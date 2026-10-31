import sys
sys.path.insert(0, 'backend')
import json
import re
from services import invoice_table as table

table._OCR_DIGIT_MAP = str.maketrans({"O": "0", "o": "0", "I": "1", "i": "1", "l": "1", "|": "1", "S": "5", "s": "5", "B": "8", "b": "8"})
table._NUM_TOKEN_RE = re.compile(r"[0-9OoIli|SBsb][0-9OoIli|SBsb,]*(?:\.[0-9OoIli|SBsb]+)?")

table._alias("rate", "reel", "rale", "tate", "rafe")
table._alias("tax_amount", "rel", "lax", "tex", "1ax", "fe")

data3 = json.load(open('scratch/sri_balaji_psm3.json', encoding='utf-8'))
words3 = table.words_from_ocr(data3['words'])
rows3 = table.group_words_into_rows(words3)

header_row = rows3[16]
clean_header_words = [w for w in header_row.words if not re.match(r"^[\s|\[\]\-_—–]+$", w.text)]

med_h = table._median_height(rows3)
phrases = table._phrases_from_words(clean_header_words, gap_limit=max(med_h * 1.5, 40.0))
cols = table._columns_from_phrases(phrases)

rate_col_idx = next((i for i, c in enumerate(cols) if c.role in ("rate", "purchase_price")), -1)
mrp_col_idx = next((i for i, c in enumerate(cols) if c.role == "mrp"), -1)
if rate_col_idx >= 0 and mrp_col_idx > rate_col_idx:
    for c in cols[rate_col_idx + 1 : mrp_col_idx]:
        if c.role == "unknown":
            c.role = "selling_price"

disc_col_idx = next((i for i, c in enumerate(cols) if c.role in ("discount", "discount_pct")), -1)
tot_col_idx = next((i for i, c in enumerate(cols) if c.role in ("total", "taxable")), -1)
if disc_col_idx >= 0 and tot_col_idx > disc_col_idx:
    for c in cols[disc_col_idx + 1 : tot_col_idx]:
        if c.role == "unknown":
            c.role = "tax_amount"

table._assign_spatial_ranges(cols, med_h)

def clean_name(raw: str) -> str:
    name = re.sub(r"^[\s|\[\]\-_—–\d.)]+", "", raw).strip()
    name = re.sub(r"[\s|\[\]\-_—–]+$", "", name).strip()
    name = re.sub(r"\bSO(?=\s*KG\b)", "50", name, flags=re.I)
    name = re.sub(r"\bS00(?=\s*GM\b)", "500", name, flags=re.I)
    name = re.sub(r"(?<=[A-Za-z])SO(?=KG\b)", " 50 ", name, flags=re.I)
    name = re.sub(r"(?<=[A-Za-z])S00(?=GM\b)", " 500 ", name, flags=re.I)
    name = re.sub(r"([A-Za-z]+)(\d+(?:\.\d+)?)\s*([A-Za-z]+)", r"\1 \2 \3", name)
    name = re.sub(r"\b(FORTUNE)(OIL)\b", r"\1 \2", name, flags=re.I)
    name = re.sub(r"\b(CHANA)(DAL)\b", r"\1 \2", name, flags=re.I)
    name = re.sub(r"\b(OIL)(CAN)\b", r"\1 \2", name, flags=re.I)
    name = re.sub(r"\b(PARLE)(G)\b", r"\1-\2", name, flags=re.I)
    if re.match(r"^sueAR\b", name, re.I):
        name = "SUGAR"
    return re.sub(r"\s+", " ", name).strip()

items = []
for row in rows3[17:]:
    text = row.text.strip()
    if not text or table.TABLE_END_RE.match(text):
        if items:
            break
        continue
    cell_words = table._cells_spatial(row, cols)
    cell_text = {i: table._join(ws) for i, ws in cell_words.items()}
    values = {}
    for i, col in enumerate(cols):
        if col.role in table.NUMERIC_ROLES and cell_text.get(i):
            values.setdefault(col.role, []).append((i, table.parse_number(cell_text[i]), cell_words.get(i, [])))
    
    product_text = " ".join(cell_text[i] for i, c in enumerate(cols) if c.role == "product" and cell_text.get(i)).strip()
    product_text = re.sub(r"^\s*\d{1,3}[.)]?\s+(?=\D)", "", product_text)
    raw_cells = {f"{c.role}{'' if c.role != 'unknown' else ':' + c.header_text}": cell_text[i]
                 for i, c in enumerate(cols) if cell_text.get(i)}
    has_values = any(v[1].value is not None for role in ("qty", "rate", "purchase_price", "total", "taxable")
                     for v in values.get(role, []))
    if not has_values or not product_text:
        continue
        
    line = table._build_line(clean_name(product_text), cols, values, cell_text, raw_cells, row, "OCR_TABLE", False)
    items.append(line)

print(f"\nExtracted items: {len(items)}")
for i, it in enumerate(items):
    qty = it.quantity
    rate = it.purchase_price
    disc = it.discount or 0.0
    tax = it.tax_amount or 0.0
    tot = it.line_total
    
    # Arithmetic reconciliation for rate and quantity:
    if rate and tot and qty and qty >= 10:
        shifted_qty = round(qty / 10.0, 2)
        expected_tot = round(shifted_qty * rate - disc + tax, 2)
        if abs(expected_tot - tot) <= max(2.0, tot * 0.02):
            qty = shifted_qty
            
    # Fix rate if rate was shifted or read as 1i925 (11925):
    if qty and tot and rate and rate > tot and qty > 0:
        derived_rate = round((tot + disc - tax) / qty, 2)
        if str(int(derived_rate)) in str(int(rate)):
            rate = derived_rate
            
    sell_str = f"{it.selling_price:8.2f}" if it.selling_price is not None else "    —   "
    unit_str = str(it.unit or '')
    pur_str = f"{rate:8.2f}" if rate is not None else "    —   "
    tot_str = f"{it.line_total:9.2f}" if it.line_total is not None else "    —   "
    mrp_str = f"{it.invoice_mrp:8.2f}" if it.invoice_mrp is not None else "    —   "
    print(f"[{i+1:2d}] {it.product_name:30} | Qty: {qty:5.1f} {unit_str:4} | Rate: {pur_str} | Sell: {sell_str} | MRP: {mrp_str} | Disc: {disc:6.2f} | Tax: {tax:6.2f} | Amount: {tot_str}")
