# 🌿 SHELFORA — Grocery Management & Invoice Intelligence Platform

**Tagline:** *"Smarter Shelves. Better Decisions."*

[![React](https://img.shields.io/badge/React-19.2.8-153D32?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-23866A?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-D6AE62?style=for-the-badge&logo=vite&logoColor=black)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-4.3-153D32?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-B9E5D0.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> **SHELFORA** is a premium, offline-first grocery management and invoice intelligence platform engineered specifically for retail stores and Indian Kirana merchants. It blends header-guided dynamic invoice extraction, rapid multi-item POS billing, real-time multi-counter synchronization, AI demand forecasting, smart weighing scale / ESP32 IoT counter integration, and 12-language Voice-to-Bill.

---

## 🌟 Key Capabilities & Pillars

| Pillar | Features & Technical Highlights |
| :--- | :--- |
| **🧾 Invoice Intelligence Scanner** | Header-guided dynamic invoice extraction layer that isolates Rate, Purchase Price, Selling Price, and MRP with spatial boundary verification and banker's Decimal rounding. Generates audit workbooks (.xlsx) and performs idempotent stock updates. |
| **📷 Invoice Photo Preparation** | Camera capture of multi-page invoices with automatic quality grading, upright/sideways/upside-down detection, deskewing, perspective correction and measured, adaptive enhancement before the existing OCR engine; manual rotate/retake/reorder, lossless PDF, originals kept. See [docs/document-prep](docs/document-prep/README.md). |
| **⚡ Lightning POS & Billing** | Rapid multi-item checkout, instant bill calculation, cash & UPI split payments, thermal receipt generator, keyboard shortcuts, and barcode scanner integration. |
| **🎙️ Voice-to-Bill (12 Languages)** | Fast natural language billing powered by multilingual voice parsing supporting Hindi, Telugu, Tamil, Kannada, Marathi, Bengali, Gujarati, Punjabi, Malayalam, Odia, Assamese, and Urdu. |
| **📦 Dynamic Inventory & Restocking** | Real-time stock decrement transactions, low-stock threshold triggers, multi-category taxonomy, supplier management, and instant stock adjustments. |
| **📊 Shelf Analytics & Demand Intelligence** | Rolling daily/weekly/monthly revenue trends, gross margin analytics `(sellingPrice - costPrice)`, top seller rankings, slow-moving dead-capital detection, and velocity-based stockout forecasts. |
| **📶 Offline-First Resilience** | Zero-latency local caching, persistent queueing of offline sales and product mutations, atomic conflict resolution, and automatic background sync upon reconnection. |
| **📡 ESP32 IoT Counter & Scale** | Ready-to-pair hardware communication bridge for ESP32 digital scales and smart optical counters with simulator fallback mode. |

---

## 🏛️ System Architecture

```
                                  +-----------------------------+
                                  |     Shelfora Web Client     |
                                  |   (React 19 + TypeScript)   |
                                  +--------------+--------------+
                                                 |
                       +-------------------------+-------------------------+
                       |                                                   |
           [Online Path: Direct Sync]                              [Offline Path]
                       |                                                   |
                       v                                                   v
         +----------------------------+                     +----------------------------+
         |     FastAPI Cloud Hub      |                     |    Local Storage Cache     |
         |  OCR Engine & SQLite DB    |                     |  Sales & Inventory Queues  |
         +-------------+--------------+                     +--------------+-------------+
                       |                                                   |
                       |                  Automatic Reconnect              |
                       +=================== Sync Engine <==================+
                                       (Exponential Backoff
                                      & Deterministic Dedupe)
```

---

## 📂 Project Structure

```bash
SHELFORA/
├── backend/                 # FastAPI REST API & Grocery OCR Engine
│   ├── api/routes/          # Invoices, Sales, Products, Auth, Voice endpoints
│   ├── services/grocery_ocr/# Modular OCR preprocessing, table extraction & audit
│   └── shoppulse.db         # Persistent SQLite database
├── src/
│   ├── components/          # Reusable UI components & modals
│   │   ├── branding/        # ShelforaLogo vector emblem and wordmarks
│   │   ├── dashboard/       # SalesOverview, TodaySummary, AttentionCard
│   │   ├── Navbar.tsx       # Minimal Shelfora top navigation
│   │   ├── Sidebar.tsx      # Grouped collapsible navigation
│   │   └── VoiceBillModal.tsx # 12-language voice billing interface
│   ├── pages/               # Top-level page views
│   │   ├── Dashboard.tsx    # Analytics-first business overview
│   │   ├── InvoiceScanner.tsx # Intelligent document processing scanner
│   │   ├── Inventory.tsx    # Shelf stock catalog & restock checklist
│   │   ├── Sales.tsx        # Fast POS billing terminal
│   │   ├── Insights.tsx     # Demand forecasting & business telemetry
│   │   └── Settings.tsx     # Shop profile & multi-language switcher
│   ├── i18n/                # 12 Indian regional language dictionaries
│   ├── hooks/               # Custom reactive state hooks
│   └── types/               # Strict TypeScript models
├── public/
│   ├── favicon.svg          # Shelfora vector favicon
│   ├── logo.svg             # Shelfora horizontal logo
│   └── manifest.json        # PWA application metadata
└── dist/                    # Optimized production bundle
```

---

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js** v20+ or v22+
* **npm** v10+
* **Python** 3.12+

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/sasikiranambati/SHOP-PULSE.git
cd SHOP-PULSE

# Install frontend dependencies
npm install

# Setup Python backend virtual environment
python -m venv backend/.venv
backend\.venv\Scripts\pip install -r backend/requirements.txt
```

### 3. Running Locally
```bash
# Terminal 1: Start FastAPI backend server
cd backend
.venv\Scripts\uvicorn main:app --reload --port 8000

# Terminal 2: Start Vite frontend development server
npm run dev
```
Open [http://localhost:5173/](http://localhost:5173/) in your browser.

### 4. Running Verification Test Suites
```bash
# Run Frontend Vitest Suite (134 tests across 17 suites)
npm test

# Run Backend Pytest Suite (915 collected: 906 passed, 9 skipped)
& "backend\.venv\Scripts\python.exe" -m pytest -c backend/pytest.ini backend/tests

# Check TypeScript Projects
npx tsc -b
npx tsc --noEmit -p tests/tsconfig.json

# Check Python Types with Pyrefly
& "backend\.venv\Scripts\pyrefly.exe" check --config pyrefly.toml backend/db/session.py backend/main.py scripts/debug/verify_voice_sales_live.py
```

---

## 🗄️ Database Architecture & Safety

- **Engine & Storage:** SQLite3 managed via SQLAlchemy ORM (`backend/shoppulse.db`).
- **Core Entities:**
  - `products`: Product master with canonical units, category taxonomy, cost/selling prices, and real-time inventory balances.
  - `sales` & `sale_items`: POS checkout records with half-up banker's Decimal precision and atomic stock deductions.
  - `invoices` & `invoice_items`: Extracted wholesale invoices with HSN, tax rate, rate/MRP parsing, and idempotent stock updates.
  - `purchases`: Supplier procurement bills and payment ledger tracking.
  - `users` & `shops`: Authentication credentials and multi-tenant shop association.
  - `mrp`: Cached product barcode-to-MRP mappings for instant invoice auditing.
- **Test Isolation Safeguards:** When running tests (`SHOPPULSE_TEST_MODE=1`), the session layer (`backend/core/db_safety.py`) strictly enforces that all test operations run in transient temporary directories (`%TEMP%/shoppulse-pytest-*`). The live database is protected from test mutation.

---

## 🎨 Shelfora Design Tokens & Palette

The Shelfora interface utilizes a sophisticated natural grocery palette:
- **Primary Deep Forest Green (`#153D32`):** Brand anchors, primary actions, and prominent typography.
- **Emerald Green (`#23866A`):** Success states, positive margins, and growth indicators.
- **Fresh Mint (`#B9E5D0`):** Soft highlights, active pills, and freshness leaf accents.
- **Warm Ivory (`#FAF8F2`):** Primary canvas backgrounds and soft surfaces.
- **Premium Gold (`#D6AE62`):** VIP highlights, AI engine badges, and intelligence sparks.
- **Soft Cream (`#F3EFE3`) & Sage Green (`#DDE9DF`):** Subtle borders and card separators.
- **Coral (`#EF806D`):** Warning thresholds, low stock alerts, and destructive confirmations.
- **Charcoal (`#252D29`):** High-contrast body text adhering to WCAG 2.1 AAA accessibility.

---
