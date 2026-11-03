import sys
sys.path.insert(0, 'backend')
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
from services import ocr

img = Image.open('scratch/original_invoice_sri_balaji.png')
# Crop header region: y from ~30% to 36%
w, h = img.size
crop = img.crop((int(w * 0.03), int(h * 0.30), int(w * 0.98), int(h * 0.36)))
crop.save('scratch/test_crop_raw.png')

# Method 1: Grayscale + Autocontrast
c1 = crop.convert('L')
c1_ac = ImageOps.autocontrast(c1, cutoff=1)
c1_ac.save('scratch/test_crop_m1.png')

# Method 2: Contrast enhanced
enhancer = ImageEnhance.Contrast(c1)
c2 = enhancer.enhance(2.0)
c2.save('scratch/test_crop_m2.png')

# Method 3: Sharpen + Contrast
c3 = c1.filter(ImageFilter.SHARPEN)
c3 = ImageEnhance.Contrast(c3).enhance(1.8)
c3.save('scratch/test_crop_m3.png')

# Method 4: Upscaled x2 + Contrast
c4 = c1.resize((c1.width * 2, c1.height * 2), Image.Resampling.LANCZOS)
c4 = ImageEnhance.Contrast(c4).enhance(1.5)
c4.save('scratch/test_crop_m4.png')

for name in ['m1', 'm2', 'm3', 'm4']:
    res = ocr.run_ocr_on_preprocessed_png(open(f'scratch/test_crop_{name}.png', 'rb').read(), '3')
    print(f"--- {name} ---")
    print(res['text'].strip())
