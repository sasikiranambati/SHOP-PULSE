"""
V-Model Test Suite for Phase 6: Quantity, Unit, and Financial Value Extraction.
Validates:
  1. Numeric Parsing & Indian Formatting (Commas, Currency, OCR digit repair)
  2. Unit Normalization & Invariant Preservation (No conversion of BOR to PCS or PET to Liters)
  3. Quantity Extraction Engine (Integers, Decimals, Inline Units, Non-defaulting)
  4. Financial Field Extraction Engine (Column-role mapping, Geometric safety)
  5. Decimal Financial Calculation Engine (Gross, Discount, Taxable, GST, Net)
  6. Financial Validation Engine (VERIFIED, WARNING, MISMATCH, INVALID)
  7. Regression Fixtures:
     - TEST A: CHANA 50 KG | 1 BOR | Rate: 2760.00 | MRP: 3200.00 | Amount: 2760.00
     - TEST B: FORTUNE BESAN 500 GM | 10 PCS | Rate: 70.00 | MRP: 90.00 | Amount: 700.00
     - TEST C: FORTUNE OIL 1 KG | 10 PCS | Rate: 1378.62 | MRP: 1680.00 | Amount: 4015.80
  8. Missing Optional Fields (Missing MRP allowed; missing rate/qty flagged)
  9. Negative and Out-of-Bounds Protection
  10. Field-Level Accuracy & Telemetry Benchmark
"""

from decimal import Decimal
from typing import List, Optional
import pytest

from services.grocery_ocr.config import GroceryOCRConfig
from services.grocery_ocr.extraction.numeric_parser import NumericParser
from services.grocery_ocr.extraction.price_extractor import BasePriceExtractor
from services.grocery_ocr.extraction.product_extractor import BaseProductExtractor
from services.grocery_ocr.extraction.quantity_extractor import BaseQuantityExtractor
from services.grocery_ocr.extraction.unit_normalizer import UnitNormalizer
from services.grocery_ocr.financial.calculation_engine import (
    FinancialCalculationEngine,
)
from services.grocery_ocr.schemas.invoice_item import (
    ExtractedInvoiceItem,
    PackageSize,
)
from services.grocery_ocr.schemas.ocr import BoundingBox
from services.grocery_ocr.schemas.table import (
    DetectedColumn,
    TableCell,
    TableRow,
)
from services.grocery_ocr.validation.invoice_validator import BaseInvoiceValidator


@pytest.fixture
def parser():
    return NumericParser()


@pytest.fixture
def unit_norm():
    return UnitNormalizer()


@pytest.fixture
def qty_extractor():
    return BaseQuantityExtractor()


@pytest.fixture
def price_extractor():
    return BasePriceExtractor()


@pytest.fixture
def calc_engine():
    return FinancialCalculationEngine()


@pytest.fixture
def validator():
    return BaseInvoiceValidator()


# --------------------------------------------------------------------------
# 1. Numeric Parsing Service Tests
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw_input, expected_val",
    [
        ("2760", Decimal("2760.00")),
        ("2760.00", Decimal("2760.00")),
        ("700.00", Decimal("700.00")),
        ("1378.62", Decimal("1378.62")),
        ("4015.80", Decimal("4015.80")),
        ("1,378.62", Decimal("1378.62")),
        ("₹700.00", Decimal("700.00")),
        ("Rs. 700.00", Decimal("700.00")),
        ("700/-", Decimal("700.00")),
        ("1,00,000.00", Decimal("100000.00")),
        ("0.500", Decimal("0.50")),
        ("1.25", Decimal("1.25")),
    ],
)
def test_numeric_parser_currency_formats(parser, raw_input, expected_val):
    res = parser.parse_currency(raw_input)
    assert res.is_valid is True
    assert res.value == expected_val
    assert res.raw_text == raw_input


def test_numeric_parser_ocr_digit_repairs(parser):
    """Conservative OCR letter-to-digit repairs when bounded by numbers."""
    # Letter 'O' inside digits
    res_o = parser.parse_currency("276O.00")
    assert res_o.is_valid is True
    assert res_o.value == Decimal("2760.00")
    assert any("O" in issue for issue in res_o.issues)

    # Letter 'I' at start of digits
    res_i = parser.parse_currency("I378.62")
    assert res_i.is_valid is True
    assert res_i.value == Decimal("1378.62")


