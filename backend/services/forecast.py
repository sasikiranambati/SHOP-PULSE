import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List, Dict, Tuple, Any
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models.product import Product
from db.models.sale import Sale
from db.models.sale_item import SaleItem
from db.models.shop_operating_status import ShopOperatingStatus
from db.models.stockout_event import StockoutEvent
from schemas.forecast import ProductForecastResponse, ForecastSummaryResponse


def get_product_demand_history(
    db: Session,
    shop_id: UUID,
    product: Product
) -> Tuple[List[Dict[str, Any]], bool, int]:
    """
    Calculates valid daily customer demand observations for a product according to Phase 3 rules:
      1. Include only completed sales.
      2. Exclude cancelled sales.
      3. Exclude refunded sales (returned quantities are not demand).
      4. Exclude explicitly closed shop days.
      5. Include genuine open days with zero sales.
      6. Exclude unknown operating-status days.
      7. Exclude stockout-censored periods (zero sales during stockout != zero demand).
      8. Exclude periods before product creation date.
      9. Use shop-local operating dates.
      10. Never fabricate historical demand.
    
    Returns:
        (valid_observations, has_stockout_censoring, censored_days_count)
    """
    # Rule 8: Exclude periods before product was created
    created_date = product.created_at.date() if product.created_at else date.today()

    # Rule 4 & 6: Query operating calendar for the shop starting from creation date
    operating_records = db.query(ShopOperatingStatus).filter(
        ShopOperatingStatus.shop_id == shop_id,
        ShopOperatingStatus.operating_date >= created_date,
    ).all()

    # Map operating dates to is_open status
    operating_calendar: Dict[date, bool] = {
        rec.operating_date: rec.is_open for rec in operating_records
    }

    # Rule 1, 2, 3: Query sales for this product and shop
    # Exclude CANCELLED and REFUNDED sales
    completed_sale_items = db.query(SaleItem).join(Sale).filter(
        Sale.shop_id == shop_id,
        SaleItem.product_id == product.id,
        Sale.status == "COMPLETED",
    ).all()

    # Group completed sales by date
    daily_sales: Dict[date, float] = {}
    for item in completed_sale_items:
        sale_date = item.sale.created_at.date() if item.sale and item.sale.created_at else created_date
        daily_sales[sale_date] = daily_sales.get(sale_date, 0.0) + float(item.quantity)

    # Rule 7: Fetch all stockout events for this product and shop
    stockout_events = db.query(StockoutEvent).filter(
        StockoutEvent.shop_id == shop_id,
        StockoutEvent.product_id == product.id,
    ).all()

    def is_date_in_stockout(target_date: date) -> bool:
        for ev in stockout_events:
            start_d = ev.started_at.date()
            end_d = ev.ended_at.date() if ev.ended_at else None
            if start_d <= target_date:
                if end_d is None or end_d >= target_date:
                    return True
        return False

    has_stockout_censoring = False
    censored_days_count = 0
    valid_observations: List[Dict[str, Any]] = []

    # Iterate through recorded calendar dates in chronological order
    for op_date in sorted(operating_calendar.keys()):
        is_open = operating_calendar[op_date]

        # Rule 4: Do not treat closed shop days as zero-demand days
        if not is_open:
            continue

        sold_qty = daily_sales.get(op_date, 0.0)

        if sold_qty > 0:
            # Positive demand observed on an open day
            valid_observations.append({
                "date": op_date,
                "demand": sold_qty,
                "weekday": op_date.weekday(),
            })
        else:
            # Zero sales on an open day: check for stockout censoring
            if is_date_in_stockout(op_date):
                # Rule 7: Stockout-censored zero sales; do not treat as zero customer demand
                has_stockout_censoring = True
                censored_days_count += 1
            else:
                # Rule 5: Genuine open day with zero sales
                valid_observations.append({
                    "date": op_date,
                    "demand": 0.0,
                    "weekday": op_date.weekday(),
                })

    return valid_observations, has_stockout_censoring, censored_days_count


