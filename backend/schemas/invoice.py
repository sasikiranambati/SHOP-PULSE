from typing import Optional, List, Any, Dict, Literal
from uuid import UUID
from datetime import datetime
from services.unit_registry import UNITS, try_normalize_unit
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from schemas.product import ProductResponse


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
    printed_amount: Optional[float] = Field(None, description="Printed line amount on the invoice")
    calculated_amount: Optional[float] = Field(None, description="Calculated line amount (quantity × purchase_price)")
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
    suggested_quantity: Optional[float] = Field(
        None, description="Possible reading of a quantity with a lost decimal point, e.g. 25 -> 2.5 (not applied)")
    matched_product_id: Optional[UUID] = Field(None, description="ID of matched existing product")
    matched_product_name: Optional[str] = Field(None, description="Name of matched existing product")
    match_score: Optional[float] = Field(None, description="Inventory similarity score (0-1)")
    pack_size: Optional[float] = Field(None, description="Product package size (e.g. 50 in 50 kg)")
    pack_size_unit: Optional[str] = Field(None, description="Unit of the package size (e.g. kg, L, gm)")
    classification_status: str = Field("GROCERY_CONFIDENT", description="GROCERY_CONFIDENT | GROCERY_REVIEW | NON_GROCERY | UNKNOWN_REVIEW")
    is_grocery: bool = Field(True, description="True if item belongs to grocery retail taxonomy")
    brand: Optional[str] = Field(None, description="Identified brand name")
    normalized_name: Optional[str] = Field(None, description="Standardized product name")
    category: Optional[str] = Field("Groceries", description="Detected grocery category")
    is_verified: bool = Field(False, description="Whether item has been verified by user or math")
    user_edited: bool = Field(False, description="Whether item has been edited by user")
    original_values: Optional[Dict[str, Any]] = Field(None, description="Original OCR extraction values prior to edits")
    # --- Read vs calculated, and separately printed financial parts (all optional, additive) ---
    derived_fields: List[str] = Field(
        default_factory=list,
        description="Fields CALCULATED rather than read (quantity, purchase_price, line_total); always need review")
    cgst_amount: Optional[float] = Field(None, description="CGST amount printed for the line")
    sgst_amount: Optional[float] = Field(None, description="SGST / UTGST amount printed for the line")
    igst_amount: Optional[float] = Field(None, description="IGST amount printed for the line")
    scheme_discount: Optional[float] = Field(None, description="Scheme discount amount printed for the line")
    other_discount: Optional[float] = Field(None, description="Other discount (e.g. RS / trade discount) printed for the line")
    discount_components: Dict[str, float] = Field(
        default_factory=dict, description="Every printed discount column by name; discount is their sum")
    net_amount: Optional[float] = Field(None, description="Printed line total including tax (Net / Amount column)")
    cases: Optional[float] = Field(None, description="Cases printed for the line (Cs column or 'cases/pieces')")
    units_per_case: Optional[float] = Field(None, description="Units per case printed for the line (e.g. UPC column)")
    loose_quantity: Optional[float] = Field(None, description="Loose pieces printed for the line (Pcs column)")
    free_quantity: Optional[float] = Field(
        None, description="Free units on the line (e.g. '10+1' -> 1; a printed free line -> its whole quantity)")
    paid_quantity: Optional[float] = Field(
        None, description="Paid units when free units are printed ('10+1' -> 10); quantity = paid + free received")
    quantity_text: Optional[str] = None
    is_free_item: bool = Field(False, description="Printed free / promotional line (rate 0.00); kept with its quantity")
    price_basis_quantity: Optional[float] = Field(1.0, description="Reference quantity for which purchase_price is quoted (default 1.0)")
    price_basis_unit: Optional[str] = Field(None, description="Canonical unit for which purchase_price is quoted (defaults to item unit)")
    normalized_purchase_price: Optional[float] = Field(None, description="Purchase cost per standard unit (same as cost_per_standard_unit)")
    # Pack size -> physical quantity -> cost per standard unit, computed by the unit registry and the
    # universal pricing engine from the printed values (services/invoice_pack_pricing.py)
    physical_quantity: Optional[float] = Field(None, description="Purchase quantity x pack size, in standard_unit (e.g. 2 bag x 25 kg = 50)")
    standard_unit: Optional[str] = Field(None, description="Unit of physical_quantity and cost_per_standard_unit (kg, L, or the purchase unit)")
    cost_per_standard_unit: Optional[float] = Field(None, description="Purchase cost per standard unit (e.g. Rs 4,700 / 50 kg = 94 per kg)")
    rate_basis_unit: Optional[str] = Field(None, description="Unit the printed rate is quoted per (usually the purchase unit)")
    pack_conversion: Optional[str] = Field(None, description="PACK_CONVERTED, COUNT_ONLY or NONE")


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
    excel_download_url: Optional[str] = Field(None, description="URL endpoint to download the generated genuine .xlsx workbook")
    total_grocery_items: int = 0
    total_review_items: int = 0
    total_excluded_items: int = 0
    pipeline_stages: List[str] = Field(default_factory=list, description="Stages completed during extraction")
    printed_total: Optional[float] = Field(
        None, description="Grand total printed on the invoice, when it could be identified reliably")
    total_reconciliation: Optional[Dict[str, Any]] = Field(
        None, description="Line amounts vs printed total: status matched | mismatch | not_completed, message, "
                          "difference, adjustments used (warning only; values are never changed)")
    bundle_notes: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Promotional bundle headings printed on the invoice (e.g. 'With Free Product'); "
                    "informational only, never stock lines")

    model_config = ConfigDict(from_attributes=True)