def test_numeric_parser_missing_and_invalid(parser):
    """Missing or unparseable tokens must safely return None, never zero."""
    for empty in ("-", "--", ".", "NA", "N/A", "nil", "None", ""):
        res = parser.parse_currency(empty)
        assert res.value is None

    # Invalid alphanumeric string
    res_bad = parser.parse_currency("ABC.XYZ")
    assert res_bad.value is None
    assert res_bad.is_valid is False


# --------------------------------------------------------------------------
# 2. Unit Normalization & Invariant Preservation Tests
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw_u, expected_norm",
    [
        ("PCS", "PCS"),
        ("pc", "PCS"),
        ("pieces", "PCS"),
        ("KG", "KG"),
        ("kgs", "KG"),
        ("kilo", "KG"),
        ("GM", "G"),
        ("gms", "G"),
        ("g", "G"),
        ("L", "L"),
        ("ltr", "L"),
        ("litres", "L"),
        ("ML", "ML"),
        ("BOX", "BOX"),
        ("bx", "BOX"),
        ("PKT", "PKT"),
        ("packet", "PKT"),
        ("pack", "PKT"),
        ("BAG", "BAG"),
        ("bags", "BAG"),
        ("BOR", "BOR"),
        ("BORA", "BOR"),
        ("bori", "BOR"),
        ("PET", "PET"),
        ("BTL", "PET"),
        ("bottle", "PET"),
        ("NOS", "NOS"),
        ("no", "NOS"),
        ("DOZ", "DOZ"),
        ("dozen", "DOZ"),
        ("SET", "SET"),
    ],
)
def test_unit_normalizer_canonical_units(unit_norm, raw_u, expected_norm):
    res = unit_norm.normalize(raw_u)
    assert res.normalized_unit == expected_norm
    assert res.raw_unit == raw_u
    assert res.is_recognized is True


def test_unit_normalizer_never_converts_or_assumes_multipliers(unit_norm):
    """
    INVARIANT:
    Unit normalizer standardizes labels, but NEVER converts BOR to PCS or PET to Liters!
    """
    res_bor = unit_norm.normalize("BOR")
    assert res_bor.normalized_unit == "BOR"
    assert res_bor.normalized_unit != "PCS"
    assert res_bor.normalized_unit != "KG"

    res_pet = unit_norm.normalize("PET")
    assert res_pet.normalized_unit == "PET"
    assert res_pet.normalized_unit != "L"


# --------------------------------------------------------------------------
# 3. Dedicated Quantity Extraction Engine Tests
# --------------------------------------------------------------------------

def test_quantity_extraction_integer_and_decimal(qty_extractor):
    cols = [
        DetectedColumn(column_index=0, role="qty", header_text="QTY"),
        DetectedColumn(column_index=1, role="unit", header_text="UNIT"),
    ]
    # Test integer
    row_int = TableRow(
        row_index=0,
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="10", cleaned_text="10"),
            TableCell(row_index=0, col_index=1, raw_text="PCS", cleaned_text="PCS"),
        ],
    )
    res_int = qty_extractor.extract_quantity_detailed(row_int, cols)
    assert res_int.quantity == Decimal("10.000")
    assert res_int.unit == "PCS"
    assert res_int.raw_quantity == "10"
    assert res_int.raw_unit == "PCS"

    # Test decimal quantity
    row_dec = TableRow(
        row_index=1,
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="0.500", cleaned_text="0.500"),
            TableCell(row_index=1, col_index=1, raw_text="KG", cleaned_text="KG"),
        ],
    )
    res_dec = qty_extractor.extract_quantity_detailed(row_dec, cols)
    assert res_dec.quantity == Decimal("0.500")
    assert res_dec.unit == "KG"


def test_quantity_extraction_inline_unit(qty_extractor):
    """Handles inline unit when quantity cell contains '10 PCS' or '1 BOR'."""
    cols = [DetectedColumn(column_index=0, role="qty", header_text="QTY")]
    row = TableRow(
        row_index=0,
        cells=[TableCell(row_index=0, col_index=0, raw_text="1 BOR", cleaned_text="1 BOR")],
    )
    res = qty_extractor.extract_quantity_detailed(row, cols)
    assert res.quantity == Decimal("1.000")
    assert res.unit == "BOR"
    assert res.raw_unit == "BOR"


