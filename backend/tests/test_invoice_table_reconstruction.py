"""
Comprehensive V-Model test suite for Phase 4: Advanced Invoice Table Reconstruction.
Tests layout scenarios A through L:
A. Simple invoice tables
B. Different column arrangements
C. Missing headers (Headerless tables)
D. Missing MRP
E. Multi-line product descriptions
F. Variable row heights
G. Borderless tables
H. Blurry / low-confidence invoices
I. Multi-page invoices & repeated headers
J. Closely spaced numeric columns
K. Additional tax columns
L. Misaligned OCR words
Plus regression tests and accuracy measurements.
"""

from decimal import Decimal
import io
import re
from typing import List, Tuple
from PIL import Image
import pytest

from services.grocery_ocr.config import GroceryOCRConfig
from services.grocery_ocr.extraction.column_detector import BaseColumnDetector
from services.grocery_ocr.extraction.header_recognizer import HeaderRecognizer
from services.grocery_ocr.extraction.table_detector import TableDetector
from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
from services.grocery_ocr.processors.pdf_processor import BasePDFProcessor
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRDocumentResult, OCRLine, OCRPageResult, OCRWord
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableReconstructionResult,
    TableRow,
    TableResult,
)
from services.grocery_ocr.visualization.table_visualizer import TableVisualizer


# --------------------------------------------------------------------------
# Helpers & Synthetic Generators
# --------------------------------------------------------------------------

def create_word(text: str, x0: float, y0: float, x1: float, y1: float, conf: float = 98.0, page: int = 1) -> OCRWord:
    """Helper to create an OCRWord with given coordinates."""
    return OCRWord(
        text=text,
        bbox=BoundingBox(x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1)),
        confidence=conf,
        page_number=page,
    )


# --------------------------------------------------------------------------
# Test A: Simple Invoice Table
# --------------------------------------------------------------------------

def test_scenario_a_simple_invoice_table():
    """Validates simple clean table with Item, Qty, Rate, MRP, Total."""
    words = [
        # Header (y=50)
        create_word("Item", 50, 50, 100, 70),
        create_word("Description", 105, 50, 220, 70),
        create_word("Qty", 300, 50, 340, 70),
        create_word("Rate", 400, 50, 450, 70),
        create_word("MRP", 500, 50, 550, 70),
        create_word("Amount", 600, 50, 670, 70),
        # Row 1 (y=100)
        create_word("Tata", 50, 100, 90, 120),
        create_word("Salt", 95, 100, 135, 120),
        create_word("1kg", 140, 100, 180, 120),
        create_word("20", 300, 100, 325, 120),
        create_word("22.00", 400, 100, 445, 120),
        create_word("28.00", 500, 100, 545, 120),
        create_word("440.00", 600, 100, 655, 120),
        # Row 2 (y=130)
        create_word("Maggi", 50, 130, 100, 150),
        create_word("Noodles", 105, 130, 170, 150),
        create_word("48", 300, 130, 325, 150),
        create_word("11.00", 400, 130, 445, 150),
        create_word("14.00", 500, 130, 545, 150),
        create_word("528.00", 600, 130, 655, 150),
        # Footer / Total (y=170)
        create_word("Total", 500, 170, 550, 190),
        create_word("968.00", 600, 170, 655, 190),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.has_table is True
    assert table.table_boundaries is not None
    assert len(table.reconstructed_rows) == 2, "Expected exactly 2 product rows (summary excluded)"

    # Verify column roles
    roles = [c.role for c in table.columns]
    assert "product" in roles
    assert "qty" in roles
    assert "rate" in roles
    assert "mrp" in roles
    assert "total" in roles

    # Verify cell values for row 1
    row1 = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row1.cells}
    assert cell_dict["product"] == "Tata Salt 1kg"
    assert cell_dict["qty"] == "20"
    assert cell_dict["rate"] == "22.00"
    assert cell_dict["mrp"] == "28.00"
    assert cell_dict["total"] == "440.00"


# --------------------------------------------------------------------------
# Test B: Different Column Arrangements
# --------------------------------------------------------------------------

