"""
Pydantic schemas representing OCR word, coordinate, line, and page results.
Preserves bounding boxes, confidence scores, and raw token evidence across the pipeline.
"""

from typing import Any, Dict, List, Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field, model_validator


class BoundingBox(BaseModel):
    """Spatial bounding box coordinates for a word, cell, or line in pixel space."""
    x0: float = Field(..., description="Left coordinate (x_min)")
    y0: float = Field(..., description="Top coordinate (y_min)")
    x1: float = Field(..., description="Right coordinate (x_max)")
    y1: float = Field(..., description="Bottom coordinate (y_max)")

    model_config = ConfigDict(frozen=True)

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Map x_min, y_min, x_max, y_max to x0, y0, x1, y1
            if "x_min" in data and "x0" not in data:
                data["x0"] = data["x_min"]
            if "y_min" in data and "y0" not in data:
                data["y0"] = data["y_min"]
            if "x_max" in data and "x1" not in data:
                data["x1"] = data["x_max"]
            if "y_max" in data and "y1" not in data:
                data["y1"] = data["y_max"]
        return data

    @property
    def x_min(self) -> float:
        return self.x0

    @property
    def y_min(self) -> float:
        return self.y0

    @property
    def x_max(self) -> float:
        return self.x1

    @property
    def y_max(self) -> float:
        return self.y1

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def height(self) -> float:
        return max(0.0, self.y1 - self.y0)

    @property
    def center_x(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2.0

    @property
    def area(self) -> float:
        return self.width * self.height

    def overlaps_horizontally(self, other: "BoundingBox", tolerance: float = 0.0) -> bool:
        """Checks if two bounding boxes overlap in horizontal space."""
        return not (self.x1 + tolerance < other.x0 or other.x1 + tolerance < self.x0)

    def overlaps_vertically(self, other: "BoundingBox", tolerance: float = 0.0) -> bool:
        """Checks if two bounding boxes overlap in vertical space."""
        return not (self.y1 + tolerance < other.y0 or other.y1 + tolerance < self.y0)

    def to_dict(self, alias_format: str = "x0y0x1y1") -> Dict[str, float]:
        if alias_format == "minmax":
            return {"x_min": self.x0, "y_min": self.y0, "x_max": self.x1, "y_max": self.y1}
        return {"x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1}


class OCRWord(BaseModel):
    """Individual OCR token with its spatial coordinate, reading order, and confidence score."""
    text: str = Field(..., description="Raw text token read by OCR engine")
    bbox: BoundingBox = Field(..., description="Spatial bounding box")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="OCR confidence (0-100)")
    word_index: int = Field(default=0, ge=0, description="0-indexed position within the line or page")
    reading_order: int = Field(default=0, ge=0, description="Sequential reading order across the page")
    line_number: Optional[int] = Field(default=None, description="0-indexed line number on the page")
    page_number: int = Field(default=1, ge=1, description="1-indexed source page number")

    model_config = ConfigDict(frozen=True)

    @model_validator(mode="before")
    @classmethod
    def handle_word_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Accept bounding_box as alias for bbox
            if "bounding_box" in data and "bbox" not in data:
                data["bbox"] = data["bounding_box"]
            # Accept reading_order for word_index or vice versa
            if "reading_order" in data and "word_index" not in data:
                data["word_index"] = data["reading_order"]
            elif "word_index" in data and "reading_order" not in data:
                data["reading_order"] = data["word_index"]
            # Normalize confidence if passed in 0.0 - 1.0 range
            conf = data.get("confidence")
            if conf is not None and isinstance(conf, (int, float)) and 0.0 <= conf <= 1.0:
                data["confidence"] = conf * 100.0
        return data

    @property
    def bounding_box(self) -> BoundingBox:
        return self.bbox

    @property
    def confidence_normalized(self) -> float:
        """Returns confidence in standard [0.0, 1.0] range."""
        return self.confidence / 100.0 if self.confidence > 1.0 else self.confidence

    def to_dict(self) -> Dict[str, Any]:
        """Returns structured dictionary conforming to Phase 2 word-level schema."""
        return {
            "text": self.text,
            "confidence": round(self.confidence_normalized, 4),
            "bounding_box": {
                "x_min": self.bbox.x0,
                "y_min": self.bbox.y0,
                "x_max": self.bbox.x1,
                "y_max": self.bbox.y1,
            },
            "page_number": self.page_number,
            "line_number": self.line_number if self.line_number is not None else 0,
            "reading_order": self.reading_order,
        }


class OCRLine(BaseModel):
    """Coherent line of text constructed from spatially grouped OCR words."""
    line_number: int = Field(..., ge=0, description="0-indexed line position")
    text: str = Field(..., description="Combined text of the line")
    words: List[OCRWord] = Field(default_factory=list, description="Constituent words in spatial order")
    bbox: BoundingBox = Field(..., description="Enclosing bounding box of the line")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Mean confidence of words")

    model_config = ConfigDict(frozen=True)


class OCRPageResult(BaseModel):
    """Complete OCR extraction result for a single invoice page."""
    page_number: int = Field(default=1, ge=1, description="1-indexed page number")
    width: int = Field(..., ge=1, description="Page width in pixels")
    height: int = Field(..., ge=1, description="Page height in pixels")
    raw_text: str = Field(default="", description="Full unsegmented text of the page")
    words: List[OCRWord] = Field(default_factory=list, description="All extracted words on the page")
    lines: List[OCRLine] = Field(default_factory=list, description="Grouped text lines on the page")
    confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Average OCR confidence")
    processing_status: str = Field(default="SUCCESS", description="Page OCR status: SUCCESS, PARTIAL, FAILED")
    warnings: List[str] = Field(default_factory=list, description="Any page-level processing warnings")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Engine specific metadata, PSM, DPI")

    @property
    def page_width(self) -> int:
        return self.width

    @property
    def page_height(self) -> int:
        return self.height

    @property
    def extracted_text(self) -> str:
        return self.raw_text


class OCRDocumentResult(BaseModel):
    """Complete OCR evidence for a multi-page or single-page invoice document."""
    document_id: str = Field(
        default_factory=lambda: f"doc_{uuid.uuid4().hex[:12]}",
        description="Unique document identifier"
    )
    filename: str = Field(default="", description="Original file name")
    total_pages: int = Field(default=1, ge=1, description="Total pages processed")
    pages: List[OCRPageResult] = Field(default_factory=list, description="Extracted pages in sequence")
    full_text: str = Field(default="", description="Concatenated raw text across all pages")
    processing_time_ms: float = Field(default=0.0, ge=0.0, description="Total OCR processing duration in ms")
    engine_name: str = Field(default="tesseract_ocr", description="Identifier of the OCR engine used")
    engine_version: str = Field(default="4.0.0", description="Version of the OCR engine / model used")
    preprocessing_metadata: Dict[str, Any] = Field(default_factory=dict, description="Image preprocessing parameters")
    processing_warnings: List[str] = Field(default_factory=list, description="Document-level warnings")
    average_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Overall document confidence")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Document processing parameters")

    @property
    def processing_time(self) -> float:
        """Processing duration in seconds."""
        return self.processing_time_ms / 1000.0


# Canonical alias for Phase 3 requirements
InvoiceOCRResult = OCRDocumentResult
