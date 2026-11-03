"""
V-Model Test Suite for Phase 7: Excel-First Invoice Processing.
Validates:
  A. Real XLSX Workbook Generation (openpyxl zip magic bytes)
  B. Real Workbook Disk Saving & Reopening
  C. Actual Excel Cell Parsing (not reusing in-memory instances)
  D. Numeric Cell Types ('n' for financial/quantities, not text)
  E. Decimal Precision Preservation (1378.62, 0.500, 2760.00)
  F. Missing Values Preservation (remain None, never zero)
  G. Multiple Invoice Items & Zero Row-Shifting
  H. Review Required Worksheet Integrity
  I. Four Mandatory Worksheets Structure (Raw, Grocery, Review, Audit)
  J. Regression Test Fixtures (TEST A, TEST B, TEST C)
  K. Corrupted & Invalid Workbook Handling
  L. Secure Storage Manager & Download Retrieval
  M. End-to-End Excel-First Pipeline Execution
  N. Integrity Report Verification & Benchmarking
"""

import io
import os
import tempfile
from decimal import Decimal
from typing import List
import openpyxl
import pytest

from services.grocery_ocr.config import GroceryOCRConfig
from services.grocery_ocr.excel.integrity_validator import (
    ExcelIntegrityReport,
    ExcelIntegrityValidator,
)
from services.grocery_ocr.excel.storage_manager import (
    WorkbookStorageManager,
)
from services.grocery_ocr.excel.workbook_generator import (
    BaseWorkbookGenerator,
    SHEET_GROCERY_ITEMS,
    SHEET_OCR_AUDIT,
    SHEET_RAW_INVOICE,
    SHEET_REVIEW_REQUIRED,
)
from services.grocery_ocr.excel.workbook_parser import (
    BaseWorkbookParser,
)
from services.grocery_ocr.exceptions import (
    ExcelGenerationError,
    ExcelParsingError,
)
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
from services.grocery_ocr.schemas.invoice import (
    ExtractedInvoice,
    InvoiceProcessingMetadata,
)
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    PackageSize,
)


@pytest.fixture
def storage_dir(tmp_path):
    d = tmp_path / "invoices_test"
    d.mkdir()
    return str(d)


@pytest.fixture
def storage_mgr(storage_dir):
    return WorkbookStorageManager(base_dir=storage_dir)


@pytest.fixture
def generator():
    return BaseWorkbookGenerator()


@pytest.fixture
def parser():
    return BaseWorkbookParser()


@pytest.fixture
def integrity_val():
    return ExcelIntegrityValidator()


@pytest.fixture
def sample_invoice():
    """Builds a realistic 3-item invoice containing Tests A, B, and C."""
    item_a = ExtractedInvoiceItem(
        item_id="item_a_chana",
        raw_product_name="CHANA 50 KG",
        normalized_product_name="Chana",
        package_size=PackageSize(value=Decimal("50"), unit="kg", raw_text="50 KG"),
        quantity=Decimal("1.000"),
        unit="BOR",
        purchase_price=Decimal("2760.00"),
        mrp=Decimal("3200.00"),
        printed_amount=Decimal("2760.00"),
        calculated_amount=Decimal("2760.00"),
        validation_status="VERIFIED",
    )

    item_b = ExtractedInvoiceItem(
        item_id="item_b_besan",
        raw_product_name="FORTUNE BESAN 500 GM",
        normalized_product_name="Fortune Besan",
        brand="Fortune",
        category="Besan",
        package_size=PackageSize(value=Decimal("500"), unit="g", raw_text="500 GM"),
        quantity=Decimal("10.000"),
        unit="PCS",
        purchase_price=Decimal("70.00"),
        mrp=Decimal("90.00"),
        printed_amount=Decimal("700.00"),
        calculated_amount=Decimal("700.00"),
        validation_status="VERIFIED",
    )

    item_c = ExtractedInvoiceItem(
        item_id="item_c_oil",
        raw_product_name="FORTUNE OIL 1 KG",
        normalized_product_name="Fortune Oil",
        brand="Fortune",
        category="Cooking oils",
        package_size=PackageSize(value=Decimal("1"), unit="kg", raw_text="1 KG"),
        quantity=Decimal("10.000"),
        unit="PCS",
        purchase_price=Decimal("1378.62"),
        mrp=Decimal("1680.00"),
        printed_amount=Decimal("4015.80"),  # arithmetic discrepancy preserved!
        calculated_amount=Decimal("13786.20"),
        rounding_difference=Decimal("-9770.40"),
        validation_status="MISMATCH",
        validation_issues=["Arithmetic mismatch: expected ₹13786.20, but invoice printed ₹4015.80"],
        review_status="REVIEW_REQUIRED",
    )

    meta = InvoiceProcessingMetadata(
        filename="sample_grocery_invoice.pdf",
        file_size_bytes=10240,
        mime_type="application/pdf",
        document_type="pdf",
        engine_name="TesseractOCR",
        pipeline_stages_completed=["file_validation", "ocr", "table_reconstruction", "invoice_validation"],
    )

    return ExtractedInvoice(
        invoice_id="inv_phase7_test_001",
        original_filename="sample_grocery_invoice.pdf",
        status="NEEDS_REVIEW",
        items=[item_a, item_b, item_c],
        total_items_count=3,
        printed_total=Decimal("7475.80"),
        calculated_total=Decimal("17246.20"),
        metadata=meta,
    )


