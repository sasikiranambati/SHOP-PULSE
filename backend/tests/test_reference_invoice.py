"""
Regression tests for the reference invoice layout:

    S.No. | ITEMS | HSN | QTY. | RATE | DISC. | TAX | AMOUNT   (13 rows)

The original scan was not supplied with the task, so tests/fixtures/reference_invoice.py
renders a replica with the same printed values: a clean scan, a phone-photo-like copy
(rotated, blurred, JPEG) and a digital PDF. If the original is added as
tests/fixtures/reference_invoice.{png,jpg,jpeg,pdf} it is tested as well.

Expected values come from the printed invoice and live only in the tests/fixtures; the
production code never sees them.
"""

import re
import uuid
from decimal import Decimal
from typing import Dict, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db.models  # noqa: F401
from api.deps import get_db
from core.config import settings
from db.session import Base
from main import app
from services import mrp_lookup
from services.invoice import build_totals, extract_invoice_from_bytes, extract_summary_amounts
from services import invoice_table as table
from fixtures.reference_invoice import (
    ROWS,
    TOTALS,
    original_scan_files,
    photo_like,
    png_bytes,
    render_pdf,
    render_png,
)

UNIT_MAP = {"PCS": "pcs", "KGS": "kg", "BOR": None, "PET": None}  # explicit table only; BOR/PET unmapped


def _num(text: Optional[str]) -> Optional[float]:
    return None if text is None else float(text.replace(",", ""))


def _pct(text: Optional[str]) -> Optional[float]:
    return None if text is None else float(text.rstrip("%"))


def _squash(name: str) -> str:
    return re.sub(r"\s+", "", name).upper()


def _extract(data: bytes, filename: str):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "MRP_PROVIDER", "none")  # no network in extraction tests
        mrp_lookup.clear_cache()
        try:
            return extract_invoice_from_bytes(data, filename, session, uuid.uuid4())
        finally:
            session.close()
            mrp_lookup.clear_cache()


@pytest.fixture(scope="module")
def digital_pdf():
    return _extract(render_pdf(), "reference_invoice.pdf")


@pytest.fixture(scope="module")
def clean_scan():
    return _extract(png_bytes(render_png()), "reference_invoice.png")


@pytest.fixture(scope="module")
def photo_scan():
    return _extract(photo_like(render_png()), "reference_invoice.jpg")


def _field_errors(item, row, exact_name: bool) -> List[str]:
    """Every field compared with the printed value; returns the fields that differ."""
    expected = {
        "quantity": _num(row.qty),
        "unit": row.unit,
        "unit_normalized": UNIT_MAP[row.unit],
        "rate": _num(row.rate),
        "purchase_price": _num(row.rate),
        "discount": _num(row.disc),
        "discount_pct": _pct(row.disc_pct),
        "tax_amount": _num(row.tax),
        "gst_rate": _pct(row.tax_pct),
        "line_total": _num(row.amount),
        "hsn_code": row.hsn,
    }
    errors = [f"{k}: got {getattr(item, k)!r}, printed {v!r}" for k, v in expected.items() if getattr(item, k) != v]
    name_ok = item.product_name == row.product if exact_name else _squash(item.product_name) == _squash(row.product)
    if not name_ok:
        errors.append(f"product_name: got {item.product_name!r}, printed {row.product!r}")
    return errors


# --------------------------------------------------------------------------
# Line items
# --------------------------------------------------------------------------


def test_digital_pdf_reads_every_printed_value(digital_pdf):
    assert digital_pdf.engine_used == "backend_pdf_direct"
    assert len(digital_pdf.items) == len(ROWS) == 13
    for item, row in zip(digital_pdf.items, ROWS):
        assert _field_errors(item, row, exact_name=True) == [], row.product
        assert item.line_total_source == "INVOICE"
        assert item.arithmetic_status == "VERIFIED", item.arithmetic_explanation


def test_clean_scan_reads_every_printed_value(clean_scan):
    """OCR may drop the space in '1 KG'; every number, unit and HSN must be exact."""
    assert clean_scan.engine_used == "backend_ocr_pipeline"
    assert len(clean_scan.items) == 13
    for item, row in zip(clean_scan.items, ROWS):
        assert _field_errors(item, row, exact_name=False) == [], row.product
        assert item.arithmetic_status == "VERIFIED", item.arithmetic_explanation


