import sys
sys.path.insert(0, 'backend')
import json
from services import invoice_table as table

data3 = json.load(open('scratch/sri_balaji_psm3.json', encoding='utf-8'))
words3 = table.words_from_ocr(data3['words'])
rows3 = table.group_words_into_rows(words3)

data6 = json.load(open('scratch/sri_balaji_ocr.json', encoding='utf-8'))
words6 = table.words_from_ocr(data6['words'])
rows6 = table.group_words_into_rows(words6)

print("=== PSM 3 PRODUCT COLUMN WORDS ===")
for r in rows3:
    # Find rows that start with a serial number 1..13
    if r.words and r.words[0].text in [str(i) for i in range(1, 14)]:
        p_words = [w.text for w in r.words if 200 <= w.cx <= 650]
        print(f"Row {r.words[0].text}: {' '.join(p_words)}")

print("\n=== PSM 6 PRODUCT COLUMN WORDS ===")
for r in rows6:
    if r.words and r.words[0].text in [str(i) for i in range(1, 14)]:
        p_words = [w.text for w in r.words if 200 <= w.cx <= 650]
        print(f"Row {r.words[0].text}: {' '.join(p_words)}")
