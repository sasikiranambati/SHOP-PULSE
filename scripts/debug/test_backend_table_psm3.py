import sys
sys.path.insert(0, 'backend')
import json
from services import invoice_table as table

data = json.load(open('scratch/sri_balaji_psm3.json', encoding='utf-8'))
words = table.words_from_ocr(data['words'])
rows = table.group_words_into_rows(words)

print(f"Grouped into {len(rows)} rows.")
for i, r in enumerate(rows):
    print(f"Row {i} (y={round(r.words[0].y0, 1)}): {r.text}")

res = table.extract_table(rows, False, 'OCR_TABLE')
print("\n=== BACKEND TABLE EXTRACTION RESULT ===")
print("Header row index:", res.header_row_index)
print("Header text:", res.header_text)
print("Columns:", [(c.role, c.x0, c.x1) for c in res.columns])
print("Items count:", len(res.items))
for i, it in enumerate(res.items):
    print(f"[{i+1}] Name: '{it.product_name}' | Qty: {it.quantity} | Unit: '{it.unit}' | Purchase: {it.purchase_price} | Sell: {it.selling_price} | MRP: {it.invoice_mrp} | Disc: {it.discount} | Tax: {it.tax_amount} | Total: {it.line_total} | Status: {it.arithmetic_status}")
