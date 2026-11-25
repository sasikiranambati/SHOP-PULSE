"""
Phase 3A – approved reliability corrections R1–R10 and free/bundle handling.

Each test names the correction it verifies (V-model: implementation -> unit/integration test).
Inputs are hand-built table rows and pipeline results (no OCR, deterministic); the values are
generic test data, not taken from any supplied invoice.
"""

import uuid
from decimal import Decimal
from typing import List, Optional

import pytest

from services import mrp_lookup
from services.grocery_ocr.extraction.column_wise_extractor import ColumnWiseExtractor
from services.grocery_ocr.extraction.numeric_parser import NumericParser
from services.grocery_ocr.extraction.price_extractor import BasePriceExtractor, is_money_like
from services.grocery_ocr.schemas.invoice import ExtractedInvoice, InvoiceProcessingMetadata
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem
from services.grocery_ocr.schemas.ocr import BoundingBox
from services.grocery_ocr.schemas.table import DetectedColumn, TableCell, TableRow


# --------------------------------------------------------------------------------------- helpers


def cols(*spec) -> List[DetectedColumn]:
    """spec: (role, header) in column order; x ranges 100 px wide."""
    return [DetectedColumn(role=r, header_text=h, column_index=i, x_start=i * 100.0, x_end=(i + 1) * 100.0)
            for i, (r, h) in enumerate(spec)]


def row(*texts, idx: int = 1) -> TableRow:
    cells = [TableCell(row_index=idx, col_index=i, raw_text=t, cleaned_text=t,
                       bbox=BoundingBox(x0=i * 100.0 + 5, y0=10.0, x1=i * 100.0 + 90, y1=30.0) if t else None)
             for i, t in enumerate(texts)]
    return TableRow(row_index=idx, cells=cells, raw_text=" | ".join(texts),
                    bbox=BoundingBox(x0=0.0, y0=10.0, x1=len(texts) * 100.0, y1=30.0))


class _NoProducts:
    def query(self, *a, **k):
        return self

    def filter(self, *a, **k):
        return self

    def all(self):
        return []


def run_api(monkeypatch, items: List[ExtractedInvoiceItem], custom: Optional[dict] = None):
    """Run the /invoices/extract mapping on a fixed pipeline result."""
    from services import invoice as inv

    meta = InvoiceProcessingMetadata(filename="t.png")
    meta.custom_properties.update(custom or {})
    result = ExtractedInvoice(invoice_id="inv_t", original_filename="t.png", status="SUCCESS", items=items,
                              total_items_count=len(items), metadata=meta)
    monkeypatch.setattr(inv.InvoicePipeline, "process", lambda self, *a, **k: result)
    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.NoProvider())
    return inv._extract_invoice_with_new_pipeline(b"x", "t.png", _NoProducts(), uuid.uuid4())


def item(name="Tata Salt 1kg", qty=None, rate=None, amount=None, unit="pcs", **kw) -> ExtractedInvoiceItem:
    d = lambda v: Decimal(str(v)) if v is not None else None  # noqa: E731
    return ExtractedInvoiceItem(item_id=f"i_{uuid.uuid4().hex[:6]}", raw_product_name=name,
                                normalized_product_name=name, quantity=d(qty), purchase_price=d(rate),
                                printed_amount=d(amount), validation_status="VERIFIED", ocr_confidence=95.0, unit=unit, **kw)


# --------------------------------------------------------------------------------------- R1


def test_r1_calculated_quantity_is_flagged_never_verified(monkeypatch):
    res = run_api(monkeypatch, [item(qty=None, rate=22, amount=440)])
    it = res.items[0]
    assert it.quantity == 20.0
    assert it.derived_fields == ["quantity"]
    assert it.needs_review is True and it.is_verified is False
    assert any("calculated" in i.lower() for i in it.validation_issues)


def test_r1_incorrect_calculated_quantity_from_misread_rate_is_flagged(monkeypatch):
    # Rate "2,760.00" misread as 276000 -> quantity would be calculated as 0.01: must be flagged
    res = run_api(monkeypatch, [item("CHANA 50 KG", qty=None, rate=276000, amount=2760)])
    it = res.items[0]
    assert it.quantity == pytest.approx(0.01)
    assert "quantity" in it.derived_fields and it.needs_review is True and it.is_verified is False


def test_r1_calculated_rate_is_flagged(monkeypatch):
    res = run_api(monkeypatch, [item(qty=20, rate=None, amount=440)])
    it = res.items[0]
    assert it.purchase_price == 22.0 and it.derived_fields == ["purchase_price"]
    assert it.needs_review is True and it.is_verified is False


def test_r1_incorrect_calculated_rate_from_gst_percent_is_flagged(monkeypatch):
    # An "amount" of 18 (really GST %) with qty 50 gives a calculated rate of 0.36 -> flagged
    res = run_api(monkeypatch, [item(qty=50, rate=None, amount=18)])
    it = res.items[0]
    assert it.purchase_price == pytest.approx(0.36)
    assert it.needs_review is True and "purchase_price" in it.derived_fields


def test_r1_read_values_that_agree_are_verified(monkeypatch):
    it = run_api(monkeypatch, [item(qty=20, rate=22, amount=440)]).items[0]
    assert it.derived_fields == [] and it.is_verified is True and it.needs_review is False