def forecast_product(
    db: Session,
    shop_id: UUID,
    product: Product,
    reference_date: Optional[date] = None
) -> ProductForecastResponse:
    """
    Computes multi-stage statistical forecast and inventory intelligence for a single product.
    """
    if reference_date is None:
        reference_date = datetime.now(timezone.utc).date()

    valid_observations, has_censoring, censored_count = get_product_demand_history(
        db, shop_id=shop_id, product=product
    )

    n_valid = len(valid_observations)
    current_stock = float(product.current_stock)
    reorder_level = product.reorder_level
    unit = product.unit or "pcs"
    warnings: List[str] = []

    if has_censoring:
        warnings.append(
            f"Detected {censored_count} stockout-censored open day(s). "
            "Zero-sales during stockouts were excluded to avoid underestimating demand."
        )

    if reorder_level is None or reorder_level == 0:
        warnings.append("No reorder level configured for this product.")

    # ---------------------------------------------------------
    # Step 3: Forecasting Maturity Levels
    # ---------------------------------------------------------
    forecast_method: str
    confidence_status: str
    average_daily_demand: Optional[float] = None
    estimated_weekly_demand: Optional[float] = None

    if n_valid < 7:
        # Stage 0 — Insufficient history
        forecast_method = "INSUFFICIENT_HISTORY"
        confidence_status = "INSUFFICIENT_DATA"
        average_daily_demand = None
        estimated_weekly_demand = None
        warnings.append(
            f"Insufficient sales history ({n_valid}/7 valid open selling days recorded). "
            "At least 7 valid days required for statistical forecasting."
        )

    elif 7 <= n_valid <= 20:
        # Stage 1 — Moving average using latest 7 valid open selling days
        forecast_method = "MOVING_AVERAGE_7"
        confidence_status = "STAGE_1_MOVING_AVERAGE"
        latest_7 = valid_observations[-7:]
        avg_demand = sum(o["demand"] for o in latest_7) / 7.0
        average_daily_demand = round(avg_demand, 2)
        estimated_weekly_demand = round(avg_demand * 7.0, 2)

    else:
        # Stage 2 — Weekday-aware forecasting (>= 21 valid days)
        # Check weekday history across valid observations
        weekday_map: Dict[int, List[float]] = {w: [] for w in range(7)}
        for obs in valid_observations:
            weekday_map[obs["weekday"]].append(obs["demand"])

        # Check if relevant upcoming weekdays have >= 3 observations
        all_weekdays_sufficient = True
        upcoming_7_days_demand: List[float] = []

        for offset in range(1, 8):
            target_weekday = (reference_date + timedelta(days=offset)).weekday()
            weekday_history = weekday_map[target_weekday]
            if len(weekday_history) >= 3:
                # Average of latest 3 observations for that weekday
                latest_3_weekday = weekday_history[-3:]
                weekday_pred = sum(latest_3_weekday) / 3.0
                upcoming_7_days_demand.append(weekday_pred)
            else:
                all_weekdays_sufficient = False
                break

        if all_weekdays_sufficient:
            forecast_method = "WEEKDAY_SEASONAL"
            confidence_status = "STAGE_2_WEEKDAY_SEASONAL"
            weekly_sum = sum(upcoming_7_days_demand)
            estimated_weekly_demand = round(weekly_sum, 2)
            average_daily_demand = round(weekly_sum / 7.0, 2)
        else:
            # Fall back to 7-valid-open-day moving average
            forecast_method = "MOVING_AVERAGE_7"
            confidence_status = "STAGE_1_MOVING_AVERAGE"
            latest_7 = valid_observations[-7:]
            avg_demand = sum(o["demand"] for o in latest_7) / 7.0
            average_daily_demand = round(avg_demand, 2)
            estimated_weekly_demand = round(avg_demand * 7.0, 2)
            warnings.append(
                "Fell back to 7-day moving average: insufficient observations (<3) for some upcoming weekdays."
            )

    # ---------------------------------------------------------
    # Step 4: Inventory Intelligence & Risk Classification
    # ---------------------------------------------------------
    days_until_stockout: Optional[float] = None
    stockout_risk: str
    recommended_reorder_quantity: Optional[int] = None

    if current_stock <= 0:
        days_until_stockout = 0.0
        stockout_risk = "OUT_OF_STOCK"
    elif average_daily_demand is not None and average_daily_demand > 0:
        raw_days = current_stock / average_daily_demand
        days_until_stockout = round(raw_days, 1)
        if days_until_stockout <= 3.0:
            stockout_risk = "HIGH"
        elif days_until_stockout <= 7.0:
            stockout_risk = "MEDIUM"
        else:
            stockout_risk = "LOW"
    else:
        # Zero average demand or insufficient history
        if reorder_level and current_stock <= reorder_level:
            stockout_risk = "HIGH"
        else:
            stockout_risk = "UNKNOWN" if forecast_method == "INSUFFICIENT_HISTORY" else "LOW"

    # Reorder Recommendation: Only when supported by reliable demand data
    if forecast_method != "INSUFFICIENT_HISTORY" and average_daily_demand is not None and estimated_weekly_demand is not None:
        threshold = float(reorder_level) if (reorder_level and reorder_level > 0) else (average_daily_demand * 3.0)
        if current_stock <= threshold:
            needed = math.ceil(max(0.0, estimated_weekly_demand - current_stock))
            recommended_reorder_quantity = needed if needed > 0 else None
        else:
            recommended_reorder_quantity = 0
    else:
        # Never guess an arbitrary default quantity (e.g. 10 units)
        recommended_reorder_quantity = None

    # Explainable Insights Message
    if current_stock <= 0:
        insights = f"{product.name} is currently OUT OF STOCK (0 {unit}). Immediate replenishment required."
    elif forecast_method != "INSUFFICIENT_HISTORY" and days_until_stockout is not None:
        insights = (
            f"{product.name} may run out in approximately {days_until_stockout} days based on recent sales. "
            f"Current stock: {current_stock:g} {unit}. Forecast method: {forecast_method}."
        )
    elif forecast_method != "INSUFFICIENT_HISTORY" and average_daily_demand == 0.0:
        insights = (
            f"{product.name} had zero customer demand across {n_valid} valid open days. "
            f"Current stock: {current_stock:g} {unit}. Forecast method: {forecast_method}."
        )
    else:
        ref_text = f"Configured reorder level reference: {reorder_level} {unit}." if reorder_level else "No reorder level set."
        insights = (
            f"Demand forecast unavailable: insufficient history ({n_valid}/7 valid open selling days recorded). "
            f"{ref_text}"
        )

    return ProductForecastResponse(
        product_id=product.id,
        product_name=product.name,
        standardized_category=product.standardized_category,
        current_stock=current_stock,
        reorder_level=reorder_level,
        unit=unit,
        valid_history_days=n_valid,
        average_daily_demand=average_daily_demand,
        estimated_weekly_demand=estimated_weekly_demand,
        days_until_stockout=days_until_stockout,
        stockout_risk=stockout_risk,
        forecast_method=forecast_method,
        confidence_status=confidence_status,
        recommended_reorder_quantity=recommended_reorder_quantity,
        has_stockout_censoring=has_censoring,
        insights=insights,
        warnings=warnings,
    )


