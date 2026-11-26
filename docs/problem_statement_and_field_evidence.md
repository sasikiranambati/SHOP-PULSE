# ShopPulse — Problem Statement and Field Evidence

> **Evidence status:** The repository contains **no recorded field interviews, surveys, or customer feedback**. Section 6 and Section 8 are templates for the team to complete. Nothing in this document should be presented as a field finding until a real interview record exists.

## 1. Project Overview

ShopPulse (the UI brands the product as "SHELFORA") is a web application for small retail shops, with the grocery / Kirana store as the primary target. It combines:

- **Stock management** — product catalog, stock levels, low-stock alerts, supplier records.
- **Point of sale (POS)** — multi-item bill creation, stock deduction on sale, sales history, receipts.
- **Supplier invoice intake** — uploading a supplier bill (photo, PDF or image) and extracting line items for review before stock is updated.
- **Voice-assisted billing** — spoken item lists turned into a draft bill (mock speech-to-text by default).
- **Business insights** — sales summaries, top sellers, and a simple demand estimate.

Implementation details are verified in [unbuilt_features_and_reasoning.md](unbuilt_features_and_reasoning.md) and the repository README.

## 2. Problem Statement

Small shop owners in India often run stock, billing, and supplier purchases in separate, manual places — paper bills, registers, and memory. As a result:

- Owners often do not know what is on the shelf until a customer asks, or until stock runs out.
- Supplier bills must be re-typed item by item to update stock and prices, which is slow and error-prone.
- Billing and stock are not linked, so a sale may not reduce the recorded stock.
- Reorder decisions depend on the owner's memory.

ShopPulse proposes a single system where a sale reduces stock, a supplier bill can be read into the catalog for review, and the owner sees low-stock items and sales totals in one place.

> **Not yet established:** how many shops face these problems, how much time they lose, and how much money they lose. None of these figures has been measured. Do not state them without field data.

## 3. Target Users

| User | Role in the shop | Workflow ShopPulse supports | Challenge addressed |
|---|---|---|---|
| Shop owner | Owner (full access) | Dashboard, stock catalog, reports, invoice intake | Needs a view of stock and sales without a manual register |
| Store manager | Manager | Stock catalog, purchases, sales history | Needs to update stock and review supplier bills |
| Cashier | Cashier (limited access) | POS billing, receipts | Needs fast billing with correct stock deduction |

Roles are defined in the backend (`OWNER`, `MANAGER`, `CASHIER` in `backend/db/models/shop_member.py`). Whether the access split matches how real shops operate is **not yet validated**.

## 4. Existing Workflow and Pain Points

| Existing Activity | Difficulty | Potential Impact |
|---|---|---|
| Recording stock in a notebook or by memory | Hard to know current stock or what is low | Missed restocking, stock-outs |
| Billing customers by hand or with a basic calculator | Stock not reduced automatically | Stock records drift from the shelf |
| Re-typing supplier bills into a register | Slow, transcription errors | Wrong prices or quantities recorded |
| Tracking sales totals at day end | Manual totals | Late or inaccurate daily figures |
| Judging which items sell fastest | Based on memory | Poor purchasing decisions |

The "Potential Impact" column describes what the team *expects* could happen. None of it is measured. Replace with observed data after interviews.

## 5. Proposed Solution

| Problem | ShopPulse Solution | Implemented Status |
|---|---|---|
| Unknown current stock | Product catalog with stock levels and low-stock list | **Verified implemented** (API + UI) |
| Stock not reduced on sale | POS sale deducts stock in the same database transaction | **Verified implemented** (backend tests in `backend/tests/test_sales.py`) |
| Re-typing supplier bills | Invoice scanner: upload → extract line items → review → confirm | **Partially implemented** — extraction runs; accuracy on real-world photos is **not measured** (see `validation/real_invoices/README.md`) |
| Slow counter billing | Quick POS with search, category filters and bill basket | **Verified implemented** (UI) |
| Spoken orders | Voice-to-Bill for 12 Indian languages | **Partially implemented** — the parser and matching work; speech-to-text runs in **mock mode** unless a Sarvam API key is configured |
| Day-end sales totals | Dashboard sales summary and sales history | **Verified implemented** |
| Which items sell fastest | Top sellers, and an EWMA-based demand estimate | **Implemented as a statistical estimate** (not an AI model) |
| Offline use | Offline queue and sync manager | **Not functional end-to-end** — see Section 2 of [unbuilt_features_and_reasoning.md](unbuilt_features_and_reasoning.md) |

## 6. Field Evidence

**FIELD EVIDENCE MUST BE COLLECTED AND VERIFIED BY THE TEAM.**

No interview, observation, survey, or customer-feedback record exists in this repository. To satisfy the field-evidence criterion, the team must:

1. Visit or call at least several shop owners, managers, or cashiers outside the classroom (a suggested minimum is set by the course rubric; check it).
2. Obtain consent before recording any interview. Do not record names or contact details in the repository unless participants agree.
3. Complete one **Interview Record** (template below) per conversation, and save it in `docs/field_evidence/` (create this folder when real records exist).
4. Link each design decision in Section 9 to a specific interview record ID.

### Interview Record

- Interview ID:
- Date:
- Location:
- Participant type: (owner / manager / cashier / supplier / other)
- Participant consent: (yes / no — and how it was recorded)
- Interviewer:
- Questions asked:
- Responses:
- Observed workflow:
- Pain points:
- Key insight:
- How this insight influenced ShopPulse:

## 7. Interview Questions

Ask these neutrally. Do not suggest answers, and do not mention ShopPulse until the end.

1. How do you currently keep track of what stock you have?
2. How do you find out that an item is running low?
3. How do you record a sale or create a bill for a customer?
4. What happens to your stock records when you sell something?
5. How do you record goods when a supplier delivers them?
6. How do you handle a supplier bill — who enters it, and how long does it take?
7. How do you decide what price to charge for an item, and where do the prices come from?
8. Which part of your day takes the most time in running the shop?
9. What mistakes happen most often, and how do you find out about them?
10. How do you check your sales totals at the end of the day?
11. Do you use any software today? What do you like and dislike about it?
12. If a tool helped with one thing, what would you want it to do first?

## 8. Evidence Summary

| Interview | User Type | Pain Point | Evidence | Design Decision |
|---|---|---|---|---|
| _(no records yet)_ | | | | |
| | | | | |
| | | | | |

## 9. How Field Feedback Influenced Design

Required chain for each design decision:

**User evidence (interview ID) → Identified problem → Feature / design decision → Where it appears in the app**

| User evidence (interview ID) | Identified problem | Feature / design decision | Where in the app |
|---|---|---|---|
| _(pending field data)_ | | | |

Until rows exist here, the features in this project are **the team's own design hypotheses**, not findings from users.

## 10. Conclusion

The problem — manual, disconnected stock, billing and supplier-bill handling in small shops — is a plausible and reasonable motivation for ShopPulse. The application addresses several parts of that workflow in working form: catalog and stock, POS billing with stock deduction, sales summaries, and invoice intake.

The problem has **not yet been validated with users**. Validation requires the field evidence described in Section 6, and the claims in this document should be updated once that evidence exists.
