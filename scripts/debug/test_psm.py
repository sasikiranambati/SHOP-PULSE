import sys
sys.path.insert(0, 'backend')
from services import ocr

img_bytes = open('scratch/original_invoice_sri_balaji.png', 'rb').read()
pre = ocr.validate_and_preprocess_image(img_bytes)

for psm in ['3', '4', '6', '11']:
    res = ocr.run_ocr_on_preprocessed_png(pre, psm)
    header_words = [w['text'] for w in res['words'] if any(k in w['text'].lower() for k in ['desc', 'item', 'qty', 'unit', 'purch', 'sell', 'price', 'mrp', 'rate', 'disc', 'amount'])]
    print(f"PSM {psm}: words={len(res['words'])}, lines={len(res['lines'])}, header_keywords={len(header_words)}")
    print(f"   Keywords found: {header_words}")