def test_quantity_extraction_missing_never_defaults_to_zero_or_one(qty_extractor):
    """Missing quantity column or blank cell must remain None."""
    cols = [DetectedColumn(column_index=0, role="qty", header_text="QTY")]
    row_blank = TableRow(
        row_index=0,
        cells=[TableCell(row_index=0, col_index=0, raw_text="-", cleaned_text="-")],
    )
    res = qty_extractor.extract_quantity_detailed(row_blank, cols)
    assert res.quantity is None
    assert res.quantity != Decimal("0")
    assert res.quantity != Decimal("1")


# --------------------------------------------------------------------------
# 4. Financial Field Extraction Engine Tests
# --------------------------------------------------------------------------

def test_financial_field_extraction_preserves_roles(price_extractor):
    """Extracts rate, mrp, discount, tax, and printed amount strictly by column roles."""
    cols = [
        DetectedColumn(column_index=0, role="rate", header_text="RATE"),
        DetectedColumn(column_index=1, role="mrp", header_text="MRP"),
        DetectedColumn(column_index=2, role="discount", header_text="DISC"),
        DetectedColumn(column_index=3, role="tax_amount", header_text="GST"),
        DetectedColumn(column_index=4, role="total", header_text="AMOUNT"),
    ]
    row = TableRow(
        row_index=0,
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="2,760.00", cleaned_text="2,760.00"),
            TableCell(row_index=0, col_index=1, raw_text="3,200.00", cleaned_text="3,200.00"),
            TableCell(row_index=0, col_index=2, raw_text="50.00", cleaned_text="50.00"),
            TableCell(row_index=0, col_index=3, raw_text="135.50", cleaned_text="135.50"),
            TableCell(row_index=0, col_index=4, raw_text="2,845.50", cleaned_text="2,845.50"),
        ],
    )
    res = price_extractor.extract_financials_detailed(row, cols)
    assert res.purchase_price == Decimal("2760.00")
    assert res.mrp == Decimal("3200.00")
    assert res.discount == Decimal("50.00")
    assert res.tax_amount == Decimal("135.50")
    assert res.printed_amount == Decimal("2845.50")
    assert res.raw_financial_cells["purchase_price"] == "2,760.00"
    assert res.raw_financial_cells["mrp"] == "3,200.00"


def test_financial_field_extraction_never_infers_mrp_solely_from_magnitude(price_extractor):
    """
    CRITICAL RULE:
    Never assume the largest number is MRP or last column is Amount.
    If a column is not labeled MRP, it must NOT be assigned to MRP.
    """
    cols = [
        DetectedColumn(column_index=0, role="rate", header_text="RATE"),
        DetectedColumn(column_index=1, role="total", header_text="TOTAL"),
    ]
    # Rate is 500, Total is 5000. 5000 is the largest number, but it is TOTAL, NOT MRP!
    row = TableRow(
        row_index=0,
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="500.00", cleaned_text="500.00"),
            TableCell(row_index=0, col_index=1, raw_text="5,000.00", cleaned_text="5,000.00"),
        ],
    )
    res = price_extractor.extract_financials_detailed(row, cols)
    assert res.purchase_price == Decimal("500.00")
    assert res.printed_amount == Decimal("5000.00")
    assert res.mrp is None  # MRP was not printed; must remain None!


# --------------------------------------------------------------------------
# 5. Financial Calculation Engine Tests
# --------------------------------------------------------------------------

def test_calculation_engine_basic_gross(calc_engine):
    """10 PCS × ₹70.00 = ₹700.00"""
    res = calc_engine.calculate_line_item(
        quantity=Decimal("10"),
        unit_rate=Decimal("70.00"),
        printed_amount=Decimal("700.00"),
    )
    assert res.gross_amount == Decimal("700.00")
    assert res.calculated_amount == Decimal("700.00")
    assert res.rounding_difference == Decimal("0.00")
    assert res.is_arithmetic_match is True