def generate_shop_forecast(
    db: Session,
    shop_id: UUID,
    product_id: Optional[UUID] = None,
    standardized_category: Optional[str] = None
) -> ForecastSummaryResponse:
    """
    Generates shop-scoped statistical forecasts for all eligible products or a filtered subset.
    """
    query = db.query(Product).filter(
        Product.shop_id == shop_id,
        Product.is_active == True,
    )

    if product_id:
        query = query.filter(Product.id == product_id)

    if standardized_category:
        query = query.filter(
            (Product.standardized_category.ilike(standardized_category)) |
            (Product.category.ilike(standardized_category))
        )

    products = query.order_by(Product.name.asc()).all()

    now_utc = datetime.now(timezone.utc)
    items: List[ProductForecastResponse] = []
    products_with_forecast = 0
    products_with_insufficient = 0
    high_risk_count = 0
    out_of_stock_count = 0

    for prod in products:
        fc = forecast_product(db, shop_id=shop_id, product=prod, reference_date=now_utc.date())
        items.append(fc)

        if fc.forecast_method != "INSUFFICIENT_HISTORY":
            products_with_forecast += 1
        else:
            products_with_insufficient += 1

        if fc.stockout_risk == "OUT_OF_STOCK":
            out_of_stock_count += 1
            high_risk_count += 1
        elif fc.stockout_risk == "HIGH":
            high_risk_count += 1

    return ForecastSummaryResponse(
        shop_id=shop_id,
        generated_at=now_utc,
        total_products_analyzed=len(items),
        products_with_forecast=products_with_forecast,
        products_with_insufficient_history=products_with_insufficient,
        high_risk_products_count=high_risk_count,
        out_of_stock_products_count=out_of_stock_count,
        items=items,
    )
