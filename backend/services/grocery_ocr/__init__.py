"""
ShopPulse Grocery OCR Engine — Phase 2 Architecture Foundation.
A modular, testable, and scalable invoice extraction engine.
"""

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import (
    ClassificationError,
    ColumnDetectionError,
    ExcelGenerationError,
    ExcelParsingError,
    ExtractionError,
    FileValidationError,
    GroceryOCRError,
    ImageProcessingError,
    InvalidInvoiceError,
    InvoiceValidationError,
    OCRProcessingError,
    PDFProcessingError,
    PipelineOrchestrationError,
    ProductMatchingError,
    TableReconstructionError,
    UnsupportedFileError,
)
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
from services.grocery_ocr.schemas import (
    BoundingBox,
    ClassificationStatusType,
    ColumnRoleType,
    DetectedColumn,
    ExtractedInvoice,
    ExtractedInvoiceItem,
    InvoiceProcessingMetadata,
    InvoiceStatusType,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
    PackageSize,
    TableCell,
    TableRow,
    TableResult,
    ValidationStatusType,
)

__all__ = [
    # Config & Pipeline
    "GroceryOCRConfig",
    "default_config",
    "InvoicePipeline",
    # Schemas
    "BoundingBox",
    "OCRWord",
    "OCRLine",
    "OCRPageResult",
    "OCRDocumentResult",
    "ColumnRoleType",
    "DetectedColumn",
    "TableCell",
    "TableRow",
    "TableResult",
    "PackageSize",
    "ExtractedInvoiceItem",
    "ValidationStatusType",
    "ClassificationStatusType",
    "InvoiceStatusType",
    "InvoiceProcessingMetadata",
    "ExtractedInvoice",
    # Exceptions
    "GroceryOCRError",
    "UnsupportedFileError",
    "InvalidInvoiceError",
    "FileValidationError",
    "PDFProcessingError",
    "ImageProcessingError",
    "OCRProcessingError",
    "TableReconstructionError",
    "ColumnDetectionError",
    "ExtractionError",
    "ClassificationError",
    "ProductMatchingError",
    "ExcelGenerationError",
    "ExcelParsingError",
    "InvoiceValidationError",
    "PipelineOrchestrationError",
]
