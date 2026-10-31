import json

data = json.load(open('scratch/sri_balaji_ocr.json', encoding='utf-8'))
words = data['words']

print("=== ALL WORDS CONTAINING HEADER KEYWORDS ===")
keywords = ['s.no', 'item', 'desc', 'hsn', 'qty', 'unit', 'purch', 'sell', 'price', 'mrp', 'disc', 'tax', 'amount', 'rate', 'total']
for w in words:
    t = w['text'].lower()
    if any(k in t for k in keywords):
        print(f"Word: {w['text']:20} bbox: {w['bbox']}")

print("\n=== ALL WORDS BETWEEN Y 400 AND 700 ===")
for w in words:
    y0 = w['bbox']['y0']
    if 400 <= y0 <= 750:
        print(f"{w['text']:15} y0={round(y0, 1)} y1={round(w['bbox']['y1'], 1)} x0={round(w['bbox']['x0'], 1)} x1={round(w['bbox']['x1'], 1)}")
