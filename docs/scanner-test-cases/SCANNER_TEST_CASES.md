# ShopPulse Invoice Scanner: Test Cases

Sample invoices for manually testing the scanner live in this folder (`docs/scanner-test-cases/`). `expected-lines.json` lists, per sample, the lines printed on that invoice (name, qty, unit, rate, MRP) so extracted values can be checked against it.

The "Actual today" column records results observed on branch `claude/tender-fermat-s3asdw`, run against the real backend and UI. Update it when the scanner changes.

## Setup

1. `npm run dev` (starts the backend and the app at http://localhost:5173).
2. Sign in, open **Scan Bill**.
3. Unless a case says otherwise, choose **Full Invoice Scan** and upload the file.
4. The supplier on every sample is *Sri Balaji Wholesale Traders*.

**Rules that apply to every case:**
- The scanner must never invent a price.
- MRP must never be derived from the purchase price.
- The selling price must not be copied from the rate.
- A printed amount must not be changed to make the arithmetic fit.
- Stock changes only after **Add to Stock**, then **Confirm**.

## A. Extraction (one file each)

| ID | File | What it tests | Expected | Actual today | Status |
|---|---|---|---|---|---|
| TC01 | `TC01-clean-digital.pdf` | Digital PDF with every column | 5 lines. Qty 4/20/12/24/48. Rate 245/22/140/9.5/11. MRP 289/28/175/12/14 marked "From invoice". Amounts kept as printed. Selling price empty. | Exactly as expected. "Invoice processed successfully". | ✅ Pass |
| TC02 | `TC02-clean-image.png` | Photo/scan of the same invoice (bordered table) | Same 5 lines as TC01 | Server OCR finds **0 rows** (the table grid becomes noise). The app falls back to in-browser OCR, which reads **5/5 exactly**, with a notice that no MRP lookup ran. | ✅ Pass (via fallback); ⚠️ server OCR gap |
| TC02b | `TC02-clean-image.png`, **Scan Product Table** mode, default crop | Crop mode on a bordered table | Same 5 lines | **3 garbage lines** with no qty, rate or amount. They are flagged and Add to Stock is blocked. | ❌ Known issue |
| TC03 | `TC03-phone-photo.jpg` | Tilted, blurred, unevenly lit phone photo | Readable lines, or a clear "needs checking" result | Full mode: 1 bogus line, "Item Description HSN", rate 51, no qty. Crop mode: 7 garbage lines. All flagged and blocked. Message says "some values need checking". | ❌ Known issue (safe) |
| TC04 | `TC04-no-rate-column.pdf` | No Rate column | Qty and amounts read. **Purchase price empty, not calculated.** Note "Rate could not be read. Amount ÷ quantity = ₹245… confirm manually". "Use ₹245" is offered but not applied. Add to Stock blocked until a price is entered. | Exactly as expected. Message says "some values need checking". | ✅ Pass |
| TC05 | `TC05-amount-mismatch.pdf` | Sunflower Oil printed ₹1,610 but 12 × 140 = ₹1,680 | ₹1,610 **kept**. Line flagged "Qty × rate ≠ amount". Other lines verified. | Exactly as expected. | ✅ Pass |
| TC06 | `TC06-no-mrp-column.pdf` | No MRP column | MRP empty on every line, note "MRP lookup not configured". MRP **not** taken from rate. | Exactly as expected. | ✅ Pass |
| TC07 | `TC07-long-40-lines.pdf` | 40 lines over 2 pages | All 40 lines. Table header stays visible while scrolling. | 40/40 exact. | ✅ Pass |
| TC08 | `TC08-numbers-in-names.pdf` | Names with numbers: "7UP 2.25L", "Lizol … 975ml x 2", "Dettol Soap 125g (Pack of 4)" | Names intact. Qty not merged into names. | 4/4 exact. Unit "pack" is normalised to "pkt". | ✅ Pass |
| TC09 | `TC09-discount-and-gst.pdf` | Disc % and GST % columns; amount includes both | Rates 140/9.5/11. Amounts 1,675.80 / 269.04 / 560.74 kept and verified. MRP empty. | As expected. No unit column, so **a unit must be picked** before Add to Stock. | ✅ Pass |
| TC10 | `TC10-no-item-table.png` | Payment receipt with no item table | No lines. Warning "No product rows could be detected…". Nothing can be added. | As expected. | ✅ Pass |
| TC11 | `TC11-empty-file.pdf` | 0-byte file | Clear error. Stock unchanged. | "Invoice upload failed: Uploaded file is empty. Please upload a valid invoice document." | ✅ Pass |
| TC12 | `TC12-text-invoice.txt` | Plain-text invoice | 3 lines: Tata Salt 20 × 22, Parle-G 24 × 9.5, Red Label 10 × 245, MRPs 28/12/290 | Exactly as expected. | ✅ Pass |

## B. Review and stock update (use TC01 unless noted)

| ID | Steps | Expected | Actual today | Status |
|---|---|---|---|---|
| TC13 | Scan TC01, Add to Stock, Confirm. Note Stock Catalog before and after. | Each matched product's stock rises by exactly its invoice qty. One purchase record. Success card shows units and value. | Verified: Tata Salt +10 for a qty-10 line. One purchase recorded. | ✅ Pass |
| TC14 | In the Confirm dialog, **double-click** "Confirm & Add to Stock". | Recorded once. | Verified: purchases went from 1 to 2, not 3. | ✅ Pass |
| TC15 | Scan **the same invoice again** and confirm. | Refused with "Invoice … was already added to stock". Edits kept. Stock unchanged. | Verified. | ✅ Pass |
| TC16 | Scan any file, press **Discard**, then **Keep reviewing**. Discard again and confirm. | First asks and keeps the lines. Second clears the review. Stock unchanged. | Verified. | ✅ Pass |
| TC17 | Scan TC04, press Add to Stock without entering prices. | Blocked: "Purchase price is required (it could not be read from the invoice)". New products also need a selling price. | Verified for missing qty and price. | ✅ Pass |
| TC18 | Edit a line (✏️), click **Link Store Item**, pick a product, then **Save Changes**. | The line stays linked to the chosen product. | Fixed in this branch. Unit-tested; not re-run in the UI. | ✅ (unit test) |
| TC19 | On a matched line with no stored purchase price, click **Use Store Prices**. | Purchase price stays empty, not ₹0. A stored selling price and MRP are copied, with MRP marked "From store record". | Fixed in this branch; unit-tested. | ✅ (unit test) |
| TC20 | Edit a pack size from "400 g" to "500g". | Shows "500g", not "500g g". | Fixed in this branch; unit-tested. | ✅ (unit test) |
| TC21 | Stop the backend, then scan TC12 in Full Invoice mode. | Falls back to in-browser OCR with a notice "…server could not be reached…". No MRP lookup. | **Not run in the UI this session.** | ⏳ To run |
| TC22 | Scan any file and watch the progress area. | "Uploading" with a real %, then "Processing" with no %, then the review. No invented percentages. | Verified: Uploading → Processing, about 1.3–2 s on a server-OCR image. | ✅ Pass |

## Known scanner issues found by these cases (not fixed)

1. **Server OCR cannot read bordered/ruled tables in photos (TC02/TC03).**
   - Text outside the grid reads fine; text inside becomes noise, so no header row is found.
   - Today the in-browser fallback rescues clean photos. Phone photos still fail.
2. **"Scan Product Table" crop mode does worse than Full mode on bordered tables (TC02b/TC03)**, even though the UI labels it "Recommended".
3. **A quantity printed slightly left of its "Qty" header gets merged into the product name**, e.g. "Tata Salt 1kg 10" with qty empty.
   - Cause: in `backend/services/invoice_table.py`, `_assign_spatial_ranges` extends the product column up to the Qty header.
   - The line is flagged and blocked; nothing is invented.
4. **Supplier name picks up "TAX INVOICE"** from the same header line (all samples): `SRI BALAJI WHOLESALE TRADERS TAX INVOICE`.

In every failing case the bad values were flagged and blocked from stock; none were silently saved.
