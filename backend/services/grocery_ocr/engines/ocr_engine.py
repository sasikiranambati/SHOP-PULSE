"""
OCR engine interface and implementations.
Provides pluggable character recognition with word coordinate extraction and confidence telemetry.
Lazy loads engine drivers to avoid heavy memory allocation on app startup.
Supports Node/Tesseract.js with bundled offline language data, digital PDF extraction, and mock testing.
"""

from abc import ABC, abstractmethod
import io
from pathlib import Path
import shutil
import time
from typing import Any, Dict, List, Optional
from PIL import Image

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import OCRProcessingError
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import (
    BoundingBox,
    OCRLine,
    OCRPageResult,
    OCRWord,
)

logger = get_logger("engines.ocr_engine")


class IOCREngine(ABC):
    """Abstract interface for Optical Character Recognition engines."""

    @abstractmethod
    def recognize(
        self,
        image_bytes: bytes,
        page_number: int = 1,
        options: Optional[Dict[str, Any]] = None,
    ) -> OCRPageResult:
        """
        Executes OCR recognition on preprocessed image bytes.

        Args:
            image_bytes: Lossless PNG image bytes.
            page_number: 1-indexed document page number.
            options: Optional runtime options (PSM, language whitelist).

        Returns:
            OCRPageResult containing word tokens, coordinates, and confidence.

        Raises:
            OCRProcessingError: When the OCR subprocess fails, crashes, or times out.
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Checks if the underlying OCR binary, worker, or model is installed and accessible."""
        pass

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """Unique identifier of the OCR engine."""
        pass

    @property
    def engine_version(self) -> str:
        """Version of the underlying OCR engine."""
        return "4.0.0"


class MockOCREngine(IOCREngine):
    """
    Test and development OCR engine.
    Returns deterministic synthetic OCR words and bounding boxes for fast, dependency-free testing.
    """

    def __init__(self, predefined_result: Optional[OCRPageResult] = None):
        self.predefined_result = predefined_result

    @property
    def engine_name(self) -> str:
        return "mock_ocr_engine"

    @property
    def engine_version(self) -> str:
        return "mock_1.0"

    def is_available(self) -> bool:
        return True

    def recognize(
        self,
        image_bytes: bytes,
        page_number: int = 1,
        options: Optional[Dict[str, Any]] = None,
    ) -> OCRPageResult:
        logger.debug("MockOCREngine executing on page %d (bytes=%d)", page_number, len(image_bytes))
        if self.predefined_result is not None:
            return self.predefined_result

        # Default synthetic page result with realistic grocery table layout
        w1 = OCRWord(text="Item", bbox=BoundingBox(x0=50, y0=50, x1=120, y1=80), confidence=98.0, word_index=0, reading_order=0, page_number=page_number)
        w2 = OCRWord(text="Description", bbox=BoundingBox(x0=130, y0=50, x1=250, y1=80), confidence=98.0, word_index=1, reading_order=1, page_number=page_number)
        w3 = OCRWord(text="Qty", bbox=BoundingBox(x0=300, y0=50, x1=360, y1=80), confidence=98.0, word_index=2, reading_order=2, page_number=page_number)
        w4 = OCRWord(text="Rate", bbox=BoundingBox(x0=400, y0=50, x1=460, y1=80), confidence=98.0, word_index=3, reading_order=3, page_number=page_number)
        w5 = OCRWord(text="Amount", bbox=BoundingBox(x0=500, y0=50, x1=580, y1=80), confidence=98.0, word_index=4, reading_order=4, page_number=page_number)

        header_line = OCRLine(
            line_number=0,
            text="Item Description Qty Rate Amount",
            words=[w1, w2, w3, w4, w5],
            bbox=BoundingBox(x0=50, y0=50, x1=580, y1=80),
            confidence=98.0
        )

        d1 = OCRWord(text="Tata", bbox=BoundingBox(x0=50, y0=100, x1=100, y1=130), confidence=95.0, word_index=5, reading_order=5, page_number=page_number)
        d2 = OCRWord(text="Salt", bbox=BoundingBox(x0=110, y0=100, x1=160, y1=130), confidence=95.0, word_index=6, reading_order=6, page_number=page_number)
        d3 = OCRWord(text="1kg", bbox=BoundingBox(x0=170, y0=100, x1=210, y1=130), confidence=95.0, word_index=7, reading_order=7, page_number=page_number)
        d4 = OCRWord(text="10", bbox=BoundingBox(x0=300, y0=100, x1=340, y1=130), confidence=95.0, word_index=8, reading_order=8, page_number=page_number)
        d5 = OCRWord(text="24.00", bbox=BoundingBox(x0=400, y0=100, x1=455, y1=130), confidence=95.0, word_index=9, reading_order=9, page_number=page_number)
        d6 = OCRWord(text="240.00", bbox=BoundingBox(x0=500, y0=100, x1=570, y1=130), confidence=95.0, word_index=10, reading_order=10, page_number=page_number)

        data_line = OCRLine(
            line_number=1,
            text="Tata Salt 1kg 10 24.00 240.00",
            words=[d1, d2, d3, d4, d5, d6],
            bbox=BoundingBox(x0=50, y0=100, x1=570, y1=130),
            confidence=95.0
        )

        all_words = [w1, w2, w3, w4, w5, d1, d2, d3, d4, d5, d6]

        return OCRPageResult(
            page_number=page_number,
            width=800,
            height=1000,
            raw_text="Item Description Qty Rate Amount\nTata Salt 1kg 10 24.00 240.00",
            words=all_words,
            lines=[header_line, data_line],
            confidence=96.5,
            metadata={"engine": "mock", "synthetic": True}
        )


