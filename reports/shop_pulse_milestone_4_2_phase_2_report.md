# ShopPulse Milestone 4.2 — Phase 2: Backend APIs & Business Logic Report

**Milestone:** 4.2 — Data Foundation & Business Logic  
**Phase:** Phase 2 (Backend APIs & Business Logic)  
**Status:** Completed & Fully Verified  
**Branch:** `feature/shoppulse-ai`  
**Date:** November 2026  

---

## 1. Executive Summary

Phase 2 builds directly upon the database foundation established in Phase 1 without altering existing database schemas or impacting frontend components. It introduces secure, tenant-isolated backend APIs and robust business logic required to capture clean, high-fidelity retail transaction data across Indian kirana stores.

### Key Capabilities Delivered:
1. **Operating Calendar Management (`/api/v1/shop-status`)**:
   - Explicit daily operating status tracking (`is_open`, `closure_reason`, `opening_time`, `closing_time`, `notes`).
   - Shop-local operating calendar dates with UTC timestamp persistence.
   - Enforced unique constraint per `(shop_id, operating_date)` with safe, idempotent upsert semantics.
   - Protection against sales on explicitly closed days (`HTTP 409 Conflict`), with implicit open registration on unrecorded days.
2. **Product Category Master & Normalization (`/api/v1/products`)**:
   - New endpoint `GET /api/v1/products/categories` exposing the 12 canonical Indian retail categories.
   - Non-destructive category normalization during product creation and update (`raw_category` preserved, canonical taxonomy mapped to `standardized_category`, ambiguous categories flagged via `needs_category_review = True`).
   - Backward compatibility preserved for legacy consumers using `category`.
3. **Sales Data Quality Engine (`/api/v1/sales`)**:
   - Server-side UTC timestamps for all transactions.
   - Duplicate POS cart line item merging to eliminate redundant line items.
   - Unit-aware quantity validation (rejecting fractional counts for discrete units like `pcs` and `pack` while supporting fractional quantities for continuous units like `kg` and `ltr`).
   - Large quantity safety confirmation threshold (> 500 units).
   - Reliable capture of `cost_price_at_sale` from current product purchase price without historical fabrication.
4. **Sale Cancellation & Refund Safety (`/api/v1/sales/{id}/cancel`, `/refund`)**:
   - Formal sale status lifecycle: `COMPLETED`, `CANCELLED`, `REFUNDED`.
   - Idempotent sale cancellation with atomic inventory restoration.
   - Idempotent refund handling with configurable stock restoration (`restock_items=True` for restockable items, `False` for damaged/perishable goods).
   - Strict tenant isolation preventing cross-shop access or mutation.
5. **Stockout Event Lifecycle Integration**:
   - Automated creation of active `StockoutEvent` records whenever inventory is depleted to $\le 0$ by sales or manual adjustment.
   - Prevention of duplicate active stockout records.
   - Automated event resolution (`ended_at` timestamp recorded) when inventory is restored via cancellations or supplier purchases.
6. **Testing & Verification**:
   - Comprehensive test suite in `backend/tests/test_phase2_backend_apis.py` (17/17 passed).
   - Regression verification of Phase 1 foundation in `backend/tests/test_phase1_database_foundation.py` (8/8 passed).
   - Total test coverage: **25 / 25 passed (100%)**.

---

## 2. New & Enhanced API Endpoints

### 2.1 Shop Operating Status (`/api/v1/shop-status`)

| Method | Endpoint | Description | Auth Required | Status Codes |
|---|---|---|---|---|
| `POST` | `/api/v1/shop-status` | Record or idempotently update operating status for a calendar date | Bearer JWT | `201 Created` (new), `200 OK` (update), `400 Bad Request` |
| `GET` | `/api/v1/shop-status/date/{operating_date}` | Retrieve operating status of authenticated shop for a specific date | Bearer JWT | `200 OK`, `404 Not Found` |
| `PUT` | `/api/v1/shop-status/date/{operating_date}` | Update status for an existing calendar date | Bearer JWT | `200 OK`, `404 Not Found` |
| `GET` | `/api/v1/shop-status` | Query paginated calendar history across optional `start_date` and `end_date` | Bearer JWT | `200 OK` |

### 2.2 Product Category Master (`/api/v1/products/categories`)

| Method | Endpoint | Description | Auth Required | Status Codes |
|---|---|---|---|---|
| `GET` | `/api/v1/products/categories` | Retrieve canonical 12 Indian retail categories with codes, names, descriptions, and sort orders | Bearer JWT | `200 OK` |

### 2.3 Sales Cancellation & Refund (`/api/v1/sales/{id}`)

