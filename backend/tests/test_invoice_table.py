"""Unit tests for invoice table reconstruction and purchase-price extraction (services/invoice_table.py)."""

from decimal import Decimal

from services.invoice_table import (
    Word,
    extract_headerless_lines,
    extract_table,
    group_words_into_rows,
    normalize_unit,
    parse_hsn,
    parse_number,
    parse_quantity,
    reconcile_line,
    rows_from_text,
)

CHAR_W = 11
H = 20


def ocr_rows(spec, conf=95.0):
    """spec: list of (y, [(x0, text) | (x0, text, conf)]) -> rows built from word boxes."""
    words = []
    for y, cells in spec:
        for cell in cells:
            x0, text = cell[0], cell[1]
            c = cell[2] if len(cell) > 2 else conf
            x = x0
            for tok in text.split(" "):
                words.append(Word(tok, x, y, x + CHAR_W * len(tok), y + H, c))
                x += CHAR_W * (len(tok) + 1)
    return group_words_into_rows(words)


def ocr_table(spec, conf=95.0):
    return extract_table(ocr_rows(spec, conf), text_mode=False, extraction_method="OCR_TABLE")


def text_table(text):
    return extract_table(rows_from_text(text), text_mode=True, extraction_method="TABLE_STRUCTURED")


def roles(res):
    return [c.role for c in res.columns]


# ---------------------------------------------------------------- columns

def test_clear_rate_column_is_purchase_price():
    res = ocr_table([
        (10, [(20, "Sri Balaji Traders")]),
        (60, [(20, "Item Description"), (420, "Qty"), (520, "Rate"), (640, "Amount")]),
        (100, [(20, "Tata Salt 1kg"), (425, "24"), (515, "22.00"), (640, "528.00")]),
    ])
    assert roles(res) == ["product", "qty", "rate", "total"]
    item = res.items[0]
    assert item.product_name == "Tata Salt 1kg"
    assert (item.quantity, item.purchase_price, item.line_total) == (24.0, 22.0, 528.0)
    assert item.arithmetic_status == "VERIFIED"
    assert item.issues == []


def test_adjacent_unit_and_rate_headers_stay_separate():
    res = ocr_table([
        (60, [(20, "Item"), (300, "Qty"), (380, "Unit"), (460, "Rate"), (560, "Amount")]),
        (100, [(20, "Toor Dal"), (305, "5"), (380, "kg"), (460, "120.00"), (560, "600.00")]),
    ])
    assert roles(res) == ["product", "qty", "unit", "rate", "total"]
    item = res.items[0]
    assert item.unit == "kg"
    assert item.purchase_price == 120.0
    assert item.quantity == 5.0


def test_unit_rate_written_as_one_phrase_is_the_rate_column():
    # 'Unit Rate' with a normal word space is one header (rate per unit)
    res = ocr_table([
        (60, [(20, "Item"), (300, "Qty"), (400, "Unit Rate"), (560, "Amount")]),
        (100, [(20, "Sugar 1kg"), (305, "10"), (420, "42.50"), (560, "425.00")]),
    ])
    assert roles(res) == ["product", "qty", "rate", "total"]
    assert res.items[0].purchase_price == 42.5


def test_cramped_headers_naming_two_columns_are_split():
    # OCR reads 'Qty Unit' with only a word space between them: still two columns
    res = ocr_table([
        (60, [(20, "Item"), (300, "Qty Unit"), (460, "Rate"), (560, "Amount")]),
        (100, [(20, "Rice"), (305, "2"), (350, "bag"), (460, "1400"), (560, "2800")]),
    ])
    assert roles(res) == ["product", "qty", "unit", "rate", "total"]
    assert res.items[0].unit == "bag"
    assert res.items[0].quantity == 2.0
    assert res.items[0].purchase_price == 1400.0


