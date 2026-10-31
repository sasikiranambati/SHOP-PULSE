from PIL import Image, ImageEnhance, ImageFilter

img = Image.open('scratch/test_invoice.jpeg')
w, h = img.size
print(f"Original size: {w}x{h}")

# Test 1: 3x upscale with Lanczos
img_3x = img.resize((w * 3, h * 3), Image.Resampling.LANCZOS)
img_3x.save('scratch/test_3x.png')
print(f"Saved 3x upscale: {w*3}x{h*3}")

# Test 2: 3x grayscale + contrast
gray_3x = img_3x.convert('L')
enhancer = ImageEnhance.Contrast(gray_3x)
contrast_3x = enhancer.enhance(1.8)
contrast_3x.save('scratch/test_3x_contrast.png')

# Test 3: 4x upscale
img_4x = img.resize((w * 4, h * 4), Image.Resampling.LANCZOS)
img_4x.save('scratch/test_4x.png')
print("Generated upscaled test images.")
