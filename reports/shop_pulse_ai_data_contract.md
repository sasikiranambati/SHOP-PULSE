# ShopPulse AI — Forecasting Service Data Contract Specification

**Version:** 1.0.0  
**Status:** PROPOSED & APPROVED FOR IMPLEMENTATION  
**Document Target:** `reports/shop_pulse_ai_data_contract.md`  
**Associated Deliverables:**
- Category Mapping: [reports/shop_pulse_category_mapping.csv](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/reports/shop_pulse_category_mapping.csv)
- Data Readiness Audit: [reports/shop_pulse_data_readiness.md](file:///c:/Users/karthikeya/Desktop/shopplus/SHOP-PULSE/reports/shop_pulse_data_readiness.md)

---

## 1. Overview & Purpose

This document establishes the formal data contract between the **ShopPulse Core Application** (React frontend + FastAPI backend) and the **AI Demand Forecasting Service**.

### Key Objectives
1. **Standardize Data Exchange:** Ensure shop sales, inventory levels, and store operational schedules are transmitted in a consistent, validated structure.
2. **Eliminate Data Quality Gaps:** Overcome the findings of Milestone 4.1 (`NULL` categories, missing SKUs, indistinguishable shop-closure days).
3. **Multi-Horizon Support:** Provide data structures that support both immediate **statistical forecasting** (Option C) and future **machine learning retraining** on Indian retail records (Option B).

---

## 2. Ingestion Data Contract (Shop $\to$ Forecasting Service)

Data is transmitted daily at the close of business (or on-demand during an analytics refresh) as an array of validated daily product-record objects.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ShopPulse Core Backend                          │
│  - Aggregates daily sales & inventory from SQLite / PostgreSQL         │
│  - Formats payload against AI Data Contract Schema                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ POST /api/v1/forecast/ingest
                                    │ (JSON or Gzip Parquet/CSV)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Forecasting Ingestion Pipeline                     │
│  - Pydantic Schema Validation (Strict Type & Range Checks)             │
│  - Zero-Fill / Calendar Reindexing (Closed vs. Open Days)              │
│  - Category Aggregation & Top-Down Disaggregation                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Field Specification & Validation Rules

| Field Name | Type | Requirement | Constraints & Validation Rules | Description |
| :--- | :--- | :---: | :--- | :--- |
| **`shop_id`** | `UUID` (String) | **Required** | Valid RFC 4122 UUID string. Must match authenticated tenant shop. | Unique identifier of the retail shop. |
| **`date`** | `String` | **Required** | ISO 8601 calendar date (`YYYY-MM-DD`). Must not be future date. | Transaction / observation calendar date. |
| **`category`** | `String` | **Required** | Non-empty string. Must match one of the standardized categories: `Dairy`, `Groceries`, `Snacks`, `Beverages`, `Household`, `Personal Care`, `Bakery`, `Staples`, `Grains`, `Biscuits`, `Oils`, `Spices`, `General`, `Other`. | Standardized product category name. |
| **`sku`** | `String` | **Optional** | Alphanumeric string, 3 to 64 chars. Barcode (EAN-13, UPC) or internal SKU code. | Unique SKU or barcode identifier for the product item. |
| **`product_id`** | `UUID` (String) | **Required** | Valid RFC 4122 UUID. References `products.id`. | Internal ShopPulse product ID. |
| **`product_name`** | `String` | **Required** | String, 1 to 255 chars. | Display name of the product (e.g. `Toned Milk (500ml)`). |
| **`quantity_sold`** | `Float` | **Required** | Float $\ge 0.0$. Negative values (returns) must be logged as separate return records or netted out beforehand. | Total units or weight (kg/l) sold on this calendar day. |
| **`selling_price`** | `Float` | **Required** | Float $> 0.0$. | Unit selling price charged to customers on this date (in INR ₹). |
| **`purchase_price`**| `Float` | **Optional** | Float $\ge 0.0$. Defaults to `0.0`. | Unit cost / wholesale purchase price from supplier (in INR ₹). |
| **`current_stock`** | `Integer` | **Required** | Integer $\ge 0$. | End-of-day remaining inventory quantity in store. |
| **`reorder_level`** | `Integer` | **Optional** | Integer $\ge 0$. Defaults to `0`. | Minimum safety stock threshold defined by the shopkeeper. |
| **`unit`** | `String` | **Optional** | String from enum: `pcs`, `pkts`, `bottles`, `kg`, `g`, `l`, `ml`, `trays`, `boxes`, `bags`. Defaults to `pcs`. | Unit of measurement. |
| **`is_shop_open`** | `Boolean` | **Required** | Boolean (`true` or `false`). | Explicit indicator of whether the store was open for business on this date. |
| **`on_promotion`** | `Boolean` | **Optional** | Boolean (`true` or `false`). Defaults to `false`. | Indicates whether this item was featured in a promotional discount or display. |

---

## 3. Data Quality & Missing-Data Handling Rules

To prevent data corruption, negative feedback loops, and training-serving skew, the ingestion pipeline enforces the following deterministic rules:

### Rule 1: Closed Days vs. Zero-Sales Days
- **If `is_shop_open == false`:**
  - The day is flagged as a **Store Closure**.
  - `quantity_sold` is treated as **Structurally Missing (Censored)**, NOT as organic zero customer demand.
  - In statistical models, closed days are excluded from velocity denominators.
  - In future ML models, closed days are assigned synthetic closure rows with indicator `is_closed = 1`.
- **If `is_shop_open == true` and no sales record exists:**
  - The pipeline automatically inserts a zero-sale record (`quantity_sold = 0.0`).
  - This accurately reflects zero customer demand while the store was operational.

### Rule 2: Stockout Censoring Handling
- If `current_stock == 0` and `quantity_sold == 0`:
  - The record is flagged as `is_stockout_censored = true`.
  - True demand was likely greater than zero, but sales were constrained by lack of inventory.
  - The forecasting service substitutes the SKU's trailing 7-day average non-zero velocity rather than raw 0 to avoid under-predicting future orders.

### Rule 3: Category Assignment Fallback
- If a record arrives with `category == NULL` or empty string:
  1. The pipeline checks `products.category` in the master catalog.
  2. If still unassigned, the item name is parsed by the multilingual concept extractor (`inventory_matcher.py`).
  3. If unclassifiable, it is assigned `category = "General"` and flagged for shopkeeper review.

### Rule 4: Unit Normalization
- Packaged goods (`pcs`, `pkts`, `bottles`, `boxes`, `trays`) are counted in integer units.
- Bulk items (`kg`, `l`) are rounded to 2 decimal places.

---

## 4. Transmission Payload Formats

### 4.1 JSON Ingestion Payload Format (`POST /api/v1/forecast/ingest`)

```json
{
  "contract_version": "1.0.0",
  "shop_id": "4a7b9c1d-8e2f-4a3b-9c1d-8e2f4a3b9c1d",
  "batch_date": "2026-11-03",
  "is_shop_open": true,
  "records": [
    {
      "product_id": "00ef5fa8-fd0c-42cf-bebf-ffe41b3ae0be",
      "sku": "8901030865421",
      "product_name": "Toned Milk (500ml)",
      "category": "Dairy",
      "unit": "pkts",
      "quantity_sold": 24.0,
      "selling_price": 28.0,
      "purchase_price": 22.0,
      "current_stock": 6,
      "reorder_level": 20,
      "on_promotion": false
    },
    {
      "product_id": "9398dbff-4937-4c75-93b8-c29999f01eed",
      "sku": "8901725131234",
      "product_name": "Fresh White Bread (400g)",
      "category": "Bakery",
      "unit": "pkts",
      "quantity_sold": 15.0,
      "selling_price": 45.0,
      "purchase_price": 35.0,
      "current_stock": 2,
      "reorder_level": 15,
      "on_promotion": false
    }
  ]
}
```

---

## 5. Egress Data Contract (Forecasting Service $\to$ Frontend / UI)

When the frontend queries for predictions (`GET /api/v1/forecast/insights` or `POST /api/v1/forecast/run`), the forecasting service returns both category-level macro projections and actionable SKU-level reorder recommendations:

### 5.1 Response Payload Specification

```json
{
  "contract_version": "1.0.0",
  "shop_id": "4a7b9c1d-8e2f-4a3b-9c1d-8e2f4a3b9c1d",
  "forecast_generated_at": "2026-11-03T01:30:00Z",
  "forecast_horizon_days": 7,
  "engine_type": "STATISTICAL_V1",
  "category_forecasts": [
    {
      "category": "Dairy",
      "model_family_mapped": "DAIRY",
      "mapping_confidence": "High",
      "projected_daily_demand": [25.0, 26.5, 24.0, 24.5, 28.0, 34.0, 32.0],
      "projected_7d_total": 194.0,
      "trend_direction": "INCREASING",
      "weekend_surge_pct": 28.5
    },
    {
      "category": "Bakery",
      "model_family_mapped": "BREAD/BAKERY",
      "mapping_confidence": "High",
      "projected_daily_demand": [14.0, 14.5, 13.5, 15.0, 17.0, 21.0, 20.0],
      "projected_7d_total": 115.0,
      "trend_direction": "STABLE",
      "weekend_surge_pct": 35.0
    }
  ],
  "sku_recommendations": [
    {
      "product_id": "00ef5fa8-fd0c-42cf-bebf-ffe41b3ae0be",
      "product_name": "Toned Milk (500ml)",
      "category": "Dairy",
      "current_stock": 6,
      "reorder_level": 20,
      "projected_daily_velocity": 24.2,
      "stockout_horizon_days": 0.25,
      "urgency_level": "CRITICAL",
      "recommended_reorder_qty": 45,
      "rationale": "Current stock (6 pkts) will exhaust within 6 hours. High weekend demand projected."
    },
    {
      "product_id": "9398dbff-4937-4c75-93b8-c29999f01eed",
      "product_name": "Fresh White Bread (400g)",
      "category": "Bakery",
      "current_stock": 2,
      "reorder_level": 15,
      "projected_daily_velocity": 14.8,
      "stockout_horizon_days": 0.14,
      "urgency_level": "CRITICAL",
      "recommended_reorder_qty": 30,
      "rationale": "Critically low stock (< 2 loaves). Projected weekend demand requires 30 units."
    }
  ]
}
```

---

## 6. Implementation Guidelines for FastAPI Backend

1. **Pydantic Validation:**
   Define `DailyShopDataPayload`, `DailyProductRecord`, and `ForecastResponse` schemas in `backend/schemas/forecast.py` strictly enforcing the constraints above.
2. **Database Integrity Migration:**
   Add `is_shop_open: bool = True` to a new `shop_calendar` table or add operating schedules to `shops`.
3. **Data Logging Service:**
   Create an asynchronous event subscriber that records clean daily rollups upon each POS checkout and purchase confirmation.
4. **Graceful Error Handling:**
   If a payload fails validation, reject with `422 Unprocessable Entity` and explicit field-level error messages (e.g. `"category 'Miscellaneous' is not in allowed category master list"`).

---

## 7. Sign-Off & Verification

- [x] Schema covers all 9 required fields: `shop_id`, `date`, `category`, `sku`, `quantity_sold`, `on_promotion`, `is_shop_open`, `current_stock`, `reorder_level`.
- [x] Clear validation rules, types, and constraints defined.
- [x] Closed days vs zero-sales days explicitly disambiguated.
- [x] Both ingestion and egress payload specifications documented.
- [x] Backwards-compatible with Option C (statistical) and forwards-compatible with Option B (machine learning).