def test_photo_scan_every_row_is_correct_or_flagged(photo_scan):
    assert photo_scan.diagnostics.deskew_angle is not None  # the 1.5° rotation was corrected
    assert len(photo_scan.items) == 13
    exact = 0
    for item, row in zip(photo_scan.items, ROWS):
        errors = _field_errors(item, row, exact_name=False)
        if errors:
            # A value that differs from the printed one is never presented as confirmed
            assert item.needs_review and item.validation_issues, (row.product, errors)
        else:
            exact += 1
    assert exact >= 11, f"only {exact} of 13 rows read exactly"


@pytest.mark.parametrize("doc", ["digital_pdf", "clean_scan"])
def test_quantities_never_come_from_product_names(doc, request):
    items = {_squash(i.product_name): i for i in request.getfixturevalue(doc).items}
    chana = items[_squash("CHANA 50 KG")]
    assert (chana.quantity, chana.unit, chana.rate, chana.line_total) == (1.0, "BOR", 2760.0, 2760.0)
    assert chana.calculated_amount == 2760.0
    assert not any("50 ×" in i for i in chana.validation_issues)
    oil = items[_squash("FORTUNE OIL 1 KG")]
    assert (oil.quantity, oil.unit, oil.rate) == (3.0, "PET", 1378.62)  # the rate is never read as quantity
    assert items[_squash("SABUDANA 30 KG")].quantity == 1.0
    assert items[_squash("SOYABEAN CHUNKS 15 KG")].quantity == 2.0
    assert items[_squash("MASOOR DAL 50 KG")].quantity == 1.0


def test_units_are_kept_as_printed_and_never_guessed(digital_pdf):
    by_unit: Dict[str, set] = {}
    for item in digital_pdf.items:
        by_unit.setdefault(item.unit, set()).add(item.unit_normalized)
    assert by_unit == {"BOR": {None}, "PCS": {"pcs"}, "PET": {None}, "KGS": {"kg"}}


def test_missing_hsn_is_null_and_printed_hsn_kept(digital_pdf, clean_scan):
    for result in (digital_pdf, clean_scan):  # blank HSN in the PDF, '-' in the scan
        hsn = [i.hsn_code for i in result.items]
        assert hsn == [r.hsn for r in ROWS]
        assert hsn.count("30") == 2 and hsn.count(None) == 11


def test_rounding_differences_are_recorded_not_hidden(digital_pdf):
    rajamm = next(i for i in digital_pdf.items if i.product_name == "RAJAMM")
    # 25 × 44.96 + 1.12 = 1125.12 against a printed 1125.00
    assert rajamm.line_total == 1125.0
    assert rajamm.calculated_amount == 1125.12
    assert rajamm.amount_difference == -0.12
    assert rajamm.arithmetic_status == "VERIFIED"
    assert "rounding difference" in rajamm.arithmetic_explanation
    assert rajamm.arithmetic_rule and "quantity × rate − discount + tax" in rajamm.arithmetic_rule


# --------------------------------------------------------------------------
# Totals
# --------------------------------------------------------------------------


@pytest.mark.parametrize("doc", ["digital_pdf", "clean_scan"])
def test_printed_totals_are_read_and_compared(doc, request):
    t = request.getfixturevalue(doc).totals
    assert Decimal(str(t.printed_quantity)) == TOTALS["quantity"]
    assert Decimal(str(t.printed_discount)) == TOTALS["discount"]
    assert Decimal(str(t.printed_tax)) == TOTALS["tax"]
    assert Decimal(str(t.printed_amount)) == TOTALS["amount"]
    assert Decimal(str(t.received)) == TOTALS["received"]
    assert Decimal(str(t.balance)) == TOTALS["balance"]
    checks = {c.field: c for c in t.checks}
    assert checks["quantity"].status == "MATCH"
    assert checks["discount"].status == "MATCH"
    assert checks["amount"].status == "MATCH"
    assert checks["balance"].status == "MATCH"
    # The per-line taxes add up to 215.75; the invoice prints 215.76. Reported, not hidden.
    assert checks["tax"].status == "ROUNDING"
    assert checks["tax"].difference == 0.01


