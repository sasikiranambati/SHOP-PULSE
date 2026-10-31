import io
import subprocess
import json
import tempfile
from PIL import Image, ImageEnhance

def test_upscale_ocr():
    with open("scratch/test_invoice.jpeg", "rb") as f:
        img_bytes = f.read()

    img = Image.open(io.BytesIO(img_bytes))
    w, h = img.size
    print(f"Original size: {w}x{h}")
    
    # Upscale 3x
    upscaled = img.resize((w * 3, h * 3), Image.Resampling.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name
        upscaled.save(tmp_path)

    res = subprocess.run(["node", "scratch/ocr_worker.mjs", tmp_path], capture_output=True, text=True)
    if res.returncode == 0:
        data = json.loads(res.stdout)
        print("Confidence:", data["confidence"])
        print("\n=== EXTRACTED OCR TEXT PREVIEW ===")
        print(data["text"][:600])
    else:
        print("Failed:", res.stderr)

if __name__ == "__main__":
    test_upscale_ocr()
