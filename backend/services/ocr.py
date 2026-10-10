import io
import os
import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple, Dict, Any, List
from PIL import Image, ImageEnhance, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

WORKER_PATH = Path(__file__).resolve().parent / "ocr_worker.mjs"

def validate_and_preprocess_image(file_bytes: bytes) -> bytes:
    """
    Validates image bytes using Pillow, corrects EXIF orientation,
    and applies adaptive scaling and contrast enhancement optimized for invoice table OCR.
    """
    if not file_bytes:
        raise ValueError("Image file is empty.")

    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError(f"Invalid or unreadable image file: {str(e)}")

    # 1. Correct EXIF rotation (smartphones often store portrait photos rotated with an EXIF orientation flag)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception as e:
        logger.debug(f"EXIF transpose skipped: {e}")

    # Convert to RGB mode if necessary
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    w, h = img.size
    max_dim = max(w, h)
    
    # 2. Adaptive scaling: low-res images (< 1600px) need upscaling for small text recognition
    if max_dim < 1600:
        scale = min(3.0, 2400.0 / max_dim)
        if scale > 1.0:
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    elif max_dim > 3600:
        # Downscale excessively large images to avoid excessive memory / latency
        scale = 3000.0 / max_dim
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # 3. Mild contrast enhancement to sharpen text against light background
    try:
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.15)
    except Exception as e:
        logger.warning(f"Could not apply contrast enhancement: {e}")

    out_buf = io.BytesIO()
    img.save(out_buf, format="PNG")
    return out_buf.getvalue()

def extract_structured_ocr_from_image_bytes(file_bytes: bytes, psm_mode: str = "auto") -> Dict[str, Any]:
    """
    Extracts structured OCR data including full text, confidence, lines, and words
    with bounding boxes from raw image bytes using the backend OCR pipeline.
    """
    preprocessed_bytes = validate_and_preprocess_image(file_bytes)

    if not WORKER_PATH.exists():
        raise FileNotFoundError(f"OCR worker script not found at {WORKER_PATH}")

    # Write to a temporary file for the Node OCR worker
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
        tmp_path = tmp_file.name
        tmp_file.write(preprocessed_bytes)

    try:
        cmd = ["node", str(WORKER_PATH), tmp_path]
        if psm_mode and psm_mode != "auto":
            cmd.append(psm_mode)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90,
            check=False
        )

        if result.returncode != 0:
            err_msg = result.stderr.strip() or f"Process exited with code {result.returncode}"
            logger.error(f"OCR worker failed: {err_msg}")
            raise RuntimeError(f"OCR engine execution failed: {err_msg}")

        try:
            data = json.loads(result.stdout)
            text = data.get("text", "")
            confidence = float(data.get("confidence", 0.0))
            lines = data.get("lines", [])
            words = data.get("words", [])

            return {
                "text": text,
                "confidence": confidence,
                "lines": lines,
                "words": words,
            }
        except json.JSONDecodeError as jde:
            logger.error(f"Failed to parse OCR worker output: {result.stdout}")
            raise RuntimeError(f"Invalid output from OCR engine: {str(jde)}")

    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

def extract_text_from_image_bytes(file_bytes: bytes) -> Tuple[str, float]:
    """
    Extracts text and recognition confidence from raw image bytes.
    Backward-compatible wrapper around extract_structured_ocr_from_image_bytes.
    
    Returns:
        Tuple[str, float]: (extracted_text, average_confidence)
    """
    ocr_data = extract_structured_ocr_from_image_bytes(file_bytes)
    return ocr_data["text"], ocr_data["confidence"]