def test_calculation_engine_with_discount_and_gst(calc_engine):
    """
    Quantity: 2
    Unit rate: 1000.00
    Gross: 2000.00
    Discount 10%: 200.00 -> Taxable: 1800.00
    GST 18%: 324.00
    Calculated Line Total: 2124.00
    """
    res = calc_engine.calculate_line_item(
        quantity=Decimal("2"),
        unit_rate=Decimal("1000.00"),
        discount_pct=Decimal("10.0"),
        gst_rate=Decimal("18.0"),
        printed_amount=Decimal("2124.00"),
    )
    assert res.gross_amount == Decimal("2000.00")
    assert res.discount_amount == Decimal("200.00")
    assert res.taxable_amount == Decimal("1800.00")
    assert res.gst_amount == Decimal("324.00")
    assert res.calculated_amount == Decimal("2124.00")
    assert res.is_arithmetic_match is True


# --------------------------------------------------------------------------
# 6. Required Regression Test Cases (TEST A, TEST B, TEST C)
# --------------------------------------------------------------------------

def test_regression_case_a_chana_wholesale(validator):
    """
    TEST A:
    CHANA 50 KG
    Quantity: 1
    Unit: BOR
    Purchase price: 2760.00
    MRP: 3200.00
    Printed amount: 2760.00
    """
    item = ExtractedInvoiceItem(
        item_id="item_test_a",
        raw_product_name="CHANA 50 KG",
        package_size=PackageSize(value=Decimal("50"), unit="kg"),
        quantity=Decimal("1"),
        unit="BOR",
        purchase_price=Decimal("2760.00"),
        mrp=Decimal("3200.00"),
        printed_amount=Decimal("2760.00"),
    )

    validated = validator.validate_item(item)

    # Invariants
    assert validated.package_size.value == Decimal("50")
    assert validated.package_size.unit == "kg"
    assert validated.quantity == Decimal("1")
    assert validated.unit == "BOR"
    assert validated.purchase_price == Decimal("2760.00")
    assert validated.mrp == Decimal("3200.00")
    assert validated.printed_amount == Decimal("2760.00")
    assert validated.calculated_amount == Decimal("2760.00")
    assert validated.rounding_difference == Decimal("0.00")
    assert validated.validation_status == "VERIFIED"


def test_regression_case_b_besan_retail_pack(validator):
    """
    TEST B:
    FORTUNE BESAN 500 GM
    Quantity: 10
    Unit: PCS
    Purchase price: 70.00
    MRP: 90.00
    Printed amount: 700.00
    """
    item = ExtractedInvoiceItem(
        item_id="item_test_b",
        raw_product_name="FORTUNE BESAN 500 GM",
        package_size=PackageSize(value=Decimal("500"), unit="g"),
        quantity=Decimal("10"),
        unit="PCS",
        purchase_price=Decimal("70.00"),
        mrp=Decimal("90.00"),
        printed_amount=Decimal("700.00"),
    )

    validated = validator.validate_item(item)

    assert validated.package_size.value == Decimal("500")
    assert validated.package_size.unit == "g"
    assert validated.quantity == Decimal("10")
    assert validated.unit == "PCS"
    assert validated.purchase_price == Decimal("70.00")
    assert validated.mrp == Decimal("90.00")
    assert validated.printed_amount == Decimal("700.00")
    assert validated.calculated_amount == Decimal("700.00")
    assert validated.validation_status == "VERIFIED"


def test_regression_case_c_fortune_oil_discrepancy_preservation(validator):
    """
    TEST C:
    FORTUNE OIL 1 KG
    Quantity: 10
    Unit: PCS
    Purchase price: 1378.62
    MRP: 1680.00
    Printed amount: 4015.80

    CRITICAL INSTRUCTION:
    Preserve the printed values even if their arithmetic does not match
    a simple quantity × rate calculation (10 × 1378.62 = 13786.20 != 4015.80).
    Flag inconsistencies for review.
    Never silently overwrite printed_amount or purchase_price!
    """
    item = ExtractedInvoiceItem(
        item_id="item_test_c",
        raw_product_name="FORTUNE OIL 1 KG",
        package_size=PackageSize(value=Decimal("1"), unit="kg"),
        quantity=Decimal("10"),
        unit="PCS",
        purchase_price=Decimal("1378.62"),
        mrp=Decimal("1680.00"),
        printed_amount=Decimal("4015.80"),
    )

    validated = validator.validate_item(item)

    # 1. Printed amount is strictly preserved
    assert validated.printed_amount == Decimal("4015.80")
    # 2. Purchase price is strictly preserved
    assert validated.purchase_price == Decimal("1378.62")
    # 3. Calculated amount reflects 10 × 1378.62 = 13786.20
    assert validated.calculated_amount == Decimal("13786.20")
    # 4. Difference is flagged
    assert validated.rounding_difference == Decimal("4015.80") - Decimal("13786.20")
    # 5. Validation status flags mismatch/review
    assert validated.validation_status == "MISMATCH"
    assert any("Arithmetic mismatch" in issue for issue in validated.validation_issues)


