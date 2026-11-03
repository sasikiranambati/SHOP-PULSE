"""
Pydantic schema for an extracted invoice line item.
Enforces Decimal precision for financial values and nullable representations for missing data.
Zero is NEVER used to substitute an unknown price or quantity.
Original OCR text is strictly preserved separately from normalized values.
Includes granular intelligence confidence scores and matching telemetry for Phase 5.
"""

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

ValidationStatusType = Literal[
    "VERIFIED",
    "WARNING",
    "REVIEW_REQUIRED",
    "INVALID",
    "MISMATCH",
    "INSUFFICIENT_DATA",
    "NEEDS_REVIEW",
]
ClassificationStatusType = Literal[
    "GROCERY_HIGH_CONFIDENCE",
    "GROCERY_REVIEW_REQUIRED",
    "NON_GROCERY",
    "UNKNOWN_REVIEW_REQUIRED",
    "GROCERY_CONFIDENT",
    "GROCERY_REVIEW",
    "UNKNOWN_REVIEW",
]


class PackageSize(BaseModel):
    """Product packaging size (e.g. 500 in 500 gm, 1 in 1 kg, 975 in 975ml x 2)."""
    value: Optional[Decimal] = Field(None, description="Extracted numeric magnitude of the package")
    unit: Optional[str] = Field(None, description="Normalized unit of the package size (e.g. kg, g, ml, l, pack)")
    raw_text: Optional[str] = Field(None, description="Original token text read from document")
    multiplier: Optional[int] = Field(default=1, ge=1, description="Pack multiplier (e.g. 2 for 975ml x 2, 4 for Pack of 4)")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Package size extraction confidence")

    model_config = ConfigDict(frozen=True)


class ProductMatchResult(BaseModel):
    """Structured result of matching an extracted line item against store catalogue."""
    matched_product_id: Optional[str] = Field(None, description="ID of matched store catalogue record")
    matched_product_name: Optional[str] = Field(None, description="Name of matched catalogue product")
    similarity_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Normalized similarity metric (0.0 to 1.0)")
    match_confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Match confidence score (0-100)")
    match_method: str = Field(default="NO_MATCH", description="GTIN | EXACT_NAME_BRAND_SIZE | FUZZY_NAME_BRAND_SIZE | NO_MATCH")
    match_explanation: str = Field(default="", description="Auditable reasoning for matching or rejection")
    review_status: str = Field(default="REVIEW_REQUIRED", description="CONFIRMED | REVIEW_REQUIRED | NO_MATCH")

    # Aliases for backward compatibility
    @property
    def matched_id(self) -> Optional[str]:
        return self.matched_product_id

    @property
    def matched_name(self) -> Optional[str]:
        return self.matched_product_name