def test_photo_received_amount_misread_is_caught_by_balance_check(photo_scan):
    t = photo_scan.totals
    checks = {c.field: c for c in t.checks}
    if t.received != 0.0:  # OCR reads the ₹ before 0.00 as a digit on this photo
        assert checks["balance"].status == "MISMATCH"
        assert any("Balance" in w for w in photo_scan.diagnostics.warnings)


def test_summary_labels_tolerate_misread_rupee_signs():
    found = extract_summary_amounts([
        "Received Amount ®0.00", "Balance Amount ¥ 46,885.80", "Round Off (-) 0.20", "Grand Total: Rs. 1,000.00",
    ])
    assert found == {"received": Decimal("0.00"), "balance": Decimal("46885.80"),
                     "round_off": Decimal("-0.20"), "grand_total": Decimal("1000.00")}


def test_totals_mismatch_is_reported_with_difference():
    line = table.extract_table(table.rows_from_text(
        "Item | Qty | Rate | Amount\nSugar | 2 | 50 | 100\nTOTAL | 2 | | 150\n"), True, "TABLE_STRUCTURED")
    totals = build_totals(line.items, line.totals_row, {})
    amount = next(c for c in totals.checks if c.field == "amount")
    assert amount.status == "MISMATCH" and amount.difference == 50.0
    assert "Printed values are kept" in amount.message


# --------------------------------------------------------------------------
# Discrepancies and missing values (text upload of the same layout)
# --------------------------------------------------------------------------

HEADER = "S.No. | ITEMS | HSN | QTY. | RATE | DISC. | TAX | AMOUNT"


def _text(rows: List[str]):
    return _extract(("\n".join([HEADER] + rows) + "\n").encode(), "invoice.txt")


def test_wrong_printed_amount_is_flagged_and_kept():
    res = _text(["1 | CHANA 50 KG | - | 1.0 BOR | 2760.0 | 0.0 | 0.0 | 27600.0"])
    item = res.items[0]
    assert item.line_total == 27600.0          # printed value kept
    assert item.calculated_amount == 2760.0
    assert item.amount_difference == 24840.0
    assert item.arithmetic_status == "MISMATCH" and item.needs_review
    assert any("does not match quantity × rate" in i for i in item.validation_issues)
    assert any("Amount may be ₹2,760.00" in s for s in item.suggestions)


def test_missing_values_stay_null_and_distinct_from_zero():
    res = _text([
        "1 | SUGAR | - | 2.0 PCS | 1925.0 | - | 0.0 | -",
        "2 | RAJAMM | - | 25.0 KGS |  | 0.0 | 1.12 | 1125.0",
    ])
    sugar, rajamm = res.items
    assert sugar.line_total is None and sugar.line_total_source is None
    assert sugar.calculated_amount == 3850.0
    assert sugar.discount is None and sugar.tax_amount == 0.0  # '-' is not printed, 0.0 is printed
    assert rajamm.rate is None and rajamm.purchase_price is None
    assert rajamm.suggested_rate == 45.0      # suggestion only, not applied
    assert any("Rate could not be read" in i for i in rajamm.validation_issues)


# --------------------------------------------------------------------------
# API response and MRP provider failures
# --------------------------------------------------------------------------

_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
client = TestClient(app)


@pytest.fixture
def api(monkeypatch):
    Base.metadata.create_all(bind=_engine)

    def override():
        s = _Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    mrp_lookup.clear_cache()
    email = f"ref_{uuid.uuid4().hex[:8]}@example.com"
    client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/v1/shops", json={"shop_name": "Ref Kirana", "owner_name": "Owner",
                                       "business_type": "Grocery/Kirana", "location": "Nagpur"}, headers=headers)
    yield headers
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)
    mrp_lookup.clear_cache()


SECRET = "test-mrp-key-not-real-4821"