# --------------------------------------------------------------------------
# Test A: Real XLSX Generation & Magic Bytes
# --------------------------------------------------------------------------

def test_scenario_a_real_xlsx_generation(generator, sample_invoice):
    """Verifies generated output is genuine XLSX (starts with PK zip magic header)."""
    wb_bytes = generator.generate(sample_invoice)
    assert isinstance(wb_bytes, bytes)
    assert len(wb_bytes) > 2000
    # ZIP magic header: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
    assert wb_bytes[:4] == b"PK\x03\x04"


# --------------------------------------------------------------------------
# Test B: Four Mandatory Worksheets
# --------------------------------------------------------------------------

def test_scenario_b_four_mandatory_worksheets(generator, sample_invoice):
    """Ensures all 4 mandatory worksheets exist with exact required titles."""
    wb_bytes = generator.generate(sample_invoice)
    wb = openpyxl.load_workbook(io.BytesIO(wb_bytes), data_only=True)

    sheet_names = wb.sheetnames
    assert SHEET_RAW_INVOICE in sheet_names
    assert SHEET_GROCERY_ITEMS in sheet_names
    assert SHEET_REVIEW_REQUIRED in sheet_names
    assert SHEET_OCR_AUDIT in sheet_names

    # Grocery Items is the active sheet
    assert wb.active.title == SHEET_GROCERY_ITEMS


# --------------------------------------------------------------------------
# Test C: Numeric Cell Types & Formats
# --------------------------------------------------------------------------

def test_scenario_c_numeric_cell_types(generator, sample_invoice):
    """
    CRITICAL RULE:
    Financial and quantity cells must be numeric ('n'), NOT string text ('s').
    Missing values must be None (empty cell), NEVER zero!
    """
    wb_bytes = generator.generate(sample_invoice)
    wb = openpyxl.load_workbook(io.BytesIO(wb_bytes), data_only=False)
    ws = wb[SHEET_GROCERY_ITEMS]

    # Row 2 is Item A (Chana 50kg)
    # Col 8 is Quantity (1.0), Col 10 is Purchase Price (2760.00), Col 12 is MRP (3200.00)
    qty_cell = ws.cell(row=2, column=8)
    rate_cell = ws.cell(row=2, column=10)
    mrp_cell = ws.cell(row=2, column=12)
    amount_cell = ws.cell(row=2, column=16)

    assert qty_cell.data_type == "n"
    assert qty_cell.value == 1.0

    assert rate_cell.data_type == "n"
    assert rate_cell.value == 2760.00
    assert rate_cell.number_format == "#,##0.00"

    assert mrp_cell.data_type == "n"
    assert mrp_cell.value == 3200.00

    assert amount_cell.data_type == "n"
    assert amount_cell.value == 2760.00


# --------------------------------------------------------------------------
# Test D: Missing Values Remain Blank / None (Never Zero)
# --------------------------------------------------------------------------

