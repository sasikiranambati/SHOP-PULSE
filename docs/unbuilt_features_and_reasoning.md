# ShopPulse — Unbuilt Features and Scope Decisions

## 1. Purpose

ShopPulse is a working MVP: a set of features that run end-to-end (stock, POS, invoice intake, voice billing, sales insights) with automated tests, rather than a complete product covering every feature a shop could want. This document lists what is **not built, partly built, or only present as unused code**, and why. Features that are implemented are not listed here.

Status labels used below:

- **NOT IMPLEMENTED** — no working code path.
- **PARTIAL** — code exists, but a key part is missing, mocked, or not reachable from the UI.
- **CODE PRESENT, NOT WIRED** — modules exist in the repository, but no page or flow calls them.

## 2. Unbuilt / Deferred / Partial Features

| Feature | Status | Verified evidence | Reason Not Built / Current State | Future Plan |
|---|---|---|---|---|
| Offline-first operation (queue sales and stock changes while offline, sync later) | **CODE PRESENT, NOT WIRED** | `src/services/offlineQueue.ts` and `src/services/syncService.ts` exist. `enqueueSale` and `enqueueInventoryMutation` are defined but **no caller exists** in `src/`, so nothing enters the queue. | Built the queue and sync manager, but the sales and inventory flows were moved to the FastAPI backend and the queue was not connected to them. | Decide on one data path, then connect the POS to an offline queue that writes through the API. |
| Single data store | **PARTIAL** | Core data (products, sales, purchases, invoices) goes through FastAPI to SQLite. `syncService.ts` writes to Firestore `users/{uid}/sales` and `users/{uid}/inventory`. | Two data paths exist from earlier and later development phases. Only the FastAPI path is used by the main flows. | Remove or consolidate the Firestore path, or document it as legacy. |
| Firebase Authentication for login | **NOT USED** | `src/services/authService.ts` logs in against the backend JWT endpoint. `firebase/auth` is initialised in `src/services/firebase.ts` but login does not use it. | The backend JWT path was chosen as the working login. | Remove the unused Firebase initialisation, or adopt one identity system. |
| Google sign-in | **NOT IMPLEMENTED** | `signInWithGoogle` in `src/services/authService.ts` throws "Google Sign-In is not configured for the local backend". | Requires an OAuth client and provider setup that was not done. | Configure an OAuth provider, or hide the button. |
| Hardware scale / ESP32 counter / Bluetooth scale | **CODE PRESENT, NOT WIRED** | `src/services/scaleService.ts`, `bluetoothService.ts`, `deviceService.ts` and `deviceSimulator.ts` exist. None of them is imported by a page or component. `deviceService` only generates `esp32_` IDs. | Hardware integration needs physical devices and was not tested. | Connect a scale to the POS quantity field after a device is available for testing. |
| Multi-counter real-time sync | **NOT IMPLEMENTED** | No WebSocket or push-sync code (`websocket` search returns nothing in `src` or `backend`). | Requires a real-time channel and conflict handling, which were out of scope. | WebSocket or server-sent events for stock and sales updates. |
| Native Android app | **PARTIAL** | `android/` and `capacitor.config.ts` (`appId: com.shoppulse.app`) exist. The Android build was not run in this review. | Capacitor scaffold only; no device testing recorded. | Build and test on a device. |
| Real-world invoice-scanner accuracy | **NOT MEASURED** | `validation/real_invoices/README.md` says the folder is empty "on purpose" and no real-world accuracy has been measured. | Requires real supplier invoice photos with verified provenance. | Collect 20–30 photos as the README describes, then run the harness. |
| Speech-to-text in production | **PARTIAL** | `backend/services/speech.py`: `VOICE_MODE=mock` is the default, and `MockSpeechService` returns a fixed transcript when no simulation text is supplied. Sarvam is used only when `VOICE_MODE=sarvam` and a key is set. | No speech key was available for the project. The frontend also has browser speech recognition where supported. | Configure a Sarvam key and test with real spoken Indian-language orders. |
| "AI" business insights | **RULE-BASED, NOT AI** | `backend/services/insights.py` `get_ai_insights` builds cards from computed sales and inventory data. | Simple, explainable, and grounded in database values. | An ML model is possible later; it needs enough sales history to train. |
| Demand forecasting | **STATISTICAL ESTIMATE** | `backend/services/forecasting.py` uses an exponentially weighted moving average (`alpha = 0.3`). | Works with short history; no seasonality or supplier lead time. | Seasonality and lead-time-aware reorder points. |
| LLM-based invoice extraction | **OPTIONAL, OFF BY DEFAULT** | Gemini and Groq providers exist in `backend/services/grocery_ocr/ai/`. `service.py` uses the mock provider unless `ai_provider` is set to `gemini` or `groq`. | No external AI keys were part of the project scope. | Enable and evaluate on the real-invoice set. |
| Supplier integrations (automatic order / price feeds) | **NOT IMPLEMENTED** | No supplier API client exists. Supplier records are manual (`backend/services/supplier.py`). | Each supplier's system differs; out of scope. | Only if real suppliers offer an API. |
| Multi-store management | **PARTIAL** | Shop membership with roles exists (`shop_members`, `OWNER` / `MANAGER` / `CASHIER`). Each user is tied to one accessible shop (`get_user_accessible_shop`). | Multi-store switching and cross-store reports were not built. | Store selector and aggregated reports. |
| Payment gateways (card, UPI API) | **NOT IMPLEMENTED** | Sales record a `payment_method` (`cash`, `upi`, `card`, `credit`). No payment provider is called. | Payments are recorded for bookkeeping, not processed. | Integrate a gateway only with a legal and security review. |
| Customer loyalty / credit ledger | **NOT IMPLEMENTED** | `customer_name` is an optional text field on a sale. No loyalty or credit-balance model exists. | Not in the core inventory and billing scope. | Customer model and ledger. |
| Thermal printer output | **PARTIAL** | `src/utils/receiptGenerator.ts` and `ReceiptModal.tsx` produce receipts in the browser. No direct printer driver. | Browser printing is enough for the MVP. | ESC/POS driver through the Android build. |
| Cloud deployment, CI and release pipeline | **NOT IMPLEMENTED** | No `.github/` workflows in the repository. No deployment configuration. | Local development and tests only. | GitHub Actions for tests, lint and build. |
| Project license file | **NOT IMPLEMENTED** | The earlier README states MIT and links `LICENSE`, but no `LICENSE` file exists in the repository. | Missing file. | Add the license file, or remove the claim. |

