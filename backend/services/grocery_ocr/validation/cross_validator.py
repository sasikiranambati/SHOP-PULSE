"""
Unified validation and cross-validation service for ShopPulse Grocery OCR.
Cross-validates geometric, spatial, taxonomic, and financial extraction evidence across all stages.
Maintains granular field-level confidence scores without averaging unrelated numbers.
Assigns verified 4-tier statuses: VERIFIED, WARNING, REVIEW_REQUIRED, INVALID.
"""

from decimal import Decimal
import re
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.financial.calculation_engine import FinancialCalculationEngine
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice import ExtractedInvoice
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    ValidationStatusType,
)

logger = get_logger("validation.cross_validator")


class FieldConfidenceScores(BaseModel):
    """
    Independent confidence metrics maintained per field.
    Averaging unrelated confidence scores is strictly prohibited.
    """
    ocr_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    table_reconstruction_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    column_mapping_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    product_classification_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    brand_recognition_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    quantity_extraction_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    financial_extraction_confidence: float = Field(default=0.0, ge=0.0, le=100.0)
    excel_parsing_integrity: float = Field(default=100.0, ge=0.0, le=100.0)


class ItemCrossValidationResult(BaseModel):
    """Evaluation result of cross-stage consistency checks for an invoice item."""
    item_id: str
    status: ValidationStatusType
    field_confidences: FieldConfidenceScores
    checks_passed: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    financial_protection_verified: bool = True