def test_scenario_d_missing_values_remain_none(generator, parser):
    """An item with missing MRP and selling price must have empty cells in Excel and None in parsed model."""
    item_no_mrp = ExtractedInvoiceItem(
        item_id="item_loose",
        raw_product_name="Loose Rice",
        quantity=Decimal("5.000"),
        unit="BAG",
        purchase_price=Decimal("1200.00"),
        selling_price=None,  # Missing
        mrp=None,            # Missing
        printed_amount=Decimal("6000.00"),
        validation_status="VERIFIED",
    )

    inv = ExtractedInvoice(
        invoice_id="inv_test_none",
        original_filename="test.pdf",
        items=[item_no_mrp],
        total_items_count=1,
        metadata=InvoiceProcessingMetadata(filename="test.pdf"),
    )

    wb_bytes = generator.generate(inv)
    wb = openpyxl.load_workbook(io.BytesIO(wb_bytes), data_only=False)
    ws = wb[SHEET_GROCERY_ITEMS]

    # Selling price is Col 11, MRP is Col 12
    cell_sell = ws.cell(row=2, column=11)
    cell_mrp = ws.cell(row=2, column=12)

    assert cell_sell.value is None  # MUST be empty
    assert cell_sell.value != 0     # MUST NOT BE ZERO
    assert cell_mrp.value is None
    assert cell_mrp.value != 0

    # Parse back
    reparsed = parser.parse(wb_bytes)
    re_item = reparsed.items[0]
    assert re_item.selling_price is None
    assert re_item.mrp is None


# --------------------------------------------------------------------------
# Test E: Workbook Saving, Reopening and Cell Parsing Round-Trip
# --------------------------------------------------------------------------

def test_scenario_e_save_reopen_parse_roundtrip(storage_mgr, generator, parser, sample_invoice):
    """
    Mandatory Phase 7 flow:
    Save real file -> Reopen from disk path -> Parse actual cells.
    """
    wb_bytes = generator.generate(sample_invoice)

    # 1. Save to actual disk path
    saved_path = storage_mgr.save_workbook(wb_bytes, sample_invoice.invoice_id)
    assert os.path.exists(saved_path)
    assert os.path.getsize(saved_path) > 2000

    # 2. Reopen and parse actual file from disk
    parsed_inv = parser.parse(saved_path)
    assert len(parsed_inv.items) == 3

    # Clean up test file
    storage_mgr.delete_workbook(saved_path)
    assert not os.path.exists(saved_path)


# --------------------------------------------------------------------------
# Test F: Regression Fixtures (TEST A, TEST B, TEST C Preservation)
# --------------------------------------------------------------------------

def test_scenario_f_regression_test_a_b_c_preservation(generator, parser, sample_invoice):
    """
    Verifies that Tests A, B, and C survive Excel generation and parsing with 100% fidelity:
    - TEST A: CHANA 50 KG | 1 BOR | Rate: 2760.00 | MRP: 3200.00 | Amount: 2760.00
    - TEST B: FORTUNE BESAN 500 GM | 10 PCS | Rate: 70.00 | MRP: 90.00 | Amount: 700.00
    - TEST C: FORTUNE OIL 1 KG | 10 PCS | Rate: 1378.62 | MRP: 1680.00 | Amount: 4015.80
    """
    wb_bytes = generator.generate(sample_invoice)
    reparsed = parser.parse(wb_bytes)

    # TEST A
    it_a = reparsed.items[0]
    assert it_a.raw_product_name == "CHANA 50 KG"
    assert it_a.package_size is not None
    assert it_a.package_size.value == Decimal("50")
    assert it_a.package_size.unit == "kg"
    assert it_a.quantity == Decimal("1.000")
    assert it_a.unit == "BOR"
    assert it_a.purchase_price == Decimal("2760.00")
    assert it_a.mrp == Decimal("3200.00")
    assert it_a.printed_amount == Decimal("2760.00")
    assert it_a.calculated_amount == Decimal("2760.00")
    assert it_a.validation_status == "VERIFIED"

    # TEST B
    it_b = reparsed.items[1]
    assert it_b.raw_product_name == "FORTUNE BESAN 500 GM"
    assert it_b.brand == "Fortune"
    assert it_b.category == "Besan"
    assert it_b.package_size.value == Decimal("500")
    assert it_b.package_size.unit == "g"
    assert it_b.quantity == Decimal("10.000")
    assert it_b.unit == "PCS"
    assert it_b.purchase_price == Decimal("70.00")
    assert it_b.mrp == Decimal("90.00")
    assert it_b.printed_amount == Decimal("700.00")
    assert it_b.calculated_amount == Decimal("700.00")
    assert it_b.validation_status == "VERIFIED"

    # TEST C (Critical Discrepancy Preservation)
    it_c = reparsed.items[2]
    assert it_c.raw_product_name == "FORTUNE OIL 1 KG"
    assert it_c.quantity == Decimal("10.000")
    assert it_c.unit == "PCS"
    assert it_c.purchase_price == Decimal("1378.62")
    assert it_c.mrp == Decimal("1680.00")
    # Printed amount must be strictly 4015.80, NOT overwritten by calculated 13786.20!
    assert it_c.printed_amount == Decimal("4015.80")
    assert it_c.calculated_amount == Decimal("13786.20")
    assert it_c.validation_status == "MISMATCH"


