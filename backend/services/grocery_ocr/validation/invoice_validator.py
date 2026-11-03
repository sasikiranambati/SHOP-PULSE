"""
Invoice validation interface and base implementation.
Verifies line-item arithmetic, financial roles, missing fields, and document-level totals.
Uses Python Decimal exclusively; never floats.
Distinguishes between optional fields (MRP, Selling Price) and required fields.
"""

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import List, Optional

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import InvoiceValidationError
from services.grocery_ocr.financial.calculation_engine import (
    FinancialCalculationEngine,
)
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice import ExtractedInvoice
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    ValidationStatusType,
)

logger = get_logger("validation.invoice_validator")


class IInvoiceValidator(ABC):
    """Abstract interface for validating invoice line items and document aggregates."""

    @abstractmethod
    def validate_item(self, item: ExtractedInvoiceItem) -> ExtractedInvoiceItem:
        """
        Validates mathematical integrity of a single line item.
        Calculates expected amount and assigns validation status.
        """
        pass

    @abstractmethod
    def validate_invoice(self, invoice: ExtractedInvoice) -> ExtractedInvoice:
        """
        Validates invoice-level totals against sum of line items and determines overall status.
        """
        pass


class BaseInvoiceValidator(IInvoiceValidator):
    """
    Standard financial and arithmetic invoice validator.
    Applies multi-rule validation:
    1. Fatal sanity: negative quantities/prices or extreme magnitudes -> INVALID
    2. Missing data: missing quantity or purchase price -> INSUFFICIENT_DATA
    3. Arithmetic comparison: printed amount vs calculated amount -> VERIFIED or MISMATCH/REVIEW_REQUIRED
    4. Optional fields: missing MRP or selling price does NOT reject a valid invoice
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None, tolerance: Optional[Decimal] = None):
        self.config = config or default_config
        self.tolerance = tolerance if tolerance is not None else Decimal("0.05")
        self.calculation_engine = FinancialCalculationEngine(self.config, self.tolerance)

    def validate_item(self, item: ExtractedInvoiceItem) -> ExtractedInvoiceItem:
        issues = list(item.validation_issues)
        status: ValidationStatusType = "VERIFIED"

        # Rule 1: Fatal Negatives & Out-of-Bounds Sanitization
        if item.quantity is not None and item.quantity < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal validation error: Negative quantity ({item.quantity}) detected")

        if item.purchase_price is not None and item.purchase_price < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal validation error: Negative purchase price (₹{item.purchase_price}) detected")

        if item.mrp is not None and item.mrp < Decimal("0"):
            status = "INVALID"
            issues.append(f"Fatal validation error: Negative MRP (₹{item.mrp}) detected")

        # Plausibility threshold checks
        if item.quantity is not None and item.quantity > Decimal("50000"):
            status = "REVIEW_REQUIRED"
            issues.append(f"Suspiciously large quantity ({item.quantity}) requires manual verification")

        if item.purchase_price is not None and item.purchase_price > Decimal("500000.00"):
            status = "REVIEW_REQUIRED"
            issues.append(f"Suspiciously large unit price (₹{item.purchase_price}) requires manual verification")

        # Rule 2: Missing Essential Fields Check
        if item.quantity is None and item.purchase_price is None:
            if status != "INVALID":
                status = "INSUFFICIENT_DATA"
            issues.append("Quantity and purchase price could not be read from document")
        elif item.quantity is None:
            if status != "INVALID":
                status = "INSUFFICIENT_DATA"
            issues.append("Quantity could not be read; verifying rate only")
        elif item.purchase_price is None:
            if status != "INVALID":
                status = "INSUFFICIENT_DATA"
            issues.append("Purchase rate could not be read; verifying quantity only")

        suggestions = list(item.suggestions)

        # Missing unit check (non-fatal suggestion)
        if item.unit is None and item.quantity is not None:
            suggestions.append("Measurement unit was not explicitly printed for this line item")

        # Rule 3: Exact Decimal Arithmetic Validation
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

        if status not in ("INVALID", "INSUFFICIENT_DATA"):
            if not calc_result.is_arithmetic_match:
                status = "MISMATCH"
                if calc_result.discrepancy_explanation:
                    issues.append(calc_result.discrepancy_explanation)
            else:
                status = "VERIFIED"

        # Check for ambiguous rate flag
        if getattr(item, "financial_role_confidence", {}).get("purchase_price", 100.0) < 75.0:
            if status == "VERIFIED":
                status = "WARNING"
            issues.append("Purchase price assigned from generic RATE column without role clarification")

        return item.model_copy(
            update={
                "calculated_amount": calculated_amount,
                "rounding_difference": rounding_diff,
                "validation_status": status,
                "validation_issues": issues,
                "suggestions": suggestions,
            }
        )

    def validate_invoice(self, invoice: ExtractedInvoice) -> ExtractedInvoice:
        try:
            validated_items = [self.validate_item(item) for item in invoice.items]

            calc_total = Decimal("0.00")
            calc_units = Decimal("0.000")
            has_mismatch = False

            for it in validated_items:
                if it.printed_amount is not None:
                    calc_total += it.printed_amount
                elif it.calculated_amount is not None:
                    calc_total += it.calculated_amount

                if it.quantity is not None:
                    calc_units += it.quantity

                if it.validation_status in ("MISMATCH", "NEEDS_REVIEW", "INVALID", "REVIEW_REQUIRED"):
                    has_mismatch = True

            overall_status = "SUCCESS"
            reason = None
            if has_mismatch or not validated_items:
                overall_status = "NEEDS_REVIEW"
                reason = "One or more line items have arithmetic discrepancies or require manual review"

            if invoice.printed_total is not None:
                diff = abs(calc_total - invoice.printed_total)
                if diff > self.tolerance * Decimal(len(validated_items) or 1):
                    overall_status = "NEEDS_REVIEW"
                    reason = f"Grand total discrepancy: sum of lines ₹{calc_total} vs printed invoice total ₹{invoice.printed_total}"

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
        except Exception as exc:
            logger.error("Invoice validation failed: %s", exc)
            raise InvoiceValidationError(f"Validation failed: {exc}", details={"invoice_id": invoice.invoice_id})
