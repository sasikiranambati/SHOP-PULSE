# Updates for Review 3

**Team:** AVENGERS
**Product:** ShelfOra (repository name: ShopPulse)
**CEO:** A. Sasi Kiran
**CTO:** K. Karthikeya

---

## Step 1 — Problem Statement

**Lead: CEO**

> Small grocery and kirana store owners struggle to keep inventory, purchase records, and selling prices accurate because supplier bills and daily sales are managed manually, leading to stock mismatches, missed sales, wasted time, and avoidable losses.

**Who:** owner-run grocery and kirana shops, often with one or two people on the counter.
**When:** during the evening rush, and every time a distributor bill arrives.
**What it costs:** stock that does not match the shelf, sales lost when an item is out, time spent typing bills, and money lost when prices change without the shop noticing.

We picked this problem because the owners we spoke to already had the sales side under control. The part that was breaking was the purchase side: bills arrived, were filed away, and were entered late or never. Once the purchase side is late, the stock count and the selling price are both wrong.

---

## Step 2 — Field Interviews

**Lead: CEO (5 interviews), CTO (3 interviews). Findings: Both.**

### Interviews Led by CEO

#### Interview 1

**Interviewee:** Venkata Subba Rao
**Role:** Kirana Store Owner
**Location:** Mangalagiri Main Bazaar
**Date:** November 2026

The store handles around 140 customers every day, with 3–4 distributor bills coming in daily. Most of the stock details are maintained using a calculator, notebooks and paper bills.

**Interview Notes:**
The owner mainly manages everything manually. During busy hours, he focuses on serving customers and doesn't have time to update stock properly. Distributor bills are kept aside and entered later, usually at the end of the day. Because of this, he sometimes forgets to update certain items and only notices that something is out of stock when a customer asks for it. He feels that managing stock after the store closes takes a lot of time, especially when there are many items in a bill.

#### Interview 2

**Interviewee:** Padmavathi Devi
**Role:** Co-owner and Counter Billing Handler
**Location:** Tadepalle Road
**Date:** November 2026

The store serves around 110 customers daily and receives 2–3 wholesale bills along with smaller bills from dairy and bakery suppliers. They use Khatabook for credit records and handwritten stickers for product prices.

**Interview Notes:**
She explained that they use different methods for different things, but none of them really helps them keep track of their stock. When supplier prices change, they usually notice it by checking the bills. Sometimes the selling price is not updated immediately, which leads to selling products at the old price even after the purchase price has increased. This makes it difficult for them to know how much profit they are actually making.

#### Interview 3

**Interviewee:** Srinivasulu K.
**Role:** Store Owner
**Location:** Vaddeswaram Junction
**Date:** November 2026

The store handles around 95 customers daily and receives distributor deliveries every two days. Stock and purchase details are maintained in a paper day-book with the help of a calculator.

**Interview Notes:**
The owner usually updates the register after the day's work is finished. He spends a considerable amount of time writing down product names, quantities and prices from the bills. Even after updating everything, the stock recorded in the register does not always match the actual stock in the store. He finds it difficult to keep the records accurate when the store is busy.

#### Interview 4

**Interviewee:** Harish Babu
**Role:** Store Owner
**Location:** Atmakur Road, Mangalagiri
**Date:** November 2026

The store has two counters and two billing staff and handles around 220 customers daily. They receive around 5–6 invoices every day. Billing software is used for customer receipts, but purchase entries are mostly not updated.

**Interview Notes:**
The store already uses software for billing, but purchase and stock management are still handled separately. Entering every item from a supplier bill takes too much time, so they often skip it. As a result, the software does not always show the correct stock. The owner still has to check the shelves manually when deciding what needs to be reordered.

#### Interview 5

**Interviewee:** Shaik Mahaboob
**Role:** Store Owner
**Location:** Undavalli Center
**Date:** November 2026

The store is managed by the owner alone and serves around 80 customers daily. He receives 2–3 supplier bills and mainly uses paper slips and WhatsApp voice notes to remember things.