def test_r1_calculation_uses_decimal_half_up():
    from services.invoice import _money, resolve_item_arithmetic_py

    assert _money(Decimal("0.045")) == Decimal("0.05")  # float round() gives 0.04
    assert round(0.09 / 2, 2) == 0.04  # documents the float behaviour that was replaced
    # calculated rates keep up to 3 decimals (printed precision), rounded half-up beyond that
    assert resolve_item_arithmetic_py(2.0, None, 0.09)["suggested_rate"] == 0.045
    assert resolve_item_arithmetic_py(3.0, None, 0.01)["suggested_rate"] == 0.003
    assert resolve_item_arithmetic_py(12.0, None, 85.716)["suggested_rate"] == 7.143


def test_r1_discount_included_in_arithmetic_check():
    from services.invoice import resolve_item_arithmetic_py

    # 40 x 2.65 - 5.30 discount + 18.13 tax = 118.83 vs printed 118.78 (rate printed rounded)
    assert resolve_item_arithmetic_py(40, 2.65, 118.78, tax=18.13, discount=5.30)["status"] == "VERIFIED"
    assert resolve_item_arithmetic_py(40, 2.65, 118.78, tax=18.13)["status"] == "MISMATCH"


# --------------------------------------------------------------------------------------- R2


def test_r2_money_like_values_only():
    assert is_money_like("245.00") and is_money_like("1,378.62") and is_money_like("62.988")
    for not_money in ("33061020", "480", "18", "12046", "2+1", "0/12", ""):
        assert not is_money_like(not_money), not_money
    assert is_money_like("960.00 |") and is_money_like("| 2,460.00 |") and is_money_like("[245.00")


def test_r2_hsn_upc_gst_never_become_the_amount():
    pe = BasePriceExtractor()
    c = cols(("product", "Product Name"), ("hsn", "HSN"), ("unknown", "UPC"), ("gst_rate", "GST %"))
    r = pe.extract_financials_detailed(row("FABRIC CONDITIONER 20ML", "33061020", "480", "18"), c)
    assert r.printed_amount is None


def test_r2_unlabelled_money_value_is_used_only_with_review():
    pe = BasePriceExtractor()
    c = cols(("product", "Item"), ("hsn", "HSN"), ("unknown", "?"))
    r = pe.extract_financials_detailed(row("SALT 1KG", "25010010", "163.40"), c)
    assert r.printed_amount == Decimal("163.40") and r.review_reasons


def test_r2_amount_left_empty_and_flagged_in_api(monkeypatch):
    it = run_api(monkeypatch, [item(qty=None, rate=None, amount=None)]).items[0]
    assert it.line_total is None and it.printed_amount is None and it.needs_review is True


def test_r2_mrp_decimal_loss_is_suggested_not_applied():
    pe = BasePriceExtractor()
    c = cols(("product", "Item"), ("rate", "Rate"), ("mrp", "MRP"), ("total", "Amount"))
    r = pe.extract_financials_detailed(row("OIL 1L", "140.00", "17500", "1680.00"), c)
    assert r.mrp == Decimal("17500.00")  # printed reading kept
    assert any("175" in s for s in r.suggestions) and r.review_reasons


# --------------------------------------------------------------------------------------- R6


GST_COLS = cols(("product", "Product Name"), ("qty", "Pcs"), ("rate", "Base Rate"), ("discount", "Sch Disc"),
                ("discount", "RS Disc"), ("taxable", "Taxable Amt"), ("gst_rate", "GST %"),
                ("tax_amount", "CGST Amt"), ("tax_amount", "S/UTGST Amt"), ("total", "Net Amt"))
GST_ROW = ("SOAP 75G", "12", "31.50", "14.40", "0.00", "363.60", "5", "9.09", "9.09", "381.78")


def test_r6_cgst_and_sgst_kept_separately_and_summed():
    r = BasePriceExtractor().extract_financials_detailed(row(*GST_ROW), GST_COLS)
    assert r.components["cgst_amount"] == Decimal("9.09") and r.components["sgst_amount"] == Decimal("9.09")
    assert r.tax_amount == Decimal("18.18")


def test_r6_multiple_discount_columns_never_overwrite_each_other():
    r = BasePriceExtractor().extract_financials_detailed(row(*GST_ROW), GST_COLS)
    assert r.components["scheme_discount"] == Decimal("14.40")
    assert r.components["other_discount"] == Decimal("0.00")
    assert r.discount == Decimal("14.40")  # before: the RS Disc 0.00 overwrote the scheme discount


def test_r6_taxable_and_net_amount_separate_and_gst_not_an_amount():
    r = BasePriceExtractor().extract_financials_detailed(row(*GST_ROW), GST_COLS)
    assert r.taxable_amount == Decimal("363.60") and r.printed_amount == Decimal("381.78")
    assert r.gst_rate == Decimal("5.00") and r.purchase_price == Decimal("31.50")


def test_r6_cgst_sgst_percent_columns_give_total_gst_rate():
    c = cols(("product", "Item"), ("gst_rate", "CGST %"), ("gst_rate", "SGST %"), ("total", "Amount"))
    r = BasePriceExtractor().extract_financials_detailed(row("AGARBATTI", "9", "9", "387.82"), c)
    assert r.gst_rate == Decimal("18")