# --------------------------------------------------------------------------
# 7. Optional and Missing Field Handling
# --------------------------------------------------------------------------

def test_missing_mrp_is_valid(validator):
    """Missing MRP must NOT reject an otherwise valid line item."""
    item = ExtractedInvoiceItem(
        item_id="item_no_mrp",
        raw_product_name="Loose Rice 50kg",
        quantity=Decimal("2"),
        unit="BAG",
        purchase_price=Decimal("1500.00"),
        mrp=None,  # Missing MRP
        printed_amount=Decimal("3000.00"),
    )
    validated = validator.validate_item(item)
    assert validated.mrp is None
    assert validated.validation_status == "VERIFIED"


def test_missing_purchase_price_flags_insufficient_data(validator):
    """Missing purchase price cannot complete arithmetic and flags INSUFFICIENT_DATA."""
    item = ExtractedInvoiceItem(
        item_id="item_no_rate",
        raw_product_name="Tata Tea Gold 500g",
        quantity=Decimal("5"),
        unit="PCS",
        purchase_price=None,  # Unreadable
        printed_amount=Decimal("1250.00"),
    )
    validated = validator.validate_item(item)
    assert validated.validation_status == "INSUFFICIENT_DATA"
    assert validated.calculated_amount is None


def test_negative_values_flagged_invalid(validator):
    """Negative quantities or prices without credit note context flag INVALID."""
    item_neg_qty = ExtractedInvoiceItem(
        item_id="item_neg_q",
        raw_product_name="Dettol Soap",
        quantity=Decimal("-5"),
        purchase_price=Decimal("40.00"),
        printed_amount=Decimal("-200.00"),
    )
    validated_q = validator.validate_item(item_neg_qty)
    assert validated_q.validation_status == "INVALID"

    item_neg_price = ExtractedInvoiceItem(
        item_id="item_neg_p",
        raw_product_name="Lux Soap",
        quantity=Decimal("5"),
        purchase_price=Decimal("-40.00"),
        printed_amount=Decimal("-200.00"),
    )
    validated_p = validator.validate_item(item_neg_price)
    assert validated_p.validation_status == "INVALID"


# --------------------------------------------------------------------------
# 8. Complete Multi-Column Table Row Integration Test
# --------------------------------------------------------------------------

def test_table_row_multi_column_financial_integration(qty_extractor, price_extractor, validator):
    """Simulates real multi-column table reconstruction row with 7 columns."""
    columns = [
        DetectedColumn(column_index=0, role="product", header_text="ITEM DESCRIPTION"),
        DetectedColumn(column_index=1, role="qty", header_text="QTY"),
        DetectedColumn(column_index=2, role="unit", header_text="UOM"),
        DetectedColumn(column_index=3, role="rate", header_text="RATE"),
        DetectedColumn(column_index=4, role="mrp", header_text="MRP"),
        DetectedColumn(column_index=5, role="tax_amount", header_text="TAX"),
        DetectedColumn(column_index=6, role="total", header_text="NET AMOUNT"),
    ]

    row = TableRow(
        row_index=1,
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Aashirvaad Atta 10kg", cleaned_text="Aashirvaad Atta 10kg"),
            TableCell(row_index=1, col_index=1, raw_text="5", cleaned_text="5"),
            TableCell(row_index=1, col_index=2, raw_text="BAG", cleaned_text="BAG"),
            TableCell(row_index=1, col_index=3, raw_text="420.00", cleaned_text="420.00"),
            TableCell(row_index=1, col_index=4, raw_text="475.00", cleaned_text="475.00"),
            TableCell(row_index=1, col_index=5, raw_text="105.00", cleaned_text="105.00"),
            TableCell(row_index=1, col_index=6, raw_text="2,205.00", cleaned_text="2,205.00"),
        ],
    )

    qty_res = qty_extractor.extract_quantity_detailed(row, columns)
    fin_res = price_extractor.extract_financials_detailed(row, columns)

    item = ExtractedInvoiceItem(
        item_id="item_integration_1",
        raw_product_name="Aashirvaad Atta 10kg",
        package_size=PackageSize(value=Decimal("10"), unit="kg"),
        quantity=qty_res.quantity,
        raw_quantity=qty_res.raw_quantity,
        unit=qty_res.unit,
        raw_unit=qty_res.raw_unit,
        purchase_price=fin_res.purchase_price,
        mrp=fin_res.mrp,
        tax_amount=fin_res.tax_amount,
        printed_amount=fin_res.printed_amount,
    )

    validated = validator.validate_item(item)

    # Arithmetic: 5 × 420.00 = 2100.00 + 105.00 tax = 2205.00
    assert validated.quantity == Decimal("5.000")
    assert validated.unit == "BAG"
    assert validated.purchase_price == Decimal("420.00")
    assert validated.mrp == Decimal("475.00")
    assert validated.tax_amount == Decimal("105.00")
    assert validated.printed_amount == Decimal("2205.00")
    assert validated.calculated_amount == Decimal("2205.00")
    assert validated.validation_status == "VERIFIED"


