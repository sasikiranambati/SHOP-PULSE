"""
PDF processing interface and base implementation.
Extracts digital text streams or rasterizes vector/scanned PDF pages for OCR recognition.
Preserves page ordering and extracts word-level bounding boxes for digital documents.
"""

from abc import ABC, abstractmethod
import io
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import PDFProcessingError
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import (
    BoundingBox,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
)

logger = get_logger("processors.pdf_processor")


class PDFProcessResult(BaseModel):
    """Result of processing a PDF invoice document."""
    page_count: int = Field(default=1, ge=1, description="Total number of pages in the PDF")
    is_digital: bool = Field(default=False, description="True if text could be extracted digitally without OCR")
    pages_rasterized: List[bytes] = Field(
        default_factory=list,
        description="High-resolution PNG renders for each page (empty when purely digital)"
    )
    digital_document: Optional[OCRDocumentResult] = Field(
        None,
        description="Structured digital OCR document with word coordinates if digital"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict, description="PDF metadata, producer, page dimensions")


class IPDFProcessor(ABC):
    """Abstract interface for PDF document processing and page rasterization."""

    @abstractmethod
    def process(self, content: bytes) -> PDFProcessResult:
        """
        Processes a PDF invoice, extracting text streams if digital or rasterizing pages if scanned.

        Args:
            content: Raw PDF bytes.

        Returns:
            PDFProcessResult containing page count and rasterized images or digital text.

        Raises:
            PDFProcessingError: If the PDF is encrypted, corrupted, or cannot be parsed.
        """
        pass

    @abstractmethod
    def rasterize_pages(self, content: bytes, dpi: int = 300) -> List[bytes]:
        """
        Renders PDF pages into lossless PNG byte streams at the given DPI.
        """
        pass

    @abstractmethod
    def extract_digital_text(self, content: bytes) -> Optional[OCRDocumentResult]:
        """
        Attempts to extract digital words and bounding coordinates directly from PDF text objects.
        Returns None if the document is scanned or contains fewer than 10 words.
        """
        pass


