"""
Excel workbook parser for grocery invoices.
Parses genuine XLSX audit workbooks back into structured ExtractedInvoice models.
Reads actual cells from 'Grocery Items' worksheet with strict Decimal precision.
Preserves missing values as None (never zero).
"""

import io
from abc import ABC, abstractmethod
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Union
import openpyxl

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExcelParsingError
from services.grocery_ocr.intelligence.package_size_extractor import PackageSizeExtractor
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice import ExtractedInvoice, InvoiceProcessingMetadata
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    PackageSize,
    ValidationStatusType,
)

logger = get_logger("excel.workbook_parser")


class IWorkbookParser(ABC):
    """Abstract interface for parsing XLSX invoice audit sheets into structured models."""

    @abstractmethod
    def parse(self, workbook_source: Union[bytes, str]) -> ExtractedInvoice:
        """
        Parses XLSX bytes or file path into a structured ExtractedInvoice.
        """
        pass


class BaseWorkbookParser(IWorkbookParser):
    """
    Independent openpyxl workbook parser.
    Reads actual worksheet cells without reusing in-memory extraction instances.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config
        self.package_size_extractor = PackageSizeExtractor(self.config)

    def parse(self, workbook_source: Union[bytes, str]) -> ExtractedInvoice:
        """
        Parses XLSX bytes or file path into ExtractedInvoice.

        Args:
            workbook_source: Either raw XLSX bytes or path string to an XLSX file on disk.

        Returns:
            ExtractedInvoice model reconstructed from Excel cell values.
        """
        try:
            if isinstance(workbook_source, str):
                logger.debug("Parsing XLSX from file path: %s", workbook_source)
                wb = openpyxl.load_workbook(filename=workbook_source, data_only=True)
                source_desc = workbook_source
                byte_size = 0
            elif isinstance(workbook_source, bytes):
                logger.debug("Parsing XLSX from bytes (%d bytes)", len(workbook_source))
                wb = openpyxl.load_workbook(filename=io.BytesIO(workbook_source), data_only=True)
                source_desc = "in_memory.xlsx"
                byte_size = len(workbook_source)
            else:
                raise ExcelParsingError(f"Invalid workbook source type: {type(workbook_source)}")

            # Check sheet presence
            sheet_names = wb.sheetnames
            target_sheet_name = "Grocery Items"
            if target_sheet_name not in sheet_names:
                # Fallback to active sheet or first sheet if named differently
                target_sheet_name = sheet_names[0] if sheet_names else None

            if not target_sheet_name:
                raise ExcelParsingError("Workbook contains no worksheets")

            ws = wb[target_sheet_name]
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                raise ExcelParsingError(f"Worksheet '{target_sheet_name}' is completely empty")

            # Parse headers from row 1
            headers = [str(c or "").strip().lower() for c in rows[0]]
            col_map = self._map_header_columns(headers)

            items: List[ExtractedInvoiceItem] = []

            for r_idx, row in enumerate(rows[1:], start=2):
                if not any(row):
                    continue

                raw_name = self._get_str(row, col_map.get("raw_name"))
                if not raw_name:
                    continue

                norm_name = self._get_str(row, col_map.get("norm_name")) or raw_name
                brand = self._get_str(row, col_map.get("brand"))
                category = self._get_str(row, col_map.get("category")) or "Other grocery products"
                hsn = self._get_str(row, col_map.get("hsn"))
                pkg_str = self._get_str(row, col_map.get("pkg_size"))

                # Package size parsing
                pkg_size: Optional[PackageSize] = None
                if pkg_str:
                    pkg_size, _ = self.package_size_extractor.extract_package_size(pkg_str)

                # Quantities and Units
                qty = self._get_decimal(row, col_map.get("qty"), quantize_exp=self.config.quantity_quantize_exp)
                raw_qty = str(row[col_map["qty"]]) if col_map.get("qty") is not None and row[col_map["qty"]] is not None else None
                unit = self._get_str(row, col_map.get("unit"))

                # Prices and Financials
                p_price = self._get_decimal(row, col_map.get("purchase_price"), quantize_exp=self.config.currency_quantize_exp)
                s_price = self._get_decimal(row, col_map.get("selling_price"), quantize_exp=self.config.currency_quantize_exp)
                mrp = self._get_decimal(row, col_map.get("mrp"), quantize_exp=self.config.currency_quantize_exp)
                discount = self._get_decimal(row, col_map.get("discount"), quantize_exp=self.config.currency_quantize_exp)
                gst_pct = self._get_decimal(row, col_map.get("gst_pct"), quantize_exp=Decimal("0.01"))
                gst_amt = self._get_decimal(row, col_map.get("gst_amt"), quantize_exp=self.config.currency_quantize_exp)
                prn_amt = self._get_decimal(row, col_map.get("printed_amt"), quantize_exp=self.config.currency_quantize_exp)
                calc_amt = self._get_decimal(row, col_map.get("calc_amt"), quantize_exp=self.config.currency_quantize_exp)

                status_raw = self._get_str(row, col_map.get("status")) or "VERIFIED"
                valid_statuses = ("VERIFIED", "WARNING", "MISMATCH", "INVALID", "NEEDS_REVIEW", "INSUFFICIENT_DATA", "REVIEW_REQUIRED")
                val_status: ValidationStatusType = status_raw if status_raw in valid_statuses else "VERIFIED"

                item_id = f"item_xl_{r_idx}"

                item = ExtractedInvoiceItem(
                    item_id=item_id,
                    raw_product_name=raw_name,
                    normalized_product_name=norm_name,
                    brand=brand,
                    category=category,
                    hsn_code=hsn,
                    package_size=pkg_size,
                    quantity=qty,
                    raw_quantity=raw_qty,
                    unit=unit,
                    raw_unit=unit,
                    purchase_price=p_price,
                    selling_price=s_price,
                    mrp=mrp,
                    discount=discount,
                    gst_rate=gst_pct,
                    tax_amount=gst_amt,
                    printed_amount=prn_amt,
                    calculated_amount=calc_amt,
                    rounding_difference=(prn_amt - calc_amt) if prn_amt is not None and calc_amt is not None else None,
                    validation_status=val_status,
                    ocr_confidence=100.0,
                    name_confidence=100.0,
                    brand_confidence=100.0 if brand else 0.0,
                    package_size_confidence=100.0 if pkg_size else 0.0,
                    category_confidence=90.0,
                    extraction_confidence=100.0,
                    source_page=1,
                    source_row_index=r_idx,
                    raw_row_text=raw_name,
                )
                items.append(item)

            meta = InvoiceProcessingMetadata(
                filename=source_desc,
                file_size_bytes=byte_size,
                mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                document_type="excel",
                engine_name="openpyxl_parser",
                pipeline_stages_completed=["excel_parsing"],
            )

            invoice = ExtractedInvoice(
                invoice_id=f"inv_xl_{source_desc}",
                original_filename=source_desc,
                status="SUCCESS" if items else "NEEDS_REVIEW",
                items=items,
                total_items_count=len(items),
                metadata=meta,
            )

            logger.info("Successfully parsed genuine XLSX: extracted %d items", len(items))
            return invoice

        except Exception as exc:
            logger.error("Failed to parse XLSX workbook: %s", exc)
            raise ExcelParsingError(f"Workbook parsing failed: {exc}", details={"error": str(exc)})

    def _map_header_columns(self, headers: List[str]) -> Dict[str, int]:
        """Maps column roles by header text strings."""
        mapping: Dict[str, int] = {}
        for idx, h in enumerate(headers):
            h_clean = h.lower()
            if "original product" in h_clean or ("product" in h_clean and "raw" in h_clean):
                mapping["raw_name"] = idx
            elif "normalized product" in h_clean or "standard name" in h_clean:
                mapping["norm_name"] = idx
            elif "brand" in h_clean:
                mapping["brand"] = idx
            elif "category" in h_clean:
                mapping["category"] = idx
            elif "hsn" in h_clean:
                mapping["hsn"] = idx
            elif "package size" in h_clean or "pack size" in h_clean:
                mapping["pkg_size"] = idx
            elif "qty" in h_clean or "quantity" in h_clean:
                mapping["qty"] = idx
            elif "unit" in h_clean or "uom" in h_clean:
                mapping["unit"] = idx
            elif "purchase" in h_clean or "rate" in h_clean or ("price" in h_clean and "sell" not in h_clean and "mrp" not in h_clean):
                if "purchase_price" not in mapping:
                    mapping["purchase_price"] = idx
            elif "selling" in h_clean:
                mapping["selling_price"] = idx
            elif "mrp" in h_clean:
                mapping["mrp"] = idx
            elif "discount" in h_clean or "disc" in h_clean:
                mapping["discount"] = idx
            elif "gst percentage" in h_clean or "gst %" in h_clean or "tax %" in h_clean:
                mapping["gst_pct"] = idx
            elif "gst amount" in h_clean or ("tax" in h_clean and "amount" in h_clean):
                mapping["gst_amt"] = idx
            elif "printed amount" in h_clean or "line total" in h_clean or "amount" in h_clean:
                if "printed_amt" not in mapping:
                    mapping["printed_amt"] = idx
            elif "calculated amount" in h_clean:
                mapping["calc_amt"] = idx
            elif "status" in h_clean:
                mapping["status"] = idx

        # Positional fallbacks for standard 18-column Grocery Items sheet
        if "raw_name" not in mapping and len(headers) > 1:
            mapping["raw_name"] = 1
        if "norm_name" not in mapping and len(headers) > 2:
            mapping["norm_name"] = 2
        if "brand" not in mapping and len(headers) > 3:
            mapping["brand"] = 3
        if "category" not in mapping and len(headers) > 4:
            mapping["category"] = 4
        if "hsn" not in mapping and len(headers) > 5:
            mapping["hsn"] = 5
        if "pkg_size" not in mapping and len(headers) > 6:
            mapping["pkg_size"] = 6
        if "qty" not in mapping and len(headers) > 7:
            mapping["qty"] = 7
        if "unit" not in mapping and len(headers) > 8:
            mapping["unit"] = 8
        if "purchase_price" not in mapping and len(headers) > 9:
            mapping["purchase_price"] = 9
        if "selling_price" not in mapping and len(headers) > 10:
            mapping["selling_price"] = 10
        if "mrp" not in mapping and len(headers) > 11:
            mapping["mrp"] = 11
        if "discount" not in mapping and len(headers) > 12:
            mapping["discount"] = 12
        if "gst_pct" not in mapping and len(headers) > 13:
            mapping["gst_pct"] = 13
        if "gst_amt" not in mapping and len(headers) > 14:
            mapping["gst_amt"] = 14
        if "printed_amt" not in mapping and len(headers) > 15:
            mapping["printed_amt"] = 15
        if "calc_amt" not in mapping and len(headers) > 16:
            mapping["calc_amt"] = 16
        if "status" not in mapping and len(headers) > 17:
            mapping["status"] = 17

        return mapping

    def _get_str(self, row: Any, col_idx: Optional[int]) -> Optional[str]:
        if col_idx is None or col_idx >= len(row):
            return None
        val = row[col_idx]
        if val is None or val == "":
            return None
        return str(val).strip()

    def _get_decimal(
        self,
        row: Any,
        col_idx: Optional[int],
        quantize_exp: Optional[Decimal] = None
    ) -> Optional[Decimal]:
        if col_idx is None or col_idx >= len(row):
            return None
        val = row[col_idx]
        if val is None or val == "":
            return None
        try:
            d = Decimal(str(val))
            if quantize_exp:
                d = d.quantize(quantize_exp)
            return d
        except (InvalidOperation, ValueError):
            return None
