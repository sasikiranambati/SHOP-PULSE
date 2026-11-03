from typing import Optional, List
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ProductForecastResponse(BaseModel):
    product_id: UUID = Field(..., description="Unique product ID")
    product_name: str = Field(..., description="Product display name")
    standardized_category: Optional[str] = Field(None, description="Canonical Indian retail category")
    current_stock: float = Field(..., description="Current available inventory")
    reorder_level: Optional[int] = Field(None, description="Configured reorder threshold")
    unit: str = Field("pcs", description="Unit of measurement")
    valid_history_days: int = Field(..., description="Number of valid open selling days observed")
    average_daily_demand: Optional[float] = Field(None, description="Estimated average daily customer demand")
    estimated_weekly_demand: Optional[float] = Field(None, description="Estimated demand over the next 7 days")
    days_until_stockout: Optional[float] = Field(None, description="Estimated days until inventory reaches zero")
    stockout_risk: str = Field(..., description="Risk tier: OUT_OF_STOCK, HIGH, MEDIUM, LOW, UNKNOWN")
    forecast_method: str = Field(..., description="Method used: INSUFFICIENT_HISTORY, MOVING_AVERAGE_7, WEEKDAY_SEASONAL")
    confidence_status: str = Field(..., description="Maturity tier: INSUFFICIENT_DATA, STAGE_1_MOVING_AVERAGE, STAGE_2_WEEKDAY_SEASONAL")
    recommended_reorder_quantity: Optional[int] = Field(None, description="Recommended reorder amount based on 7-day demand")
    has_stockout_censoring: bool = Field(False, description="Flag indicating zero-sales days were censored by stockouts")
    insights: str = Field(..., description="Explainable inventory and demand intelligence statement")
    warnings: List[str] = Field(default_factory=list, description="Diagnostic and data quality warnings")

    model_config = ConfigDict(from_attributes=True)


class ForecastSummaryResponse(BaseModel):
    shop_id: UUID = Field(..., description="Authenticated shop ID")
    generated_at: datetime = Field(..., description="Timestamp of forecast generation in UTC")
    total_products_analyzed: int = Field(..., description="Total products evaluated")
    products_with_forecast: int = Field(..., description="Products with Stage 1 or Stage 2 forecasts")
    products_with_insufficient_history: int = Field(..., description="Products in Stage 0 (<7 days)")
    high_risk_products_count: int = Field(..., description="Products with HIGH stockout risk")
    out_of_stock_products_count: int = Field(..., description="Products currently OUT_OF_STOCK")
    items: List[ProductForecastResponse] = Field(default_factory=list, description="Detailed product-level forecasts")

    model_config = ConfigDict(from_attributes=True)