def test_r6_components_reach_the_api_response(monkeypatch):
    extracted = ColumnWiseExtractor().extract_row(row("1", *GST_ROW), cols(("serial", "Sl"), *[
        (c.role, c.header_text) for c in GST_COLS]))
    from services.grocery_ocr.pipeline.invoice_pipeline import extraction_metadata

    it = item("SOAP 75G", qty=12, rate=Decimal("31.50"), amount=Decimal("381.78"),
              discount=extracted.discount, tax_amount=extracted.tax_amount, taxable_amount=extracted.taxable_amount)
    it.metadata.update(extraction_metadata(extracted))
    out = run_api(monkeypatch, [it]).items[0]
    assert (out.cgst_amount, out.sgst_amount) == (9.09, 9.09)
    assert (out.scheme_discount, out.other_discount) == (14.40, 0.0)
    assert out.taxable_amount == 363.60 and out.net_amount == 381.78
    # 12 x 31.50 - 14.40 + 18.18 = 381.78 = printed net: read values agree
    assert out.is_verified is True


def test_r6_carry_forward_matches_rows_by_position_and_name():
    from services.grocery_ocr.pipeline.invoice_pipeline import carry_forward_unexported_fields

    pre = [item("A"), item("B")]
    pre[0].metadata["financial_components"] = {"cgst_amount": "1.00"}
    pre[0].taxable_amount = Decimal("10.00")
    post = [item("A"), item("Different")]
    carry_forward_unexported_fields(pre, post)
    assert post[0].metadata["financial_components"] == {"cgst_amount": "1.00"}
    assert post[0].taxable_amount == Decimal("10.00")
    assert "financial_components" not in post[1].metadata  # never moved to another product


# --------------------------------------------------------------------------------------- R7


@pytest.mark.parametrize("text,expected", [("62.988", "62.988"), ("7.143", "7.143"), ("90.000", "90.000"),
                                           ("245.00", "245.00"), ("2760", "2760.00"), ("58.75", "58.75")])
def test_r7_printed_decimals_preserved(text, expected):
    assert str(NumericParser().parse_currency(text).value) == expected


def test_r7_three_decimals_survive_the_excel_round_trip(tmp_path):
    from services.grocery_ocr.excel.workbook_generator import BaseWorkbookGenerator
    from services.grocery_ocr.excel.workbook_parser import BaseWorkbookParser

    inv = ExtractedInvoice(invoice_id="x", original_filename="x.png", status="SUCCESS",
                           items=[item("BISCUIT 5RS", qty=12, rate=Decimal("7.143"), amount=Decimal("90.000")),
                                  item("SALT", qty=20, rate=Decimal("22.00"), amount=Decimal("440.00"))],
                           metadata=InvoiceProcessingMetadata(filename="x.png"))
    parsed = BaseWorkbookParser().parse(BaseWorkbookGenerator().generate(inv))
    assert parsed.items[0].purchase_price == Decimal("7.143")
    assert parsed.items[0].printed_amount == Decimal("90.00")  # 90.000 == 90.00 (no 3rd digit lost)
    assert parsed.items[1].purchase_price == Decimal("22.00")


def test_r7_three_decimal_amount_reaches_api(monkeypatch):
    it = run_api(monkeypatch, [item("BUTTER COOKIES", qty=12, rate=Decimal("5.249"), amount=Decimal("62.988"))]).items[0]
    assert it.printed_amount == 62.988 and it.purchase_price == 5.249


# --------------------------------------------------------------------------------------- R3


def _page(tokens: List[str]):
    from services.grocery_ocr.schemas.ocr import OCRPageResult, OCRWord

    words = [OCRWord(text=t, bbox=BoundingBox(x0=i * 50.0, y0=10.0, x1=i * 50.0 + 40, y1=30.0), confidence=90.0,
                     page_number=1) for i, t in enumerate(tokens)]
    return OCRPageResult(width=2000, height=1000, raw_text=" ".join(tokens), words=words, confidence=90.0)


class _FakeEngine:
    engine_name = "fake"

    def __init__(self, default_tokens, fallback_tokens):
        self.calls = []
        self.pages = {"3": _page(default_tokens), "6": _page(fallback_tokens)}

    def recognize(self, image_bytes, page_number=1, options=None):
        psm = str((options or {}).get("psm", "3"))
        self.calls.append(psm)
        return self.pages[psm]


def _r3(default_tokens, fallback_tokens):
    from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline

    eng = _FakeEngine(default_tokens, fallback_tokens)
    pipe = InvoicePipeline(ocr_engine=eng)
    meta = InvoiceProcessingMetadata(filename="t.png")
    chosen = pipe._compare_fallback_segmentation(b"png", 1, eng.recognize(b"png"), meta)
    return eng, chosen, meta


def test_r3_fallback_mode_used_when_default_splits_decimals():
    eng, chosen, meta = _r3(["125.", "00", "12.", ".00", "6.", ".00", "84.", ".00"],
                            ["125.00", "12.00", "6.00", "84.00", "38.00"])
    assert eng.calls == ["3", "6"]
    assert [w.text for w in chosen.words][0] == "125.00"
    assert meta.custom_properties["ocr_psm_used"] == "6"
    assert meta.custom_properties["ocr_psm_selection"][0]["chosen_psm"] == "6"