# --------------------------------------------------------------------------
# Test G: Integrity Validator
# --------------------------------------------------------------------------

def test_scenario_g_integrity_validator_detects_100_percent_match(generator, parser, integrity_val, sample_invoice):
    """Integrity validator confirms 100% fidelity between pre-Excel and post-Excel datasets."""
    wb_bytes = generator.generate(sample_invoice)
    reparsed = parser.parse(wb_bytes)

    report = integrity_val.validate_integrity(pre_invoice=sample_invoice, post_invoice=reparsed)

    assert report.is_intact is True
    assert report.pre_excel_item_count == 3
    assert report.post_excel_item_count == 3
    assert report.row_count_matched is True
    assert report.missing_fields_preserved is True
    assert report.mismatches_count == 0
    assert "100% data integrity" in report.summary


# --------------------------------------------------------------------------
# Test H: Review Required Worksheet Contents
# --------------------------------------------------------------------------

def test_scenario_h_review_required_worksheet_populated(generator, sample_invoice):
    """Ensures Item C (MISMATCH / REVIEW_REQUIRED) is listed on Sheet 3."""
    wb_bytes = generator.generate(sample_invoice)
    wb = openpyxl.load_workbook(io.BytesIO(wb_bytes), data_only=True)
    ws_rev = wb[SHEET_REVIEW_REQUIRED]

    # Row 1 is header. Row 2 should contain Fortune Oil 1kg
    assert ws_rev.max_row >= 2
    row_val = [c for c in ws_rev.iter_rows(values_only=True)][1]
    assert row_val[0] == "FORTUNE OIL 1 KG"
    assert "Arithmetic mismatch" in str(row_val[5]) or "discrepancy" in str(row_val[5])


# --------------------------------------------------------------------------
# Test I: Corrupted and Invalid Workbook Error Handling
# --------------------------------------------------------------------------

def test_scenario_i_corrupted_workbook_handling(parser):
    """Malformed or invalid bytes raise clean ExcelParsingError."""
    with pytest.raises(ExcelParsingError):
        parser.parse(b"NOT_A_VALID_EXCEL_FILE")

    with pytest.raises(ExcelParsingError):
        # Empty workbook
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "EmptySheet"
        buf = io.BytesIO()
        wb.save(buf)
        parser.parse(buf.getvalue())


# --------------------------------------------------------------------------
# Test J: Security Path Traversal Protection
# --------------------------------------------------------------------------

def test_scenario_j_storage_path_traversal_protection(storage_mgr):
    """Guarantees that malicious path traversal filenames cannot escape storage directory."""
    traversal_id = "../../etc/passwd"
    filename = storage_mgr.generate_filename(traversal_id)
    assert ".." not in filename
    assert "/" not in filename
    assert "\\" not in filename


# --------------------------------------------------------------------------
# Test K: End-to-End Excel-First Pipeline Execution
# --------------------------------------------------------------------------

