"""
Unit & Integration Test Suite for Phase 3:
Column-Wise Deterministic Extraction Engine.

Tests:
1. Column-anchored extraction without cross-column bleeding.
2. Cell-level expected data type validation.
3. Pack size preservation vs billing quantity distinction.
4. Faint OCR decimal dot repair using line-level arithmetic.
5. Strict None preservation for missing fields.
6. Non-item metadata filtering (bank details, totals, terms).
"""

from decimal import Decimal
import pytest

from services.grocery_ocr.extraction.column_wise_extractor import (
    ColumnWiseExtractor,
    ExtractedRowRecord,
)
from services.grocery_ocr.extraction.dynamic_schema_generator import (
    DocumentTableSchema,
    DynamicColumnDefinition,
    ExpectedDataType,
)
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import (
    DetectedColumn,
    TableCell,
    TableRow,
)


def make_word(text: str, x0: float, y0: float, x1: float, y1: float) -> OCRWord:
    return OCRWord(
        text=text,
        bbox=BoundingBox(x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1)),
        confidence=98.0,
        page_number=1,
    )


@pytest.fixture
def extractor():
    return ColumnWiseExtractor()


@pytest.fixture
def standard_schema():
    cols = [
        DynamicColumnDefinition(
            column_index=0,
            role="serial",
            header_text="S.No",
            normalized_role="SERIAL",
            expected_data_type=ExpectedDataType.INTEGER_SERIAL,
            x_start=0.0,
            x_end=80.0,
        ),
        DynamicColumnDefinition(
            column_index=1,
            role="product",
            header_text="Item Description",
            normalized_role="PRODUCT",
            expected_data_type=ExpectedDataType.TEXT,
            x_start=80.0,
            x_end=350.0,
        ),
        DynamicColumnDefinition(
            column_index=2,
            role="hsn",
            header_text="HSN",
            normalized_role="HSN",
            expected_data_type=ExpectedDataType.HSN_CODE,
            x_start=350.0,
            x_end=450.0,
        ),
        DynamicColumnDefinition(
            column_index=3,
            role="qty",
            header_text="Qty",
            normalized_role="QUANTITY",
            expected_data_type=ExpectedDataType.DECIMAL_QUANTITY,
            x_start=450.0,
            x_end=550.0,
        ),
        DynamicColumnDefinition(
            column_index=4,
            role="rate",
            header_text="Rate",
            normalized_role="RATE",
            expected_data_type=ExpectedDataType.DECIMAL_CURRENCY,
            x_start=550.0,
            x_end=650.0,
        ),
        DynamicColumnDefinition(
            column_index=5,
            role="mrp",
            header_text="MRP",
            normalized_role="MRP",
            expected_data_type=ExpectedDataType.DECIMAL_CURRENCY,
            x_start=650.0,
            x_end=750.0,
        ),
        DynamicColumnDefinition(
            column_index=6,
            role="total",
            header_text="Amount",
            normalized_role="AMOUNT",
            expected_data_type=ExpectedDataType.DECIMAL_CURRENCY,
            x_start=750.0,
            x_end=900.0,
        ),
    ]
    return DocumentTableSchema(
        columns=cols,
        has_explicit_headers=True,
        has_product_column=True,
        has_quantity_column=True,
        has_price_or_amount=True,
        is_valid_schema=True,
    )


def test_clean_row_extraction(extractor, standard_schema):
    row = TableRow(
        row_index=1,
        raw_text="1 | Tata Salt 1kg | 2501 | 20 | 24.00 | 28.00 | 480.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="1", cleaned_text="1"),
            TableCell(row_index=1, col_index=1, raw_text="Tata Salt 1kg", cleaned_text="Tata Salt 1kg"),
            TableCell(row_index=1, col_index=2, raw_text="2501", cleaned_text="2501"),
            TableCell(row_index=1, col_index=3, raw_text="20", cleaned_text="20"),
            TableCell(row_index=1, col_index=4, raw_text="24.00", cleaned_text="24.00"),
            TableCell(row_index=1, col_index=5, raw_text="28.00", cleaned_text="28.00"),
            TableCell(row_index=1, col_index=6, raw_text="480.00", cleaned_text="480.00"),
        ],
    )

    rec = extractor.extract_row(row, standard_schema)
    assert rec is not None
    assert rec.serial == 1
    assert rec.raw_product_name == "Tata Salt 1kg"
    assert rec.hsn_code == "2501"
    assert rec.quantity == Decimal("20")
    assert rec.purchase_price == Decimal("24.00")
    assert rec.mrp == Decimal("28.00")
    assert rec.printed_amount == Decimal("480.00")
    assert rec.is_valid is True


def test_cell_data_type_validation_flags_mismatches(extractor, standard_schema):
    """Verifies that text in a numeric column is flagged in warnings."""
    row = TableRow(
        row_index=2,
        raw_text="1 | Sugar 5kg | 1701 | TEN | 45.00 | 50.00 | 450.00",
        cells=[
            TableCell(row_index=2, col_index=0, raw_text="1", cleaned_text="1"),
            TableCell(row_index=2, col_index=1, raw_text="Sugar 5kg", cleaned_text="Sugar 5kg"),
            TableCell(row_index=2, col_index=2, raw_text="1701", cleaned_text="1701"),
            TableCell(row_index=2, col_index=3, raw_text="TEN", cleaned_text="TEN"),  # Non-numeric quantity
            TableCell(row_index=2, col_index=4, raw_text="45.00", cleaned_text="45.00"),
            TableCell(row_index=2, col_index=5, raw_text="50.00", cleaned_text="50.00"),
            TableCell(row_index=2, col_index=6, raw_text="450.00", cleaned_text="450.00"),
        ],
    )

    rec = extractor.extract_row(row, standard_schema)
    assert rec is not None
    # Cell validation flag
    assert any("Expected numeric quantity" in w for w in rec.warnings)


