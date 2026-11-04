"""
Image preprocessing interface and adaptive OpenCV implementation.
Handles EXIF orientation, deskewing, resolution normalization (300 DPI),
adaptive contrast enhancement (CLAHE), bilateral noise reduction, and sharpening.
Preserves decimal points, thin punctuation, and original document evidence.
"""

from abc import ABC, abstractmethod
import io
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ImageProcessingError
from services.grocery_ocr.logger import get_logger

logger = get_logger("processors.image_processor")


class ImagePreprocessResult(BaseModel):
    """Result of preprocessing an invoice image for optimal OCR extraction."""
    processed_bytes: bytes = Field(..., description="Cleaned, normalized PNG bytes ready for OCR")
    original_dimensions: Tuple[int, int] = Field(..., description="(width, height) of input image")
    processed_dimensions: Tuple[int, int] = Field(..., description="(width, height) of output image")
    dpi: int = Field(default=300, ge=72, description="Target horizontal and vertical resolution")
    skew_angle_degrees: float = Field(default=0.0, description="Estimated skew angle corrected in degrees")
    preprocessing_steps_applied: List[str] = Field(
        default_factory=list,
        description="Sequential list of preprocessing techniques applied"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Image metrics and transformations")


class IImageProcessor(ABC):
    """Abstract interface for image preprocessing and normalization."""

    @abstractmethod
    def preprocess(self, image_bytes: bytes) -> ImagePreprocessResult:
        """
        Applies end-to-end adaptive preprocessing: orientation, deskewing, resizing,
        contrast enhancement, noise reduction, and format normalization.

        Args:
            image_bytes: Raw input image bytes (PNG, JPEG, WebP, etc.).

        Returns:
            ImagePreprocessResult with processed bytes and telemetry.

        Raises:
            ImageProcessingError: If the image is truncated, invalid, or cannot be processed.
        """
        pass

    @abstractmethod
    def deskew(self, image_bytes: bytes) -> Tuple[bytes, float]:
        """Detects and corrects rotational tilt/skew in the invoice image."""
        pass

    @abstractmethod
    def normalize_resolution(self, image_bytes: bytes, target_dpi: int = 300) -> bytes:
        """Rescales the image so characters have optimal pixel height for OCR."""
        pass


class AdaptiveImageProcessor(IImageProcessor):
    """
    Adaptive OpenCV-based image preprocessing pipeline.
    Inspects image blur, contrast, and tilt metrics to select optimal operations
    without overprocessing or damaging decimal points.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def preprocess(self, image_bytes: bytes) -> ImagePreprocessResult:
        logger.debug("Preprocessing image (bytes=%d)", len(image_bytes))
        steps: List[str] = []
        debug_paths: Dict[str, str] = {}
        ts = int(time.time() * 1000)

        debug_dir = self._get_debug_dir()

        try:
            # 1. Load image and correct EXIF orientation (mobile cameras)
            pil_img = Image.open(io.BytesIO(image_bytes))
            orig_w, orig_h = pil_img.size
            try:
                transposed = ImageOps.exif_transpose(pil_img)
                if transposed is not pil_img:
                    pil_img = transposed
                    steps.append("exif_orientation_correction")
            except Exception as e:
                logger.debug("EXIF transpose skipped: %s", e)

            # Flatten alpha transparency onto pure white
            if pil_img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGBA", pil_img.size, (255, 255, 255, 255))
                if pil_img.mode == "P":
                    pil_img = pil_img.convert("RGBA")
                elif pil_img.mode == "LA":
                    pil_img = pil_img.convert("RGBA")
                composed = Image.alpha_composite(bg, pil_img)
                pil_img = composed.convert("RGB")
                steps.append("flatten_alpha_to_white")
            elif pil_img.mode != "RGB":
                pil_img = pil_img.convert("RGB")

            # Convert to OpenCV BGR array
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            if debug_dir:
                p = debug_dir / f"{ts}_01_original.png"
                cv2.imwrite(str(p), cv_img)
                debug_paths["01_original"] = str(p)

            # 1.5 Cardinal Rotation Correction (90 / 270 degrees)
            cv_img, cardinal_rot = self.detect_and_correct_cardinal_rotation(cv_img)
            if cardinal_rot != 0:
                steps.append(f"cardinal_rotation_{cardinal_rot}deg")

            # 2. Deskewing: detect horizontal text alignment
            cv_img, skew_angle = self._deskew_cv2(cv_img)
            if abs(skew_angle) >= 0.5:
                steps.append(f"deskew_{skew_angle:+.2f}deg")
                if debug_dir:
                    p = debug_dir / f"{ts}_02_deskewed.png"
                    cv2.imwrite(str(p), cv_img)
                    debug_paths["02_deskewed"] = str(p)

            # 3. Resolution Normalization / Optimal Scaling
            cv_img, scaled = self._rescale_for_ocr(cv_img)
            if scaled:
                steps.append(f"rescale_{cv_img.shape[1]}x{cv_img.shape[0]}")

            # Convert to single-channel Grayscale for contrast/noise processing
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

            # 3.5 Illumination Normalization (Shadow removal for mobile camera photos)
            gray, ill_normalized = self.normalize_illumination(gray)
            if ill_normalized:
                steps.append("illumination_normalization")

            # 3.6 Table Grid Line Removal (Prevents characters fusing with borders in ruled tables)
            gray, grid_removed = self.remove_table_grid_lines(gray)
            if grid_removed:
                steps.append("table_grid_line_removal")

            # 4. Contrast Analysis & Adaptive Enhancement (CLAHE)
            mean_val, std_val = cv2.meanStdDev(gray)
            mean_lum = float(mean_val[0][0])
            std_lum = float(std_val[0][0])
            is_low_contrast = std_lum < 40.0

            if is_low_contrast:
                # Faded invoice or dim photo: apply CLAHE
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                gray = clahe.apply(gray)
                steps.append("clahe_contrast_enhancement")
                if debug_dir:
                    p = debug_dir / f"{ts}_03_clahe.png"
                    cv2.imwrite(str(p), gray)
                    debug_paths["03_clahe"] = str(p)
            else:
                # Natural contrast stretch without tail clipping
                gray = cv2.normalize(gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
                steps.append("minmax_contrast_stretch")

            # 5. Bilateral Noise Reduction (preserves crisp edges and decimal points)
            gray = cv2.bilateralFilter(gray, d=5, sigmaColor=50, sigmaSpace=50)
            steps.append("bilateral_noise_filter")

            # 6. Sharpness Analysis & Adaptive Unsharp Masking
            lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            is_blurry = lap_var < 150.0

            if is_blurry:
                # Mild unsharp mask to restore blurred character glyphs
                blurred = cv2.GaussianBlur(gray, (0, 0), 2.0)
                gray = cv2.addWeighted(gray, 1.25, blurred, -0.25, 0)
                steps.append("adaptive_unsharp_mask")

            # Encode preprocessed grayscale image to lossless PNG
            success, encoded_png = cv2.imencode(".png", gray)
            if not success:
                raise ImageProcessingError("Failed to encode preprocessed image to PNG format.")

            processed_bytes = encoded_png.tobytes()
            proc_h, proc_w = gray.shape[:2]

            if debug_dir:
                p = debug_dir / f"{ts}_04_preprocessed.png"
                p.write_bytes(processed_bytes)
                debug_paths["04_preprocessed"] = str(p)

            return ImagePreprocessResult(
                processed_bytes=processed_bytes,
                original_dimensions=(orig_w, orig_h),
                processed_dimensions=(proc_w, proc_h),
                dpi=self.config.default_dpi,
                skew_angle_degrees=round(skew_angle, 2),
                preprocessing_steps_applied=steps,
                metadata={
                    "format": "PNG",
                    "mode": "L",
                    "mean_luminance": round(mean_lum, 2),
                    "std_luminance": round(std_lum, 2),
                    "is_low_contrast": is_low_contrast,
                    "laplacian_variance": round(lap_var, 2),
                    "is_blurry": is_blurry,
                    "debug_image_paths": debug_paths,
                }
            )
        except Exception as exc:
            logger.error("Adaptive image preprocessing failed: %s", exc)
            raise ImageProcessingError(f"Image preprocessing failed: {exc}", details={"error": str(exc)})

    def deskew(self, image_bytes: bytes) -> Tuple[bytes, float]:
        """Detects and corrects document skew returning (deskewed_bytes, angle_degrees)."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ImageProcessingError("Could not decode image for deskewing.")
        deskewed_img, angle = self._deskew_cv2(img)
        success, enc = cv2.imencode(".png", deskewed_img)
        return (enc.tobytes() if success else image_bytes), angle

    def normalize_resolution(self, image_bytes: bytes, target_dpi: int = 300) -> bytes:
        """Rescales the image to optimal OCR resolution (~2400-3000px max dimension)."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes
        rescaled, _ = self._rescale_for_ocr(img)
        success, enc = cv2.imencode(".png", rescaled)
        return enc.tobytes() if success else image_bytes

    def evaluate_thresholding(self, gray: np.ndarray, method: str = "adaptive") -> np.ndarray:
        """
        Evaluates alternative binarization strategies (adaptive Gaussian vs Otsu).
        Used when documents suffer from extreme non-uniform illumination.
        """
        if method == "otsu":
            return cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        elif method == "adaptive":
            return cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 8
            )
        return gray

    def detect_and_correct_cardinal_rotation(self, img: np.ndarray) -> Tuple[np.ndarray, int]:
        """
        Detects if document is rotated 90 or 270 degrees based on dominant orientation of
        text lines and edges. If vertical orientation significantly dominates horizontal
        lines, rotates the image 90 degrees counter-clockwise to restore horizontal alignment.
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        edges = cv2.Canny(gray, 50, 150)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 60, minLineLength=50, maxLineGap=10)
        if lines is None:
            return img, 0

        h_count, v_count = 0, 0
        for l in lines:
            pts = l.flatten()
            deg = abs(np.degrees(np.arctan2(float(pts[3] - pts[1]), float(pts[2] - pts[0]))))
            if deg <= 20 or deg >= 160:
                h_count += 1
            elif 70 <= deg <= 110:
                v_count += 1

        if v_count > max(10, h_count * 2):
            rotated = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
            return rotated, 90

        return img, 0

    def normalize_illumination(self, gray: np.ndarray) -> Tuple[np.ndarray, bool]:
        """
        Removes non-uniform lighting and shadows (common in smartphone camera photos of receipts).
        Uses morphological background estimation via a large structuring element,
        dividing the grayscale image by the estimated background to flatten illumination gradients.
        Only applies when luminance gradient across quadrants indicates uneven illumination.
        """
        h, w = gray.shape[:2]
        if min(h, w) < 200:
            return gray, False

        q1 = np.mean(gray[: h // 2, : w // 2])
        q2 = np.mean(gray[: h // 2, w // 2 :])
        q3 = np.mean(gray[h // 2 :, : w // 2])
        q4 = np.mean(gray[h // 2 :, w // 2 :])
        quad_spread = max(q1, q2, q3, q4) - min(q1, q2, q3, q4)

        if quad_spread > 25.0:
            kernel_size = max(25, int(min(h, w) * 0.05))
            if kernel_size % 2 == 0:
                kernel_size += 1
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
            bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
            bg = np.maximum(bg, 1)
            normalized = cv2.divide(gray, bg, scale=255.0)
            return normalized.astype(np.uint8), True

        return gray, False

    def remove_table_grid_lines(self, gray: np.ndarray) -> Tuple[np.ndarray, bool]:
        """
        Detects and removes black/dark table borders and grid lines from invoice tables.
        Prevents Tesseract from fusing characters with table cells or mistaking borders for glyphs.
        Preserves decimal points, small punctuation, and characters by strictly targeting
        long contiguous line segments (>= 35px in length).
        """
        h, w = gray.shape[:2]
        if min(h, w) < 100:
            return gray, False

        _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        min_line_len = max(35, int(min(h, w) * 0.03))

        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (min_line_len, 1))
        h_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, h_kernel)

        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_line_len))
        v_lines = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, v_kernel)

        grid = cv2.add(h_lines, v_lines)
        if cv2.countNonZero(grid) > 0:
            grid_dilated = cv2.dilate(grid, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
            cleaned = gray.copy()
            cleaned[grid_dilated > 0] = 255
            return cleaned, True

        return gray, False

    def _deskew_cv2(self, img: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        Calculates text skew angle using Hough line transform with minAreaRect fallback.
        Rotates image around its center if |angle| in [0.5, 45.0] degrees.
        """
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

        detected_angle = 0.0
        hough_detected = False

        # Method 1: Hough Lines detection (most accurate for table grids and printed text)
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=80, minLineLength=80, maxLineGap=10)

        if lines is not None and len(lines) >= 5:
            angles: List[float] = []
            for l in lines:
                pts = l.flatten()
                x1, y1, x2, y2 = pts[0], pts[1], pts[2], pts[3]
                rad = np.arctan2(float(y2 - y1), float(x2 - x1))
                deg = float(np.degrees(rad))
                if -45.0 <= deg <= 45.0:
                    angles.append(deg)
            if len(angles) >= 5:
                detected_angle = float(np.median(angles))
                hough_detected = True

        # Method 2: Fallback minAreaRect only if Hough lines could not find sufficient lines
        if not hough_detected:
            thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
            coords = np.column_stack(np.where(thresh > 0))
            if len(coords) > 100:
                rect = cv2.minAreaRect(coords)
                alt_angle = rect[-1]
                if alt_angle < -45.0:
                    alt_angle = -(90.0 + alt_angle)
                else:
                    alt_angle = -alt_angle
                if 0.5 <= abs(alt_angle) <= 45.0:
                    detected_angle = float(alt_angle)

        # Apply rotation only if tilt is significant
        if 0.5 <= abs(detected_angle) <= 45.0:
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, detected_angle, 1.0)
            rotated = cv2.warpAffine(
                img,
                M,
                (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(255, 255, 255),
            )
            return rotated, detected_angle

        return img, 0.0

    def _rescale_for_ocr(self, img: np.ndarray) -> Tuple[np.ndarray, bool]:
        """Rescales the image to ensure resolution is suitable for character recognition."""
        h, w = img.shape[:2]
        max_dim = max(w, h)

        if 300 <= max_dim < 1600:
            scale = min(3.0, 2400.0 / max_dim)
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            rescaled = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            return rescaled, True
        elif max_dim > 3600:
            scale = 3000.0 / max_dim
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            rescaled = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            return rescaled, True

        return img, False

    def _get_debug_dir(self) -> Optional[Path]:
        env_dir = os.environ.get("OCR_DEBUG_DIR")
        target = env_dir or (self.config.debug_dir if hasattr(self.config, "debug_dir") else None)
        if target:
            p = Path(target)
            p.mkdir(parents=True, exist_ok=True)
            return p
        return None


# BaseImageProcessor aliases to AdaptiveImageProcessor for complete backward compatibility
BaseImageProcessor = AdaptiveImageProcessor