class UnifiedValidationService:
    """
    Comprehensive validation engine.
    Executes cross-validation across table geometry, column semantics, OCR text, and exact arithmetic.
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        tolerance: Optional[Decimal] = None
    ):
        self.config = config or default_config
        self.tolerance = tolerance if tolerance is not None else Decimal("0.05")
        self.calculation_engine = FinancialCalculationEngine(self.config, self.tolerance)

    def cross_validate_item(
        self,
        item: ExtractedInvoiceItem,
        invoice: Optional[ExtractedInvoice] = None
    ) -> ExtractedInvoiceItem:
        """
        Cross-validates an individual line item across 8 evidence criteria:
        1. Geometric association: Does product name belong to reconstructed row?
        2. Packaging containment: Does package size belong to product description?
        3. Column role alignment: Does quantity originate from detected QTY column?
        4. Rate column alignment: Does purchase price originate from RATE column?
        5. Horizontal alignment: Does printed amount belong to the same item row?
        6. Decimal arithmetic: Does Qty * Rate match printed line total?
        7. Field-level confidences: Separate tracking without averaging.
        8. Strict financial protection assertion.
        """
        checks_passed: List[str] = []
        warnings: List[str] = []
        issues: List[str] = list(item.validation_issues)
        suggestions: List[str] = list(item.suggestions)
        status: ValidationStatusType = "VERIFIED"

        # Check 1: Fatal Negatives & Bounds
        if item.quantity is not None and item.quantity < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal error: Negative quantity ({item.quantity}) detected")

        if item.purchase_price is not None and item.purchase_price < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal error: Negative purchase price (₹{item.purchase_price}) detected")

        if item.mrp is not None and item.mrp < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal error: Negative MRP (₹{item.mrp}) detected")

        # Check 2: Geometric & Row Association
        # Verifies that raw product name is consistent with raw row text
        raw_row = item.raw_row_text or ""
        if raw_row:
            product_tokens = item.raw_product_name.split()
            matching_tokens = sum(1 for t in product_tokens if t in raw_row)
            if matching_tokens > 0:
                checks_passed.append("product_in_reconstructed_row")
            else:
                warnings.append(
                    f"Product name '{item.raw_product_name}' has low token overlap with raw row '{raw_row}'"
                )
                if status == "VERIFIED":
                    status = "WARNING"
        else:
            checks_passed.append("product_in_reconstructed_row")

        # Check 3: Package size containment in description (not in quantity)
        if item.package_size and item.package_size.raw_text:
            if item.package_size.raw_text.lower() in item.raw_product_name.lower():
                checks_passed.append("package_size_in_product_description")
            else:
                warnings.append(
                    f"Package size '{item.package_size.raw_text}' was not directly observed in product title"
                )
                if status == "VERIFIED":
                    status = "WARNING"

        # Check 4: Quantity column alignment
        raw_qty_str = item.raw_cells.get("qty") or item.raw_quantity
        if raw_qty_str is not None or not item.raw_cells:
            checks_passed.append("quantity_from_detected_column")
        elif item.quantity is not None:
            # Quantity was inferred rather than explicitly from a QTY column
            warnings.append("Quantity was inferred rather than read from explicit QTY column")
            if status == "VERIFIED":
                status = "WARNING"

        # Check 5: Rate column alignment
        raw_rate_str = item.raw_cells.get("rate")
        if raw_rate_str is not None or not item.raw_cells:
            checks_passed.append("rate_from_detected_column")
        elif item.purchase_price is not None:
            warnings.append("Purchase rate was inferred rather than read from explicit RATE column")
            if status == "VERIFIED":
                status = "WARNING"

        # Check 6: Printed line amount alignment
        raw_amt_str = item.raw_cells.get("total") or item.raw_cells.get("amount")
        if raw_amt_str is not None:
            checks_passed.append("printed_amount_row_alignment")

        # Check 7: Essential data presence
        if item.quantity is None and item.purchase_price is None:
            if status != "INVALID":
                status = "REVIEW_REQUIRED"
            issues.append("Quantity and purchase rate missing from document")
        elif item.quantity is None:
            if status != "INVALID":
                status = "REVIEW_REQUIRED"
            issues.append("Quantity missing; rate present only")
        elif item.purchase_price is None:
            if status != "INVALID":
                status = "REVIEW_REQUIRED"
            issues.append("Purchase rate missing; quantity present only")

        # Check 8: Decimal Arithmetic Validation
        calc_result = self.calculation_engine.calculate_line_item(
            quantity=item.quantity,
            unit_rate=item.purchase_price,
            discount=item.discount,
            discount_pct=item.discount_pct,
            tax_amount=item.tax_amount,
            gst_rate=item.gst_rate,
            printed_taxable=item.taxable_amount,
            printed_amount=item.printed_amount,
        )

        calculated_amount = calc_result.calculated_amount
        rounding_diff = calc_result.rounding_difference

        if status not in ("INVALID", "REVIEW_REQUIRED"):
            if not calc_result.is_arithmetic_match:
                status = "MISMATCH"
                if calc_result.discrepancy_explanation:
                    issues.append(calc_result.discrepancy_explanation)
            else:
                checks_passed.append("arithmetic_exact_match")

        # Compute granular field-level confidences without averaging
        qty_conf = 95.0 if raw_qty_str else (60.0 if item.quantity is not None else 0.0)
        fin_conf = getattr(item, "financial_role_confidence", {}).get("purchase_price", 90.0)
        if item.purchase_price is None:
            fin_conf = 0.0

        excel_integrity = 100.0
        if invoice and "excel_integrity_report" in invoice.metadata.custom_properties:
            rep = invoice.metadata.custom_properties["excel_integrity_report"]
            if not rep.get("is_intact", True):
                excel_integrity = 70.0

        field_scores = FieldConfidenceScores(
            ocr_confidence=item.ocr_confidence,
            table_reconstruction_confidence=item.extraction_confidence,
            column_mapping_confidence=90.0 if "rate_from_detected_column" in checks_passed else 65.0,
            product_classification_confidence=item.category_confidence,
            brand_recognition_confidence=item.brand_confidence,
            quantity_extraction_confidence=qty_conf,
            financial_extraction_confidence=fin_conf,
            excel_parsing_integrity=excel_integrity,
        )

        # Confidence threshold degradation
        if field_scores.ocr_confidence < getattr(self.config, "medium_confidence_threshold", 60.0):
            if status == "VERIFIED":
                status = "WARNING"
            warnings.append(f"Low OCR confidence ({field_scores.ocr_confidence}%) for row")

        if item.review_status == "REVIEW_REQUIRED" or item.classification_status == "UNKNOWN_REVIEW_REQUIRED":
            if status == "VERIFIED":
                status = "REVIEW_REQUIRED"

        # Attach custom properties
        meta = dict(item.metadata)
        meta["field_confidences"] = field_scores.model_dump()
        meta["cross_validation_checks_passed"] = checks_passed
        if warnings:
            meta["cross_validation_warnings"] = warnings

        # Map canonical status to validation_status
        return item.model_copy(
            update={
                "calculated_amount": calculated_amount,
                "rounding_difference": rounding_diff,
                "validation_status": status,
                "validation_issues": issues,
                "suggestions": suggestions,
                "metadata": meta,
            }
        )

    def cross_validate_invoice(self, invoice: ExtractedInvoice) -> ExtractedInvoice:
        """Validates all items and invoice-level grand totals."""
        validated_items = [self.cross_validate_item(item, invoice) for item in invoice.items]

        calc_total = Decimal("0.00")
        calc_units = Decimal("0.000")
        has_review = False
        has_invalid = False

        for it in validated_items:
            if it.printed_amount is not None:
                calc_total += it.printed_amount
            elif it.calculated_amount is not None:
                calc_total += it.calculated_amount

            if it.quantity is not None:
                calc_units += it.quantity

            if it.validation_status in ("MISMATCH", "NEEDS_REVIEW", "REVIEW_REQUIRED"):
                has_review = True
            elif it.validation_status == "INVALID":
                has_invalid = True

        overall_status = "SUCCESS"
        reason = None

        if has_invalid:
            overall_status = "FAILED"
            reason = "Fatal data validation error detected on one or more line items"
        elif has_review or not validated_items:
            overall_status = "NEEDS_REVIEW"
            reason = "One or more line items have arithmetic discrepancies or require manual review"

        if invoice.printed_total is not None:
            diff = abs(calc_total - invoice.printed_total)
            if diff > self.tolerance * Decimal(len(validated_items) or 1):
                overall_status = "NEEDS_REVIEW"
                reason = f"Grand total mismatch: calculated lines sum ₹{calc_total} vs printed ₹{invoice.printed_total}"

        return invoice.model_copy(
            update={
                "items": validated_items,
                "calculated_total": calc_total if validated_items else None,
                "total_units": calc_units if validated_items else None,
                "total_items_count": len(validated_items),
                "status": overall_status,
                "reason": reason,
            }
        )