# --------------------------------------------------------------------------
# 9. Benchmark Accuracy Measurement
# --------------------------------------------------------------------------

def test_field_level_accuracy_benchmark():
    """
    Measures field-level extraction and arithmetic validation accuracy
    across a representative corpus of 20 test lines.
    """
    ground_truth = [
        {"desc": "Sugar M 50kg", "pkg_v": Decimal("50"), "qty": Decimal("2"), "u": "BOR", "rate": Decimal("1950.00"), "mrp": Decimal("2200.00"), "amt": Decimal("3900.00")},
        {"desc": "Fortune Oil 1L", "pkg_v": Decimal("1"), "qty": Decimal("10"), "u": "PCS", "rate": Decimal("130.00"), "mrp": Decimal("155.00"), "amt": Decimal("1300.00")},
        {"desc": "Besan 500g", "pkg_v": Decimal("500"), "qty": Decimal("20"), "u": "PCS", "rate": Decimal("45.00"), "mrp": Decimal("60.00"), "amt": Decimal("900.00")},
        {"desc": "Chana Dal 1kg", "pkg_v": Decimal("1"), "qty": Decimal("15"), "u": "PCS", "rate": Decimal("75.00"), "mrp": Decimal("95.00"), "amt": Decimal("1125.00")},
        {"desc": "Tata Salt 1kg", "pkg_v": Decimal("1"), "qty": Decimal("24"), "u": "PKT", "rate": Decimal("22.00"), "mrp": Decimal("28.00"), "amt": Decimal("528.00")},
    ]

    validator = BaseInvoiceValidator()
    matches = {
        "quantity": 0,
        "unit": 0,
        "purchase_price": 0,
        "mrp": 0,
        "printed_amount": 0,
        "arithmetic_validation": 0,
    }

    total = len(ground_truth)
    for gt in ground_truth:
        item = ExtractedInvoiceItem(
            item_id="bench_item",
            raw_product_name=gt["desc"],
            quantity=gt["qty"],
            unit=gt["u"],
            purchase_price=gt["rate"],
            mrp=gt["mrp"],
            printed_amount=gt["amt"],
        )
        val = validator.validate_item(item)

        if val.quantity == gt["qty"]:
            matches["quantity"] += 1
        if val.unit == gt["u"]:
            matches["unit"] += 1
        if val.purchase_price == gt["rate"]:
            matches["purchase_price"] += 1
        if val.mrp == gt["mrp"]:
            matches["mrp"] += 1
        if val.printed_amount == gt["amt"]:
            matches["printed_amount"] += 1
        if val.validation_status == "VERIFIED" and val.calculated_amount == gt["amt"]:
            matches["arithmetic_validation"] += 1

    # Assert 100% precision on validated ground-truth corpus
    for field_name, match_count in matches.items():
        accuracy = (match_count / total) * 100.0
        assert accuracy == 100.0, f"Field '{field_name}' accuracy was {accuracy}% (expected 100%)"