def test_r3_default_kept_when_the_second_reading_is_not_better():
    # Both readings are always compared (TC30: the automatic layout dropped a whole column band);
    # the single-block reading is kept only when it is clearly better.
    eng, chosen, meta = _r3(["125.00", "12.00", "6.00", "Salt"], ["125.00"])
    assert eng.calls == ["3", "6"]
    assert meta.custom_properties["ocr_psm_used"] == "3" and chosen.words[0].text == "125.00"
    assert meta.custom_properties["ocr_psm_selection"][0]["chosen_psm"] == "3"


def test_r3_second_reading_kept_when_the_default_lost_a_table():
    # TC03: the automatic layout read no amounts from a photographed ruled table
    eng, chosen, meta = _r3(["Bill", "To", "Item", "Description"],
                            ["Atta", "4", "bag", "245.00", "289.00", "980.00", "Salt", "20", "22.00", "440.00"])
    assert meta.custom_properties["ocr_psm_used"] == "6"
    assert meta.custom_properties["ocr_psm_selection"][0]["reason"] == "read clearly more amounts"


def test_r3_second_reading_kept_when_the_default_dropped_a_column():
    # TC30: same amounts, but the Qty / Unit column band is missing from the default reading
    default = ["Nescafe", "175.00", "210.00", "2625.00"] * 4
    alt = ["Nescafe", "15", "jar", "175.00", "210.00", "2625.00"] * 4
    eng, chosen, meta = _r3(default, alt)
    assert meta.custom_properties["ocr_psm_selection"][0]["reason"] == "read more of the table text"
    assert "jar" in [w.text for w in chosen.words]


def test_r9_line_with_its_own_hsn_and_values_is_not_a_continuation():
    from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor

    c = cols(("serial", "Sl"), ("hsn", "HSN"), ("product", "Product Name"), ("qty", "Pcs"), ("taxable", "Taxable"),
             ("total", "Net Amt"))
    rows = [row("2", "21069099", "KETCHUP 500G", "24", "2280.00", "2553.60", idx=1),
            row("", "34013090", "HAND WASH (With", "", "540.00", "", idx=2)]
    for i, r in enumerate(rows):
        r.bbox = BoundingBox(x0=0.0, y0=100.0 + i * 25, x1=600.0, y1=120.0 + i * 25)
    out = BaseTableReconstructor()._reconstruct_multiline_product_rows(rows, c, 20.0, None)
    assert len(out) == 2 and out[0].cells[2].cleaned_text == "KETCHUP 500G"


def test_r3_fallback_not_chosen_unless_clearly_better():
    eng, chosen, meta = _r3(["125.", ".00", "12.", ".00", "245.00", "22.00", "9.50"],
                            ["125.00", "12.00", "245.00"])
    assert eng.calls == ["3", "6"]  # compared ...
    assert meta.custom_properties["ocr_psm_used"] == "3"  # ... but the default kept


# --------------------------------------------------------------------------------------- R4


def _words_row(idx: int, y: float, words):
    from services.grocery_ocr.schemas.ocr import OCRWord

    ws = [OCRWord(text=t, bbox=BoundingBox(x0=x0, y0=y, x1=x1, y1=y + 20), confidence=95.0, page_number=1)
          for t, x0, x1 in words]
    cells = [TableCell(row_index=idx, col_index=i, raw_text=w.text, cleaned_text=w.text, words=[w], bbox=w.bbox)
             for i, w in enumerate(ws)]
    return TableRow(row_index=idx, cells=cells, raw_text=" ".join(t for t, _, _ in words),
                    bbox=BoundingBox(x0=ws[0].bbox.x0, y0=y, x1=ws[-1].bbox.x1, y1=y + 20))


def _two_line_table(header_row_index: int):
    from services.grocery_ocr.schemas.table import TableResult

    rows = [
        _words_row(0, 100, [("Product", 100, 170), ("Name", 175, 220), ("Base", 400, 450), ("Taxable", 600, 680),
                            ("Net", 800, 840)]),
        _words_row(1, 124, [("Rate", 400, 450), ("Amt", 600, 640), ("Amt", 800, 840)]),
        _words_row(2, 160, [("Salt", 100, 140), ("1kg", 145, 175), ("22.00", 400, 450), ("440.00", 600, 660),
                            ("462.00", 800, 860)]),
    ]
    return TableResult(rows=rows, header_row_index=header_row_index, page_number=1)


@pytest.mark.parametrize("header_row_index", [0, 1])
def test_r4_two_line_headings_are_merged(header_row_index):
    from services.grocery_ocr.extraction.dynamic_schema_generator import DynamicSchemaGenerator

    table = _two_line_table(header_row_index)
    roles = [c.role for c in DynamicSchemaGenerator().generate_schema(table).columns]
    assert roles == ["product", "rate", "taxable", "total"], roles
    assert table.rows[1 - header_row_index].is_header is True  # second heading line is not data
    assert table.rows[2].is_header is False