def test_scenario_k_end_to_end_excel_first_pipeline():
    """
    Tests complete InvoicePipeline execution:
    Reconstructs table -> Validates -> Generates XLSX -> Saves to disk ->
    Reopens actual file -> Parses actual cells -> Returns Excel-derived invoice.
    """
    from PIL import Image
    from services.grocery_ocr.engines.ocr_engine import MockOCREngine
    from services.grocery_ocr.schemas.ocr import BoundingBox, OCRLine, OCRPageResult, OCRWord

    # Generate a genuine PNG image in memory
    img = Image.new("RGB", (800, 600), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    valid_png_bytes = buf.getvalue()

    # Create synthetic OCR words for a table
    header_words = [
        OCRWord(text="ITEM", confidence=99.0, bbox=BoundingBox(x0=50, y0=50, x1=150, y1=70)),
        OCRWord(text="QTY", confidence=99.0, bbox=BoundingBox(x0=200, y0=50, x1=250, y1=70)),
        OCRWord(text="UNIT", confidence=99.0, bbox=BoundingBox(x0=300, y0=50, x1=350, y1=70)),
        OCRWord(text="RATE", confidence=99.0, bbox=BoundingBox(x0=400, y0=50, x1=460, y1=70)),
        OCRWord(text="AMOUNT", confidence=99.0, bbox=BoundingBox(x0=500, y0=50, x1=580, y1=70)),
    ]
    data_words = [
        OCRWord(text="CHANA 50 KG", confidence=98.0, bbox=BoundingBox(x0=50, y0=100, x1=180, y1=120)),
        OCRWord(text="1", confidence=98.0, bbox=BoundingBox(x0=200, y0=100, x1=230, y1=120)),
        OCRWord(text="BOR", confidence=98.0, bbox=BoundingBox(x0=300, y0=100, x1=340, y1=120)),
        OCRWord(text="2760.00", confidence=98.0, bbox=BoundingBox(x0=400, y0=100, x1=470, y1=120)),
        OCRWord(text="2760.00", confidence=98.0, bbox=BoundingBox(x0=500, y0=100, x1=570, y1=120)),
    ]

    mock_page = OCRPageResult(
        page_number=1,
        width=800,
        height=600,
        dpi=300,
        confidence=98.5,
        words=header_words + data_words,
        lines=[
            OCRLine(
                line_number=1,
                text="ITEM QTY UNIT RATE AMOUNT",
                confidence=99.0,
                words=header_words,
                bbox=BoundingBox(x0=50, y0=50, x1=580, y1=70),
            ),
            OCRLine(
                line_number=2,
                text="CHANA 50 KG 1 BOR 2760.00 2760.00",
                confidence=98.0,
                words=data_words,
                bbox=BoundingBox(x0=50, y0=100, x1=570, y1=120),
            ),
        ],
    )

    mock_engine = MockOCREngine(predefined_result=mock_page)
    pipeline = InvoicePipeline(ocr_engine=mock_engine)
    result = pipeline.process(valid_png_bytes, "test_grocery_invoice.png")

    assert result is not None
    # 1. Pipeline stages completed include Excel-first flow
    stages = result.metadata.pipeline_stages_completed
    assert "table_and_column_detection" in stages
    assert "invoice_validation" in stages
    assert "workbook_generation" in stages
    assert "workbook_parsing" in stages
    assert "integrity_validation" in stages

    # 2. Custom properties contain genuine saved file path and integrity report
    props = result.metadata.custom_properties
    assert "xlsx_file_path" in props
    saved_path = props["xlsx_file_path"]
    assert os.path.exists(saved_path)
    assert os.path.getsize(saved_path) > 2000

    assert "excel_integrity_report" in props
    integrity_rep = props["excel_integrity_report"]
    assert integrity_rep["is_intact"] is True
    assert integrity_rep["post_excel_item_count"] == 1

    # 3. Downstream extracted items are parsed directly from Excel cells
    assert len(result.items) == 1
    it = result.items[0]
    assert it.raw_product_name == "CHANA 50 KG"
    assert it.quantity == Decimal("1.000")
    assert it.unit == "BOR"
    assert it.purchase_price == Decimal("2760.00")
    assert it.printed_amount == Decimal("2760.00")
    assert it.calculated_amount == Decimal("2760.00")
    assert it.validation_status == "VERIFIED"

    # Clean up temporary file
    if os.path.exists(saved_path):
        os.remove(saved_path)
