import sys
sys.path.insert(0, 'backend')
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
from services import ocr
import io

img = Image.open('scratch/original_invoice_sri_balaji.png')
# exif transpose and grayscale
img = ImageOps.exif_transpose(img)
if img.mode in ("RGBA", "LA", "P"):
    img = img.convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    img = Image.alpha_composite(background, img)
img = img.convert("L")

# Autocontrast + Sharpen + slight contrast enhance
img = ImageOps.autocontrast(img, cutoff=0.5)
img = img.filter(ImageFilter.SHARPEN)
enhancer = ImageEnhance.Contrast(img)
img = enhancer.enhance(1.5)

buf = io.BytesIO()
img.save(buf, format="PNG")
png_bytes = buf.getvalue()
open('scratch/test_preprocessed_full.png', 'wb').write(png_bytes)

res = ocr.run_ocr_on_preprocessed_png(png_bytes, '3')
print(f"Total lines: {len(res['lines'])}, words: {len(res['words'])}")
for i, l in enumerate(res['lines'][:25]):
    print(f"[{i}] {l['text']}")
