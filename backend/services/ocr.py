import io
import os
import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple, Dict, Any, Optional
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

WORKER_PATH = Path(__file__).resolve().parent / "ocr_worker.mjs"
OCR_TIMEOUT_SECONDS = 90


class OcrUnavailableError(RuntimeError):
    """The OCR engine could not run (Node missing, language data missing, crash).

    Distinct from ValueError, which means the uploaded file itself is invalid.
    """


MAX_SKEW_DEGREES = 8.0
MIN_SKEW_CORRECTION = 0.3


def estimate_skew_angle(gray: Image.Image, max_angle: float = MAX_SKEW_DEGREES) -> float:
    """
    Estimates page skew by projection profile: text lines and table rules are
    horizontal when the row-darkness profile is sharpest. Returns the angle (degrees,
    counter-clockwise) that makes the page level. Uses Pillow only.
    """
    small = gray.copy()
    small.thumbnail((900, 900))
    ink = small.point(lambda p: 255 if p < 150 else 0)  # dark pixels -> white

    def sharpness(angle: float) -> float:
        rotated = ink.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=0)
        profile = list(rotated.resize((1, rotated.height), Image.Resampling.BOX).getdata())
        return float(sum((b - a) ** 2 for a, b in zip(profile, profile[1:])))

    def best(candidates):
        return max(candidates, key=sharpness)

    steps = int(max_angle / 0.5)
    coarse = best([i * 0.5 for i in range(-steps, steps + 1)])
    fine = best([round(coarse + i * 0.1, 2) for i in range(-5, 6)])
    return fine


def preprocess_image(file_bytes: bytes) -> Tuple[bytes, Dict[str, Any]]:
    """
    Validates image bytes, corrects EXIF orientation and skew, converts to grayscale,
    stretches contrast and rescales to a size Tesseract reads well. The uploaded file
    itself is never modified. Returns (png_bytes, info).
    """
    if not file_bytes:
        raise ValueError("Image file is empty.")

    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        logger.info(f"Unreadable image upload: {e}")
        raise ValueError("Invalid or unreadable image file: the file is not a PNG, JPG, WEBP, BMP or TIFF image, "
                         "or it is damaged. Upload the original photo or PDF of the invoice.")

    # Smartphones often store portrait photos rotated with an EXIF orientation flag
    try:
        img = ImageOps.exif_transpose(img)
    except Exception as e:
        logger.debug(f"EXIF transpose skipped: {e}")

    # Flatten transparency onto white, then work in grayscale
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(background, img)
    img = img.convert("L")
    info: Dict[str, Any] = {"deskew_angle": 0.0}

    # Phone photos are rarely level; even ~1.5 degrees moves the right end of a table row
    # onto the next row. Rotating the page level keeps every row on one baseline.
    try:
        angle = estimate_skew_angle(img)
        if abs(angle) >= MIN_SKEW_CORRECTION:
            img = img.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
            info["deskew_angle"] = angle
    except Exception as e:
        logger.warning(f"Skew estimation skipped: {e}")

    w, h = img.size
    max_dim = max(w, h)
    # Low-res images need upscaling for small text; huge ones are downscaled for latency
    if max_dim < 1600:
        scale = min(3.0, 2400.0 / max_dim)
        if scale > 1.0:
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    elif max_dim > 3600:
        scale = 3000.0 / max_dim
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)

    # Plain min/max stretch only. Clipping histogram tails (autocontrast cutoff) or extra
    # contrast boosts damage glyph edges because text is well under 1% of an invoice's pixels.
    try:
        img = ImageOps.autocontrast(img, cutoff=0)
    except Exception as e:
        logger.warning(f"Could not apply contrast stretch: {e}")

    out_buf = io.BytesIO()
    img.save(out_buf, format="PNG")
    return out_buf.getvalue(), info


def validate_and_preprocess_image(file_bytes: bytes) -> bytes:
    """Backward-compatible wrapper returning only the preprocessed PNG bytes."""
    return preprocess_image(file_bytes)[0]


def _worker_env() -> Dict[str, str]:
    env = os.environ.copy()
    # Node's built-in fetch ignores HTTPS_PROXY unless asked to honour it (Node >= 22.21).
    # Only relevant when language data has to be downloaded at runtime.
    if (env.get("HTTPS_PROXY") or env.get("https_proxy")) and "NODE_USE_ENV_PROXY" not in env:
        env["NODE_USE_ENV_PROXY"] = "1"
    return env


def _parse_worker_error(stderr: str) -> Tuple[Optional[str], str]:
    """The worker prints a JSON line {error, code} on failure; fall back to raw stderr."""
    for line in reversed((stderr or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                payload = json.loads(line)
                return payload.get("code"), str(payload.get("error") or "")
            except json.JSONDecodeError:
                continue
    return None, (stderr or "").strip()[-500:]


def run_ocr_on_preprocessed_png(png_bytes: bytes, psm_mode: str = "auto") -> Dict[str, Any]:
    """Runs the Node tesseract.js worker on an already preprocessed PNG."""
    if not WORKER_PATH.exists():
        raise OcrUnavailableError(f"OCR worker script not found at {WORKER_PATH}")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
        tmp_path = tmp_file.name
        tmp_file.write(png_bytes)

    try:
        cmd = ["node", str(WORKER_PATH), tmp_path]
        if psm_mode and psm_mode != "auto":
            cmd.append(psm_mode)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=OCR_TIMEOUT_SECONDS,
                check=False,
                env=_worker_env(),
            )
        except FileNotFoundError:
            raise OcrUnavailableError("Node.js is not installed or not on PATH; it is required for backend OCR.")
        except subprocess.TimeoutExpired:
            raise OcrUnavailableError(f"OCR engine timed out after {OCR_TIMEOUT_SECONDS}s.")

        if result.returncode != 0:
            code, message = _parse_worker_error(result.stderr)
            logger.error("OCR worker failed (%s): %s", code or "unknown", message)
            raise OcrUnavailableError(message or f"OCR engine exited with code {result.returncode}")

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as jde:
            logger.error("Failed to parse OCR worker output (%d bytes)", len(result.stdout or ""))
            raise OcrUnavailableError(f"Invalid output from OCR engine: {str(jde)}")

        return {
            "text": data.get("text", ""),
            "confidence": float(data.get("confidence") or 0.0),
            "lines": data.get("lines", []),
            "words": data.get("words", []),
            "psm": data.get("psm", psm_mode),
            "language_data": data.get("language_data"),
        }
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def extract_structured_ocr_from_image_bytes(file_bytes: bytes, psm_mode: str = "auto") -> Dict[str, Any]:
    """
    Extracts structured OCR data (full text, confidence, lines, and words with
    bounding boxes) from raw image bytes. Raises ValueError for unreadable images
    and OcrUnavailableError when the OCR engine itself cannot run.
    """
    preprocessed_bytes = validate_and_preprocess_image(file_bytes)
    return run_ocr_on_preprocessed_png(preprocessed_bytes, psm_mode)


def extract_text_from_image_bytes(file_bytes: bytes) -> Tuple[str, float]:
    """
    Extracts text and recognition confidence from raw image bytes.
    Backward-compatible wrapper around extract_structured_ocr_from_image_bytes.
    """
    ocr_data = extract_structured_ocr_from_image_bytes(file_bytes)
    return ocr_data["text"], ocr_data["confidence"]