**Interview Notes:**
He finds it difficult to maintain records while handling customers, weighing products and packing orders. He sometimes makes voice notes or keeps bills aside to update later, but not everything gets recorded properly. He also mentioned that older products can get pushed behind newer stock, and he has lost money because some products expired before they were sold.

### Interviews Led by CTO

#### Interview 6

**Interviewee:** Naga Raju M.
**Role:** Store Owner
**Location:** Neerukonda Main Road, near campus
**Date:** November 2026

The store has one counter and a helper and serves around 180 customers daily, especially during the evening. It receives approximately four distributor bills per day and uses a calculator, UPI QR code and notebook for daily operations.

**Interview Notes:**
The store gets very busy in the evenings because of students and people returning from work. During this time, the owner mainly concentrates on billing and serving customers. Sales and stock updates are not always recorded immediately. When it is time to order products, he usually relies on what he remembers or checks the shelves himself. He feels that having the stock information available without manually checking everything would make things easier.

#### Interview 7

**Interviewee:** Praveen Kumar
**Role:** Lead Counter Cashier
**Location:** Kuragallu Village Road
**Date:** November 2026

The store handles around 150 customers daily and receives 3–4 supplier invoices. Billing is done using a pre-printed bill pad and calculator.

**Interview Notes:**
He explained that price changes are usually communicated by the owner verbally or through supplier bills. Since different people work at the counter, there are chances of someone using an old price without knowing that it has changed. This can also create confusion while checking the day's cash and billing records. Having updated prices available at the counter would make the process easier for everyone.

#### Interview 8

**Interviewee:** Lakshmi Narayana
**Role:** Store Owner
**Location:** Neerukonda–Tadikonda Road
**Date:** November 2026

The store is managed by the owner and his spouse and serves around 130 customers daily. They receive approximately three distributor bills per day and maintain records using a spiral register and calculator.

**Interview Notes:**
The owner is not interested in apps that require him to enter every product manually at the end of the day. He feels that this would only add more work to his existing routine. However, he was interested in a system where he could take a picture of a supplier bill, check whether the details were correct and have the stock updated automatically. He felt that this would save time and make stock management easier without changing the way he currently runs the store.

---

## Step 3 — Market Research

**Lead: CEO**

We looked at four ways shops handle this today. Pricing varies a lot between providers and between shops, so we have not listed specific prices.

### Alternative 1 — Manual Registers and Calculators

**How it works:** the owner writes sales, purchases, prices and stock by hand, and adds up totals with a calculator.

- **Advantages:** low cost, familiar, easy to start.
- **Limitations:** slow, stock often wrong, hard to look at sales over time, purchase bills can stay unrecorded, shortages found late.

### Alternative 2 — Billing / POS Software

**How it works:** the shop uses software to print customer bills, and sometimes to track stock.

- **Advantages:** faster billing, digital sales records, basic stock tracking.
- **Limitations:** purchase bills often have to be typed in line by line. If purchases are skipped, stock is wrong. Some owners find the workflow hard to keep up.

### Alternative 3 — Credit / Khata Apps

**How it works:** the app keeps a record of what each customer owes and what they have paid.

- **Advantages:** good for credit, customer history and payment records.
- **Limitations:** does not record purchases, does not track stock, and does not connect purchases with sales.

### Alternative 4 — Spreadsheets

**How it works:** the owner keeps stock and prices in a sheet and updates it by hand.

- **Advantages:** flexible, cheap, can be customised.
- **Limitations:** needs manual updates, needs someone who knows spreadsheets, hard to update in a busy hour, not linked to billing.

### Why a store might choose ShelfOra

- Fewer manual supplier-invoice entries.
- Stock is updated from purchases.
- Purchases, sales and stock are kept together.
- Selling prices can be managed from the same place.
- Billing and Voice-to-Bill for counter sales.
- Low-stock information and simple insights for the owner.

We have not measured how any of these compares with the alternatives in a real shop. Those comparisons are part of the validation work in Step 6.

---

## Step 4 — Architecture

**Lead: CTO. Walkthrough: Both.**

ShelfOra is a browser app with a separate backend.

