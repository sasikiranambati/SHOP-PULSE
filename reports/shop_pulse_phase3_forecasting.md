# ShopPulse Phase 3 — Statistical AI Forecasting Engine Technical Report

**Milestone:** 4.2 / Phase 3  
**Status:** Completed & Fully Verified  
**Branch:** `feature/phase3-forecasting`  
**Execution Environment:** Isolated In-Memory SQLite (`sqlite:///:memory:`)  
**Test Suite:** 59 / 59 Tests Passing (100% Pass Rate)  
**Date:** November 2026  

---

## 1. Executive Summary & Architectural Overview

Phase 3 introduces an explainable, reliable, and mathematically sound **Statistical AI Forecasting Engine** directly embedded within ShopPulse's FastAPI backend. 

### Core Motivation: Rejection of Kaggle Favorita LightGBM Model for Indian Kirana
In earlier exploratory work, a machine learning model trained on Ecuadorian supermarket chain data (Corporación Favorita, Kaggle Store Sales) was evaluated. A strategic architectural decision was made **not** to deploy that model to Indian kirana shops because:
1. **Taxonomic Incompatibility:** 33 Ecuadorian supermarket product families do not map cleanly to Indian kirana inventory (e.g. dals, atta, mustard oil, pooja items).
2. **Missing External Covariates:** The Kaggle model relies heavily on Ecuador crude oil prices, national public-sector paydays, and Ecuadorian national holidays which have zero causal relevance to Indian neighborhood retailers.
3. **Store Scale Mismatch:** High-volume automated retail chains operate with automated warehouse reordering and computerized distribution, while Indian kirana shops operate with localized suppliers, flexible credit, discrete packaging, and manual counter sales.
4. **Data Scarcity in New Stores:** Kirana shops onboarded to ShopPulse have little to no historical training data; complex GBDT / neural networks overfit or fail on sparse data.

Instead, Phase 3 implements an **explainable, multi-stage statistical demand forecasting engine** that uses actual, verified ShopPulse transaction and operating calendar data.

---

## 2. Historical Demand Aggregation Engine (10 Core Rules)