class BasePDFProcessor(IPDFProcessor):
    """
    Production implementation of PDF processing.
    Evaluates digital text streams first, falling back to 300 DPI page rasterization.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def process(self, content: bytes) -> PDFProcessResult:
        logger.debug("Processing PDF document (bytes=%d)", len(content))
        try:
            # Step 1: Evaluate direct digital text stream extraction
            digital_doc = self.extract_digital_text(content)
            if digital_doc and len(digital_doc.pages) > 0 and sum(len(p.words) for p in digital_doc.pages) >= 10:
                total_words = sum(len(p.words) for p in digital_doc.pages)
                logger.info("PDF has digital text layer (%d words across %d pages)",
                            total_words, digital_doc.total_pages)
                return PDFProcessResult(
                    page_count=digital_doc.total_pages,
                    is_digital=True,
                    pages_rasterized=[],
                    digital_document=digital_doc,
                    metadata={"extractor": "digital_pdf", "total_digital_words": total_words}
                )

            # Step 2: Rasterize scanned or non-searchable PDF for OCR
            logger.info("PDF is scanned or lacks searchable text; rasterizing pages at %d DPI", self.config.default_dpi)
            rasterized = self.rasterize_pages(content, dpi=self.config.default_dpi)
            if not rasterized:
                raise PDFProcessingError("Failed to rasterize any pages from the PDF document.")

            return PDFProcessResult(
                page_count=len(rasterized),
                is_digital=False,
                pages_rasterized=rasterized,
                digital_document=None,
                metadata={"extractor": "rasterized_pdf", "page_count": len(rasterized), "dpi": self.config.default_dpi}
            )
        except Exception as exc:
            logger.error("PDF processing failed: %s", exc)
            raise PDFProcessingError(f"Failed to parse PDF document: {exc}", details={"error": str(exc)})

    def rasterize_pages(self, content: bytes, dpi: int = 300) -> List[bytes]:
        """
        Rasterizes PDF pages to high-resolution PNG bytes using pypdfium2 with pdfplumber fallback.
        Preserves strict page sequence (1, 2, ... N).
        """
        pages_bytes: List[bytes] = []

        # Primary engine: pypdfium2 (fast native rasterization)
        try:
            import pypdfium2 as pdfium
            doc = pdfium.PdfDocument(content)
            scale = dpi / 72.0
            for page in doc:
                bmp = page.render(scale=scale)
                pil_img = bmp.to_pil()
                buf = io.BytesIO()
                pil_img.save(buf, format="PNG")
                pages_bytes.append(buf.getvalue())
            if pages_bytes:
                logger.debug("pypdfium2 rasterized %d pages at %d DPI", len(pages_bytes), dpi)
                return pages_bytes
        except Exception as p_exc:
            logger.warning("pypdfium2 rasterization encountered error: %s; falling back to pdfplumber", p_exc)

        # Fallback engine: pdfplumber
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    img = page.to_image(resolution=dpi)
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    pages_bytes.append(buf.getvalue())
            return pages_bytes
        except Exception as pl_exc:
            logger.error("pdfplumber rasterization also failed: %s", pl_exc)
            return pages_bytes

    def extract_digital_text(self, content: bytes) -> Optional[OCRDocumentResult]:
        """
        Extracts words, lines, and bounding boxes directly from digital PDF text streams.
        Returns None if document contains fewer than 10 words (i.e. scanned invoice).
        """
        try:
            import pdfplumber
            pages_result: List[OCRPageResult] = []
            full_text_parts: List[str] = []

            with pdfplumber.open(io.BytesIO(content)) as pdf:
                total_pages = len(pdf.pages)
                for page_idx, page in enumerate(pdf.pages, start=1):
                    raw_page_words = page.extract_words(
                        keep_blank_chars=False,
                        x_tolerance=3,
                        y_tolerance=3,
                    )
                    page_text = page.extract_text() or ""
                    full_text_parts.append(page_text)

                    ocr_words: List[OCRWord] = []
                    for w_idx, w in enumerate(raw_page_words):
                        # Extract exact coordinates (x0, top, x1, bottom)
                        x0 = float(w.get("x0", 0.0))
                        y0 = float(w.get("top", 0.0))
                        x1 = float(w.get("x1", 0.0))
                        y1 = float(w.get("bottom", 0.0))
                        text = str(w.get("text", "")).strip()
                        if not text:
                            continue

                        ocr_words.append(
                            OCRWord(
                                text=text,
                                bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                                confidence=100.0,  # 100% exact fidelity from digital text stream
                                word_index=w_idx,
                                reading_order=w_idx,
                                page_number=page_idx,
                            )
                        )

                    # Group words into lines based on vertical alignment
                    lines = self._group_words_into_lines(ocr_words)

                    pages_result.append(
                        OCRPageResult(
                            page_number=page_idx,
                            width=max(1, int(page.width)),
                            height=max(1, int(page.height)),
                            raw_text=page_text,
                            words=ocr_words,
                            lines=lines,
                            confidence=100.0,
                            processing_status="SUCCESS",
                            metadata={"is_digital": True, "word_count": len(ocr_words)}
                        )
                    )

            total_words = sum(len(p.words) for p in pages_result)
            if total_words < 10:
                logger.debug("Digital extraction found only %d words (< 10 threshold); marking scanned", total_words)
                return None

            return OCRDocumentResult(
                pages=pages_result,
                total_pages=len(pages_result),
                full_text="\n\n".join(full_text_parts),
                average_confidence=100.0,
                engine_name="digital_pdf_extractor",
                engine_version="1.0.0",
                preprocessing_metadata={"is_digital_stream": True},
            )
        except Exception as exc:
            logger.debug("Direct digital text extraction failed or not supported for this PDF: %s", exc)
            return None

    def _group_words_into_lines(self, words: List[OCRWord]) -> List[OCRLine]:
        """Groups words on a page into horizontal text lines based on vertical overlap."""
        if not words:
            return []

        # Sort words primarily top-to-bottom, then left-to-right
        sorted_words = sorted(words, key=lambda w: (w.bbox.y0, w.bbox.x0))
        lines: List[List[OCRWord]] = []

        for w in sorted_words:
            placed = False
            for line_words in lines:
                rep = line_words[0]
                overlap = min(w.bbox.y1, rep.bbox.y1) - max(w.bbox.y0, rep.bbox.y0)
                min_h = min(w.bbox.height, rep.bbox.height)
                if min_h > 0 and (overlap / min_h) >= 0.5:
                    line_words.append(w)
                    placed = True
                    break
            if not placed:
                lines.append([w])

        ocr_lines: List[OCRLine] = []
        for line_idx, line_words in enumerate(lines):
            line_words.sort(key=lambda w: w.bbox.x0)
            line_text = " ".join(w.text for w in line_words).strip()
            x0 = min(w.bbox.x0 for w in line_words)
            y0 = min(w.bbox.y0 for w in line_words)
            x1 = max(w.bbox.x1 for w in line_words)
            y1 = max(w.bbox.y1 for w in line_words)
            ocr_lines.append(
                OCRLine(
                    line_number=line_idx,
                    text=line_text,
                    words=line_words,
                    bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                    confidence=100.0,
                )
            )

        # Sort lines top-to-bottom
        ocr_lines.sort(key=lambda l: l.bbox.y0)
        return ocr_lines