class InvoiceConfirmItem(BaseModel):
    name: str = Field(..., min_length=1, description="Product name")
    category: Optional[str] = Field("Groceries", description="Product category")
    quantity: float = Field(..., gt=0, description="Quantity received (> 0); fractional only for kg, g, L, ml")
    unit: Optional[str] = Field(None, description="Unit of the quantity; required (a missing unit is never assumed to be pcs)")
    purchase_price: float = Field(..., ge=0, description="Unit purchase price; must be confirmed, never assumed")
    selling_price: Optional[float] = Field(None, ge=0, description="Selling price; required for new products")
    mrp: Optional[float] = Field(None, gt=0, description="Maximum retail price (MRP)")
    mrp_source: Optional[Literal["INVOICE", "API", "MANUAL", "STORE"]] = Field(
        None, description="Origin of the MRP; treated as MANUAL when omitted")
    line_amount: Optional[float] = Field(None, ge=0, description="Line amount printed on the invoice")
    matched_product_id: Optional[UUID] = Field(None, description="Existing product ID if matched")
    # Promotions: received quantity = paid + free (e.g. 10+1 -> quantity 11, paid 10, free 1).
    # The printed rate / amount are kept; no cost is redistributed to the free units.
    paid_quantity: Optional[float] = Field(None, ge=0, description="Paid units included in quantity")
    free_quantity: Optional[float] = Field(None, ge=0, description="Free units included in quantity")
    is_free_item: bool = Field(False, description="Printed free line (rate 0.00); never sets the product's cost")
    price_basis_quantity: Optional[float] = Field(1.0, gt=0, description="Reference quantity for purchase price (default 1.0)")
    price_basis_unit: Optional[str] = Field(None, description="Canonical unit in which purchase price is quoted")
    mrp_basis_quantity: Optional[float] = Field(None, gt=0, description="Reference quantity for which invoice line MRP is quoted (defaults to price_basis_quantity if null)")
    mrp_basis_unit: Optional[str] = Field(None, description="Canonical unit in which invoice line MRP is quoted (defaults to price_basis_unit if null)")
    update_selling_price: bool = Field(False, description="Explicit confirmation to update retail selling price on existing products")
    # Pack size printed on the invoice (content of ONE purchase unit, e.g. 25 kg per bag). When given,
    # stock and cost are converted through the unit registry / pricing engine instead of price_basis.
    pack_size: Optional[float] = Field(None, gt=0, description="Content of one purchase unit (e.g. 25 for 25 kg per bag)")
    pack_size_unit: Optional[str] = Field(None, description="Unit of pack_size (kg, g, L, ml)")
    rate_basis_unit: Optional[str] = Field(None, description="Unit the purchase_price is quoted per; defaults to the line unit")
    stock_unit: Optional[str] = Field(None, description="New products only: stock in this unit (the purchase unit or the pack unit)")

    @model_validator(mode="after")
    def free_units_add_up(self) -> "InvoiceConfirmItem":
        if self.paid_quantity is not None and self.free_quantity is not None:
            if abs(self.quantity - (self.paid_quantity + self.free_quantity)) > 1e-9:
                raise ValueError("quantity must equal paid + free units "
                                 f"({self.paid_quantity:g} + {self.free_quantity:g})")
        return self

    @property
    def has_free_units(self) -> bool:
        return self.is_free_item or (self.free_quantity or 0) > 0

    @model_validator(mode="before")
    @classmethod
    def map_product_name(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "name" not in data or not data["name"]:
                if "product_name" in data and data["product_name"]:
                    data["name"] = data["product_name"]
        return data

    @model_validator(mode="after")
    def quantities_suit_the_unit(self) -> "InvoiceConfirmItem":
        """Fractions (up to 3 decimals) only for kg, g, L and ml; every other registered unit needs whole
        numbers. A fractional quantity is rejected, never rounded, so no stock is posted for the invoice.
        A missing or unregistered unit is reported by the confirm service (it needs review)."""
        unit_id = try_normalize_unit(self.unit) if self.unit else None
        if unit_id is None:
            return self
        definition = UNITS[unit_id]
        for value in (self.quantity, self.paid_quantity, self.free_quantity):
            if value is None:
                continue
            if not definition.allows_fraction and abs(value - round(value)) > 1e-9:
                raise ValueError(f"quantity {value:g} is not a whole number: fractional stock quantities are not "
                                 f"currently supported for {definition.label} (only kg, g, L and ml). "
                                 "Correct the quantity before adding to stock.")
            if definition.allows_fraction and abs(value * 1000 - round(value * 1000)) > 1e-6:
                raise ValueError(f"quantity {value:g} {definition.label} has more than 3 decimal places.")
        return self


_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def parse_invoice_date(value: str) -> Optional[datetime]:
    """Parse the date formats printed on Indian invoices (day first) and ISO dates.

    Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (2- or 4-digit year), YYYY-MM-DD (or / .) and
    '12 Oct 2026' / '12-Oct-2026'. Returns None when the text is not a real calendar date.
    """
    import re as _re

    text = (value or "").strip()
    m = _re.fullmatch(r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})", text)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})", text)
        if m:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            m = _re.fullmatch(r"(\d{1,2})[\s\-]+([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{2}|\d{4})", text)
            if not m or m.group(2).lower() not in _MONTHS:
                return None
            d, mo, y = int(m.group(1)), _MONTHS[m.group(2).lower()], int(m.group(3))
        if y < 100:
            y += 2000
    try:
        return datetime(y, mo, d)
    except ValueError:
        return None


