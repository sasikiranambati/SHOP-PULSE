"""
Pydantic data schemas for the ShopPulse Grocery OCR Engine.
Exports OCR token models, table grids, invoice line items, and invoice aggregates.
"""

from services.grocery_ocr.schemas.invoice import (
    ExtractedInvoice,
    InvoiceProcessingMetadata,
    InvoiceStatusType,
)
from services.grocery_ocr.schemas.invoice_item import (
    ClassificationStatusType,
    ExtractedInvoiceItem,
    PackageSize,
    ProductMatchResult,
    ValidationStatusType,
)
from services.grocery_ocr.schemas.ocr import (
    BoundingBox,
    InvoiceOCRResult,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
)
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableRow,
    TableResult,
    TableReconstructionResult,
)

__all__ = [
    # OCR
    "BoundingBox",
    "OCRWord",
    "OCRLine",
    "OCRPageResult",
    "OCRDocumentResult",
    "InvoiceOCRResult",
    # Table
    "ColumnRoleType",
    "DetectedColumn",
    "TableCell",
    "TableRow",
    "TableResult",
    "TableReconstructionResult",
    # Invoice Item
    "PackageSize",
    "ProductMatchResult",
    "ValidationStatusType",
    "ClassificationStatusType",
    "ExtractedInvoiceItem",
    # Invoice
    "InvoiceStatusType",
    "InvoiceProcessingMetadata",
    "ExtractedInvoice",
]