The service [`backend/services/forecast.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/services/forecast.py) implements the 10 data aggregation rules:

1. **Include Only Completed Sales:** Only transactions with `Sale.status == "COMPLETED"` are included in sales aggregation.
2. **Exclude Cancelled Sales:** Sales with `status == "CANCELLED"` are omitted completely.
3. **Handle Refunds Using Actual Refunded Quantities:** Sales with `status == "REFUNDED"` are excluded from customer demand. Returned items do not constitute true consumed demand.
4. **Closed Shop Days Are Not Zero-Demand Days:** Explicit closed days (`ShopOperatingStatus.is_open == False`) are omitted from valid selling days. They are never interpreted as zero-demand days.
5. **Include Genuine Open Days with Zero Sales:** If the shop was open (`is_open == True`) and had stock available, but recorded 0 sales, that day is included as a genuine zero-demand observation (`demand = 0.0`).
6. **Exclude Unknown Operating-Status Days:** Calendar dates with no recorded status in `shop_operating_status` are excluded from the valid selling day count.
7. **Handle Stockout-Censored Periods Separately:** If a product had zero sales on an open day because inventory was depleted (`StockoutEvent` was active or covered that date), that day is flagged as **stockout-censored** and excluded from zero-demand calculations. Zero sales during a stockout does not equal zero customer demand.
8. **Exclude Periods Before Product Creation:** Dates prior to `product.created_at.date()` are excluded, ensuring newly listed products are not penalized by prior shop history.
9. **Consistent Shop-Local Operating Dates:** Calendar dates are consistently matched against shop-local operating dates (`ShopOperatingStatus.operating_date`), while timestamps remain UTC.
10. **Never Invent Historical Sales or Demand:** True observed sales and censored periods are kept strictly separate; no synthetic sales are fabricated.

---

## 3. Multi-Stage Forecasting Maturity Framework

```
                       Valid Open Selling Days (N)
                                   |
         +-------------------------+-------------------------+
         |                                                   |
       N < 7                                               N >= 7
         |                                                   |
   [STAGE 0]                                                 |
Insufficient History                                         |
* No numerical forecast                                      |
* Reorder level reference                                    |
* No arbitrary numbers                                       |
                                                             |
                                  +--------------------------+--------------------------+
                                  |                                                     |
                             7 <= N <= 20                                             N >= 21
                                  |                                                     |
                              [STAGE 1]                                                 |
                          Moving Average (7)                                            |
                       * Latest 7 valid days                                            |
                       * Weekly = Avg * 7                                               |
                                                                                        |
                                                              +-------------------------+-------------------------+
                                                              |                                                   |
                                                     All 7 Weekdays >= 3 obs.                            Any Weekday < 3 obs.
                                                              |                                                   |
                                                          [STAGE 2]                                           [STAGE 1]
                                                      Weekday Seasonal                                         Fallback
                                                 * 3-observation weekday avg                          * Fallback to 7-day MA
                                                 * Seasonally weighted week                           * Warning logged
```

### Stage 0 — Insufficient History ($N < 7$)
- **Condition:** Fewer than 7 valid open selling days.
- **Method:** `INSUFFICIENT_HISTORY` (`INSUFFICIENT_DATA`).
- **Behavior:** Returns `average_daily_demand = None`, `estimated_weekly_demand = None`, `recommended_reorder_quantity = None`.
- **Transparency:** Displays configured `reorder_level` as reference. Never guesses or recommends arbitrary default quantities (e.g. 10 units).
- **Insight:** `"Demand forecast unavailable: insufficient history (N/7 valid open selling days recorded). Configured reorder level reference: X units."`

### Stage 1 — Moving Average ($7 \le N \le 20$ or Fallback)
- **Condition:** 7 to 20 valid open selling days, or fallback from Stage 2.
- **Method:** `MOVING_AVERAGE_7` (`STAGE_1_MOVING_AVERAGE`).
- **Behavior:** Calculates the mean of the latest 7 valid open selling days:
  $$\text{average\_daily\_demand} = \frac{\sum_{i=1}^{7} \text{demand}_i}{7}$$
  $$\text{estimated\_weekly\_demand} = \text{round}(\text{average\_daily\_demand} \times 7, 2)$$

### Stage 2 — Weekday-Aware Forecasting ($N \ge 21$)
- **Condition:** At least 21 valid observations and $\ge 3$ observations for all 7 upcoming weekdays.
- **Method:** `WEEKDAY_SEASONAL` (`STAGE_2_WEEKDAY_SEASONAL`).
- **Behavior:** For each of the upcoming 7 days $D + 1, \dots, D + 7$:
  $$\text{demand}_{\text{weekday}} = \frac{\sum_{j=1}^{3} \text{latest\_3\_obs}(w)}{3}$$
  $$\text{estimated\_weekly\_demand} = \sum_{k=1}^{7} \text{demand}(D + k)$$
  $$\text{average\_daily\_demand} = \text{round}(\text{estimated\_weekly\_demand} / 7.0, 2)$$
- **Fallback:** If any upcoming weekday has $< 3$ observations, automatically falls back to `MOVING_AVERAGE_7` and adds an informative diagnostic warning.

---

## 4. Inventory Intelligence & Risk Classification

### 4.1 Stockout Horizon (`days_until_stockout`)
- If `current_stock <= 0`: `0.0` days.
- If `average_daily_demand > 0`: $\text{round}(\text{current\_stock} / \text{average\_daily\_demand}, 1)$ days.
- If `average_daily_demand == 0` or insufficient history: `None`.

### 4.2 Stockout Risk Tiers
- **`OUT_OF_STOCK`**: `current_stock <= 0`.
- **`HIGH`**: `days_until_stockout <= 3.0` days, or `current_stock <= reorder_level`.
- **`MEDIUM`**: `3.0 < days_until_stockout <= 7.0` days.
- **`LOW`**: `days_until_stockout > 7.0` days.
- **`UNKNOWN`**: Stage 0 with no reorder level trigger.

### 4.3 Recommended Reorder Quantity
- Only generated when supported by Stage 1 or Stage 2 demand data.
- If `current_stock <= threshold` (where `threshold = reorder_level` or `average_daily_demand * 3`):
  $$\text{recommended\_quantity} = \text{max}(0, \lceil \text{estimated\_weekly\_demand} - \text{current\_stock} \rceil)$$
- If stock is healthy: `0`.
- If Stage 0: `None`.

---

## 5. API Reference: `GET /api/v1/forecast`

### Request
- **Headers:** `Authorization: Bearer <JWT>`
- **Query Parameters:**
  - `product_id: Optional[UUID]` — Filter by single product ID.
  - `standardized_category: Optional[str]` — Filter by canonical category.

### Response Example (`ForecastSummaryResponse`)
```json
{
  "shop_id": "8bb384d1-bf0d-4a11-827c-2b6fb5a8dae4",
  "generated_at": "2026-11-03T06:30:00Z",
  "total_products_analyzed": 2,
  "products_with_forecast": 1,
  "products_with_insufficient_history": 1,
  "high_risk_products_count": 1,
  "out_of_stock_products_count": 0,
  "items": [
    {
      "product_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "product_name": "Fortune Sunflower Oil 1L",
      "standardized_category": "Edible Oils",
      "current_stock": 15.0,
      "reorder_level": 20,
      "unit": "pcs",
      "valid_history_days": 14,
      "average_daily_demand": 6.0,
      "estimated_weekly_demand": 42.0,
      "days_until_stockout": 2.5,
      "stockout_risk": "HIGH",
      "forecast_method": "MOVING_AVERAGE_7",
      "confidence_status": "STAGE_1_MOVING_AVERAGE",
      "recommended_reorder_quantity": 27,
      "has_stockout_censoring": false,
      "insights": "Fortune Sunflower Oil 1L may run out in approximately 2.5 days based on recent sales. Current stock: 15 pcs. Forecast method: MOVING_AVERAGE_7.",
      "warnings": []
    },
    {
      "product_id": "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e",
      "product_name": "Organic Black Rice 500g",
      "standardized_category": "Grains and Pulses",
      "current_stock": 10.0,
      "reorder_level": 5,
      "unit": "pack",
      "valid_history_days": 3,
      "average_daily_demand": null,
      "estimated_weekly_demand": null,
      "days_until_stockout": null,
      "stockout_risk": "UNKNOWN",
      "forecast_method": "INSUFFICIENT_HISTORY",
      "confidence_status": "INSUFFICIENT_DATA",
      "recommended_reorder_quantity": null,
      "has_stockout_censoring": false,
      "insights": "Demand forecast unavailable: insufficient history (3/7 valid open selling days recorded). Configured reorder level reference: 5 pack.",
      "warnings": [
        "Insufficient sales history (3/7 valid open selling days recorded). At least 7 valid days required for statistical forecasting."
      ]
    }
  ]
}
```

---

## 6. Verification & Test Suite Results

The comprehensive test suite [`backend/tests/test_phase3_forecasting.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/tests/test_phase3_forecasting.py) was executed alongside the existing suites using [`backend/tests/run_all_automated_tests.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/tests/run_all_automated_tests.py):

```text
================================================================================
 SHOPPULSE QA AUTOMATION — FULL BACKEND WORKFLOW TEST SUITE
================================================================================
Environment: Isolated In-Memory SQLite Database
Testing Strategy: FastAPI TestClient E2E + Direct DB Assertions
--------------------------------------------------------------------------------
Discovered 59 test cases across 4 test modules.

...........................................................
----------------------------------------------------------------------
Ran 59 tests in 38.777s

OK
================================================================================
 EXECUTION SUMMARY
================================================================================
Total Tests Run   : 59
Passed            : 59
Failed            : 0
Errors            : 0
Skipped           : 0
Total Time Taken  : 38.78 seconds
--------------------------------------------------------------------------------
RESULT: ALL TESTS PASSED SUCCESSFULLY! (100% Pass Rate)
================================================================================
```

### Breakdown by Module:
1. `test_phase3_forecasting.py`: **19 / 19 passed** (covering all 20 Phase 3 scenarios: Stage 0, Stage 1, Stage 2, fallback, closed days, zero-sales days, unknown dates, cancellations, refunds, stockout censoring, product creation date, tenant isolation, no reorder level, horizon math, authentication, and filters).
2. `test_automated_workflows.py`: **15 / 15 passed** (End-to-end API workflows).
3. `test_phase2_backend_apis.py`: **17 / 17 passed** (Operating calendar, cart merging, cancellations, refunds).
4. `test_phase1_database_foundation.py`: **8 / 8 passed** (Database schemas, migrations, category master).

---

## 7. Modified & Created Files

| File | Action | Purpose |
|---|---|---|
| [`backend/schemas/forecast.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/schemas/forecast.py) | **Created** | Pydantic response models for product forecast and summary |
| [`backend/services/forecast.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/services/forecast.py) | **Created** | Core statistical demand aggregation, maturity stages, and inventory intelligence engine |
| [`backend/api/routes/forecast.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/api/routes/forecast.py) | **Created** | Authenticated, tenant-isolated `GET /api/v1/forecast` endpoint |
| [`backend/api/main.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/api/main.py) | **Modified** | Registered `forecast.router` with `/forecast` prefix |
| [`backend/tests/test_phase3_forecasting.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/tests/test_phase3_forecasting.py) | **Created** | 19 unit test cases covering all 20 Phase 3 testing requirements |
| [`backend/tests/run_all_automated_tests.py`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/backend/tests/run_all_automated_tests.py) | **Modified** | Added Phase 3 test module to the unified test runner |
| [`reports/shop_pulse_phase3_forecasting.md`](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/reports/shop_pulse_phase3_forecasting.md) | **Created** | Complete technical report and architecture documentation |

---

## 8. Limitations & Recommendations for Future Phases

1. **Lead Time Inputs:** In accordance with user rules, supplier lead time was not assumed or invented. In future phases, when actual purchase order delivery durations are recorded, supplier lead times can be incorporated into safety stock sizing.
2. **Promotional Event Multipliers:** Local festive spikes (e.g. Diwali sweet/ghee demand) can be layered on top of Stage 2 weekday forecasts as explicit calendar event multipliers once retailers annotate festival calendar events.
3. **Phase 4 Readiness:** Backend APIs, schemas, and statistical models are complete, verified, and ready for frontend visualization in Phase 4.
