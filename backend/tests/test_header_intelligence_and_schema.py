"""
Comprehensive Unit & Integration Test Suite for Phase 2:
Header Intelligence Engine & Dynamic Schema Generator.

Validates:
1. Multi-lingual semantic header classification (English, Hindi, Telugu, Tamil, Kannada, Marathi, Bengali).
2. Multi-line stacked header consolidation.
3. Percentage symbol (%) disambiguation (discount_pct vs discount, gst_rate vs tax_amount).
4. Purchase Price vs Selling Price vs Rate disambiguation.
5. Continuous horizontal boundary calculation via whitespace valleys.
6. ExpectedDataType assignment per column.
7. Conservative positional role inference (between Rate and MRP, sequential integers).
8. Headerless invoice schema generation.
9. Backward compatibility with BaseColumnDetector and DetectedColumn.
"""

from decimal import Decimal
import pytest

from services.grocery_ocr.extraction.dynamic_schema_generator import (
    DocumentTableSchema,
    DynamicColumnDefinition,
    DynamicSchemaGenerator,
    ExpectedDataType,
)
from services.grocery_ocr.extraction.header_intelligence import (
    CANONICAL_HEADER_LABELS,
    HEADER_SEMANTIC_ALIASES,
    HeaderCandidate,
    HeaderIntelligenceEngine,
)
from services.grocery_ocr.extraction.column_detector import BaseColumnDetector
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableRow,
    TableResult,
)


def make_word(text: str, x0: float, y0: float, x1: float, y1: float, conf: float = 98.0) -> OCRWord:
    """Helper to create OCRWord."""
    return OCRWord(
        text=text,
        bbox=BoundingBox(x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1)),
        confidence=conf,
        page_number=1,
    )


# ===========================================================================
# 1. Multi-Lingual Semantic Header Classification Tests
# ===========================================================================

@pytest.fixture
def header_engine():
    return HeaderIntelligenceEngine()


@pytest.fixture
def schema_gen(header_engine):
    return DynamicSchemaGenerator(header_intelligence=header_engine)


def test_english_header_classification(header_engine):
    cases = [
        ("Item Description", "product"),
        ("Particulars", "product"),
        ("Description of Goods", "product"),
        ("HSN / SAC Code", "hsn"),
        ("Billed Qty", "qty"),
        ("Quantity", "qty"),
        ("UOM", "unit"),
        ("Unit Price", "rate"),
        ("Basic Rate", "rate"),
        ("Purchase Price", "purchase_price"),
        ("Selling Price", "selling_price"),
        ("Retail Price", "selling_price"),
        ("M.R.P.", "mrp"),
        ("Discount Amount", "discount"),
        ("Disc %", "discount_pct"),
        ("GST Amount", "tax_amount"),
        ("GST %", "gst_rate"),
        ("Taxable Value", "taxable"),
        ("Net Amount", "total"),
        ("Sl No", "serial"),
    ]
    for text, expected_role in cases:
        role, conf, norm = header_engine.classify_text(text)
        assert role == expected_role, f"Expected '{text}' -> {expected_role}, got {role}"
        assert conf >= 90.0
        assert norm == CANONICAL_HEADER_LABELS[expected_role]


def test_hindi_header_classification(header_engine):
    cases = [
        ("विवरण", "product"),
        ("सामग्री", "product"),
        ("वस्तु विवरण", "product"),
        ("मात्रा", "qty"),
        ("दर", "rate"),
        ("खरीद दर", "purchase_price"),
        ("बिक्री दर", "selling_price"),
        ("एमआरपी", "mrp"),
        ("छूट", "discount"),
        ("कर", "tax_amount"),
        ("कुल", "total"),
        ("क्र.सं.", "serial"),
    ]
    for text, expected_role in cases:
        role, conf, _ = header_engine.classify_text(text)
        assert role == expected_role, f"Hindi '{text}' -> {expected_role}, got {role}"


def test_telugu_header_classification(header_engine):
    cases = [
        ("వస్తువు", "product"),
        ("వివరాలు", "product"),
        ("పరిమాణం", "qty"),
        ("ధర", "rate"),
        ("కొనుగోలు ధర", "purchase_price"),
        ("అమ్మకపు ధర", "selling_price"),
        ("రాయితీ", "discount"),
        ("పన్ను", "tax_amount"),
        ("మొత్తం", "total"),
        ("క్ర.సంఖ్య", "serial"),
    ]
    for text, expected_role in cases:
        role, conf, _ = header_engine.classify_text(text)
        assert role == expected_role, f"Telugu '{text}' -> {expected_role}, got {role}"