def test_r4_data_row_is_never_taken_as_a_heading_line():
    from services.grocery_ocr.extraction.dynamic_schema_generator import DynamicSchemaGenerator

    gen = DynamicSchemaGenerator()
    hdr = [w for c in _two_line_table(0).rows[0].cells for w in c.words]
    data = [w for c in _two_line_table(0).rows[2].cells for w in c.words]
    assert gen._is_stacked_header_line(data, hdr, 20.0) is False


def test_r4_sub_label_under_group_heading_is_not_the_line_total():
    from services.grocery_ocr.extraction.header_intelligence import HeaderIntelligenceEngine
    from services.grocery_ocr.schemas.ocr import OCRWord

    def w(t, x0, x1, y):
        return OCRWord(text=t, bbox=BoundingBox(x0=x0, y0=y, x1=x1, y1=y + 20), confidence=95.0, page_number=1)

    line1 = [w("Taxable", 300, 380, 100), w("IGST", 500, 540, 100), w("Total", 700, 750, 100)]
    line2 = [w("%", 450, 465, 124), w("Amount", 560, 630, 124)]
    cands = HeaderIntelligenceEngine().extract_header_candidates([line1, line2], 20.0)
    roles = {c.raw_text: c.role for c in cands}
    assert roles["IGST Amount"] == "tax_amount" and roles["IGST %"] == "gst_rate" and roles["Total"] == "total"


# --------------------------------------------------------------------------------------- R5


R5_COLS = cols(("serial", "Sl"), ("product", "Product Name"), ("units_per_case", "UPC"), ("mrp", "MRP"),
               ("cases", "Cs"), ("qty", "Pcs"), ("rate", "Base Rate"), ("taxable", "Taxable Amt"))


def test_r5_case_columns_recognised():
    from services.grocery_ocr.extraction.header_intelligence import HeaderIntelligenceEngine

    h = HeaderIntelligenceEngine()
    assert [h.classify_text(t)[0] for t in ("UPC", "Cs", "Cases", "Pcs")] == ["units_per_case", "cases", "cases", "qty"]


def test_r5_cases_times_units_plus_pieces_is_calculated_and_flagged():
    rec = ColumnWiseExtractor().extract_row(row("11", "SCRUB PAD 3PC", "40", "25.00", "1", "0", "19.50", "780.00"),
                                            R5_COLS)
    assert rec.quantity == Decimal("40") and rec.derived_fields == ["quantity"]
    assert rec.quantity_details["cases"] == Decimal("1") and rec.quantity_details["units_per_case"] == Decimal("40")
    assert any("case" in r for r in rec.review_reasons)


def test_r5_zero_cases_keeps_printed_pieces_without_calculation():
    rec = ColumnWiseExtractor().extract_row(row("1", "FABRIC CONDITIONER 20ML", "480", "5.00", "0", "40", "4.20", "168.00"),
                                            R5_COLS)
    assert rec.quantity == Decimal("40") and rec.derived_fields == [] and rec.review_reasons == []


def test_r5_cases_without_units_per_case_leave_quantity_empty():
    c = cols(("product", "Item"), ("cases", "Cs"), ("qty", "Pcs"), ("rate", "Rate"), ("total", "Amount"))
    rec = ColumnWiseExtractor().extract_row(row("OIL 1L", "2", "0", "140.00", "1680.00"), c)
    assert rec.quantity is None and any("units per case" in r for r in rec.review_reasons)


def test_r5_cases_slash_pieces_format():
    c = cols(("product", "Product Description"), ("qty", "Qtysold"), ("rate", "Basic.Rt"), ("total", "Netamount"))
    rec = ColumnWiseExtractor().extract_row(row("CHOCO WAFER 10RS", "0/12", "7.143", "90.000"), c)
    assert rec.quantity == Decimal("12") and rec.quantity_details["cases"] == Decimal("0")
    assert rec.purchase_price == Decimal("7.143") and rec.printed_amount == Decimal("90.000")


def test_r5_paid_plus_free_line_arithmetic_uses_paid_units():
    """The extractor keeps the paid units for the line arithmetic; the API reports paid + free as the
    received quantity (see test_phase3a_followup)."""
    c = cols(("product", "Item"), ("qty", "Qty"), ("rate", "Rate"), ("total", "Amount"))
    rec = ColumnWiseExtractor().extract_row(row("BISCUIT 5RS", "10+1", "4.50", "45.00"), c)
    assert rec.quantity == Decimal("10") and rec.quantity_details["free_quantity"] == Decimal("1")
    assert any("free" in r for r in rec.review_reasons)


def test_r5_long_upc_value_is_a_barcode_not_units_per_case():
    rec = ColumnWiseExtractor().extract_row(
        row("1", "SALT 1KG", "8901030865278", "28.00", "1", "20", "22.00", "440.00"), R5_COLS)
    assert rec.barcode == "8901030865278" and "units_per_case" not in rec.quantity_details
    assert rec.quantity is None  # 1 case with unknown units per case -> entered by the user


# --------------------------------------------------------------------------------------- R9