class InvoiceConfirmRequest(BaseModel):
    supplier_name: Optional[str] = None
    supplier_id: Optional[UUID] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    items: List[InvoiceConfirmItem] = Field(..., min_length=1)
    confirm_free_units: bool = Field(
        False, description="Explicit confirmation that free / promotional units may be posted to stock")

    @model_validator(mode="after")
    def free_units_need_confirmation(self) -> "InvoiceConfirmRequest":
        names = [i.name for i in self.items if i.has_free_units]
        if names and not self.confirm_free_units:
            raise ValueError("Free / promotional units must be confirmed before they are added to stock: "
                             + ", ".join(names))
        return self

    @field_validator("supplier_name", "invoice_number", mode="before")
    @classmethod
    def blank_is_missing(cls, v: Any) -> Any:
        """Missing invoice details stay missing: blank text is stored as NULL, never invented."""
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("invoice_date", mode="before")
    @classmethod
    def valid_invoice_date(cls, v: Any) -> Any:
        """The date is kept exactly as entered, but it must be a real calendar date."""
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("Invoice date must be text such as 08/10/2026.")
        v = v.strip()
        if not v:
            return None
        if parse_invoice_date(v) is None:
            raise ValueError(f"'{v}' is not a valid invoice date. Use DD/MM/YYYY, for example 08/10/2026.")
        return v


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
    processing_status: Optional[str] = "CONFIRMED"
    review_status: Optional[str] = "REVIEWED"
    promotional_lines: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Lines posted with free units: received, paid and free quantities with the printed rate and amount")
    saved_products: List[ProductResponse] = Field(
        default_factory=list,
        description="List of all saved and restocked product details with IDs, stock, and prices"
    )

    model_config = ConfigDict(from_attributes=True)
