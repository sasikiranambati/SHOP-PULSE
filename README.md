# ShopPulse

ShopPulse is a web application for small shops, with a focus on grocery / Kirana stores. It keeps stock, counter billing and supplier bills in one place: a POS sale reduces stock, a supplier bill can be read into the catalog for review, and the owner sees low-stock items and sales summaries on a dashboard. The UI brands the product as **SHELFORA**.

## Features

Verified in code and by automated tests or screenshots:

- **Stock catalog** — products, prices, stock levels, low-stock list, product images.
- **Quick POS** — multi-item basket, payment method (cash, UPI, card, credit), receipts; stock is reduced in the same transaction as the sale.
- **Scan Bill** — upload or capture supplier invoices (PDF, image, or photos), quality check, rotation, enhancement, OCR, and a review step before stock changes.
- **Voice-to-Bill** — spoken orders parsed into items for 12 Indian languages. Speech-to-text runs in **mock mode** unless a Sarvam API key is set.
- **Shop insights** — 7-day sales summary, top sellers, rule-based insight cards, and a simple moving-average demand estimate.
- **Roles** — owner, manager and cashier access on the shop.

See [docs/unbuilt_features_and_reasoning.md](docs/unbuilt_features_and_reasoning.md) for partial and unbuilt features.

## Architecture

```
React 19 + TypeScript + Vite (src/)
        │  /api  (Vite dev proxy → http://127.0.0.1:8000)
        ▼
FastAPI  /api/v1  (backend/api/routes/)      JWT bearer auth
        │
        ▼
Services (backend/services/)                 pricing, sales, invoices, OCR, voice, insights
        │
        ▼
SQLAlchemy ORM → SQLite (backend/shoppulse.db by default)
```

The invoice OCR also uses a Node worker (`backend/services/ocr_worker.mjs`, tesseract.js) called from Python.

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS 4, lucide-react, Capacitor (Android scaffold) |
| Backend | Python 3.13 (tested), FastAPI, SQLAlchemy, Alembic, Pydantic, PyJWT, bcrypt |
| Documents / OCR | pdfplumber, pypdfium2, OpenCV (headless), Pillow, pi-heif, openpyxl, tesseract.js |
| Database | SQLite (PostgreSQL driver listed in requirements; not tested) |
| Testing | pytest (backend), Vitest (frontend), TypeScript compiler checks, oxlint; Playwright browser checks live in `scripts/e2e/` and are not part of the commands below |

## Project Structure

```
SHOP-PULSE/
├── backend/
│   ├── main.py              # FastAPI app; `python main.py --init-db` creates the schema
│   ├── api/routes/          # REST routers under /api/v1
│   ├── services/            # business logic (sales, pricing, invoices, OCR, voice)
│   ├── db/models/           # SQLAlchemy models
│   ├── schemas/             # Pydantic request/response models
│   ├── alembic/             # migrations
│   └── tests/               # backend test suite
├── src/
│   ├── pages/               # Dashboard, Sales, Inventory, Insights, InvoiceScanner, Settings
│   ├── components/          # UI components and modals
│   ├── api/                 # HTTP client modules for the backend
│   ├── services/            # frontend services (sales, inventory, sync, device)
│   └── tests/               # Vitest suites
├── scripts/                 # backend launcher, debug and browser-check scripts
├── docs/                    # evaluation documents, OCR and phase reports
└── validation/              # folder for real invoice photos (empty by design)
```

## Prerequisites

- **Node.js** 22 (tested with 22.23)
- **npm** 10 (tested with 10.9)
- **Python** 3.13 (tested)
- Git

## Installation

```bash
git clone https://github.com/sasikiranambati/SHOP-PULSE.git
cd SHOP-PULSE

# Frontend dependencies (uses package-lock.json)
npm ci

# Backend virtual environment and dependencies
python -m venv backend/.venv
# macOS / Linux:
source backend/.venv/bin/activate
# Windows (PowerShell):
#   backend\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
pip install pytest            # test runner (not listed in requirements.txt)
pip install pytest-xdist      # optional: parallel runs with -n 4
```

## Environment Setup

Both examples contain **placeholder values only**. Copy them before editing.

- `backend/.env.example` → `backend/.env`: API port, JWT settings, voice mode, MRP provider. The development `SECRET_KEY` in the example must be replaced for any deployment.
- `.env.example` → `.env` (repository root): Firebase web configuration values (`VITE_FIREBASE_*`). These are used by the product-image upload; sign-in does not use Firebase. Empty or default values let the app start.

```bash
cp backend/.env.example backend/.env
cp .env.example .env
```