def test_pack_size_vs_billing_quantity_distinction(extractor, standard_schema):
    """Verifies that 'CHANA 50 KG' pack size in name is not confused with quantity 2 BOR."""
    row = TableRow(
        row_index=3,
        raw_text="1 | CHANA 50 KG | 0713 | 2 BOR | 2750.00 | 3200.00 | 5500.00",
        cells=[
            TableCell(row_index=3, col_index=0, raw_text="1", cleaned_text="1"),
            TableCell(row_index=3, col_index=1, raw_text="CHANA 50 KG", cleaned_text="CHANA 50 KG"),
            TableCell(row_index=3, col_index=2, raw_text="0713", cleaned_text="0713"),
            TableCell(row_index=3, col_index=3, raw_text="2 BOR", cleaned_text="2 BOR"),
            TableCell(row_index=3, col_index=4, raw_text="2750.00", cleaned_text="2750.00"),
            TableCell(row_index=3, col_index=5, raw_text="3200.00", cleaned_text="3200.00"),
            TableCell(row_index=3, col_index=6, raw_text="5500.00", cleaned_text="5500.00"),
        ],
    )

    rec = extractor.extract_row(row, standard_schema)
    assert rec is not None
    assert rec.quantity == Decimal("2")
    assert rec.unit == "BOR"
    assert rec.pack_size is not None
    assert rec.pack_size.value == Decimal("50")
    assert rec.pack_size.unit.upper() == "KG"


def test_faint_ocr_decimal_dot_repair(extractor, standard_schema):
    """
    Verifies that if OCR missed faint decimal in 1.0 (read as 10) or 2.0 (read as 20)
    and line total equals (qty/10)*rate, the quantity is repaired.
    """
    row = TableRow(
        row_index=4,
        raw_text="1 | MASOOR DAL 50KG | 0713 | 10 BOR | 4825.00 | 5400.00 | 4825.00",
        cells=[
            TableCell(row_index=4, col_index=0, raw_text="1", cleaned_text="1"),
            TableCell(row_index=4, col_index=1, raw_text="MASOOR DAL 50KG", cleaned_text="MASOOR DAL 50KG"),
            TableCell(row_index=4, col_index=2, raw_text="0713", cleaned_text="0713"),
            TableCell(row_index=4, col_index=3, raw_text="10 BOR", cleaned_text="10 BOR"),  # Actually 1.0 BOR
            TableCell(row_index=4, col_index=4, raw_text="4825.00", cleaned_text="4825.00"),
            TableCell(row_index=4, col_index=5, raw_text="5400.00", cleaned_text="5400.00"),
            TableCell(row_index=4, col_index=6, raw_text="4825.00", cleaned_text="4825.00"),
        ],
    )

    rec = extractor.extract_row(row, standard_schema)
    assert rec is not None
    # Repaired from 10 to 1.0
    assert rec.quantity == Decimal("1.000")
    assert any("Repaired faint decimal" in w for w in rec.warnings)


def test_missing_mrp_remains_none(extractor, standard_schema):
    """Missing MRP in invoice must remain None without fabricating a value."""
    row = TableRow(
        row_index=5,
        raw_text="1 | Loose Sugar | 1701 | 50 KG | 40.00 | | 2000.00",
        cells=[
            TableCell(row_index=5, col_index=0, raw_text="1", cleaned_text="1"),
            TableCell(row_index=5, col_index=1, raw_text="Loose Sugar", cleaned_text="Loose Sugar"),
            TableCell(row_index=5, col_index=2, raw_text="1701", cleaned_text="1701"),
            TableCell(row_index=5, col_index=3, raw_text="50 KG", cleaned_text="50 KG"),
            TableCell(row_index=5, col_index=4, raw_text="40.00", cleaned_text="40.00"),
            TableCell(row_index=5, col_index=5, raw_text="", cleaned_text=""),  # Missing MRP
            TableCell(row_index=5, col_index=6, raw_text="2000.00", cleaned_text="2000.00"),
        ],
    )

    rec = extractor.extract_row(row, standard_schema)
    assert rec is not None
    assert rec.mrp is None
    assert rec.purchase_price == Decimal("40.00")
    assert rec.quantity == Decimal("50")


def test_non_item_metadata_filtered(extractor, standard_schema):
    """Ensures footer text like Bank Details or Authorised Signatory are rejected."""
    non_item_rows = [
        TableRow(row_index=10, raw_text="Bank Details: SBI A/C 12345678", cells=[TableCell(row_index=10, col_index=1, raw_text="Bank Details: SBI", cleaned_text="Bank Details: SBI")]),
        TableRow(row_index=11, raw_text="Total in Words: Two Thousand Only", cells=[TableCell(row_index=11, col_index=1, raw_text="Total in Words", cleaned_text="Total in Words")]),
        TableRow(row_index=12, raw_text="Authorised Signatory", cells=[TableCell(row_index=12, col_index=1, raw_text="Authorised Signatory", cleaned_text="Authorised Signatory")]),
    ]
    for row in non_item_rows:
        rec = extractor.extract_row(row, standard_schema)
        assert rec is None
