import sys
sys.path.insert(0, 'backend')
import json
from services import invoice_table as table

data = json.load(open('scratch/sri_balaji_psm3.json', encoding='utf-8'))
words = table.words_from_ocr(data['words'])
rows = table.group_words_into_rows(words)
r16 = rows[16]

print(f"Row 16 text: {r16.text}")
print("Words in Row 16:")
for i, w in enumerate(r16.words):
    print(f"  [{i}] '{w.text}' x0={round(w.x0, 1)} x1={round(w.x1, 1)}")

cols = table.detect_columns_from_words(r16.words)
print("\nColumns detected by detect_columns_from_words:")
for c in cols:
    print(f"  Role: {c.role:15} x0={round(c.x0, 1)} x1={round(c.x1, 1)} text='{c.header_text}'")