def test_r9_name_line_and_numbers_line_join():
    from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor

    c = cols(("serial", "Sno"), ("product", "Product Name"), ("qty", "Qtysold"), ("rate", "Netrate"),
             ("total", "Totamount"))
    rows = [row("1", "WAFER BAR 10/-", "", "", "", idx=1), row("", "", "1", "240.00", "240.000", idx=2),
            row("2", "CANDY BOX 5/-", "", "", "", idx=3), row("", "", "1", "150.00", "150.000", idx=4)]
    for i, r in enumerate(rows):
        r.bbox = BoundingBox(x0=0.0, y0=100.0 + i * 25, x1=500.0, y1=120.0 + i * 25)
    out = BaseTableReconstructor()._reconstruct_multiline_product_rows(rows, c, 20.0, None)
    assert len(out) == 2
    assert [x.cleaned_text for x in out[0].cells] == ["1", "WAFER BAR 10/-", "1", "240.00", "240.000"]
    assert [x.cleaned_text for x in out[1].cells] == ["2", "CANDY BOX 5/-", "1", "150.00", "150.000"]


def test_r9_neighbouring_products_with_their_own_numbers_are_not_merged():
    from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor

    c = cols(("serial", "Sl"), ("product", "Item"), ("qty", "Qty"), ("rate", "Rate"), ("total", "Amount"))
    rows = [row("1", "SALT 1KG", "20", "22.00", "440.00", idx=1), row("", "", "5", "9.50", "47.50", idx=2)]
    for i, r in enumerate(rows):
        r.bbox = BoundingBox(x0=0.0, y0=100.0 + i * 25, x1=500.0, y1=120.0 + i * 25)
    out = BaseTableReconstructor()._reconstruct_multiline_product_rows(rows, c, 20.0, None)
    assert len(out) == 2 and out[0].cells[2].cleaned_text == "20"  # second line not folded into the first


# --------------------------------------------------------------------------------------- R8


def _page_on_table(offset_x: int, canvas_w: int):
    import numpy as np

    from doc_prep_dataset import PAGE_1_ITEMS, render_invoice_page

    page = render_invoice_page(PAGE_1_ITEMS).image  # 1240 x 1754, text up to 80 px from the edges
    canvas = np.full((1950, canvas_w, 3), (60, 72, 85), np.uint8)
    rng = np.random.default_rng(3)
    canvas = np.clip(canvas.astype(int) + rng.normal(0, 6, canvas.shape), 0, 255).astype(np.uint8)
    x1 = min(canvas_w, offset_x + page.shape[1])
    canvas[100:100 + page.shape[0], offset_x:x1] = page[:, : x1 - offset_x]
    return canvas


def test_r8_cropped_page_is_not_reshaped_and_asks_for_a_retake():
    from services.document_prep.document_detector import detect_document

    det = detect_document(_page_on_table(offset_x=200, canvas_w=1300))  # right side of the page cut off
    assert det.outline_reliable is False and det.should_warp is False
    assert det.cut_off is True and "right" in det.cut_off_edges


def test_r8_whole_page_on_a_table_is_not_marked_cut_off():
    from services.document_prep.document_detector import detect_document

    det = detect_document(_page_on_table(offset_x=80, canvas_w=1400))
    assert det.cut_off is False and det.outline_reliable is True


def test_r8_full_frame_scan_is_not_rejected():
    from doc_prep_dataset import PAGE_1_ITEMS, render_invoice_page
    from services.document_prep.document_detector import detect_document

    det = detect_document(render_invoice_page(PAGE_1_ITEMS).image)  # a flat scan: page = whole image
    assert det.cut_off is False


def test_r8_cut_off_becomes_a_retake_reason_in_quality():
    import cv2

    from services.document_prep.pipeline import assess_capture

    img = _page_on_table(offset_x=200, canvas_w=1300)
    res = assess_capture(cv2.imencode(".png", img)[1].tobytes(), "photo.png")
    assert res["document"]["cut_off"] is True
    assert res["retake_recommended"] is True
    assert any(i["code"] == "cut_off" for i in res["quality"]["issues"])


# --------------------------------------------------------------------------------------- R10


def test_r10_clean_photo_assessment_has_no_retake():
    import cv2

    from services.document_prep.pipeline import assess_capture

    res = assess_capture(cv2.imencode(".png", _page_on_table(offset_x=80, canvas_w=1400))[1].tobytes(), "p.png")
    assert res["retake_recommended"] is False and res["document"]["cut_off"] is False


# --------------------------------------------------------------------------------------- Stage 4


FREE_COLS = cols(("serial", "Sl"), ("product", "Product Name"), ("units_per_case", "UPC"), ("mrp", "MRP"),
                 ("cases", "Cs"), ("qty", "Pcs"), ("rate", "Base Rate"), ("taxable", "Taxable Amt"),
                 ("total", "Net Amt"))


def test_stage4_bundle_heading_is_not_a_product():
    rec = ColumnWiseExtractor().extract_row(
        row("3", "HAND WASH 200ML (With Free Product)", "", "", "0+0", "6+6", "", "540.00", ""), FREE_COLS)
    assert rec is not None and rec.is_bundle_header is True
    assert rec.quantity is None  # never a stock line


def test_stage4_bundle_heading_detected_from_quantities_without_rate():
    rec = ColumnWiseExtractor().extract_row(row("", "SOAP COMBO", "", "", "0+0", "2+1", "", "240.00", ""),
                                            FREE_COLS)
    assert rec.is_bundle_header is True