def test_rupee_symbols_commas_and_decimals():
    res = ocr_table([
        (60, [(20, "Particulars"), (400, "Qty"), (480, "Rate (₹)"), (640, "Amount (₹)")]),
        (100, [(20, "Basmati Rice 25kg"), (405, "2"), (470, "₹1,425.50"), (630, "₹2,851.00")]),
        (140, [(20, "Ghee 15kg Tin"), (405, "1"), (470, "₹1,25,000"), (630, "₹1,25,000.00")]),
    ])
    rice, ghee = res.items
    assert rice.purchase_price == 1425.5 and rice.line_total == 2851.0
    assert ghee.purchase_price == 125000.0 and ghee.line_total == 125000.0
    assert rice.arithmetic_status == ghee.arithmetic_status == "VERIFIED"


def test_rate_before_qty_layout_and_mrp_column():
    res = ocr_table([
        (60, [(20, "Description"), (360, "MRP"), (440, "Rate"), (520, "Qty"), (600, "Amount")]),
        (100, [(20, "Colgate 200g"), (360, "99.00"), (440, "85.00"), (525, "24"), (600, "2,040.00")]),
    ])
    item = res.items[0]
    assert item.invoice_mrp == 99.0
    assert item.purchase_price == 85.0
    assert item.quantity == 24.0
    assert item.line_total == 2040.0


def test_purchase_selling_and_mrp_columns_kept_separate():
    res = text_table("Product | Qty | Purchase Rate | Selling Price | MRP | Amount\nGhee 1L | 5 | 520 | 580 | 620 | 2600\n")
    item = res.items[0]
    assert (item.purchase_price, item.selling_price, item.invoice_mrp, item.line_total) == (520.0, 580.0, 620.0, 2600.0)


def test_gst_percent_and_discount_columns_reconcile():
    # 10 × 100 = 1000, less 5% = 950, plus 18% GST = 1121
    res = text_table("Item | Qty | Rate | Disc % | GST % | Amount\nShampoo 180ml | 10 | 100 | 5 | 18 | 1121.00\n")
    item = res.items[0]
    assert item.discount_pct == 5.0
    assert item.gst_rate == 18.0
    assert item.purchase_price == 100.0
    assert item.arithmetic_status == "VERIFIED"


def test_long_description_does_not_leak_into_qty_column():
    # Description runs past the midpoint between the 'Item' header and 'Qty'
    res = ocr_table([
        (60, [(20, "Item"), (500, "Qty"), (580, "Rate"), (680, "Amount")]),
        (100, [(20, "Fortune Sunflower Refined Oil 1L Pouch"), (505, "10"), (575, "135.00"), (680, "1350.00")]),
    ])
    item = res.items[0]
    assert item.product_name == "Fortune Sunflower Refined Oil 1L Pouch"
    assert item.quantity == 10.0


def test_header_found_after_long_supplier_block():
    preamble = [(10 + i * 30, [(20, f"Address line {i} Market Road")]) for i in range(18)]
    res = ocr_table(preamble + [
        (600, [(20, "Item"), (400, "Qty"), (480, "Rate"), (580, "Total")]),
        (640, [(20, "Parle-G 800g"), (405, "30"), (480, "60.00"), (580, "1800.00")]),
    ])
    assert len(res.items) == 1
    assert res.items[0].line_total == 1800.0


def test_wrapped_description_joins_previous_item_not_next():
    res = ocr_table([
        (60, [(20, "Item"), (420, "Qty"), (500, "Rate"), (600, "Amount")]),
        (100, [(20, "Fortune Sunflower Refined"), (425, "5"), (500, "135.00"), (600, "675.00")]),
        (122, [(20, "Oil 1L Pouch")]),
        (160, [(20, "Tata Salt 1kg"), (425, "24"), (500, "22.00"), (600, "528.00")]),
    ])
    names = [it.product_name for it in res.items]
    assert names == ["Fortune Sunflower Refined Oil 1L Pouch", "Tata Salt 1kg"]


def test_table_stops_at_totals_and_footer_is_not_an_item():
    res = text_table(
        "Item    Qty    Rate    Amount\n"
        "Tata Salt 1kg    24    22.00    528.00\n"
        "Grand Total    528.00\n"
        "CGST 2.5%    13.20\n"
        "Bank: SBI A/c 1234567890\n"
    )
    assert [it.product_name for it in res.items] == ["Tata Salt 1kg"]