| Method | Endpoint | Description | Auth Required | Status Codes |
|---|---|---|---|---|
| `POST` | `/api/v1/sales/{id}/cancel` | Cancel erroneous/aborted checkout; restores inventory atomically; idempotent | Bearer JWT | `200 OK`, `400 Bad Request`, `403 Forbidden`, `404 Not Found` |
| `POST` | `/api/v1/sales/{id}/refund` | Refund completed transaction; optional stock restoration; idempotent | Bearer JWT | `200 OK`, `400 Bad Request`, `403 Forbidden`, `404 Not Found` |
| `GET` | `/api/v1/sales` | Enhanced with `status` query filter (`COMPLETED`, `CANCELLED`, `REFUNDED`) | Bearer JWT | `200 OK` |

---

## 3. Request & Response Schemas

### 3.1 Operating Status Schemas (`backend/schemas/shop_status.py`)

#### `ShopOperatingStatusCreate` (Request)
```json
{
  "operating_date": "2026-11-03",
  "is_open": false,
  "opening_time": null,
  "closing_time": null,
  "closure_reason": "FESTIVAL",
  "notes": "Diwali holiday closure"
}
```

#### `ShopOperatingStatusUpdate` (Request)
```json
{
  "is_open": true,
  "opening_time": "08:30:00",
  "closing_time": "22:00:00",
  "closure_reason": null,
  "notes": "Regular operations resumed"
}
```

#### `ShopOperatingStatusResponse` (Response)
```json
{
  "id": "c1f7b029-4bf9-45e0-8a15-0f62b7746401",
  "shop_id": "8bb384d1-bf0d-4a11-827c-2b6fb5a8dae4",
  "operating_date": "2026-11-03",
  "is_open": false,
  "opening_time": null,
  "closing_time": null,
  "closure_reason": "FESTIVAL",
  "notes": "Diwali holiday closure",
  "created_at": "2026-11-02T20:25:00Z",
  "updated_at": "2026-11-02T20:25:00Z"
}
```

#### `PaginatedShopOperatingStatusResponse` (Response)
```json
{
  "items": [ ... ],
  "total": 31,
  "skip": 0,
  "limit": 50
}
```

---

### 3.2 Category & Product Schemas (`backend/schemas/product.py`)

#### `CategoryItemResponse`
```json
{
  "code": "STAPLES",
  "name": "Staples",
  "description": "Atta (wheat flour), maida, sooji, besan, salt, refined sugar, and jaggery.",
  "display_order": 2
}
```

#### `ProductResponse` (Enhanced with Phase 1 & 2 additions)
```json
{
  "id": "e2d091ab-67b1-4d1a-a16b-16d7eb599298",
  "shop_id": "8bb384d1-bf0d-4a11-827c-2b6fb5a8dae4",
  "name": "Fortune Sunflower Oil 1L",
  "category": "Edible Oil",
  "standardized_category": "Edible Oils",
  "raw_category": "Edible Oil",
  "needs_category_review": false,
  "selling_price": 140.0,
  "purchase_price": 120.0,
  "mrp": 150.0,
  "mrp_source": "MANUAL",
  "mrp_updated_at": "2026-11-02T20:30:00Z",
  "current_stock": 15,
  "reorder_level": 5,
  "unit": "pcs",
  "is_active": true,
  "last_stockout_at": null,
  "created_at": "2026-11-02T20:30:00Z",
  "updated_at": "2026-11-02T20:30:00Z"
}
```

---

### 3.3 Sales Schemas (`backend/schemas/sale.py`)

#### `SaleCreate` (Enhanced)
```json
{
  "items": [
    {
      "product_id": "e2d091ab-67b1-4d1a-a16b-16d7eb599298",
      "quantity": 2.5,
      "unit_price": 140.0,
      "confirmed_large_quantity": false
    }
  ],
  "payment_method": "upi",
  "operating_date": "2026-11-03",
  "confirmed_large_quantity": false
}
```

#### `SaleCancelRequest` & `SaleRefundRequest`
```json
// POST /api/v1/sales/{id}/cancel
{
  "reason": "Customer entered wrong phone number and aborted checkout"
}

// POST /api/v1/sales/{id}/refund
{
  "reason": "Damaged goods return - seal broken",
  "restock_items": false
}
```

