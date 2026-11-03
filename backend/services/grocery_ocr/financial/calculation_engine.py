"""
Dedicated financial calculation engine for grocery invoices.
Executes exact Decimal calculations for Gross, Discount, Taxable, GST, and Net Line Amounts.
Maintains strict separation between printed amounts and calculated amounts.
"""

from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger

logger = get_logger("financial.calculation_engine")


class LineItemCalculationResult(BaseModel):
    """Detailed mathematical breakdown for an invoice line item."""
    gross_amount: Optional[Decimal] = Field(None, description="Quantity × Unit Rate")
    discount_amount: Optional[Decimal] = Field(None, description="Calculated or printed discount deduction")
    taxable_amount: Optional[Decimal] = Field(None, description="Gross minus discount")
    gst_amount: Optional[Decimal] = Field(None, description="Calculated or printed GST / tax addition")
    calculated_amount: Optional[Decimal] = Field(None, description="Final calculated line total (Taxable + GST)")
    printed_amount: Optional[Decimal] = Field(None, description="Verbatim line total as printed on invoice")
    rounding_difference: Optional[Decimal] = Field(None, description="Printed amount minus calculated amount")
    is_arithmetic_match: bool = Field(default=True, description="True if printed matches calculated within tolerance")
    discrepancy_explanation: Optional[str] = Field(None, description="Explanation for any arithmetic discrepancy")


class FinancialCalculationEngine:
    """
    Precision Decimal arithmetic engine.
    Calculates line totals and verifies document arithmetic without mutating source inputs.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None, tolerance: Optional[Decimal] = None):
        self.config = config or default_config
        self.tolerance = tolerance if tolerance is not None else Decimal("0.05")

    def calculate_line_item(
        self,
        quantity: Optional[Decimal],
        unit_rate: Optional[Decimal],
        discount: Optional[Decimal] = None,
        discount_pct: Optional[Decimal] = None,
        tax_amount: Optional[Decimal] = None,
        gst_rate: Optional[Decimal] = None,
        printed_taxable: Optional[Decimal] = None,
        printed_amount: Optional[Decimal] = None,
    ) -> LineItemCalculationResult:
        """
        Calculates expected line total from quantity and rate, factoring in discounts and taxes.

        Args:
            quantity: Purchased item quantity.
            unit_rate: Applicable unit purchase/selling price.
            discount: Flat discount amount if printed.
            discount_pct: Discount percentage if printed.
            tax_amount: Tax amount if printed.
            gst_rate: Tax rate percentage if printed.
            printed_taxable: Taxable value if printed.
            printed_amount: Verbatim line total printed on the invoice.

        Returns:
            LineItemCalculationResult with exact Decimals and discrepancy analysis.
        """
        # 1. Check if minimum inputs exist to compute gross amount
        if quantity is None or unit_rate is None:
            return LineItemCalculationResult(
                gross_amount=None,
                discount_amount=None,
                taxable_amount=printed_taxable,
                gst_amount=tax_amount,
                calculated_amount=None,
                printed_amount=printed_amount,
                rounding_difference=None,
                is_arithmetic_match=True,  # Cannot determine mismatch without rate & qty
                discrepancy_explanation="Cannot compute expected amount: quantity or unit rate is missing",
            )

        # 2. Compute gross amount = quantity × unit_rate
        gross = (quantity * unit_rate).quantize(self.config.currency_quantize_exp)

        # 3. Factor in discount
        discount_amt = Decimal("0.00")
        if discount is not None:
            discount_amt = discount
        elif discount_pct is not None:
            discount_amt = (gross * discount_pct / Decimal("100")).quantize(self.config.currency_quantize_exp)

        # 4. Determine taxable amount
        taxable = printed_taxable if printed_taxable is not None else (gross - discount_amt)

        # 5. Factor in tax / GST
        tax_amt = Decimal("0.00")
        if tax_amount is not None:
            tax_amt = tax_amount
        elif gst_rate is not None:
            tax_amt = (taxable * gst_rate / Decimal("100")).quantize(self.config.currency_quantize_exp)

        # 6. Final calculated amount
        calculated = (taxable + tax_amt).quantize(self.config.currency_quantize_exp)

        # 7. Compare with printed amount
        rounding_diff: Optional[Decimal] = None
        is_match = True
        explanation: Optional[str] = None

        if printed_amount is not None:
            rounding_diff = printed_amount - calculated
            if abs(rounding_diff) > self.tolerance:
                is_match = False
                explanation = (
                    f"Arithmetic mismatch: expected ₹{calculated} "
                    f"({quantity} × ₹{unit_rate}"
                    f"{f' - ₹{discount_amt} disc' if discount_amt > 0 else ''}"
                    f"{f' + ₹{tax_amt} tax' if tax_amt > 0 else ''}), "
                    f"but invoice printed ₹{printed_amount} (diff: ₹{rounding_diff})"
                )

        return LineItemCalculationResult(
            gross_amount=gross,
            discount_amount=discount_amt if discount_amt > 0 else None,
            taxable_amount=taxable,
            gst_amount=tax_amt if tax_amt > 0 else None,
            calculated_amount=calculated,
            printed_amount=printed_amount,
            rounding_difference=rounding_diff,
            is_arithmetic_match=is_match,
            discrepancy_explanation=explanation,
        )
