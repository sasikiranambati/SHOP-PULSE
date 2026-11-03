import sys
sys.path.insert(0, 'backend')
import json
from services import ocr

img_bytes = open('scratch/original_invoice_sri_balaji.png', 'rb').read()
pre = ocr.validate_and_preprocess_image(img_bytes)

res3 = ocr.run_ocr_on_preprocessed_png(pre, '3')
open('scratch/sri_balaji_psm3.json', 'w', encoding='utf-8').write(json.dumps(res3, indent=2))

print(f"Total lines in PSM 3: {len(res3['lines'])}")
for i, l in enumerate(res3['lines']):
    print(f"[{i}] {l['text']}")
