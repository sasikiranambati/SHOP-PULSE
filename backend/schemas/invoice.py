from typing import Optional, List, Any, Dict, Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class MrpLookupSchema(BaseModel):
    status: str = Field(..., description="FOUND | PRODUCT_NOT_FOUND | MRP_UNAVAILABLE | MANUAL_REVIEW_REQUIRED | "
                                         "API_AUTHENTICATION_ERROR | API_RATE_LIMITED | API_TIMEOUT | "
                                         "API_CONFIGURATION_ERROR | API_ERROR | SKIPPED")
    provider: str
    message: str
    mrp: Optional[float] = None
    matched_name: Optional[str] = None
    brand: Optional[str] = None
    barcode: Optional[str] = None
    match_method: Optional[str] = None
    match_confidence: Optional[float] = None
    http_status: Optional[int] = None
    looked_up_at: Optional[str] = None


class CanonicalInvoiceItemSchema(BaseModel):
    id: str
    product_name: str = Field(..., description="Detected product or item name")
    quantity: Optional[float] = Field(None, description="Purchased quantity; null when it could not be read")
    unit: Optional[str] = Field(None, description="Unit from the invoice Unit column; null when not printed")
    rate: Optional[float] = Field(None, description="Value read from the Rate / Unit Price column")
    purchase_price: Optional[float] = Field(None, description="Unit purchase price (Purchase Price column, else Rate column)")
    selling_price: Optional[float] = Field(None, description="Selling price column, only if printed on the invoice")
    mrp: Optional[float] = Field(None, description="Resolved MRP for this line (invoice value, else verified provider value)")
    mrp_source: Optional[str] = Field(None, description="INVOICE | API | null")
    invoice_mrp: Optional[float] = Field(None, description="MRP printed on the invoice")
    store_mrp: Optional[float] = Field(None, description="MRP currently stored for the matched shop product")
    mrp_lookup: Optional[MrpLookupSchema] = Field(None, description="External MRP lookup result")
    raw_rate: Optional[float] = None
    raw_purchase_price: Optional[float] = None
    raw_selling_price: Optional[float] = None
    raw_mrp: Optional[float] = None
    discount: Optional[float] = Field(None, description="Discount amount")
    discount_pct: Optional[float] = Field(None, description="Discount percentage")
    taxable_amount: Optional[float] = Field(None, description="Taxable value")
    tax_amount: Optional[float] = Field(None, description="GST / tax amount")
    gst_rate: Optional[float] = Field(None, description="GST rate percentage")
    hsn_code: Optional[str] = Field(None, description="HSN / SAC code")
    barcode: Optional[str] = Field(None, description="Barcode / GTIN printed on the invoice")
    line_total: Optional[float] = Field(None, description="Line amount")
    amount: Optional[float] = Field(None, description="Alias of line_total")
    line_total_source: Optional[str] = Field(None, description="INVOICE (printed) | CALCULATED (qty × rate) | null")
    arithmetic_status: str = Field("INSUFFICIENT_DATA", description="VERIFIED | MISMATCH | INSUFFICIENT_DATA")
    purchasePrice: Optional[float] = Field(None, description="camelCase alias of purchase_price")
    confidence: float = Field(0.0, description="Extraction confidence (0-100)")
    confidence_level: str = Field("LOW", description="HIGH | MEDIUM | LOW")
    needs_review: bool = Field(True, description="True when any value needs manual confirmation")
    source_text: str = Field("", description="Original OCR/PDF text of the row")
    raw_cells: Dict[str, str] = Field(default_factory=dict, description="Raw text per detected column")
    extraction_method: str = Field("TABLE_STRUCTURED", description="Extraction method used")
    validation_issues: List[str] = Field(default_factory=list, description="Problems that need review")
    suggestions: List[str] = Field(default_factory=list, description="Possible OCR corrections (not applied)")
    suggested_rate: Optional[float] = Field(None, description="Amount ÷ quantity when no rate was printed (not applied)")
    matched_product_id: Optional[UUID] = Field(None, description="ID of matched existing product")
    matched_product_name: Optional[str] = Field(None, description="Name of matched existing product")
    match_score: Optional[float] = Field(None, description="Inventory similarity score (0-1)")


class DetectedColumnSchema(BaseModel):
    role: str
    header_text: str
    x_start: Optional[float] = None
    x_end: Optional[float] = None


class DiagnosticInfo(BaseModel):
    document_type: str = "image"
    engine_used: str = "backend_tesseract"
    total_raw_lines: int = 0
    total_raw_words: int = 0
    header_detected: bool = False
    header_text: Optional[str] = None
    detected_columns: List[str] = Field(default_factory=list)
    columns: List[DetectedColumnSchema] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    detected_sections: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    ocr_psm: Optional[str] = None
    ocr_language_data: Optional[str] = None
    pages_processed: int = 0
    mrp_provider: Optional[str] = None


class InvoiceExtractResponse(BaseModel):
    id: str
    supplier_name: Optional[str] = None
    supplier_confidence: float = 0.0
    invoice_number: Optional[str] = None
    invoice_no_confidence: float = 0.0
    invoice_date: Optional[str] = None
    date_confidence: float = 0.0
    gstin: Optional[str] = None
    invoice_total: Optional[float] = Field(None, description="Grand total printed on the invoice")
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
    name: str = Field(..., min_length=1, description="Product name")
    category: Optional[str] = Field("Groceries", description="Product category")
    quantity: float = Field(..., gt=0, description="Quantity to restock in whole stock units (> 0)")
    unit: str = Field("pcs", description="Packaging unit")
    purchase_price: float = Field(..., ge=0, description="Unit purchase price; must be confirmed, never assumed")
    selling_price: Optional[float] = Field(None, ge=0, description="Selling price; required for new products")
    mrp: Optional[float] = Field(None, gt=0, description="Maximum retail price (MRP)")
    mrp_source: Optional[Literal["INVOICE", "API", "MANUAL", "STORE"]] = Field(
        None, description="Origin of the MRP; treated as MANUAL when omitted")
    line_amount: Optional[float] = Field(None, ge=0, description="Line amount printed on the invoice")
    matched_product_id: Optional[UUID] = Field(None, description="Existing product ID if matched")

    @field_validator("quantity")
    @classmethod
    def whole_units(cls, v: float) -> float:
        if abs(v - round(v)) > 1e-9:
            raise ValueError("quantity must be a whole number of stock units (stock is tracked in whole units)")
        return float(round(v))


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
    invoice_number: Optional[str] = None
    total_amount: float
    total_units: float
    items_restocked: int
    items_created: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
