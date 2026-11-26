# ShopPulse — Presentation Notes

These notes accompany `docs/ShopPulse_Project_Presentation.pptx` (8 slides). Speaking lines are suggestions; rewrite them in your own words. Numbers quoted here were produced by the checks listed in the README. Re-run them before the presentation if the code changes.

**Before the presentation**

- Team names, institution and roles on slide 1 and slide 7 are placeholders until the team fills them in.
- Slide 3 is marked "Field Evidence — To Be Added". Do not present it as collected data until real interview records exist (see `docs/problem_statement_and_field_evidence.md`).
- The application brands itself "SHELFORA" in the UI, but the project and the presentation say "ShopPulse". Say once, early, that these are the same project, so the panel is not confused.

---

## 1. 8-Slide Speaking Script

**Slide 1 — Title (about 40 seconds)**

"Hi, we're presenting ShopPulse. It's a web app for small shops that keeps stock, billing and supplier bills in one place. Our UI calls it SHELFORA — same project. Today I'll show you the problem, what we built, how it's put together, what works, and what doesn't yet."

**Slide 2 — Problem (about 75 seconds)**

"Small shop owners usually track stock in a notebook or in their head. Billing and stock are separate, so a sale doesn't reduce what the register says. When a supplier bill comes in, someone re-types every line. The owner often finds out an item is low only when a customer asks for it. That's the problem we're addressing. I want to be clear: we have not yet measured how common this is — that's the next thing we need to do with real shop owners."

**Slide 3 — Field evidence (about 60 seconds)**

"This slide is where our field evidence goes. Right now it's marked as 'to be added', because we have not yet recorded interviews. Here is what we will collect: who we spoke with, what they said, and which design decision each finding changed. We won't show any findings until they are real."