def test_tamil_header_classification(header_engine):
    cases = [
        ("பொருளின் பெயர்", "product"),
        ("விவரம்", "product"),
        ("அளவு", "qty"),
        ("விலை", "rate"),
        ("விற்பனை விலை", "selling_price"),
        ("தள்ளுபடி", "discount"),
        ("வரி", "tax_amount"),
        ("தொகை", "total"),
        ("வரிசை எண்", "serial"),
    ]
    for text, expected_role in cases:
        role, conf, _ = header_engine.classify_text(text)
        assert role == expected_role, f"Tamil '{text}' -> {expected_role}, got {role}"


def test_kannada_marathi_bengali_classification(header_engine):
    # Kannada
    role, _, _ = header_engine.classify_text("ವಿವರ")
    assert role == "product"
    role, _, _ = header_engine.classify_text("ಪ್ರಮಾಣ")
    assert role == "qty"
    role, _, _ = header_engine.classify_text("ಒಟ್ಟು")
    assert role == "total"

    # Marathi
    role, _, _ = header_engine.classify_text("तपशील")
    assert role == "product"
    role, _, _ = header_engine.classify_text("भाव")
    assert role == "rate"

    # Bengali
    role, _, _ = header_engine.classify_text("বিবরণ")
    assert role == "product"
    role, _, _ = header_engine.classify_text("মোট")
    assert role == "total"


# ===========================================================================
# 2. Percentage Disambiguation Tests
# ===========================================================================

def test_percentage_disambiguation(header_engine):
    # Discount percentage vs amount
    role_pct, _, _ = header_engine.classify_text("Disc %")
    role_amt, _, _ = header_engine.classify_text("Disc Amt")
    assert role_pct == "discount_pct"
    assert role_amt == "discount"

    # GST percentage vs amount
    role_tax_pct, _, _ = header_engine.classify_text("GST %")
    role_tax_amt, _, _ = header_engine.classify_text("GST Amt")
    assert role_tax_pct == "gst_rate"
    assert role_tax_amt == "tax_amount"

    # Less percentage
    role_less_pct, _, _ = header_engine.classify_text("Less %")
    assert role_less_pct == "discount_pct"


# ===========================================================================
# 3. Multi-Line Stacked Header Consolidation Tests
# ===========================================================================

def test_stacked_vertical_headers_consolidate(header_engine):
    # Line 1: "Item" (x: 100-140, y: 40-55), "Basic" (x: 300-340, y: 40-55)
    # Line 2: "Description" (x: 100-180, y: 60-75), "Rate" (x: 300-335, y: 60-75)
    # Line 3: "(Rs)" (x: 300-325, y: 80-95)
    line1 = [
        make_word("Item", 100, 40, 140, 55),
        make_word("Basic", 300, 40, 340, 55),
    ]
    line2 = [
        make_word("Description", 100, 60, 180, 75),
        make_word("Rate", 300, 60, 335, 75),
    ]
    line3 = [
        make_word("(Rs)", 300, 80, 325, 95),
    ]

    candidates = header_engine.extract_header_candidates([line1, line2, line3], median_font_height=15.0)

    assert len(candidates) == 2
    prod_cand = candidates[0]
    rate_cand = candidates[1]

    assert prod_cand.role == "product"
    assert "Item Description" in prod_cand.raw_text
    assert prod_cand.bbox.y0 == 40
    assert prod_cand.bbox.y1 == 75

    assert rate_cand.role == "rate"
    assert "Basic Rate" in rate_cand.raw_text
    assert rate_cand.bbox.y0 == 40
    assert rate_cand.bbox.y1 == 95


# ===========================================================================
# 4. Dynamic Schema Generator Tests
# ===========================================================================

