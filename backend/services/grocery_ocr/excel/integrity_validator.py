"""
Post-Excel parsing validation and integrity comparison service.
Compares in-memory pre-Excel data with re-parsed post-Excel models to guarantee 100% data preservation.
Flags any cell corruption, precision degradation, or row-shifting.
"""

from decimal import Decimal
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice import ExtractedInvoice
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem

logger = get_logger("excel.integrity_validator")


class ExcelIntegrityReport(BaseModel):
    """Integrity audit report comparing pre-Excel dataset with post-Excel re-parsed models."""
    is_intact: bool = Field(default=True, description="True if post-Excel data matches pre-Excel data with 100% fidelity")
    pre_excel_item_count: int = Field(default=0, description="Item count before generating Excel")
    post_excel_item_count: int = Field(default=0, description="Item count after reopening and parsing Excel")
    row_count_matched: bool = Field(default=True, description="True if row counts are identical")
    missing_fields_preserved: bool = Field(default=True, description="True if missing fields remained None without becoming zero")
    mismatches_count: int = Field(default=0, description="Total number of field-level discrepancies detected")
    field_mismatches: List[str] = Field(default_factory=list, description="List of mismatched fields")
    detailed_discrepancies: List[Dict[str, Any]] = Field(default_factory=list, description="Row-level mismatch details")
    summary: str = Field(default="", description="Human-readable summary of integrity audit")


class ExcelIntegrityValidator:
    """
    Validates that workbook generation and re-parsing preserved all data fields,
    decimal precisions, null representations, and row associations.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None, tolerance: Optional[Decimal] = None):
        self.config = config or default_config
        self.tolerance = tolerance if tolerance is not None else Decimal("0.001")

    def validate_integrity(
        self,
        pre_invoice: ExtractedInvoice,
        post_invoice: ExtractedInvoice
    ) -> ExcelIntegrityReport:
        """
        Compares pre-Excel invoice against post-Excel parsed invoice.
        """
        pre_items = pre_invoice.items
        post_items = post_invoice.items

        pre_count = len(pre_items)
        post_count = len(post_items)
        row_count_ok = (pre_count == post_count)

        discrepancies: List[Dict[str, Any]] = []
        field_mismatches_set = set()
        missing_preserved = True

        if not row_count_ok:
            field_mismatches_set.add("row_count")
            discrepancies.append({
                "type": "ROW_COUNT_MISMATCH",
                "pre_count": pre_count,
                "post_count": post_count,
            })

        # Compare items row by row
        min_len = min(pre_count, post_count)
        for i in range(min_len):
            pre_it = pre_items[i]
            post_it = post_items[i]

            # 1. Product Name
            if pre_it.raw_product_name != post_it.raw_product_name:
                field_mismatches_set.add("raw_product_name")
                discrepancies.append({
                    "row": i + 1,
                    "field": "raw_product_name",
                    "pre": pre_it.raw_product_name,
                    "post": post_it.raw_product_name,
                })

            # 2. Quantity
            if not self._decimal_equal(pre_it.quantity, post_it.quantity):
                field_mismatches_set.add("quantity")
                discrepancies.append({
                    "row": i + 1,
                    "field": "quantity",
                    "pre": str(pre_it.quantity),
                    "post": str(post_it.quantity),
                })

            # Check missing quantity preservation
            if pre_it.quantity is None and post_it.quantity is not None:
                missing_preserved = False
                field_mismatches_set.add("missing_quantity_mutated")

            # 3. Unit
            if (pre_it.unit or "").upper() != (post_it.unit or "").upper():
                field_mismatches_set.add("unit")
                discrepancies.append({
                    "row": i + 1,
                    "field": "unit",
                    "pre": pre_it.unit,
                    "post": post_it.unit,
                })

            # 4. Purchase Price
            if not self._decimal_equal(pre_it.purchase_price, post_it.purchase_price):
                field_mismatches_set.add("purchase_price")
                discrepancies.append({
                    "row": i + 1,
                    "field": "purchase_price",
                    "pre": str(pre_it.purchase_price),
                    "post": str(post_it.purchase_price),
                })

            # Check missing purchase price preservation
            if pre_it.purchase_price is None and post_it.purchase_price is not None:
                missing_preserved = False
                field_mismatches_set.add("missing_purchase_price_mutated")

            # 5. MRP
            if not self._decimal_equal(pre_it.mrp, post_it.mrp):
                field_mismatches_set.add("mrp")
                discrepancies.append({
                    "row": i + 1,
                    "field": "mrp",
                    "pre": str(pre_it.mrp),
                    "post": str(post_it.mrp),
                })

            # 6. Printed Amount
            if not self._decimal_equal(pre_it.printed_amount, post_it.printed_amount):
                field_mismatches_set.add("printed_amount")
                discrepancies.append({
                    "row": i + 1,
                    "field": "printed_amount",
                    "pre": str(pre_it.printed_amount),
                    "post": str(post_it.printed_amount),
                })

            # 7. Calculated Amount
            if not self._decimal_equal(pre_it.calculated_amount, post_it.calculated_amount):
                field_mismatches_set.add("calculated_amount")
                discrepancies.append({
                    "row": i + 1,
                    "field": "calculated_amount",
                    "pre": str(pre_it.calculated_amount),
                    "post": str(post_it.calculated_amount),
                })

        is_intact = len(discrepancies) == 0 and row_count_ok and missing_preserved

        if is_intact:
            summary = (
                f"Excel round-trip verified with 100% data integrity: "
                f"all {post_count} rows, Decimals, and nulls survived generate-save-reopen-parse."
            )
        else:
            summary = (
                f"Excel round-trip detected {len(discrepancies)} discrepancy(ies) across "
                f"fields: {', '.join(sorted(field_mismatches_set))}."
            )

        report = ExcelIntegrityReport(
            is_intact=is_intact,
            pre_excel_item_count=pre_count,
            post_excel_item_count=post_count,
            row_count_matched=row_count_ok,
            missing_fields_preserved=missing_preserved,
            mismatches_count=len(discrepancies),
            field_mismatches=sorted(field_mismatches_set),
            detailed_discrepancies=discrepancies,
            summary=summary,
        )

        logger.info("Excel integrity validation complete: intact=%s, mismatches=%d", is_intact, len(discrepancies))
        return report

    def _decimal_equal(self, d1: Optional[Decimal], d2: Optional[Decimal]) -> bool:
        if d1 is None and d2 is None:
            return True
        if d1 is None or d2 is None:
            return False
        return abs(d1 - d2) <= self.tolerance