def test_stage4_free_line_kept_with_quantity_and_zero_rate():
    rec = ColumnWiseExtractor().extract_row(
        row("", "HAND WASH REFILL 180ML", "36", "89.00", "0", "6", "0.00", "0.00", "0.00"), FREE_COLS)
    assert rec is not None and rec.is_bundle_header is False
    assert rec.is_free_item is True and rec.quantity == Decimal("6") and rec.purchase_price == Decimal("0.00")


def test_stage4_paid_line_with_free_word_in_name_is_not_free():
    rec = ColumnWiseExtractor().extract_row(
        row("", "DETERGENT 1KG + 50G POUCH FREE", "20", "140.00", "0", "3", "112.50", "337.50", "398.25"), FREE_COLS)
    assert rec.is_free_item is False and rec.purchase_price == Decimal("112.50")


def test_stage4_free_item_reaches_review_without_invented_cost(monkeypatch):
    from services.grocery_ocr.pipeline.invoice_pipeline import extraction_metadata

    rec = ColumnWiseExtractor().extract_row(
        row("", "HAND WASH REFILL 180ML", "36", "89.00", "0", "6", "0.00", "0.00", "0.00"), FREE_COLS)
    it = item("HAND WASH REFILL 180ML", qty=6, rate=Decimal("0.00"), amount=Decimal("0.00"))
    it.metadata.update(extraction_metadata(rec))
    out = run_api(monkeypatch, [it], custom={"bundle_headers": [{"text": "HAND WASH 200ML (With Free Product)",
                                                                  "quantity_text": "6+6"}]})
    li = out.items[0]
    assert li.is_free_item is True and li.purchase_price == 0.0 and li.quantity == 6.0
    assert li.derived_fields == [] and li.needs_review is True
    assert any("Free item" in i for i in li.validation_issues)
    assert out.bundle_notes[0]["quantity_text"] == "6+6"


def test_stage4_free_item_can_be_confirmed_with_zero_rate():
    from schemas.invoice import InvoiceConfirmItem

    assert InvoiceConfirmItem(name="REFILL", quantity=6, purchase_price=0.0, selling_price=0.0).purchase_price == 0.0


# --------------------------------------------------------------------------------------- end to end


def _render_generic_gst_invoice(header_align: str = "center"):
    """A generic gridded GST invoice (made-up products and values): two-line headings, a case-sold
    line, a bundle heading with its paid and free lines, and two discount columns. Numbers are
    right-aligned; headings are centred (default) or left-aligned in their cells."""
    import glob
    import textwrap

    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    font = None
    candidate_names = [
        "cour.ttf", "consola.ttf", "lucon.ttf",
        "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf", "FreeMono.ttf",
        "Menlo.ttc", "Courier.dfont",
    ]
    for name in candidate_names:
        try:
            font = ImageFont.truetype(name, 30)
            break
        except Exception:
            continue
    if font is None:
        import os
        font_dirs = [
            "/usr/share/fonts", "/usr/local/share/fonts",
            os.path.expanduser("~/.fonts"),
            os.environ.get("WINDIR", r"C:\Windows") + r"\Fonts",
        ]
        for fdir in font_dirs:
            matches = [f for f in glob.glob(f"{fdir}/**/*Mono*.ttf", recursive=True)
                       if "Bold" not in f and "Oblique" not in f and "Italic" not in f]
            if matches:
                try:
                    font = ImageFont.truetype(sorted(matches)[0], 30)
                    break
                except Exception:
                    pass
    if font is None:
        try:
            font = ImageFont.load_default(size=30)
        except TypeError:
            font = ImageFont.load_default()
    hdr = [("Sl",), ("HSN",), ("Product Name",), ("UPC",), ("MRP",), ("Cs",), ("Pcs",), ("Base", "Rate"),
           ("Sch", "Disc"), ("RS Disc",), ("Taxable", "Amt"), ("GST", "%"), ("CGST", "Amt"), ("SGST", "Amt"),
           ("Net Amt",)]
    rows = [
        ["1", "19059090", "GLUCO BISCUIT 100G", "48", "10.00", "0", "24", "8.10", "2.40", "0.00", "192.00", "18",
         "17.28", "17.28", "226.56"],
        ["2", "21069099", "TOMATO KETCHUP 500G", "24", "120.00", "1", "0", "95.50", "12.00", "0.00", "2280.00",
         "12", "136.80", "136.80", "2553.60"],
        ["3", "34013090", "HAND WASH 200ML (With Free Product)", "", "", "0+0", "6+6", "", "", "", "540.00", "",
         "", "", ""],
        ["", "34013090", "HAND WASH 200ML", "36", "99.00", "0", "6", "90.00", "0.00", "0.00", "540.00", "18",
         "48.60", "48.60", "637.20"],
        ["", "34013090", "HAND WASH REFILL 180ML", "36", "89.00", "0", "6", "0.00", "0.00", "0.00", "0.00", "18",
         "0.00", "0.00", "0.00"],
        ["4", "09023020", "GREEN TEA 25 BAGS", "72", "150.00", "0", "12", "118.75", "0.00", "5.00", "1420.00", "5",
         "35.50", "35.50", "1491.00"],
    ]
    wch = [3, 9, 23, 4, 7, 4, 6, 7, 7, 7, 9, 3, 8, 8, 8]
    xs = [60]
    for w in wch:
        xs.append(xs[-1] + int(w * 18.5) + 16)
    lh = 36
    lines = [(r, textwrap.wrap(r[2], 23)) for r in rows]
    height = 420 + sum(len(n) * lh + 18 for _, n in lines) + 200
    im = Image.new("L", (xs[-1] + 60, height), 255)
    d = ImageDraw.Draw(im)
    d.text((60, 40), "GENERIC FMCG DISTRIBUTORS", font=font, fill=0)
    d.text((60, 90), "Bill No : GFD/1001   Bill Date : 05/11/2026", font=font, fill=0)
    y = top = 300
    d.line((xs[0], y, xs[-1], y), fill=0, width=3)
    for i, h in enumerate(hdr):
        for k, t in enumerate(h):
            tw = d.textlength(t, font=font)
            x = xs[i] + 8 if header_align == "left" else (xs[i] + xs[i + 1] - tw) / 2
            d.text((x, y + 8 + k * lh), t, font=font, fill=0)
    y += 2 * lh + 20
    d.line((xs[0], y, xs[-1], y), fill=0, width=2)
    for r, name in lines:
        for i, c in enumerate(r):
            if i == 2:
                for k, t in enumerate(name):
                    d.text((xs[i] + 8, y + 8 + k * lh), t, font=font, fill=0)
            elif c:
                x = xs[i] + 8 if i in (0, 1) else xs[i + 1] - 8 - d.textlength(c, font=font)
                d.text((x, y + 8), c, font=font, fill=0)
        y += len(name) * lh + 18
        d.line((xs[0], y, xs[-1], y), fill=0, width=2)
    for x in xs:
        d.line((x, top, x, y), fill=0, width=2)
    return cv2.imencode(".png", cv2.cvtColor(np.array(im), cv2.COLOR_GRAY2BGR))[1].tobytes()