def test_dynamic_schema_generation_standard_table(schema_gen):
    header_row = TableRow(
        row_index=0,
        raw_text="Sl | Item Description | Qty | Rate | MRP | Amount",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Sl", words=[make_word("Sl", 20, 50, 40, 70)]),
            TableCell(row_index=0, col_index=1, raw_text="Item Description", words=[make_word("Item", 100, 50, 140, 70), make_word("Description", 145, 50, 240, 70)]),
            TableCell(row_index=0, col_index=2, raw_text="Qty", words=[make_word("Qty", 320, 50, 350, 70)]),
            TableCell(row_index=0, col_index=3, raw_text="Rate", words=[make_word("Rate", 420, 50, 460, 70)]),
            TableCell(row_index=0, col_index=4, raw_text="MRP", words=[make_word("MRP", 520, 50, 560, 70)]),
            TableCell(row_index=0, col_index=5, raw_text="Amount", words=[make_word("Amount", 620, 50, 680, 70)]),
        ],
        is_header=True,
    )

    data_row = TableRow(
        row_index=1,
        raw_text="1 | Tata Salt 1kg | 20 | 22.00 | 28.00 | 440.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="1", words=[make_word("1", 25, 100, 35, 120)]),
            TableCell(row_index=1, col_index=1, raw_text="Tata Salt 1kg", words=[make_word("Tata", 100, 100, 135, 120), make_word("Salt", 140, 100, 175, 120), make_word("1kg", 180, 100, 210, 120)]),
            TableCell(row_index=1, col_index=2, raw_text="20", words=[make_word("20", 325, 100, 345, 120)]),
            TableCell(row_index=1, col_index=3, raw_text="22.00", words=[make_word("22.00", 420, 100, 455, 120)]),
            TableCell(row_index=1, col_index=4, raw_text="28.00", words=[make_word("28.00", 520, 100, 555, 120)]),
            TableCell(row_index=1, col_index=5, raw_text="440.00", words=[make_word("440.00", 620, 100, 665, 120)]),
        ],
    )

    table = TableResult(rows=[header_row, data_row])
    schema = schema_gen.generate_schema(table, data_rows=[data_row])

    assert isinstance(schema, DocumentTableSchema)
    assert schema.is_valid_schema is True
    assert schema.has_explicit_headers is True
    assert schema.has_product_column is True
    assert schema.has_quantity_column is True
    assert schema.has_price_or_amount is True
    assert len(schema.columns) == 6

    # Verify ExpectedDataType assignment
    col_roles = {c.role: c for c in schema.columns}
    assert col_roles["serial"].expected_data_type == ExpectedDataType.INTEGER_SERIAL
    assert col_roles["product"].expected_data_type == ExpectedDataType.TEXT
    assert col_roles["qty"].expected_data_type == ExpectedDataType.DECIMAL_QUANTITY
    assert col_roles["rate"].expected_data_type == ExpectedDataType.DECIMAL_CURRENCY
    assert col_roles["mrp"].expected_data_type == ExpectedDataType.DECIMAL_CURRENCY
    assert col_roles["total"].expected_data_type == ExpectedDataType.DECIMAL_CURRENCY

    # Verify horizontal non-overlapping coverage
    for i in range(len(schema.columns) - 1):
        curr_col = schema.columns[i]
        next_col = schema.columns[i + 1]
        assert curr_col.x_end == next_col.x_start, f"Col {i} end ({curr_col.x_end}) must match Col {i+1} start ({next_col.x_start})"


def test_schema_disambiguates_purchase_and_selling_rate(schema_gen):
    header_row = TableRow(
        row_index=0,
        raw_text="Item | Purchase Rate | Sale Rate | Total",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Item", words=[make_word("Item", 50, 50, 100, 70)]),
            TableCell(row_index=0, col_index=1, raw_text="Purchase Rate", words=[make_word("Purchase", 200, 50, 260, 70), make_word("Rate", 265, 50, 300, 70)]),
            TableCell(row_index=0, col_index=2, raw_text="Sale Rate", words=[make_word("Sale", 380, 50, 420, 70), make_word("Rate", 425, 50, 460, 70)]),
            TableCell(row_index=0, col_index=3, raw_text="Total", words=[make_word("Total", 550, 50, 600, 70)]),
        ],
        is_header=True,
    )
    table = TableResult(rows=[header_row])
    schema = schema_gen.generate_schema(table)

    roles = [c.role for c in schema.columns]
    assert "purchase_price" in roles, "Expected 'Purchase Rate' disambiguated to purchase_price"
    assert "selling_price" in roles, "Expected 'Sale Rate' disambiguated to selling_price"