#### `SaleResponse` (Enhanced)
```json
{
  "id": "5fa2dc50-c63e-48a5-b1a7-f9d2cb039d41",
  "shop_id": "8bb384d1-bf0d-4a11-827c-2b6fb5a8dae4",
  "total_amount": 350.0,
  "payment_method": "upi",
  "status": "COMPLETED",
  "cancelled_at": null,
  "cancellation_reason": null,
  "items": [
    {
      "id": "76ba3f56-7871-41fa-806b-2877a11eb9f0",
      "sale_id": "5fa2dc50-c63e-48a5-b1a7-f9d2cb039d41",
      "product_id": "e2d091ab-67b1-4d1a-a16b-16d7eb599298",
      "quantity": 2.5,
      "unit_price": 140.0,
      "cost_price_at_sale": 120.0,
      "created_at": "2026-11-02T20:35:00Z"
    }
  ],
  "created_at": "2026-11-02T20:35:00Z",
  "updated_at": "2026-11-02T20:35:00Z"
}
```

---

## 4. Business Logic Changes & Architectural Rationale

### 4.1 Operating Calendar & POS Closed-Day Conflict Management
- **Local Date Handling**: Retailers operate on local shop calendar dates (e.g., IST). Timestamps are recorded in UTC, but the operational calendar day `operating_date` is evaluated against shop-local date.
- **Closed Day Conflict (`HTTP 409`)**: If a retailer explicitly recorded that the shop is closed on date $D$ (`is_open = False`), any attempt to check out sales on date $D$ raises `HTTP 409 Conflict`. POS checkouts cannot silently overwrite an intentional closure.
- **Implicit Open Registration**: If no calendar record exists for date $D$, completing a legitimate POS checkout automatically creates an implicit record with `is_open = True` and notes indicating creation via POS checkout.
- **Idempotent Upsert**: POSTing an operating status for an existing date performs an idempotent update with `200 OK` rather than failing with database constraint violations.

### 4.2 Product Category Normalization
- **12 Canonical Categories**: Based on Indian Kirana taxonomy (`Dairy`, `Staples`, `Grains and Pulses`, `Snacks`, `Beverages`, `Bakery`, `Personal Care`, `Household and Cleaning`, `Spices`, `Edible Oils`, `Baby Care`, `Other`).
- **Non-Destructive Normalization**:
  - `raw_category` preserves the exact input entered by the user.
  - `standardized_category` receives the canonical taxonomy category.
  - `needs_category_review` is set to `True` if the category was unrecognized or mapped into generic `"Other"`.
  - Canonical categories or unambiguous aliases (e.g., `"edible oil"` $\to$ `"Edible Oils"`, `"pulses"` $\to$ `"Grains and Pulses"`) are mapped cleanly with `needs_category_review = False`.
  - Legacy `category` column remains populated for backward compatibility with existing frontends and reports.

### 4.3 Sales Quality Engine
- **Cart Line Merging**: Multiple cart lines specifying the same `product_id` are aggregated into a single consolidated `SaleItem` with combined quantity and subtotal before validation or stock deduction.
- **Unit Granularity Validation**:
  - Discrete count units (`pcs`, `pack`, `bottles`, `boxes`, `trays`) reject fractional quantities (e.g., $1.5$ pcs) with `HTTP 400 Bad Request`.
  - Continuous measurement units (`kg`, `gm`, `ltr`, `ml`) accept fractional quantities (e.g., $2.5$ kg).
  - Quantities $\le 0$ are rejected by Pydantic validation (`HTTP 422`).
- **Large Quantity Safeguard**: Cart items with quantity $> 500$ require explicit confirmation (`confirmed_large_quantity = True`) to prevent accidental barcode scanner multiplier mistakes.
- **Reliable Cost Price Capture**: `cost_price_at_sale` on `sale_items` is populated directly from the product's active `purchase_price` if $> 0$. If unpopulated or zero, it is left `NULL` to avoid fabricating historical cost data.

### 4.4 Sale Cancellation vs. Refund Distinction
- **Cancellation (`cancel_sale`)**:
  - **Purpose**: Voiding an erroneous or aborted checkout (e.g. wrong barcode scanned, customer aborts payment at counter).
  - **Inventory**: Unconditionally restores stock to products atomically.
  - **Status**: Sets `status = "CANCELLED"`.
  - **Idempotency**: Repeated calls return the cancelled sale with no repeated stock increments.
  - **Constraint**: Cannot cancel a sale that has already been refunded.
- **Refund (`refund_sale`)**:
  - **Purpose**: Post-sale customer dispute, return, or exchange.
  - **Inventory**: Configurable via `restock_items`. If `True`, inventory is returned to shelf. If `False` (damaged packaging, perishable expired goods), inventory is NOT restored.
  - **Status**: Sets `status = "REFUNDED"`.
  - **Idempotency**: Repeated calls return the refunded sale without duplicate restocking.
  - **Constraint**: Cannot refund a sale that has already been cancelled.