# ---------------------------------------------------------------- missing / unreadable values

def test_missing_rate_is_not_invented():
    res = text_table("Item | Qty | Rate | Amount\nCoffee 200g | 2 |  | 500\n")
    item = res.items[0]
    assert item.purchase_price is None
    assert item.quantity == 2.0
    assert item.line_total == 500.0
    assert item.suggested_rate == 250.0
    assert any("Rate could not be read" in i for i in item.issues)


def test_unreadable_rate_text_is_not_turned_into_a_number():
    res = text_table("Item | Qty | Rate | Amount\nCoffee 200g | 2 | ab.cd | 500\n")
    assert res.items[0].purchase_price is None


def test_missing_quantity_is_not_defaulted_to_one():
    res = text_table("Item | Qty | Rate | Amount\nTea 1kg |  | 450 | 900\n")
    item = res.items[0]
    assert item.quantity is None
    assert item.purchase_price == 450.0
    assert any("Quantity could not be read" in i for i in item.issues)


def test_mismatch_keeps_printed_amount_and_offers_suggestion():
    # OCR dropped the decimal point in the rate: 2200 instead of 22.00
    res = text_table("Item | Qty | Rate | Amount\nTata Salt 1kg | 24 | 2200 | 528.00\n")
    item = res.items[0]
    assert item.arithmetic_status == "MISMATCH"
    assert item.purchase_price == 2200.0      # not silently rewritten
    assert item.line_total == 528.0           # printed amount kept
    assert any("Rate may be ₹22" in s for s in item.suggestions)


def test_missing_amount_is_calculated_but_never_reported_as_printed():
    res = text_table("Item | Qty | Rate\nMaggi 70g | 48 | 12.50\n")
    item = res.items[0]
    assert item.line_total is None            # nothing printed, nothing invented
    assert item.line_total_source is None
    assert item.calculated_amount == Decimal("600.00")
    assert item.arithmetic_status == "INSUFFICIENT_DATA"
    assert any("not printed" in i for i in item.issues)


def test_low_confidence_numbers_are_flagged():
    res = ocr_table([
        (60, [(20, "Item"), (400, "Qty"), (480, "Rate"), (580, "Amount")]),
        (100, [(20, "Tata Salt 1kg"), (405, "24"), (480, "22.00", 31.0), (580, "528.00")]),
    ])
    item = res.items[0]
    assert any("Low OCR confidence for Rate" in i for i in item.issues)
    assert item.confidence < 85


# ---------------------------------------------------------------- number parsing

def test_parse_number_rules():
    assert parse_number("₹ 1,250.50").value == 1250.5
    assert parse_number("Rs.250/-").value == 250.0
    assert parse_number("1,25,000.00").value == 125000.0
    assert parse_number("250,50").value == 250.5
    assert parse_number("(250.00)").value == -250.0
    assert parse_number("—").value is None
    assert parse_number("").value is None
    # letter-for-digit slips only inside tokens that contain digits, and they are marked
    fixed = parse_number("2O0.00")
    assert fixed.value == 200.0 and fixed.corrected
    assert parse_number("SO").value is None
    assert parse_number("abc").value is None
    # two different numbers in one cell are ambiguous
    amb = parse_number("22.00 528.00")
    assert amb.value is None and amb.ambiguous


def test_reconcile_tax_amount_and_discount():
    assert reconcile_line(10, 100, 1050, tax_amount=50).status == "VERIFIED"
    assert reconcile_line(10, 100, 900, discount=100).status == "VERIFIED"
    assert reconcile_line(10, 100, 1000).status == "VERIFIED"
    assert reconcile_line(10, 100, 1300).status == "MISMATCH"


# ---------------------------------------------------------------- receipts without headers