class ExtractedInvoiceItem(BaseModel):
    """
    Structured representation of a single line item extracted from an invoice.
    Maintains full auditability between raw OCR text and normalized intelligence values.
    """

    item_id: str = Field(..., description="Unique deterministic identifier for this line item")

    # Product Identification (raw vs normalized)
    raw_product_name: str = Field(..., min_length=1, description="Original verbatim product name from OCR")
    normalized_product_name: Optional[str] = Field(None, description="Cleaned, standardized product title")
    brand: Optional[str] = Field(None, description="Detected grocery brand name (e.g. Fortune, Tata, Parle)")
    category: Optional[str] = Field("Groceries", description="Identified taxonomy category")
    hsn_code: Optional[str] = Field(None, description="Printed HSN / SAC code")
    barcode: Optional[str] = Field(None, description="Printed barcode, EAN-13, or GTIN")

    # Quantity & Packaging (Nullable Decimal; never zero when unknown)
    quantity: Optional[Decimal] = Field(
        None,
        description="Purchased quantity; None when not printed or unreadable. NEVER defaults to 0 or 1"
    )
    raw_quantity: Optional[str] = Field(
        None,
        description="Verbatim quantity string as printed in document"
    )
    unit: Optional[str] = Field(
        None,
        description="Normalized measurement unit (e.g. kg, pcs, bag, bor)"
    )
    raw_unit: Optional[str] = Field(
        None,
        description="Verbatim unit string as printed in document"
    )
    package_size: Optional[PackageSize] = Field(
        None,
        description="Physical package size attached to the product description"
    )

    # Financial Values (Nullable Decimal; never zero when unknown)
    purchase_price: Optional[Decimal] = Field(
        None,
        description="Unit purchase price (from Purchase Rate or Rate column); None when unreadable"
    )
    selling_price: Optional[Decimal] = Field(
        None,
        description="Selling price printed on invoice; None if absent"
    )
    mrp: Optional[Decimal] = Field(
        None,
        description="Maximum Retail Price (MRP) printed on invoice; None if absent"
    )
    discount: Optional[Decimal] = Field(
        None,
        description="Discount amount deducted on this line item"
    )
    discount_pct: Optional[Decimal] = Field(
        None,
        description="Discount percentage applied to this line item"
    )
    tax_amount: Optional[Decimal] = Field(
        None,
        description="GST or tax amount for this line item"
    )
    gst_rate: Optional[Decimal] = Field(
        None,
        description="GST percentage rate for this line item (e.g. 5.0, 18.0)"
    )
    taxable_amount: Optional[Decimal] = Field(
        None,
        description="Taxable value before tax was applied"
    )
    printed_amount: Optional[Decimal] = Field(
        None,
        description="Line total amount verbatim as printed on the invoice"
    )
    calculated_amount: Optional[Decimal] = Field(
        None,
        description="Independently verified quantity × purchase_price calculation"
    )
    rounding_difference: Optional[Decimal] = Field(
        None,
        description="Difference between printed line total and calculated amount"
    )
    financial_role_confidence: Dict[str, float] = Field(
        default_factory=dict,
        description="Confidence per financial column role assignment (e.g. {'purchase_price': 95.0, 'mrp': 90.0})"
    )

    # Granular Quality & Confidence Metrics (Phase 5)
    ocr_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Average confidence of OCR tokens comprising this item"
    )
    name_confidence: float = Field(
        default=100.0,
        ge=0.0,
        le=100.0,
        description="Confidence in product name normalization and boundary extraction"
    )
    brand_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Confidence in brand identification (0.0 when no brand detected)"
    )
    package_size_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Confidence in package size extraction (0.0 when no size detected)"
    )
    category_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Confidence in taxonomy category classification"
    )
    match_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Confidence in store catalogue product matching"
    )
    extraction_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Heuristic extraction confidence for column and field assignments"
    )

    # Classification & Review Telemetry
    validation_status: ValidationStatusType = Field(
        default="INSUFFICIENT_DATA",
        description="VERIFIED | MISMATCH | INSUFFICIENT_DATA | NEEDS_REVIEW"
    )
    classification_status: ClassificationStatusType = Field(
        default="GROCERY_HIGH_CONFIDENCE",
        description="GROCERY_HIGH_CONFIDENCE | GROCERY_REVIEW_REQUIRED | NON_GROCERY | UNKNOWN_REVIEW_REQUIRED"
    )
    is_grocery: bool = Field(
        default=True,
        description="True if product belongs to retail grocery taxonomy"
    )
    classification_explanation: Optional[str] = Field(
        None,
        description="Human-readable explanation of why this category, brand, or status was assigned"
    )
    review_status: str = Field(
        default="CONFIRMED",
        description="CONFIRMED | REVIEW_REQUIRED | NON_GROCERY"
    )

    # Catalogue Matching Telemetry
    matched_product_id: Optional[str] = Field(None, description="Catalogue ID of matched product")
    matched_product_name: Optional[str] = Field(None, description="Catalogue name of matched product")
    match_method: Optional[str] = Field(None, description="Method used to match catalogue product")
    match_explanation: Optional[str] = Field(None, description="Explanation for catalogue match or rejection")

    # Provenance and Traceability
    source_page: int = Field(default=1, ge=1, description="Source page number in document")
    source_row_index: Optional[int] = Field(None, ge=0, description="0-indexed table row reference")
    raw_row_text: str = Field(default="", description="Complete raw text line from document")
    raw_cells: Dict[str, str] = Field(
        default_factory=dict,
        description="Verbatim text per column (e.g. {'rate': '2,760.00', 'mrp': '3,200.00'})"
    )
    validation_issues: List[str] = Field(
        default_factory=list,
        description="Traceable explanations for any review flags or arithmetic mismatches"
    )
    suggestions: List[str] = Field(
        default_factory=list,
        description="Safe, non-destructive suggestions for manual review"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Custom processing tags")

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def handle_status_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Accept original_product_name as alias for raw_product_name
            if "original_product_name" in data and "raw_product_name" not in data:
                data["raw_product_name"] = data["original_product_name"]

            # Accept gst_percentage and gst_amount aliases
            if "gst_percentage" in data and "gst_rate" not in data:
                data["gst_rate"] = data["gst_percentage"]
            if "gst_amount" in data and "tax_amount" not in data:
                data["tax_amount"] = data["gst_amount"]

            # Map legacy status strings to canonical 4-tier statuses
            status = data.get("classification_status")
            if status == "GROCERY_CONFIDENT":
                data["classification_status"] = "GROCERY_HIGH_CONFIDENCE"
            elif status == "GROCERY_REVIEW":
                data["classification_status"] = "GROCERY_REVIEW_REQUIRED"
            elif status == "UNKNOWN_REVIEW":
                data["classification_status"] = "UNKNOWN_REVIEW_REQUIRED"
        return data

    @property
    def original_product_name(self) -> str:
        """Alias for raw_product_name as specified in Section 3 & 8."""
        return self.raw_product_name

    @property
    def gst_percentage(self) -> Optional[Decimal]:
        """Alias for gst_rate as specified in Section 1 & 7."""
        return self.gst_rate

    @property
    def gst_amount(self) -> Optional[Decimal]:
        """Alias for tax_amount as specified in Section 1 & 7."""
        return self.tax_amount

    @property
    def has_complete_arithmetic_evidence(self) -> bool:
        """Returns True if quantity, purchase_price, and printed_amount are all present."""
        return (
            self.quantity is not None
            and self.purchase_price is not None
            and self.printed_amount is not None
        )
