"""
Pydantic schemas for the complete invoice extraction result and processing metadata.
Preserves raw OCR evidence, tables, confidence metrics, and financial totals in Decimal.
"""

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem
from services.grocery_ocr.schemas.ocr import OCRDocumentResult
from services.grocery_ocr.schemas.table import TableResult

InvoiceStatusType = Literal["PENDING", "PROCESSING", "SUCCESS", "NEEDS_REVIEW", "FAILED"]


class InvoiceProcessingMetadata(BaseModel):
    """Execution telemetry, timing metrics, and full OCR evidence for an invoice."""
    filename: str = Field(..., description="Original filename uploaded by user")
    file_size_bytes: int = Field(default=0, ge=0, description="Size of the uploaded file in bytes")
    mime_type: str = Field(default="application/octet-stream", description="Detected MIME type")
    document_type: str = Field(default="image", description="Document category: pdf, image, or text")
    page_count: int = Field(default=1, ge=1, description="Number of pages processed")
    engine_name: str = Field(default="grocery_ocr_engine", description="Primary OCR engine used")
    pipeline_stages_completed: List[str] = Field(
        default_factory=list,
        description="Stages successfully executed by the pipeline"
    )
    stage_timings_ms: Dict[str, float] = Field(
        default_factory=dict,
        description="Execution time per stage in milliseconds"
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Non-fatal warnings recorded during extraction"
    )
    ocr_evidence: Optional[OCRDocumentResult] = Field(
        None,
        description="Full, untruncated OCR evidence with word coordinates"
    )
    tables_detected: List[TableResult] = Field(
        default_factory=list,
        description="All tables reconstructed from the document"
    )
    custom_properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional processing attributes"
    )


class ExtractedInvoice(BaseModel):
    """
    Complete structured representation of an extracted grocery invoice.
    Contains supplier details, line items with Decimal precision, metadata, and validation summary.
    """

    invoice_id: str = Field(..., description="Unique deterministic identifier for this extraction")
    original_filename: str = Field(..., description="Original filename of the invoice document")
    status: InvoiceStatusType = Field(default="PENDING", description="Current pipeline processing status")

    # Supplier & Metadata
    supplier_name: Optional[str] = Field(None, description="Name of the vendor/supplier")
    supplier_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Confidence of supplier extraction")
    invoice_number: Optional[str] = Field(None, description="Invoice / bill / voucher number")
    invoice_no_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Confidence of invoice number")
    invoice_date: Optional[str] = Field(None, description="Printed invoice date (ISO or verbatim format)")
    date_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Confidence of date extraction")
    gstin: Optional[str] = Field(None, description="Supplier GSTIN printed on the bill")

    # Financial Totals (Nullable Decimal)
    printed_total: Optional[Decimal] = Field(
        None,
        description="Grand total amount printed on the invoice; None when absent"
    )
    calculated_total: Optional[Decimal] = Field(
        None,
        description="Sum of all verified item line totals"
    )
    total_units: Optional[Decimal] = Field(
        None,
        description="Sum of all extracted item quantities"
    )
    total_items_count: int = Field(default=0, ge=0, description="Total number of extracted line items")

    # Extracted Items
    items: List[ExtractedInvoiceItem] = Field(
        default_factory=list,
        description="List of all extracted line items"
    )

    # Diagnostic & Audit Metadata
    metadata: InvoiceProcessingMetadata = Field(..., description="Pipeline execution metadata and OCR evidence")
    excel_download_url: Optional[str] = Field(None, description="Link or path to generated audit workbook")
    reason: Optional[str] = Field(None, description="High-level reason if invoice requires review or failed")

    model_config = ConfigDict(from_attributes=True)

    @property
    def has_unresolved_mismatches(self) -> bool:
        """Returns True if any item has an arithmetic mismatch or requires manual review."""
        return any(
            item.validation_status in ("MISMATCH", "NEEDS_REVIEW")
            for item in self.items
        )