def test_headerless_receipt_accepts_only_verifiable_lines():
    res = extract_headerless_lines(rows_from_text(
        "Kiran General Store\n"
        "Amul Milk 500ml 2 x 27 = 54\n"
        "Britannia Good Day 3 20.00 60.00\n"
        "Loose Item 50\n"
        "TOTAL 114\n"
    ))
    names = [it.product_name for it in res.items]
    assert names == ["Amul Milk 500ml", "Britannia Good Day"]
    milk = res.items[0]
    assert (milk.quantity, milk.purchase_price, milk.line_total) == (2.0, 27.0, 54.0)
    assert all(it.issues for it in res.items)  # always flagged for review


# --------------------------------------------------------------------------
# Field parsers (quantity + printed unit, OCR repairs, percentages, HSN)
# --------------------------------------------------------------------------


def test_quantity_and_printed_unit_are_read_together():
    cases = {
        "1.0 BOR": (Decimal("1.0"), "BOR"), "2.0BOR": (Decimal("2.0"), "BOR"), "3.0PET": (Decimal("3.0"), "PET"),
        "25.0 KGS": (Decimal("25.0"), "KGS"), "10 Nos": (Decimal("10"), "Nos"), "12": (Decimal("12"), None),
        "10ltr": (Decimal("10"), "ltr"), "5lbs": (Decimal("5"), "lbs"),
    }
    for text, (value, unit) in cases.items():
        p = parse_quantity(text)
        assert (p.value, p.unit) == (value, unit), text
        assert not p.corrected, text


def test_quantity_letters_that_only_make_sense_as_digits_are_repaired_and_flagged():
    p = parse_quantity("1O")
    assert (p.value, p.unit, p.corrected) == (Decimal("10"), None, True)
    p = parse_quantity("2OOml")
    assert (p.value, p.unit, p.corrected) == (Decimal("200"), "ml", True)


def test_units_are_normalized_only_through_the_explicit_table():
    assert normalize_unit("PCS") == "pcs" and normalize_unit("KGS") == "kg" and normalize_unit("Bag") == "bag"
    assert normalize_unit("BOR") is None and normalize_unit("PET") is None  # never guessed as kg / pieces


def test_number_cells_with_percentages_and_misread_rupee_signs():
    p = parse_number("124.08 (3%)")
    assert (p.value, p.percent) == (Decimal("124.08"), Decimal("3"))
    p = parse_number("(3%)")
    assert (p.value, p.percent) == (None, Decimal("3"))  # a percentage, never a negative number
    p = parse_number("K215.76")
    assert (p.value, p.symbol_stripped) == (Decimal("215.76"), True)  # never 8215.76
    p = parse_number("1:12")
    assert (p.value, p.corrected) == (Decimal("1.12"), True)
    assert parse_number("05/10/2026").value is None
    assert parse_number("SBW1021").value is None


def test_hsn_codes():
    assert parse_hsn("-") == (None, None)
    assert parse_hsn("") == (None, None)
    assert parse_hsn("30") == ("30", None)
    assert parse_hsn("1101 0000") == ("11010000", None)
    code, issue = parse_hsn("3O")
    assert code is None and "not a valid HSN" in issue


def test_arithmetic_uses_decimal_and_a_documented_tolerance():
    # 25 × 44.96 + 1.12 = 1125.12; printed 1125.00 is within ₹0.005 × 25 + ₹0.02 = ₹0.145
    ok = reconcile_line(Decimal("25"), Decimal("44.96"), Decimal("1125.00"), tax_amount=Decimal("1.12"))
    assert ok.status == "VERIFIED"
    assert (ok.calculated_amount, ok.amount_difference) == (Decimal("1125.12"), Decimal("-0.12"))
    bad = reconcile_line(Decimal("25"), Decimal("44.96"), Decimal("1126.00"), tax_amount=Decimal("1.12"))
    assert bad.status == "MISMATCH" and bad.amount_difference == Decimal("0.88")
    assert bad.line_total == Decimal("1126.00")  # printed amount kept
    # 0.1 + 0.2 style float error cannot creep in
    assert reconcile_line(Decimal("3"), Decimal("0.10"), Decimal("0.30")).amount_difference == Decimal("0.00")
