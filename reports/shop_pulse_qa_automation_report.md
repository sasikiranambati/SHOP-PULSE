# ShopPulse Phase 1 & 2 — Full QA Automation Report

**Role:** Senior QA Automation Engineer  
**Component:** Backend Core, Database Migrations, APIs & Data Quality Engine  
**Execution Environment:** Isolated In-Memory SQLite (`sqlite:///:memory:`)  
**Database Isolation:** 100% Isolated; Production & Development SQLite Databases Unmodified  
**Test Framework:** Python `unittest` + `FastAPI TestClient` (Zero additional packages required)  
**Execution Command:** `.\venv\Scripts\python.exe backend/tests/run_all_automated_tests.py`  
**Execution Timestamp:** November 2026  
**Execution Status:** **ALL 40 TESTS PASSED (100% Pass Rate)**

---

## 1. Executive Summary & Test Plan

### 1.1 Objective
Automate comprehensive end-to-end and regression testing across everything implemented in:
- **Phase 1 (Database Foundation):** 12-category master taxonomy, additive schema columns, operating calendar table, stockout events table, and idempotent migrations.
- **Phase 2 (Backend APIs & Data Quality):** Operating calendar APIs, category normalization, sales data quality, cart line merging, atomic cancellation & refund workflows, stockout event lifecycle, and strict multi-tenant isolation.

### 1.2 Inspection & Architecture Review
1. **FastAPI Application & Dependency Injection:** The application uses `api_router` mounted under `/api/v1`. Dependencies like `deps.get_db` and `deps.get_current_user` allow clean dependency overrides with `StaticPool` in-memory SQLite instances.
2. **Database Isolation Strategy:** Production (`backend/shoppulse.db`) and development (`backend/shoppulse_dev.db`) databases are strictly protected. Every automated test suite runs against `sqlite:///:memory:`, creating all tables via `Base.metadata.create_all()` and running `init_db_schema()`, followed by automatic cleanup in `tearDown()`.
3. **Multi-Tenant Authorization Safeguards:** Every shop-scoped route uses `get_user_shop_or_raise` to derive tenant ownership from the cryptographically verified JWT bearer token. Arbitrary `shop_id` query/body parameters from untrusted requests are never accepted as authority.

---

## 2. Test Execution Summary

| Test Suite / Module | Workflows Covered | Total Tests | Passed | Failed | Errors | Skipped | Time (s) |
|---|---|---|---|---|---|---|---|
| `test_automated_workflows.py` | Workflows 1 – 18 (End-to-End API Workflows) | 15 | 15 | 0 | 0 | 0 | 12.02s |
| `test_phase1_database_foundation.py` | Workflow 19 (Database Foundation & Schema Additions) | 8 | 8 | 0 | 0 | 0 | 0.40s |
| `test_phase2_backend_apis.py` | Workflow 20 (Backend APIs & Data Quality Regressions) | 17 | 17 | 0 | 0 | 0 | 11.24s |
| **Combined Full Suite** | **All 20 Workflows** | **40** | **40** | **0** | **0** | **0** | **23.66s** |

---

## 3. Workflow-by-Workflow Coverage Matrix