```
Browser (React 19 + TypeScript + Vite)
        │  HTTP / JSON, JWT bearer token
        ▼
FastAPI backend  (/api/v1 — 15 routers)
  ├── Auth and roles (owner / manager / cashier)
  ├── Sales and POS (stock reduced in the same transaction)
  ├── Purchases, suppliers and products
  ├── Invoice scanner (extract → review → confirm)
  │     └── Node tesseract.js OCR worker
  ├── Voice-to-Bill (parse → match to catalogue)
  │     └── speech-to-text: mock by default, Sarvam if configured
  ├── Insights (rule-based) and demand estimate (moving average)
  └── Notifications
        │  SQLAlchemy
        ▼
SQLite database (backend/shoppulse.db by default)
```

| Area | What is in the code |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS 4. Pages for dashboard, POS, stock, insights, scanner, settings and sign-in. |
| Backend | Python 3.13 (tested), FastAPI, SQLAlchemy, Alembic migrations, Pydantic models. |
| APIs | 15 route groups under `/api/v1`, documented automatically at `/docs`. |
| Database | SQLite by default. Tables for users, shops, shop members, products, sales and sale items, purchases and purchase items, suppliers, notifications. |
| Authentication | Email and password, bcrypt hashes, signed JWT tokens. |
| Roles and permissions | Owner, manager and cashier per shop. Owners and managers see insights, purchases and suppliers. Cashiers work the counter. |
| Inventory | Stock changes on each sale and each confirmed purchase. |
| POS and sales | Server-side pricing, one transaction per sale. |
| Invoice scanner / OCR | PDF text reading, OCR for photos and scanned pages, table rebuilt from the page layout, review before confirm. |
| Voice-to-Bill | Turns spoken or typed orders into items, matches them to products, and adds them to the POS basket. |
| Analytics | Sales summary, top sellers, stock status, rule-based insight cards. |
| Notifications | Low-stock and sales notifications stored in the database; push token registration exists. |
| External services | Tesseract (through a Node worker). Optional speech provider (Sarvam). Optional MRP lookup. Firebase is used in the frontend only for product image upload. |

**Not connected:** an offline sync module that uses Firestore. The code exists, but nothing writes to its queue, so it is not part of the running app.

---

## Step 5 — Core Workflow

**Lead: CTO**

This is the flow as the app supports it today.

1. **Supplier invoice is uploaded or photographed.** The owner or manager opens Scan Bill and uploads a PDF or image, or takes photos. Photos can be straightened and cleaned before reading.
2. **Invoice information is extracted.** The system reads the table and works out the supplier, invoice number, date, items, quantities, rates and amounts. It checks quantity times rate against the line amount.
3. **The user reviews and corrects the lines.** Anything unclear is flagged. Nothing has changed in stock yet.
4. **Confirmed purchase items are saved.** On confirm, the supplier, any new products, the purchase record and the stock changes are saved in one transaction. The same invoice cannot be confirmed twice.
5. **Inventory is updated.** Stock goes up for each confirmed line.
6. **A customer buys at the counter.** The cashier adds items to the basket on Quick Sales POS, or uses Voice-to-Bill to fill the basket from a spoken or typed order, then completes the sale.
7. **Inventory is updated after the sale.** Each sale reduces stock in the same transaction as the sale record.
8. **The owner checks stock, sales and insights.** The dashboard shows today's sales and items needing attention. Shop Insights shows the sales period, top sellers, stock status and insight cards.

**Limits to keep in mind:** Voice-to-Bill speech input is mock by default, so spoken orders only work for real once a speech key is configured. The insight cards are rule-based, not AI. The demand estimate is a moving average. Invoice reading has not been measured on real supplier photos yet.

---

## Step 6 — Validation

**Lead: Both**

This step covers what has actually been checked. It is split into four kinds of evidence, and they should not be mixed up.

**Field interviews (Step 2).** Eight conversations with shop people, as described above. These tell us about the problem. They are not usability tests.

**Software tests (run by us).** On the merged branch, 26 November 2026:

- Backend: 1,374 tests collected; 1,371 passed; 3 failed. The 3 failures need the developer's local database file, which is not in a fresh copy of the repository.
- Frontend: 358 tests; 357 passed; 1 failed. The failing check counts hardcoded English text in the app and is above its recorded limit after a teammate's merge. We have not decided what to do about it yet.
- TypeScript, production build: pass. Lint: no errors, 28 warnings.

**Internal walkthroughs (run by the developers, not by shop users).**

- Counter sale in a browser, against a test database: add a product, complete the sale. The app showed "Sale Recorded!" and the stock went from 16 to 15.
- Localization in a browser, all 13 languages, Insights page: labels changed to the selected language and the choice held after two page reloads.

**Actual usability sessions.** None yet. We have not put the app in front of a shop owner or cashier to use on their own. This is the next step.

**Problems found and fixed during our own checks:**

- The chosen language reverted to English on refresh. A profile sync was overwriting the saved language with an old value. We removed that overwrite.
- "Remember me on this device" was in English in every language. We translated it and made the translation check strict, so a missing key now fails the build.
- The Insights page had about 58 hard-coded English strings. They now come from the translation files.

**Known problems we have not fixed yet:**

- Invoice reading on a blurred test page produced three wrong decimal values. We have not checked whether the app warns about them.
- Voice and edit-product screens have about 37 new English strings from a teammate's merge. We have to decide whether to keep them in English or translate them.
- The dashboard shows some fixed figures, such as "+12% vs Yesterday", which the code does not calculate.

---

## Step 7 — Pitch and Next Steps

**Lead: CEO**

**Pitch order:**

1. **Problem.** The statement from Step 1, told through one or two examples from the interviews.
2. **Field evidence.** Two or three short points from the eight interviews: late purchase entry, stock that does not match, and price changes that do not reach every shift.
3. **Solution.** The counter sale and the supplier-bill review, in simple terms.
4. **Live demo.** The flow below.
5. **Value to the owner.** Fewer hours spent typing bills, a stock count that matches the shelf, and prices that change in one place.
6. **Next steps.**

**Demo flow (keep it under five minutes):**

1. Log in with an account created for the demo.
2. Open Scan Bill and upload a sample supplier invoice. Show the review screen and confirm it.
3. Open Stock Catalog and show the new stock.
4. Open Quick Sales POS, add an item, and complete a sale.
5. Open the dashboard and show the sale and the stock change.

Do not demo offline mode, hardware, or spoken orders unless speech has been configured for the demo machine.

**Next steps (only what the team has agreed or can do next):**

- Show the app to shop owners, not just to classmates, and watch them use it (Step 6).
- Measure invoice reading on real supplier photos.
- Decide what to do with the failing text check and the new English strings, then push the branch.
- Remove the fixed dashboard figures before any demo.
- Check that the app's account and password handling is acceptable for a pilot shop.

---

## Step 8 — Swap Demo

**Lead: Both**

The CEO demonstrates the product and the CTO answers business questions. Then the roles swap. This is what each of us should be able to explain without notes.

**CEO should be able to explain:**

- The architecture at a high level: browser, backend, database, and the two helpers (OCR and speech).
- The main workflow, from supplier invoice to inventory, and from counter sale to stock.
- How invoice scanning connects to inventory: stock changes only after the owner confirms the lines.
- How sales affect inventory: each sale reduces stock in the same step as the sale is recorded.
- The main technologies: React, TypeScript, FastAPI, SQLite, Tesseract.

**CTO should be able to explain:**

- The customer problem and who the target customers are.
- The interview findings.
- The market alternatives: registers, billing software, credit apps and spreadsheets.
- The business value: fewer typed entries, stock that matches, prices in one place.
- Why ShelfOra is useful to a shop owner, and what it does not do yet.

**Swap-demo checklist:**

- [ ] CEO demo run, timed, from the problem to the sale.
- [ ] CTO demo run, timed, covering architecture and the workflow.
- [ ] Swap run: each person answers the other's questions without help.
- [ ] Each person has the demo account and sample invoice ready.
- [ ] Backup screenshots are open in a separate window.
- [ ] Both have read the limitations in Steps 5 and 6.

Status: the swap demo has not been practised yet. This checklist is for the practice runs.