### 4.5 Stockout Event Lifecycle
- **Depletion to Zero ($\le 0$)**: When inventory reaches zero or negative via POS checkout or manual adjustment, `record_stockout_event_if_depleted` checks for any unclosed event (`ended_at IS NULL`). If none exists, it opens a new `StockoutEvent` and updates `product.last_stockout_at`.
- **Restocking ($> 0$)**: When inventory is replenished via purchase order receiving, sale cancellation, or customer refund restock, `resolve_active_stockout_events_if_restocked` finds all active events for `(shop_id, product_id)` and sets `ended_at = now_utc`.

---

## 5. Authorization & Multi-Tenant Safeguards

1. **Resolution via Session User**: All endpoints resolve the active shop strictly using `get_user_shop_or_raise(db, current_user)`.
2. **Untrusted `shop_id` Rejection**: Request payloads never accept an arbitrary `shop_id` parameter to determine tenancy. Tenancy is strictly derived from the verified JWT identity.
3. **Cross-Shop Mutation Isolation**:
   - Accessing or mutating a sale belonging to another shop returns `HTTP 403 Forbidden`.
   - Modifying operating calendar records belonging to another shop is impossible because all queries filter on `shop_id == user_shop.id`.
4. **Independent Calendars**: Multiple shops operating on the same physical calendar date maintain completely independent records with zero cross-contamination.

---

## 6. Test Suite & Verification Results

### 6.1 Phase 2 Backend APIs Test Suite (`backend/tests/test_phase2_backend_apis.py`)

All 17 tests passed cleanly:
```
test_01_record_and_get_shop_status .................................................... ok
test_02_duplicate_operating_status_idempotent ......................................... ok
test_03_update_operating_status_endpoint .............................................. ok
test_04_operating_status_history_date_range ........................................... ok
test_05_independent_calendars_for_multiple_shops ...................................... ok
test_06_get_canonical_categories ...................................................... ok
test_07_product_creation_category_normalization ....................................... ok
test_08_sales_duplicate_line_merging_and_cost_price ................................... ok
test_09_sales_quantity_validation ..................................................... ok
test_10_bulk_quantity_threshold_confirmation .......................................... ok
test_11_closed_day_conflict_and_implicit_open ......................................... ok
test_12_sale_cancellation_and_inventory_restoration ................................... ok
test_13_sale_refund_with_and_without_restock .......................................... ok
test_14_unauthorized_cross_shop_mutation .............................................. ok
test_15_stockout_event_lifecycle_with_sale_and_cancel ................................. ok
test_16_existing_pos_checkout_flow .................................................... ok
test_17_purchase_restock_resolves_stockout ............................................ ok

----------------------------------------------------------------------
Ran 17 tests in 19.626s
OK
```

### 6.2 Phase 1 Database Foundation Regression Suite (`backend/tests/test_phase1_database_foundation.py`)

All 8 tests passed cleanly:
```
test_01_new_tables_and_columns_exist .................................................. ok
test_02_unique_shop_operating_date_constraint ......................................... ok
test_03_multi_shops_independent_operating_calendars ................................... ok
test_04_stockout_event_lifecycle ...................................................... ok
test_05_category_master_seeding ....................................................... ok
test_06_category_normalization_logic .................................................. ok
test_07_existing_product_and_sales_compatibility ...................................... ok
test_08_repeated_migration_idempotency ................................................ ok

----------------------------------------------------------------------
Ran 8 tests in 0.397s
OK
```

**Overall Combined Test Result:** 25 / 25 tests passed (100% success rate).

---

## 7. Compatibility with Existing Functionality

1. **POS Checkout Semantics**: Legacy POS checkout clients continue to send `{"items": [{"product_id": "...", "quantity": 1}]}` without breaking. New fields are optional and default safely.
2. **Product API Consumers**: Legacy clients that read `product.category` receive the familiar category string while newer consumers have access to `standardized_category`, `raw_category`, and `needs_category_review`.
3. **Database Integrity**: SQLite production (`backend/shoppulse.db`) and development (`backend/shoppulse_dev.db`) databases are untouched by destructive operations; all additions remain additive.
4. **Existing Backups**: Database backups preserved in `backups/db_backup_20261103_milestone4_2/`.

---

## 8. Known Limitations & Recommendations for Phase 3

1. **Timezone Configuration**: Shop models currently assume local time is aligned with Indian Standard Time (IST). For national multi-state rollouts spanning varying operating rules, adding an optional `timezone` field to `Shop` could provide explicit offset handling.
2. **Partial Line Returns**: The current `refund_sale` voids the entire transaction or restores all items based on `restock_items`. Line-item level partial refunds (e.g., refunding 1 of 3 items from a cart) can be added in future iterations if requested.
3. **Stop Criterion Met**: In compliance with user instructions, execution stops here. Phase 3 (Frontend & User Experience Integrations) must not begin until this report and its test results are formally reviewed and approved.