*(If real interviews exist by the day of the presentation, replace this slide's content with the interview IDs, user types and quoted pain points, and remove the "to be added" banner.)*

**Slide 4 — Solution and prototype (about 75 seconds)**

"Here's the working app. A sale on the POS reduces stock in the same transaction. The dashboard shows today's sales and what is running low. The scanner reads a supplier bill and lists the items for review before stock changes. Everything you see here is running on a local backend with a seeded test database."

**Slide 5 — Architecture (about 80 seconds)**

"The frontend is React with TypeScript, built with Vite. It calls a FastAPI backend under `/api/v1`. The backend uses SQLAlchemy and SQLite by default. Invoice OCR runs partly in a Python pipeline and partly in a Node worker using Tesseract. I want to be honest about one thing: the frontend also contains Firebase and offline-sync code from an earlier phase. Those parts are not connected to the main flows, and I'll explain that on slide 8."

**Slide 6 — Core features and demo (about 75 seconds)**

"Four things to look at. Stock catalog with low-stock status. The POS with a basket and payment method. The invoice scanner, which goes step by step from capture through OCR to results. And Voice-to-Bill, which parses spoken orders in 12 languages. Voice recognition is in mock mode by default, so I'll say that when I show it."

**Slide 7 — Engineering, testing and team (about 90 seconds)**

"The hard part was keeping money and stock exact. Prices use Python Decimal with one rounding rule, and stock updates happen inside one transaction, so a failed sale changes nothing. We tested this with the backend suite, the frontend suite, TypeScript checks, lint and a production build. The numbers are on the slide. [Team member] built the backend and data layer, and [team member] built the frontend. Each of us can explain the other's part — and we'll show that in questions."

**Slide 8 — Limitations, future and conclusion (about 75 seconds)**

"What's working: stock, billing, sales summaries, invoice intake and voice parsing. What isn't: offline mode is not connected end to end, the Firestore sync path is a leftover from an earlier design, hardware scales and real-time multi-counter sync are not built, and we have not measured invoice-scanner accuracy on real photos. We chose to finish the core working flows over adding breadth. The next step is one data path, then real-world testing. ShopPulse is a working MVP that addresses a real workflow, and we're honest about where it stops."

---

## 2. Suggested 5–7 Minute Presentation

| Time | Slide | Segment |
|---|---|---|
| 0:00–0:40 | 1 | Title and project value |
| 0:40–1:55 | 2 | Problem statement |
| 1:55–2:55 | 3 | Field evidence (state honestly what exists) |
| 2:55–4:10 | 4 | Solution overview |
| 4:10–5:30 | 5 | Architecture |
| 5:30–6:45 | 6 | Live demo (see Section 3) |
| 6:45–8:15 | 7 | Engineering, testing, team |
| 8:15–9:30 | 8 | Limitations, future, conclusion |

For a 5-minute slot, shorten the demo to two items (POS sale and stock check) and drop the detail on slide 5. For a 7-minute slot, keep the full demo.

---

## 3. Live Demo Sequence

Use only the features verified in the checks. Rehearse the sequence at least twice on the presentation machine.

**Before you start:** start the backend and frontend (README, "Run the project"). Create your own account through the sign-up page. The "demo login" button uses a fixed account that may not exist in your database, so do not rely on it. Seed a few products through the Stock Catalog page.

1. Open the app at `http://localhost:5173`.
2. Log in with your own account.
3. Show the **Dashboard**: today's sales, bills, products, and the low-stock list.
4. Open **Stock Catalog**: show product rows, stock levels and the low-stock status. Add or edit one product.
5. Open **Quick Sales POS**: tap two or three products to add them to the basket, choose a payment method, and complete the sale.
6. Return to the **Dashboard** or **Stock Catalog** and show that the stock for the sold items went down.
7. Open **Shop Insights**: show the sales summary and the top-seller card.
8. Open **Scan Bill**: show the steps (capture or upload, quality check, rotation, enhancement, OCR, results). Upload a clean sample invoice from `docs/scanner-test-cases/` (for example `TC01-clean-digital.pdf`) if the OCR run is reliable on your machine; otherwise show the upload screen and say what the results step will show.
9. Optional, if reliable: **Voice-to-Bill** from the POS. It works in mock mode with a fixed sample order. Say "mock mode" when you show it.

**Do not demonstrate:** the offline mode, the hardware scale, the Google sign-in button (it reports that it is not configured), or any feature listed as partial in `unbuilt_features_and_reasoning.md`, unless you explain its limits first.

---

## 4. Backup Demo Plan

| If this happens | Do this |
|---|---|
| Internet is unavailable | The app runs locally and needs no internet. Keep the backend and frontend on your own machine and do not use external services during the demo. If the frontend fails to load, switch to the screenshots in `docs/` (or the screenshots you captured) and narrate. |
| Backend fails to start | Check the terminal running the backend. Restart it with the command in the README. If it still fails, show the screenshots and the test results from the README. |
| Database is empty or missing tables | Run the schema setup command from the README (`python main.py --init-db` in `backend/`) on the development database, then re-create your account. Do this before the presentation, not during it. |
| OCR fails or is slow | Show the scanner's upload step and the results of the earlier run (screenshot). Say that OCR depends on the local Tesseract and Python libraries and that accuracy on real photos has not been measured. |
| Microphone unavailable or Voice-to-Bill fails | Voice is mock mode by default. Use the text "simulation" input if the modal provides it, or skip the demo and show the voice screen as a screenshot. |
| Login fails | Use the account you created earlier. If the password is lost, create a new account on the sign-up page before the presentation. Do not rely on the demo login. |
| A feature fails during the presentation | Say what you expected, show the earlier screenshot, and move on. Do not debug in front of the panel. |

**Always keep open in a separate window:** the presentation file, a screen recording or screenshots of the demo sequence, and the README test results.

---

## 5. Likely Panel Questions

Answers are grounded in the repository. Where the answer is "not done", say so directly.

**Problem and users**

1. **What problem does ShopPulse solve?** Stock, billing and supplier bills are handled in separate manual places in small shops. ShopPulse connects them: a sale reduces stock, and a supplier bill can be read into the catalog for review.
2. **Who are the users?** Shop owners, managers and cashiers, with three roles in the backend (`OWNER`, `MANAGER`, `CASHIER`). The primary target is grocery / Kirana stores.
3. **How do you know the problem is real?** We have not yet collected field evidence in a recorded form. The problem is reasoned from how shops are typically run. We will collect interviews and update the problem document with the results.

**Field evidence**

4. **Who did you interview?** Not yet recorded. The template and questions are in the problem document. We will not claim interviews that did not happen.
5. **What did you change because of feedback?** Nothing yet, because no feedback has been recorded. Design decisions so far are the team's hypotheses.

**Architecture and frontend**

6. **What is the architecture?** React + TypeScript + Vite frontend, FastAPI backend under `/api/v1`, SQLAlchemy ORM, SQLite by default, Node Tesseract worker for OCR.
7. **Why React and Vite?** Fast development server, type safety with TypeScript, and a component model that fits the many screens (dashboard, POS, catalog, scanner, insights).
8. **How does the frontend call the backend?** A central API client (`src/api/client.ts`) adds the JWT from local storage to each request, and Vite proxies `/api` to the backend in development.
9. **Why is there Firebase code if you don't use it?** It was part of an earlier design for offline sync and per-user data. The login and main data flows now use the FastAPI backend. The Firebase code is still in the repository and is listed as unbuilt cleanup work.

**Backend, database and API**

10. **Why FastAPI?** Typed request and response models, automatic docs at `/docs`, and async support for the upload endpoints.
11. **What database do you use?** SQLite by default (`backend/shoppulse.db`, gitignored). PostgreSQL is listed in the requirements, but we have not tested a PostgreSQL deployment.
12. **How is the schema managed?** Alembic migrations exist. A legacy column-adding path in `main.py` is skipped when Alembic has run.
13. **How do you keep stock correct during a sale?** The sale runs in one transaction. Stock is reduced with a conditional update, and a failed sale rolls back. Tests cover insufficient stock and invalid products.
14. **How do you handle money?** Python `Decimal` with ROUND_HALF_UP to paise. No binary floats in the pricing engine.

**Authentication and security**

15. **How does login work?** Email and password are checked with bcrypt; a JWT is issued and sent as a bearer token. Inactive users are rejected.
16. **How do roles work?** Shop membership with `OWNER`, `MANAGER`, `CASHIER`. Routes check the current user's membership; role tests are in `test_role_based_access_control.py`.
17. **What are the security weaknesses?** The development `SECRET_KEY` is in the example config and must be replaced. The demo login has hard-coded credentials in client code. Google sign-in is not configured. We would fix these before any real deployment.

**OCR and invoices**

18. **How does the invoice scanner work?** The user captures or uploads a bill. The document-prep pipeline checks quality, rotates and enhances pages, and then OCR extracts a table. Line items are shown for review; stock is not changed until the user confirms.
19. **How accurate is it?** We have not measured accuracy on real supplier photos. The validation folder is empty for that reason. Results on repository fixtures are a different thing and we will not present them as real-world accuracy.
20. **Does it use AI?** The default OCR AI provider is a mock. Gemini and Groq providers exist and are used only when configured. The insights "AI" cards are rule-based templates over computed data.

**Voice**

21. **Does Voice-to-Bill really understand 12 languages?** The parser and item matching are implemented for the supported language list. Speech-to-text is in mock mode by default, so spoken input is not recognised unless a Sarvam key is configured. We have not tested real spoken orders.

**Testing**

22. **How did you test it?** Backend pytest suite, frontend Vitest suite, TypeScript checks for the app and test configs, ESLint-based lint (`oxlint`), and a production build. Counts are in the README and were run for this presentation.
23. **Do you test the UI?** The repository has Playwright-based browser checks under `scripts/e2e/`. For this presentation we captured screenshots against an isolated test database and checked the phone dashboard for horizontal overflow (other screens were not checked at phone width).
24. **Do the tests use the real database?** No. The test runner points the backend at a temporary SQLite file, and a guard stops the process if it would use `backend/shoppulse.db`.

**Limitations and future scope**

25. **What isn't built?** Offline mode (the code exists but is not connected), hardware scales, real-time multi-counter sync, supplier integrations, payment gateways, and a customer ledger. See the unbuilt-features document.
26. **What would you do with more time?** Choose one data store, connect offline mode, test invoices on real photos, test speech with real orders, and add CI.
27. **Why didn't you build X?** Each deferred feature needs external hardware, a service, or a decision we could not make with the evidence we have. We chose to finish and test the core flows.

**Technical challenges and team**

28. **What was the hardest technical problem?** Keeping money and stock exact. We solved it with Decimal arithmetic, one rounding rule, and a single transaction for stock changes.
29. **What did each of you build?** From git history (author-level, non-merge commits): Karthikeya's changes are concentrated in frontend services, hooks, types and pages, plus backend API, database models and schemas; Sasi Kiran's are concentrated in backend services and tests, plus frontend components and pages. Both worked across the stack. Confirm the split and the author names with your team before presenting, and say which parts each of you can explain in depth.
30. **Can you explain your partner's part?** Each person should be able to explain one flow end to end that the other built, for example the sale flow (frontend → API → service → database) or the invoice flow (upload → OCR → review → confirm). Practise this before the day.
31. **Why is the license missing?** The earlier README states MIT, but no license file is in the repository. We will add the file or remove the claim before submission.
32. **Did you change test data to make a test pass?** We changed the layout of the synthetic invoice used by one OCR test, because the supplier name and the invoice metadata overlapped in one font. We did not change any expected value. The change improved supplier and invoice-number extraction on the synthetic benchmark, but three decimal errors appeared on one blurred case and two product names were lost on another. We have not updated the recorded baselines, and we say so rather than hide it.