def _ocr_available() -> bool:
    try:
        from services.document_prep.ocr_scoring import ocr_engine_available

        return ocr_engine_available()
    except Exception:
        return False


@pytest.mark.skipif(not _ocr_available(), reason="OCR engine not installed")
def test_end_to_end_generic_gst_invoice(monkeypatch):
    """Real OCR + table reconstruction on a generic rendered invoice (R3, R4, R5, R6, Stage 4)."""
    from services import invoice as inv

    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.NoProvider())
    res = inv._extract_invoice_with_new_pipeline(_render_generic_gst_invoice(), "generic.png", _NoProducts(),
                                                 uuid.uuid4())
    by = {i.product_name.upper()[:14]: i for i in res.items}
    assert len(res.items) == 5, [i.product_name for i in res.items]  # bundle heading is not a stock line
    assert [b["quantity_text"] for b in res.bundle_notes] == ["6+6"]

    biscuit = by["GLUCO BISCUIT "]
    assert (biscuit.quantity, biscuit.purchase_price, biscuit.invoice_mrp) == (24.0, 8.10, 10.00)
    assert (biscuit.cgst_amount, biscuit.sgst_amount, biscuit.scheme_discount) == (17.28, 17.28, 2.40)
    assert (biscuit.taxable_amount, biscuit.net_amount) == (192.00, 226.56)
    # the generic invoice prints no unit column: the only review reason is the missing unit (Phase 4)
    assert biscuit.is_verified is True and biscuit.unit is None
    assert [v for v in biscuit.validation_issues if "Unit not printed" not in v] == [] and biscuit.needs_review is True

    ketchup = by["TOMATO KETCHUP"]  # 1 case x 24 per case: calculated, flagged
    assert ketchup.quantity == 24.0 and ketchup.derived_fields == ["quantity"] and ketchup.needs_review is True

    refill = by["HAND WASH REFI"]
    assert refill.is_free_item is True and refill.quantity == 6.0 and refill.purchase_price == 0.0

    tea = by["GREEN TEA 25 B"]
    assert (tea.scheme_discount, tea.other_discount) == (0.0, 5.0) and tea.net_amount == 1491.00


@pytest.mark.skipif(not _ocr_available(), reason="OCR engine not installed")
def test_end_to_end_left_aligned_headings(monkeypatch):
    """Left-aligned headings over right-aligned numbers: the narrow Cs column keeps its own values
    (column boundary is never placed through a stack of values)."""
    from services import invoice as inv

    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.NoProvider())
    res = inv._extract_invoice_with_new_pipeline(_render_generic_gst_invoice("left"), "generic.png", _NoProducts(),
                                                 uuid.uuid4())
    by = {i.product_name.upper()[:14]: i for i in res.items}
    assert len(res.items) == 5
    assert (by["GLUCO BISCUIT "].cases, by["GLUCO BISCUIT "].loose_quantity, by["GLUCO BISCUIT "].quantity) == (0.0, 24.0, 24.0)
    assert by["TOMATO KETCHUP"].quantity == 24.0 and by["TOMATO KETCHUP"].derived_fields == ["quantity"]
    for it in res.items:
        if it.derived_fields or it.quantity is None:
            assert it.needs_review is True and it.is_verified is False