def test_scenario_b_different_column_arrangements():
    """Validates unusual column order: Qty -> Description -> Total -> Rate."""
    words = [
        # Header (y=40)
        create_word("Qty", 50, 40, 90, 60),
        create_word("Particulars", 150, 40, 260, 60),
        create_word("Total", 400, 40, 460, 60),
        create_word("Unit Price", 550, 40, 640, 60),
        # Data Row (y=80)
        create_word("10", 50, 80, 75, 100),
        create_word("Sugar 1kg", 150, 80, 230, 100),
        create_word("420.00", 400, 80, 455, 100),
        create_word("42.00", 550, 80, 595, 100),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.has_table is True
    col_roles = [c.role for c in table.columns]
    assert col_roles == ["qty", "product", "total", "rate"]

    row = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row.cells}
    assert cell_dict["qty"] == "10"
    assert cell_dict["product"] == "Sugar 1kg"
    assert cell_dict["total"] == "420.00"
    assert cell_dict["rate"] == "42.00"


# --------------------------------------------------------------------------
# Test C: Missing Headers (Headerless Table)
# --------------------------------------------------------------------------

def test_scenario_c_missing_headers_grid():
    """Validates table with no printed headers, structured purely as coordinate grid."""
    words = [
        # Data Row 1 (y=100)
        create_word("1", 40, 100, 55, 120),
        create_word("Atta 5kg", 100, 100, 180, 120),
        create_word("2", 300, 100, 315, 120),
        create_word("245.00", 400, 100, 450, 120),
        # Data Row 2 (y=130)
        create_word("2", 40, 130, 55, 150),
        create_word("Salt 1kg", 100, 130, 180, 150),
        create_word("10", 300, 130, 320, 150),
        create_word("22.00", 400, 130, 445, 150),
        # Data Row 3 (y=160)
        create_word("3", 40, 160, 55, 180),
        create_word("Oil 1L", 100, 160, 160, 180),
        create_word("5", 300, 160, 315, 180),
        create_word("140.00", 400, 160, 450, 180),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.has_table is True
    assert table.header_row_index is None
    assert len(table.rows) == 3


# --------------------------------------------------------------------------
# Test D: Missing MRP Column
# --------------------------------------------------------------------------

def test_scenario_d_missing_mrp_does_not_shift_rates():
    """Validates that missing MRP column keeps MRP as None, never moving Rate into MRP."""
    words = [
        # Header
        create_word("Item", 50, 50, 90, 70),
        create_word("Qty", 250, 50, 280, 70),
        create_word("Rate", 380, 50, 420, 70),
        create_word("Amount", 520, 50, 580, 70),
        # Data Row
        create_word("Tata Salt 1kg", 50, 100, 160, 120),
        create_word("20", 250, 100, 275, 120),
        create_word("22.00", 380, 100, 425, 120),
        create_word("440.00", 520, 100, 575, 120),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    roles = [c.role for c in table.columns]
    assert "mrp" not in roles
    assert "rate" in roles
    assert "total" in roles

    row = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row.cells}
    assert cell_dict["rate"] == "22.00"
    assert "mrp" not in cell_dict


# --------------------------------------------------------------------------
# Test E: Multi-line Product Descriptions
# --------------------------------------------------------------------------

def test_scenario_e_multiline_description_merging():
    """
    Validates continuation line detection:
    Line 1: FORTUNE
    Line 2: BESAN
    Line 3: 500 GM with Qty 10, Rate 45.00, Total 450.00
    Must be consolidated into single description 'FORTUNE BESAN 500 GM'.
    Separate product below with its own Qty must NOT be merged.
    """
    words = [
        # Header (y=50)
        create_word("Description", 50, 50, 150, 70),
        create_word("Qty", 300, 50, 330, 70),
        create_word("Rate", 420, 50, 460, 70),
        create_word("Amount", 550, 50, 610, 70),
        # Product 1, Line 1 (y=90)
        create_word("FORTUNE", 50, 90, 130, 110),
        create_word("10", 300, 90, 320, 110),
        create_word("45.00", 420, 90, 465, 110),
        create_word("450.00", 550, 90, 605, 110),
        # Product 1, Continuation Line 2 (y=115) - within continuation tolerance
        create_word("BESAN", 50, 115, 110, 135),
        # Product 1, Continuation Line 3 (y=140)
        create_word("500 GM", 50, 140, 120, 160),
        # Product 2, Independent Product (y=180) - has its own numeric values
        create_word("Aashirvaad Atta", 50, 180, 180, 200),
        create_word("2", 300, 180, 315, 200),
        create_word("245.00", 420, 180, 470, 200),
        create_word("490.00", 550, 180, 605, 200),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert len(table.reconstructed_rows) == 2, "Expected 2 product rows after continuation consolidation"

    p1 = table.reconstructed_rows[0]
    assert "FORTUNE" in p1.reconstructed_description
    assert "BESAN" in p1.reconstructed_description
    assert "500 GM" in p1.reconstructed_description
    assert len(p1.original_lines) == 3, "Original lines must be preserved in p1.original_lines"

    p2 = table.reconstructed_rows[1]
    assert "Aashirvaad Atta" in p2.reconstructed_description
    assert "BESAN" not in p2.reconstructed_description


# --------------------------------------------------------------------------
# Test F: Variable Row Heights
# --------------------------------------------------------------------------

def test_scenario_f_variable_row_heights():
    """Validates rows with different font sizes / heights (10px, 20px, 14px)."""
    words = [
        # Header (h=14)
        create_word("Item", 50, 40, 90, 54),
        create_word("Qty", 200, 40, 230, 54),
        create_word("Amount", 350, 40, 410, 54),
        # Row 1 (small text: h=9)
        create_word("Small Item", 50, 80, 130, 89),
        create_word("1", 200, 80, 210, 89),
        create_word("10.00", 350, 80, 390, 89),
        # Row 2 (large text: h=22)
        create_word("Big Brand Salt", 50, 110, 180, 132),
        create_word("5", 200, 110, 215, 132),
        create_word("110.00", 350, 110, 405, 132),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert len(table.reconstructed_rows) == 2


# --------------------------------------------------------------------------
# Test G: Borderless Tables
# --------------------------------------------------------------------------

def test_scenario_g_borderless_table():
    """Validates table with zero border lines, purely coordinate aligned."""
    words = [
        create_word("Description", 80, 60, 180, 80),
        create_word("Qty", 320, 60, 350, 80),
        create_word("Price", 450, 60, 490, 80),
        create_word("Total", 580, 60, 620, 80),
        # Row 1
        create_word("Sunfeast Yippee", 80, 110, 200, 130),
        create_word("12", 320, 110, 340, 130),
        create_word("12.00", 450, 110, 490, 130),
        create_word("144.00", 580, 110, 630, 130),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.has_table is True
    assert len(table.reconstructed_rows) == 1
    assert table.reconstructed_rows[0].cells[0].cleaned_text == "Sunfeast Yippee"


# --------------------------------------------------------------------------
# Test H: Blurry Invoices / Low Confidence
# --------------------------------------------------------------------------

def test_scenario_h_low_confidence_marks_review_required():
    """Validates that low OCR confidence triggers REVIEW_REQUIRED."""
    words = [
        create_word("Item", 50, 50, 90, 70, conf=45.0),
        create_word("Qty", 200, 50, 230, 70, conf=40.0),
        create_word("Amount", 350, 50, 410, 70, conf=50.0),
        create_word("Blurry Tea", 50, 100, 130, 120, conf=35.0),
        create_word("1", 200, 100, 210, 120, conf=40.0),
        create_word("50.00", 350, 100, 390, 120, conf=45.0),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words, confidence=42.5)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.review_status == "REVIEW_REQUIRED"


# --------------------------------------------------------------------------
# Test I: Multi-Page Invoices & Repeated Headers
# --------------------------------------------------------------------------

def test_scenario_i_multi_page_repeated_headers():
    """Validates repeated headers on Page 2 are detected and not treated as product rows."""
    p1_words = [
        create_word("Item", 50, 50, 90, 70, page=1),
        create_word("Qty", 200, 50, 230, 70, page=1),
        create_word("Amount", 350, 50, 410, 70, page=1),
        create_word("Product Page 1", 50, 100, 160, 120, page=1),
        create_word("5", 200, 100, 215, 120, page=1),
        create_word("100.00", 350, 100, 400, 120, page=1),
    ]
    p2_words = [
        # Repeated Header on Page 2
        create_word("Item", 50, 50, 90, 70, page=2),
        create_word("Qty", 200, 50, 230, 70, page=2),
        create_word("Amount", 350, 50, 410, 70, page=2),
        create_word("Product Page 2", 50, 100, 160, 120, page=2),
        create_word("10", 200, 100, 220, 120, page=2),
        create_word("200.00", 350, 100, 400, 120, page=2),
    ]

    doc = OCRDocumentResult(
        document_id="doc_multi_page_test",
        total_pages=2,
        pages=[
            OCRPageResult(page_number=1, width=800, height=1000, words=p1_words),
            OCRPageResult(page_number=2, width=800, height=1000, words=p2_words),
        ],
    )

    reconstructor = BaseTableReconstructor()
    tables = reconstructor.reconstruct_document_tables(doc)

    assert len(tables) == 2
    assert len(tables[0].reconstructed_rows) == 1
    assert len(tables[1].reconstructed_rows) == 1
    assert tables[1].reconstructed_rows[0].cells[0].cleaned_text == "Product Page 2"
    assert tables[1].metadata.get("is_repeated_header") is True


# --------------------------------------------------------------------------
# Test J: Closely Spaced Numeric Columns
# --------------------------------------------------------------------------

def test_scenario_j_closely_spaced_numeric_columns():
    """Validates narrow gap between Rate and MRP columns does not bleed numbers."""
    words = [
        # Header (Rate and MRP are only 15px apart)
        create_word("Rate", 300, 50, 340, 70),
        create_word("MRP", 355, 50, 390, 70),
        create_word("Total", 450, 50, 490, 70),
        # Data
        create_word("45.00", 300, 100, 340, 120),
        create_word("50.00", 355, 100, 390, 120),
        create_word("450.00", 450, 100, 495, 120),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    row = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row.cells}
    assert cell_dict["rate"] == "45.00"
    assert cell_dict["mrp"] == "50.00"
    assert cell_dict["total"] == "450.00"


# --------------------------------------------------------------------------
# Test K: Additional Tax Columns
# --------------------------------------------------------------------------

def test_scenario_k_additional_tax_columns():
    """Validates invoice with Taxable, GST %, and Total Tax Amount."""
    words = [
        create_word("Item", 40, 50, 80, 70),
        create_word("Taxable Value", 180, 50, 270, 70),
        create_word("GST %", 330, 50, 380, 70),
        create_word("Tax Amount", 440, 50, 520, 70),
        create_word("Total", 580, 50, 620, 70),
        # Row
        create_word("Biscuits", 40, 100, 100, 120),
        create_word("100.00", 180, 100, 230, 120),
        create_word("18%", 330, 100, 360, 120),
        create_word("18.00", 440, 100, 480, 120),
        create_word("118.00", 580, 100, 630, 120),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    roles = [c.role for c in table.columns]
    assert "taxable" in roles
    assert "gst_rate" in roles
    assert "tax_amount" in roles
    assert "total" in roles

    row = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row.cells}
    assert cell_dict["taxable"] == "100.00"
    assert cell_dict["gst_rate"] == "18%"
    assert cell_dict["tax_amount"] == "18.00"
    assert cell_dict["total"] == "118.00"


# --------------------------------------------------------------------------
# Test L: Misaligned OCR Words
# --------------------------------------------------------------------------

def test_scenario_l_misaligned_ocr_words():
    """Validates that words with vertical baseline jitter (+- 3px) stay in the same row."""
    words = [
        create_word("Item", 50, 50, 90, 70),
        create_word("Qty", 200, 52, 230, 72),  # +2px shift
        create_word("Total", 350, 48, 410, 68),  # -2px shift
        create_word("Good Day", 50, 100, 120, 120),
        create_word("10", 200, 103, 218, 123),  # +3px shift
        create_word("250.00", 350, 98, 400, 118),  # -2px shift
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert len(table.reconstructed_rows) == 1
    row = table.reconstructed_rows[0]
    assert row.cells[0].cleaned_text == "Good Day"
    assert row.cells[1].cleaned_text == "10"
    assert row.cells[2].cleaned_text == "250.00"


# --------------------------------------------------------------------------
# Regressions & Safety Verification
# --------------------------------------------------------------------------

def test_regression_swallowed_qty_left_of_header():
    """
    Regression test for Known Issue #3 from SCANNER_TEST_CASES.md:
    Quantity printed slightly left of 'Qty' header must NOT be swallowed into the product name.
    """
    words = [
        # Header: Qty starts at x=300
        create_word("Item Description", 50, 50, 200, 70),
        create_word("Qty", 300, 50, 330, 70),
        create_word("Rate", 420, 50, 460, 70),
        create_word("Amount", 550, 50, 610, 70),
        # Data: Qty 10 is printed at x=285 (left of header x=300)
        # Description ends at x=180
        create_word("Tata Salt 1kg", 50, 100, 180, 120),
        create_word("10", 285, 100, 305, 120),
        create_word("24.00", 420, 100, 465, 120),
        create_word("240.00", 550, 100, 605, 120),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    row = table.reconstructed_rows[0]
    cell_dict = {table.columns[c.col_index].role: c.cleaned_text for c in row.cells}

    assert cell_dict["product"] == "Tata Salt 1kg", "Quantity must NOT be merged into product description"
    assert cell_dict["qty"] == "10", "Quantity must be assigned to Qty column"


def test_regression_payment_receipt_no_table():
    """
    Regression test for TC10:
    Payment receipt with no item table must detect has_table=False and return 0 data rows.
    """
    words = [
        create_word("SRI BALAJI WHOLESALE TRADERS", 50, 50, 300, 70),
        create_word("Receipt No: 9912", 50, 80, 200, 100),
        create_word("Received with thanks a sum of Rupees Five Thousand only.", 50, 120, 500, 140),
        create_word("Payment mode: UPI", 50, 160, 220, 180),
        create_word("Authorised Signatory", 350, 220, 500, 240),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert table.has_table is False
    assert table.review_status == "NO_TABLE_DETECTED"
    assert len(table.reconstructed_rows) == 0


def test_regression_summary_lines_excluded():
    """
    Regression test: Grand Total, Tax Summary, and Terms must never be returned as product rows.
    """
    words = [
        create_word("Item", 50, 50, 90, 70),
        create_word("Amount", 300, 50, 350, 70),
        create_word("Ghee 1L", 50, 100, 120, 120),
        create_word("550.00", 300, 100, 350, 120),
        create_word("Grand Total 550.00", 50, 150, 350, 170),
        create_word("Goods once sold will not be returned. E.&O.E.", 50, 190, 450, 210),
    ]

    page = OCRPageResult(page_number=1, width=800, height=1000, words=words)
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(page)

    assert len(table.reconstructed_rows) == 1
    assert table.reconstructed_rows[0].cells[0].cleaned_text == "Ghee 1L"


# --------------------------------------------------------------------------
# Accuracy & Verification Metrics Measurement
# --------------------------------------------------------------------------

def test_vmodel_accuracy_measurements():
    """
    Measures and asserts precision, recall, and complete-row accuracy
    across our representative test dataset.
    """
    test_cases = [
        ("docs/scanner-test-cases/TC01-clean-digital.pdf", 5),
        ("docs/scanner-test-cases/TC04-no-rate-column.pdf", 3),
        ("docs/scanner-test-cases/TC05-amount-mismatch.pdf", 3),
        ("docs/scanner-test-cases/TC06-no-mrp-column.pdf", 3),
        ("docs/scanner-test-cases/TC07-long-40-lines.pdf", 40),
        ("docs/scanner-test-cases/TC08-numbers-in-names.pdf", 4),
        ("docs/scanner-test-cases/TC09-discount-and-gst.pdf", 3),
    ]

    total_expected_rows = 0
    total_detected_rows = 0
    true_positive_rows = 0

    pipeline = InvoicePipeline()

    for pdf_path, expected_count in test_cases:
        with open(pdf_path, "rb") as f:
            res = pipeline.process(f.read(), pdf_path)

        detected_count = len(res.items)
        total_expected_rows += expected_count
        total_detected_rows += detected_count

        if detected_count == expected_count:
            true_positive_rows += expected_count
        else:
            true_positive_rows += min(detected_count, expected_count)

    precision = true_positive_rows / total_detected_rows if total_detected_rows > 0 else 0.0
    recall = true_positive_rows / total_expected_rows if total_expected_rows > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    print(f"\n[V-Model Accuracy Metrics]")
    print(f"Total Expected Rows: {total_expected_rows}")
    print(f"Total Detected Rows: {total_detected_rows}")
    print(f"Row Detection Precision: {precision * 100:.2f}%")
    print(f"Row Detection Recall:    {recall * 100:.2f}%")
    print(f"Row Reconstruction F1:   {f1 * 100:.2f}%")

    assert precision >= 0.99, f"Precision {precision:.2f} below 99%"
    assert recall >= 0.99, f"Recall {recall:.2f} below 99%"
    assert f1 >= 0.99, f"F1 {f1:.2f} below 99%"

