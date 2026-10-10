from typing import Optional, List, Any, Dict
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class CanonicalInvoiceItemSchema(BaseModel):
    id: str
    product_name: str = Field(..., description="Detected product or item name")
    quantity: Optional[float] = Field(None, description="Purchased quantity (must not be fabricated)")
    unit: Optional[str] = Field(None, description="Packaging unit: kg, g, L, ml, pcs, pkt, box, bag")
    rate: Optional[float] = Field(None, description="Extracted rate from Rate column")
    purchase_price: Optional[float] = Field(None, description="Unit purchase/wholesale rate")
    selling_price: Optional[float] = Field(None, description="Retail selling price if specified")
    mrp: Optional[float] = Field(None, description="Maximum retail price if specified")
    raw_rate: Optional[float] = Field(None, description="Verbatim raw extracted rate")
    raw_purchase_price: Optional[float] = Field(None, description="Verbatim raw extracted purchase price")
    raw_selling_price: Optional[float] = Field(None, description="Verbatim raw extracted selling price")
    raw_mrp: Optional[float] = Field(None, description="Verbatim raw extracted MRP")
    discount: Optional[float] = Field(None, description="Item discount")
    taxable_amount: Optional[float] = Field(None, description="Base assessable amount")
    tax_amount: Optional[float] = Field(None, description="GST / Tax amount")
    gst_rate: Optional[float] = Field(None, description="Tax rate percentage")
    hsn_code: Optional[str] = Field(None, description="HSN / SAC statutory code")
    line_total: Optional[float] = Field(None, description="Total amount for this line")
    amount: Optional[float] = Field(None, description="Total amount for this line (Amount alias)")
    purchasePrice: Optional[float] = Field(None, description="Unit purchase rate (camelCase alias for frontend)")
    confidence: float = Field(85.0, description="Extraction confidence score (0-100)")
    confidence_level: str = Field("HIGH", description="Confidence tier: HIGH | MEDIUM | LOW")
    source_text: str = Field("", description="Original verbatim line text from OCR/PDF")
    extraction_method: str = Field("TABLE_STRUCTURED", description="Extraction method used")
    validation_issues: List[str] = Field(default_factory=list, description="Arithmetic or layout warnings")
    matched_product_id: Optional[UUID] = Field(None, description="ID of matched existing product")
    matched_product_name: Optional[str] = Field(None, description="Name of matched existing product")
    match_score: Optional[float] = Field(None, description="Inventory similarity score (0-1)")

class DiagnosticInfo(BaseModel):
    document_type: str = "image"
    engine_used: str = "backend_tesseract"
    total_raw_lines: int = 0
    total_raw_words: int = 0
    header_detected: bool = False
    detected_columns: List[str] = Field(default_factory=list)
    detected_sections: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

class InvoiceExtractResponse(BaseModel):
    id: str
    supplier_name: Optional[str] = None
    supplier_confidence: float = 0.0
    invoice_number: Optional[str] = None
    invoice_no_confidence: float = 0.0
    invoice_date: Optional[str] = None
    date_confidence: float = 0.0
    total_amount: float = 0.0
    total_units: float = 0.0
    total_items: int = 0
    confidence_score: float = 0.0
    raw_ocr_text: str = ""
    engine_used: str = "backend_engine"
    extraction_method: str = "TABLE_STRUCTURED"
    items: List[CanonicalInvoiceItemSchema] = Field(default_factory=list)
    status: str = Field("success", description="Status: 'success', 'needs_review', or 'error'")
    reason: Optional[str] = None
    diagnostics: Optional[DiagnosticInfo] = None

    model_config = ConfigDict(from_attributes=True)

class InvoiceConfirmItem(BaseModel):
    name: str = Field(..., description="Product name")
    category: Optional[str] = Field("Groceries", description="Product category")
    quantity: float = Field(..., gt=0, description="Quantity to restock (> 0)")
    unit: str = Field("pcs", description="Packaging unit")
    purchase_price: Optional[float] = Field(None, ge=0, description="Unit purchase price (>= 0)")
    selling_price: Optional[float] = Field(None, description="Retail selling price")
    mrp: Optional[float] = Field(None, description="Maximum retail price (MRP)")
    matched_product_id: Optional[UUID] = Field(None, description="Existing product ID if matched")

class InvoiceConfirmRequest(BaseModel):
    supplier_name: Optional[str] = None
    supplier_id: Optional[UUID] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    items: List[InvoiceConfirmItem] = Field(..., min_length=1)

class InvoiceConfirmResponse(BaseModel):
    purchase_id: UUID
    shop_id: UUID
    supplier_name: Optional[str] = None
    total_amount: float
    total_units: float
    items_restocked: int
    items_created: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