## 3. Technical Limitations

Verified from the code and from the checks run for this document:

1. **Database is SQLite by default.** `backend/core/config.py` uses `backend/shoppulse.db` unless `DATABASE_URL` is set. `psycopg2-binary` is in `requirements.txt`, but no PostgreSQL deployment has been tested.
2. **Schema management is mixed.** Alembic migrations exist in `backend/alembic/versions/`, and `backend/main.py` also has a legacy `INCREMENTAL_COLUMNS` path for databases without Alembic. The code skips the legacy path when an `alembic_version` table exists.
3. **Two data stores in the frontend** (SQLite via API, Firestore in the sync module). See Section 2.
4. **Demo login uses hard-coded credentials in client code.** `loginAsDemo` in `src/services/authService.ts` sends a fixed demo email and password. This must not be used in a deployed build.
5. **Development default secret key.** `backend/core/config.py` and `.env.example` contain a `SECRET_KEY` value. It must be replaced in any real deployment.
6. **Brand inconsistency.** The UI says "SHELFORA"; the repository, package name, and backend say "ShopPulse". Use one name in the presentation and documentation.
7. **Frontend lint has 21 warnings** (React hooks rules). Lint reports 0 errors.
7a. **Stale configuration comment.** The root `.env.example` says a Gemini key is entered in the browser for an "in-browser fallback scanner". No such code exists in `src/`, so the comment should be removed.
8. **Invoice-scanner accuracy on real photos is unknown** (see Section 2).
9. **Voice input is mock by default.**
10. **No end-to-end test of offline behaviour** exists, because the offline path is not wired.

## 4. Scope Decisions

These priorities are supported by what the repository actually contains:

- **Core inventory and stock correctness.** Sales deduct stock inside a database transaction, with tests for insufficient stock and rollback (`backend/tests/test_sales.py`). Fractional quantities are limited to kg, g, L and ml.
- **Billing.** The POS is the most developed UI, with a basket, payment method, and receipts.
- **Pricing correctness.** A Decimal-based pricing engine (`backend/services/pricing_engine.py`) with a documented ROUND_HALF_UP rule. Covered by dedicated tests.
- **Authorization.** Role-based access (`OWNER`, `MANAGER`, `CASHIER`) with tests in `test_role_based_access_control.py`.
- **Testing.** Backend test suite and frontend Vitest suite, both run in this review (see the README for current counts).
- **Usability on phones.** A mobile bottom navigation and responsive layouts exist (verified by screenshot at 390 px width).

Deprioritised: multi-store, hardware, real-time sync, and payment processing. The team's reasoning is that each needs external devices, services, or sign-off that were not part of the MVP. This is the team's explanation; the repository does not record a formal decision.

## 5. Future Roadmap

**Short-term (next iteration)**

- Remove or consolidate the Firestore sync path; choose one data store.
- Connect the POS to an offline queue that writes through the API, or remove the unused queue code.
- Remove the hard-coded demo login from production builds.
- Add `LICENSE`, and a CI workflow that runs the tests, lint and build.
- Collect and run the real-invoice validation set.

**Medium-term**

- Speech-to-text tested with real spoken orders in the 12 supported languages.
- Hardware scale integration after a device is available for testing.
- Multi-store switching and aggregated reports.
- Reorder suggestions based on the forecast and supplier lead time.

**Long-term**

- Real-time multi-counter synchronisation.
- Customer ledger and loyalty.
- Supplier integrations where suppliers offer an API.
- Payment gateway integration after a security review.
- Native Android release.

## 6. Panel Questions

**Why didn't you implement offline mode?**
Offline code was written and is in the repository, but the sales path was not connected to it, so the feature does not work. We chose to report it as partial rather than claim it. Making it work needs one data path first, because the offline queue currently writes to a different database than the main app.

**Why did you choose this stack?**
The frontend is React, TypeScript and Vite, which give fast development and type safety. The backend is FastAPI with SQLAlchemy, which gives typed request and response models, automatic API documentation at `/docs`, and a straightforward SQLite setup for a single-shop MVP. Python also gives us the document-processing libraries (pdfplumber, OpenCV, Pillow) that the invoice scanner uses.

**What would you improve with more time?**
Consolidate the two data stores, wire up offline mode properly, validate the invoice scanner on real photos, and test speech input with real spoken orders.

**What are your biggest technical limitations?**
SQLite by default, no real-time sync, no tested offline mode, mock speech input by default, and invoice-scanner accuracy that has not been measured on real photos.

**What was the most challenging engineering problem?**
Decimal money handling and stock arithmetic. Prices and stock must stay exact across units (kg, g, pieces), so the pricing engine uses Python `Decimal` with an explicit rounding rule, and stock updates are done in one transaction so that a failed sale leaves stock unchanged. Tests cover these paths.

**Did you test the invoice scanner on real bills?**
Not yet. The repository has a validation harness and a folder for real photos, but the folder is empty. We report scanner results only from repository fixtures and say so.