Without a `backend/.env`, the backend uses its built-in defaults. Speech-to-text stays in mock mode unless `VOICE_MODE=sarvam` and `SARVAM_API_KEY` are set.

## Run the Project

**1. Create the database schema (first run only).** The default database is `backend/shoppulse.db`, which is gitignored.

```bash
cd backend
python main.py --init-db
cd ..
```

**2. Start the backend** (in one terminal, from the repository root):

```bash
npm run backend
```

This launches `backend/main.py` on `http://127.0.0.1:8000` using `backend/.venv` if it exists. Health check: `http://127.0.0.1:8000/api/v1/health`. API docs: `http://127.0.0.1:8000/docs`.

Alternative: `cd backend && python main.py`.

**3. Start the frontend** (in a second terminal):

```bash
npm run dev
```

Open `http://localhost:5173`. Create an account on the sign-up page, then log in.

## Testing

```bash
# Backend tests (from the repository root; uses a temporary SQLite database)
python -m pytest -c backend/pytest.ini backend/tests

# Frontend tests (Vitest)
npm test

# TypeScript checks
npx tsc -b
npx tsc --noEmit -p tests/tsconfig.json

# Lint (oxlint: 0 errors; warnings are listed in the output)
npm run lint

# Production build
npm run build
```

**Recorded results** (from the working tree this README is part of):

- Backend: 1257 collected; **1254 passed, 3 failed, 0 skipped**. The 3 failures are environment-dependent: `test_db_initialization_safety.py::test_02_…` and `::test_06_…`, and `test_stage_6_7_acceptance.py::test_01_…`. Each needs the developer's local `backend/shoppulse.db`, which is gitignored and not in a fresh clone; the tests fail with "file not found" and do not create the file.
- Frontend: 251 tests passed in 21 files
- TypeScript (app and tests): pass
- Lint: 0 errors, 21 warnings
- Production build: pass

Run backend tests from the repository root as shown; running from `backend/` makes some fixture paths fail.

**Synthetic invoice fixture, benchmark trade-off.** `backend/tests/doc_prep_dataset.py` draws the supplier name at 36 pt (previously 40 pt), so it no longer runs into the metadata block in DejaVu Sans. Geometry is covered by `backend/tests/test_fixture_layout_geometry.py`. On the synthetic benchmark (`tests/evaluate_extraction_baseline.py`), supplier-name and invoice-number extraction improved substantially (supplier correct on 16 of 17 cases, up from 1). Line-level results moved the other way: fully correct cases 106 → 104, three decimal-shift errors appeared on case `10_blurry`, and two product names were lost on `16_similar_background`. The recorded baselines were **not** updated.

## Important Commands

| Task | Command |
|---|---|
| Install frontend dependencies | `npm ci` |
| Create backend DB schema | `cd backend && python main.py --init-db` |
| Start backend | `npm run backend` |
| Start frontend dev server | `npm run dev` |
| Backend tests | `python -m pytest -c backend/pytest.ini backend/tests` |
| Frontend tests | `npm test` |
| TypeScript check | `npx tsc -b` |
| Lint | `npm run lint` |
| Production build | `npm run build` |
| Preview production build | `npm run preview` |

Android (Capacitor): `npm run cap:sync` builds the web app and syncs it to `android/`; `npm run cap:android` opens Android Studio. The Android build was not run as part of the evaluation documents.

## Documentation

- [Problem Statement and Field Evidence](docs/problem_statement_and_field_evidence.md) — the problem, target users, and the field-evidence plan (no field interviews are recorded yet).
- [Unbuilt Features and Reasons](docs/unbuilt_features_and_reasoning.md) — partial and unbuilt features, limitations, scope decisions.
- [Presentation Notes](docs/presentation_notes.md) — speaking script, demo sequence, backup plan, panel Q&A.
- [Presentation deck](docs/ShopPulse_Project_Presentation.pptx) — 8 slides.
- [Scanner architecture](docs/scanner_architecture.md) and [document preparation](docs/document-prep/README.md).

## Project Status

- Working end to end: stock catalog, POS sales with stock deduction, dashboard, insights, role-based access, invoice intake with review.
- Partial: invoice-scanner accuracy on real photos is **not measured** (`validation/real_invoices/` is empty); speech input is mock by default; offline sync code exists but is **not connected** to the sales or stock flows.
- Not built: hardware scales, real-time multi-counter sync, payment gateways, supplier integrations.
- No CI workflow and no `LICENSE` file are present in the repository yet.

## Future Scope

- One data store (consolidate the Firestore sync path with the API)
- Connect offline mode to the POS, or remove the unused code
- Measure invoice accuracy on real supplier photos
- Real-world speech testing with a Sarvam key
- CI pipeline and license file