def test_schema_conservative_role_inference(schema_gen):
    """Verifies single unknown numeric between Rate and MRP is inferred as selling_price."""
    header_row = TableRow(
        row_index=0,
        raw_text="Item | Rate | UnknownGap | MRP | Amount",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Item", words=[make_word("Item", 50, 50, 100, 70)]),
            TableCell(row_index=0, col_index=1, raw_text="Rate", words=[make_word("Rate", 200, 50, 240, 70)]),
            TableCell(row_index=0, col_index=2, raw_text="UnknownGap", words=[make_word("UnknownGap", 320, 50, 400, 70)]),
            TableCell(row_index=0, col_index=3, raw_text="MRP", words=[make_word("MRP", 480, 50, 520, 70)]),
            TableCell(row_index=0, col_index=4, raw_text="Amount", words=[make_word("Amount", 600, 50, 660, 70)]),
        ],
        is_header=True,
    )
    data_row = TableRow(
        row_index=1,
        raw_text="Basmati Rice | 90.00 | 105.00 | 120.00 | 900.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Basmati Rice", cleaned_text="Basmati Rice"),
            TableCell(row_index=1, col_index=1, raw_text="90.00", cleaned_text="90.00"),
            TableCell(row_index=1, col_index=2, raw_text="105.00", cleaned_text="105.00"),
            TableCell(row_index=1, col_index=3, raw_text="120.00", cleaned_text="120.00"),
            TableCell(row_index=1, col_index=4, raw_text="900.00", cleaned_text="900.00"),
        ],
    )
    table = TableResult(rows=[header_row, data_row])
    schema = schema_gen.generate_schema(table, data_rows=[data_row])

    inferred_col = schema.columns[2]
    assert inferred_col.role == "selling_price"
    assert inferred_col.is_inferred is True
    assert inferred_col.confidence == 65.0
    assert inferred_col.inference_reason == "POSITIONAL_BETWEEN_RATE_AND_MRP"


def test_headerless_invoice_schema_inference(schema_gen):
    """Verifies schema deduction when no explicit header line exists."""
    row1 = TableRow(
        row_index=0,
        raw_text="1 | Sugar 5kg | 5 | 45.00 | 225.00",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="1", cleaned_text="1", words=[make_word("1", 20, 50, 30, 70)]),
            TableCell(row_index=0, col_index=1, raw_text="Sugar 5kg", cleaned_text="Sugar 5kg", words=[make_word("Sugar", 100, 50, 150, 70), make_word("5kg", 155, 50, 185, 70)]),
            TableCell(row_index=0, col_index=2, raw_text="5", cleaned_text="5", words=[make_word("5", 300, 50, 315, 70)]),
            TableCell(row_index=0, col_index=3, raw_text="45.00", cleaned_text="45.00", words=[make_word("45.00", 450, 50, 490, 70)]),
            TableCell(row_index=0, col_index=4, raw_text="225.00", cleaned_text="225.00", words=[make_word("225.00", 600, 50, 650, 70)]),
        ],
    )
    row2 = TableRow(
        row_index=1,
        raw_text="2 | Atta 10kg | 2 | 380.00 | 760.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="2", cleaned_text="2", words=[make_word("2", 20, 90, 30, 110)]),
            TableCell(row_index=1, col_index=1, raw_text="Atta 10kg", cleaned_text="Atta 10kg", words=[make_word("Atta", 100, 90, 140, 110), make_word("10kg", 145, 90, 185, 110)]),
            TableCell(row_index=1, col_index=2, raw_text="2", cleaned_text="2", words=[make_word("2", 300, 90, 315, 110)]),
            TableCell(row_index=1, col_index=3, raw_text="380.00", cleaned_text="380.00", words=[make_word("380.00", 450, 90, 495, 110)]),
            TableCell(row_index=1, col_index=4, raw_text="760.00", cleaned_text="760.00", words=[make_word("760.00", 600, 90, 650, 110)]),
        ],
    )

    table = TableResult(rows=[row1, row2])
    schema = schema_gen.generate_schema(table)

    assert schema.has_explicit_headers is False
    assert schema.has_product_column is True
    assert schema.is_valid_schema is True
    assert len(schema.columns) >= 3


# ===========================================================================
# 5. BaseColumnDetector Backward Compatibility Tests
# ===========================================================================

def test_base_column_detector_detect_schema_and_columns_consistency():
    detector = BaseColumnDetector()

    header_row = TableRow(
        row_index=0,
        raw_text="Item | Qty | Rate | Total",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Item", words=[make_word("Item", 50, 50, 100, 70)]),
            TableCell(row_index=0, col_index=1, raw_text="Qty", words=[make_word("Qty", 200, 50, 240, 70)]),
            TableCell(row_index=0, col_index=2, raw_text="Rate", words=[make_word("Rate", 350, 50, 400, 70)]),
            TableCell(row_index=0, col_index=3, raw_text="Total", words=[make_word("Total", 500, 50, 550, 70)]),
        ],
        is_header=True,
    )
    table = TableResult(rows=[header_row])

    schema = detector.detect_schema(table)
    assert isinstance(schema, DocumentTableSchema)
    assert schema.column_count == 4

    columns = detector.detect_columns(table)
    assert isinstance(columns, list)
    assert len(columns) == 4
    assert all(isinstance(c, DetectedColumn) for c in columns)

    # Roles and headers match exactly
    for dyn_col, det_col in zip(schema.columns, columns):
        assert dyn_col.role == det_col.role
        assert dyn_col.header_text == det_col.header_text
        assert dyn_col.x_start == det_col.x_start