def _mock_provider(monkeypatch, handler):
    for k, v in {
        "MRP_PROVIDER": "custom_http", "MRP_API_BASE_URL": "https://mrp.example.test", "MRP_API_KEY": SECRET,
        "MRP_API_SEARCH_PATH": "/search", "MRP_API_BARCODE_PATH": None, "MRP_API_RESULTS_FIELD": "items",
        "MRP_API_MRP_FIELD": "mrp", "MRP_API_NAME_FIELD": "title", "MRP_API_BARCODE_FIELD": "ean",
        "MRP_LOOKUP_ENABLED": True,
    }.items():
        monkeypatch.setattr(settings, k, v)
    http = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(mrp_lookup, "get_provider", lambda: mrp_lookup.CustomHttpMrpProvider(client=http))


def _upload(headers):
    res = client.post("/api/v1/invoices/extract", headers=headers,
                      files={"file": ("reference_invoice.pdf", render_pdf(), "application/pdf")})
    assert res.status_code == 200, res.text
    return res


def test_api_returns_all_fields_and_verified_mrp(api, monkeypatch):
    def catalogue(request: httpx.Request):
        q = request.url.params.get("q", "").lower()
        if "parle" in q:
            return httpx.Response(200, json={"items": [{"title": "Parle-G", "mrp": 720.0}]})
        return httpx.Response(200, json={"items": []})

    _mock_provider(monkeypatch, catalogue)
    res = _upload(api)
    data = res.json()
    assert SECRET not in res.text
    assert len(data["items"]) == 13
    chana = data["items"][0]
    for key in ("unit", "unit_normalized", "calculated_amount", "amount_difference", "arithmetic_rule",
                "arithmetic_explanation", "discount_pct", "gst_rate", "hsn_code", "line_total"):
        assert key in chana
    assert (chana["quantity"], chana["unit"], chana["unit_normalized"]) == (1.0, "BOR", None)
    parle = next(i for i in data["items"] if i["product_name"] == "PARLE-G")
    assert parle["mrp_lookup"]["status"] == "FOUND"
    assert (parle["mrp"], parle["mrp_source"]) == (720.0, "API")
    others = [i for i in data["items"] if i["product_name"] != "PARLE-G"]
    assert all(i["mrp"] is None and i["mrp_lookup"]["status"] == "PRODUCT_NOT_FOUND" for i in others)
    assert data["totals"]["printed_amount"] == 46885.8
    assert {c["field"]: c["status"] for c in data["totals"]["checks"]}["amount"] == "MATCH"


def _timeout(request: httpx.Request):
    raise httpx.ReadTimeout("slow", request=request)


@pytest.mark.parametrize("failure,status", [
    (_timeout, "API_TIMEOUT"),
    (lambda r: httpx.Response(401, json={"error": "bad key"}), "API_AUTHENTICATION_ERROR"),
    (lambda r: httpx.Response(429), "API_RATE_LIMITED"),
    (lambda r: httpx.Response(500), "API_ERROR"),
])
def test_mrp_provider_failure_never_blocks_extraction(api, monkeypatch, failure, status):
    _mock_provider(monkeypatch, failure)
    res = _upload(api)
    data = res.json()
    assert SECRET not in res.text
    assert len(data["items"]) == 13
    assert [i["line_total"] for i in data["items"]] == [_num(r.amount) for r in ROWS]
    assert all(i["mrp"] is None for i in data["items"])  # never derived from the purchase rate
    assert data["items"][0]["mrp_lookup"]["status"] == status


# --------------------------------------------------------------------------
# The original scan, when it is added to tests/fixtures
# --------------------------------------------------------------------------


@pytest.mark.parametrize("path", original_scan_files() or [None])
def test_original_scan_if_supplied(path):
    if path is None:
        pytest.skip("Original reference scan not supplied (add tests/fixtures/reference_invoice.png|jpg|pdf)")
    res = _extract(path.read_bytes(), path.name)
    assert len(res.items) == 13
    for item, row in zip(res.items, ROWS):
        errors = _field_errors(item, row, exact_name=False)
        if errors:
            assert item.needs_review and item.validation_issues, (row.product, errors)