class TesseractOCREngine(IOCREngine):
    """
    Production Tesseract OCR engine adapter.
    Integrates with the Node.js tesseract.js worker using bundled offline language data.
    Extracts word tokens with spatial pixel bounding boxes, reading order, and confidence scores.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    @property
    def engine_name(self) -> str:
        return "tesseract_ocr"

    @property
    def engine_version(self) -> str:
        return "4.0.0_best_int"

    def is_available(self) -> bool:
        """Verifies Node.js runtime and OCR worker script availability."""
        node_bin = shutil.which("node")
        if not node_bin:
            return False
        worker_file = Path(__file__).resolve().parent.parent.parent / "ocr_worker.mjs"
        return worker_file.exists()

    def recognize(
        self,
        image_bytes: bytes,
        page_number: int = 1,
        options: Optional[Dict[str, Any]] = None,
    ) -> OCRPageResult:
        logger.debug("TesseractOCREngine recognizing page %d (bytes=%d)", page_number, len(image_bytes))
        opts = options or {}
        psm = opts.get("psm", self.config.default_ocr_psm)

        # Determine image dimensions
        img_w, img_h = 1000, 1000
        try:
            with Image.open(io.BytesIO(image_bytes)) as pil_img:
                img_w, img_h = pil_img.size
        except Exception as e:
            logger.debug("Could not read image dimensions from bytes: %s", e)

        start_time = time.time()
        try:
            from services.ocr import run_ocr_on_preprocessed_png
            ocr_dict = run_ocr_on_preprocessed_png(image_bytes, psm_mode=str(psm))

            raw_words = ocr_dict.get("words", [])
            words: List[OCRWord] = []

            for idx, w in enumerate(raw_words):
                text = str(w.get("text", "")).strip()
                if not text:
                    continue

                # Handle both flat and nested bbox structures
                raw_box = w.get("bbox") or {}
                if isinstance(raw_box, dict):
                    x0 = float(raw_box.get("x0", w.get("x0", 0.0)))
                    y0 = float(raw_box.get("y0", w.get("y0", 0.0)))
                    x1 = float(raw_box.get("x1", w.get("x1", 0.0)))
                    y1 = float(raw_box.get("y1", w.get("y1", 0.0)))
                else:
                    x0 = float(w.get("x0", 0.0))
                    y0 = float(w.get("y0", 0.0))
                    x1 = float(w.get("x1", 0.0))
                    y1 = float(w.get("y1", 0.0))

                conf = float(w.get("confidence", w.get("conf", 100.0)) or 100.0)

                words.append(
                    OCRWord(
                        text=text,
                        bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                        confidence=conf,
                        word_index=idx,
                        reading_order=idx,
                        page_number=page_number,
                    )
                )

            # Unpack or construct coherent text lines
            raw_lines = ocr_dict.get("lines", [])
            lines: List[OCRLine] = []

            for line_idx, rl in enumerate(raw_lines):
                line_text = str(rl.get("text", "")).strip()
                if not line_text:
                    continue
                line_box = rl.get("bbox") or {}
                lx0 = float(line_box.get("x0", 0.0))
                ly0 = float(line_box.get("y0", 0.0))
                lx1 = float(line_box.get("x1", 0.0))
                ly1 = float(line_box.get("y1", 0.0))
                line_conf = float(rl.get("confidence", 100.0) or 100.0)

                # Line constituent words
                line_words = [
                    w for w in words
                    if w.bbox.y0 >= (ly0 - 5.0) and w.bbox.y1 <= (ly1 + 5.0)
                ]
                line_words.sort(key=lambda w: w.bbox.x0)

                lines.append(
                    OCRLine(
                        line_number=line_idx,
                        text=line_text,
                        words=line_words,
                        bbox=BoundingBox(x0=lx0, y0=ly0, x1=lx1, y1=ly1),
                        confidence=line_conf,
                    )
                )

            raw_text = ocr_dict.get("text", "")
            avg_conf = float(ocr_dict.get("confidence", 0.0))
            if not avg_conf and words:
                avg_conf = sum(w.confidence for w in words) / len(words)

            duration_ms = (time.time() - start_time) * 1000.0

            return OCRPageResult(
                page_number=page_number,
                width=img_w,
                height=img_h,
                raw_text=raw_text,
                words=words,
                lines=lines,
                confidence=round(avg_conf, 2),
                processing_status="SUCCESS" if words else "EMPTY",
                metadata={
                    "psm": psm,
                    "engine": "tesseract.js",
                    "language_data": ocr_dict.get("language_data"),
                    "duration_ms": round(duration_ms, 2),
                    "total_words_extracted": len(words),
                }
            )
        except Exception as exc:
            logger.error("Tesseract execution failed: %s", exc)
            raise OCRProcessingError(f"Tesseract OCR engine failed: {exc}", details={"error": str(exc)})


class DigitalPDFEngine(IOCREngine):
    """
    Direct digital PDF vector text extractor.
    Operates at near-zero latency with 100% precision for native digital invoices.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    @property
    def engine_name(self) -> str:
        return "digital_pdf_engine"

    @property
    def engine_version(self) -> str:
        return "pdfplumber_0.11"

    def is_available(self) -> bool:
        try:
            import pdfplumber
            return True
        except ImportError:
            return False

    def recognize(
        self,
        image_bytes: bytes,
        page_number: int = 1,
        options: Optional[Dict[str, Any]] = None,
    ) -> OCRPageResult:
        # Digital PDFs are processed directly via BasePDFProcessor.extract_digital_text
        raise NotImplementedError("DigitalPDFEngine expects PDF document bytes via PDFProcessor.")


class HybridOCREngine(IOCREngine):
    """
    Hybrid OCR Engine that delegates between digital text stream extraction
    and Tesseract image OCR based on document characteristics.
    """

    def __init__(
        self,
        tesseract_engine: Optional[IOCREngine] = None,
        config: Optional[GroceryOCRConfig] = None,
    ):
        self.config = config or default_config
        self.tesseract_engine = tesseract_engine or TesseractOCREngine(self.config)

    @property
    def engine_name(self) -> str:
        return "hybrid_ocr_engine"

    @property
    def engine_version(self) -> str:
        return f"hybrid({self.tesseract_engine.engine_name})"

    def is_available(self) -> bool:
        return self.tesseract_engine.is_available()

    def recognize(
        self,
        image_bytes: bytes,
        page_number: int = 1,
        options: Optional[Dict[str, Any]] = None,
    ) -> OCRPageResult:
        return self.tesseract_engine.recognize(image_bytes, page_number=page_number, options=options)


# Alias for explicit clarity
NodeTesseractOCREngine = TesseractOCREngine