| # | Workflow Description | Test Case Method | Endpoints Covered | Status |
|---|---|---|---|---|
| **1** | User registration and login | `test_wf01_register_and_login_scenarios` | `POST /api/v1/auth/register`<br>`POST /api/v1/auth/login` | **PASSED** |
| **2** | Authenticated profile access | `test_wf02_authenticated_profile_access` | `GET /api/v1/auth/profile` | **PASSED** |
| **3** | Shop creation and retrieval | `test_wf03_shop_lifecycle` | `POST /api/v1/shops`<br>`GET /api/v1/shops/me`<br>`PUT /api/v1/shops/{id}` | **PASSED** |
| **4** | Shop operating status creation, update & history | `test_wf04_shop_operating_status_lifecycle` | `POST /api/v1/shop-status`<br>`GET /api/v1/shop-status/date/{date}`<br>`PUT /api/v1/shop-status/date/{date}`<br>`GET /api/v1/shop-status` | **PASSED** |
| **5** | Closed shop must reject a sale | `test_wf05_and_wf06_closed_and_reopened_shop_sales` | `POST /api/v1/sales` (on closed date $\to$ 409 Conflict) | **PASSED** |
| **6** | Reopening the shop must allow sales | `test_wf05_and_wf06_closed_and_reopened_shop_sales` | `PUT /api/v1/shop-status/date/{date}` $\to$ `POST /api/v1/sales` $\to$ 201 | **PASSED** |
| **7** | Product creation and listing | `test_wf07_product_creation_and_listing` | `POST /api/v1/products`<br>`GET /api/v1/products`<br>`GET /api/v1/products/low-stock`<br>`GET /api/v1/products/{id}` | **PASSED** |
| **8** | Product category normalization & review flags | `test_wf08_product_category_normalization` | `GET /api/v1/products/categories`<br>`POST /api/v1/products`<br>`PUT /api/v1/products/{id}` | **PASSED** |
| **9** | Valid sale creation and total calculation | `test_wf09_valid_sale_creation_and_calculation` | `POST /api/v1/sales` (merging repeated items, calculating totals) | **PASSED** |
| **10** | Inventory stock deduction after a sale | `test_wf10_inventory_deduction` | `POST /api/v1/sales` $\to$ verified via API & DB queries | **PASSED** |
| **11** | Invalid quantities and invalid product IDs | `test_wf11_invalid_quantities_and_product_ids` | `POST /api/v1/sales` (zero, negative, discrete fraction, unconfirmed bulk, bad ID) | **PASSED** |
| **12** | Sale cancellation and stock restoration | `test_wf12_and_wf13_cancellation_and_idempotency` | `POST /api/v1/sales/{id}/cancel` $\to$ atomic stock restored | **PASSED** |
| **13** | Repeated cancellation must not restore stock twice | `test_wf12_and_wf13_cancellation_and_idempotency` | `POST /api/v1/sales/{id}/cancel` (idempotent, no second restore) | **PASSED** |
| **14** | Refund behavior (restocking, damaged, repeated) | `test_wf14_refund_workflows` | `POST /api/v1/sales/{id}/refund` (`restock_items=True/False`) | **PASSED** |
| **15** | Stockout event creation when inventory reaches zero | `test_wf15_and_wf16_stockout_lifecycle` | `POST /api/v1/sales` $\to$ DB `StockoutEvent` active record created | **PASSED** |
| **16** | Stockout event closure after inventory replenishment | `test_wf15_and_wf16_stockout_lifecycle` | `POST /api/v1/sales/{id}/cancel` $\to$ `StockoutEvent.ended_at` closed | **PASSED** |
| **17** | Cross-shop access must be rejected | `test_wf17_cross_shop_access_rejected` | Cross-shop product GET/PUT/DELETE, sale GET/CANCEL/REFUND $\to$ 403 | **PASSED** |
| **18** | Ensure one user's data is never visible to another user | `test_wf18_user_data_isolation` | Multi-tenant lists for products, sales, operating calendars $\to$ isolated | **PASSED** |
| **19** | Existing Phase 1 database migration tests | `test_phase1_database_foundation.py` (8 tests) | Table structures, column migrations, unique constraints, category seeding | **PASSED** |
| **20** | Existing Phase 2 regression tests | `test_phase2_backend_apis.py` (17 tests) | Operating status API, sales quality engine, cancellation/refund safety, purchase restock | **PASSED** |

---

## 4. Nuances & Findings Identified During Testing

### 4.1 Shop Business Type Enum Validation
- **Observed Behavior:** In `ShopCreate`, `business_type` requires an exact match with the `BusinessType` Enum (e.g. `"Grocery/Kirana"` rather than generic `"Grocery"`). If an invalid string is passed, FastAPI/Pydantic returns `HTTP 422 Unprocessable Entity` rather than reaching domain logic.
- **QA Verification:** Verified that passing a valid enum string like `"Grocery/Kirana"` correctly triggers the domain constraint check (`"User already has a shop profile."` with `HTTP 400 Bad Request`).

### 4.2 Shop-Local Operating Date vs. Server UTC Date
- **Observed Behavior:** Kirana shops operate on shop-local calendar days (IST). In late evening or early morning hours, the local calendar date differs from the UTC date.
- **Resolution in Phase 2:** The sales engine accepts an optional `operating_date` or defaults to shop-local date, while checking both local and UTC closure status. POS checkouts on explicitly closed days are rejected with `HTTP 409 Conflict`.

### 4.3 Pydantic Field Defaults on Review Flagging
- **Observed Behavior:** `ProductBase` originally set `needs_category_review` default to `False`. When creating unmapped products without specifying `needs_category_review`, Pydantic populated `False`, masking the domain normalization output.
- **Resolution in Phase 2:** `needs_category_review` was updated to default to `None` in `ProductBase`. Normalization accurately sets `needs_category_review = True` for ambiguous categories, and `False` for canonical/unambiguous categories.

---

## 5. Execution Instructions

To execute the complete automated test suite with a single command:

```powershell
.\venv\Scripts\python.exe backend/tests/run_all_automated_tests.py
```

Or using standard Python test discovery:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py" -v
```

---

## 6. Conclusion

All 20 specified workflows and regression suites have been automated and verified.
- **Zero production or development SQLite databases were modified.**
- **Zero unnecessary packages were installed.**
- **Zero test failures or regressions.**
- The system is verified, stable, and ready for user review.
