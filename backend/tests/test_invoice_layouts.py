"""
Layouts other than the reference invoice, so extraction is not tuned to one document:
- Tally-style "Description of Goods | HSN/SAC | Quantity | Rate | per | Amount" with a
  wrapped description, 8-digit HSN codes and GST summary lines below the table
  (digital PDF and a scanned image read by OCR);
- separate Qty / Unit / MRP / Disc % / GST % columns where the amount includes tax;
- right-aligned numbers under short headers (column boundaries from the table body).
"""

import uuid
from typing import List, Tuple

import pytest
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db.models  # noqa: F401
from core.config import settings
from db.session import Base
from services import invoice_table as table
from services import mrp_lookup
from services.invoice import extract_invoice_from_bytes
from fixtures.reference_invoice import png_bytes, text_pdf


def _extract(data: bytes, filename: str):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "MRP_PROVIDER", "none")
        mrp_lookup.clear_cache()
        try:
            return extract_invoice_from_bytes(data, filename, session, uuid.uuid4())
        finally:
            session.close()


# --------------------------------------------------------------------------
# Tally-style layout
# --------------------------------------------------------------------------

# (column, alignment, x in a 1240-unit page) — numbers right-aligned to x
TALLY_COLS = [("sl", "left", 40), ("desc", "left", 130), ("hsn", "right", 560), ("qty", "right", 720),
              ("rate", "right", 860), ("per", "left", 880), ("amount", "right", 1200)]
TALLY_HEADER = {"sl": "Sl No.", "desc": "Description of Goods", "hsn": "HSN/SAC", "qty": "Quantity",
                "rate": "Rate", "per": "per", "amount": "Amount"}
TALLY_ROWS = [
    # sl, description lines, hsn, qty cell, rate, per, amount
    ("1", ["Aashirvaad Atta 10 kg"], "11010000", "5 Bag", "420.00", "Bag", "2,100.00"),
    ("2", ["Tata Salt 1 kg"], "25010020", "24 Pcs", "22.00", "Pcs", "528.00"),
    ("3", ["Fortune Sunflower Oil 1 L", "Pouch"], "15121110", "12 Pcs", "155.50", "Pcs", "1,866.00"),
    ("4", ["Surf Excel Easy Wash 1.5 kg"], "34022010", "6 Pcs", "189.00", "Pcs", "1,134.00"),
]
TALLY_EXPECTED = [
    ("Aashirvaad Atta 10 kg", "11010000", 5.0, "Bag", 420.0, 2100.0),
    ("Tata Salt 1 kg", "25010020", 24.0, "Pcs", 22.0, 528.0),
    ("Fortune Sunflower Oil 1 L Pouch", "15121110", 12.0, "Pcs", 155.5, 1866.0),
    ("Surf Excel Easy Wash 1.5 kg", "34022010", 6.0, "Pcs", 189.0, 1134.0),
]


def _tally_placements(char_w: float, line_h: float) -> List[Tuple[float, float, str, str]]:
    """(x, y, text, align) in page units; y grows downwards."""
    out = [(40, 40, "Krishna Wholesale Traders", "left"), (40, 80, "Invoice No.: KWT/245", "left"),
           (800, 80, "Dated: 02/10/2026", "left")]
    y = 150
    for col, align, x in TALLY_COLS:
        out.append((x, y, TALLY_HEADER[col], align))
    y += line_h * 1.6
    for sl, desc, hsn, qty, rate, per, amount in TALLY_ROWS:
        cells = {"sl": sl, "hsn": hsn, "qty": qty, "rate": rate, "per": per, "amount": amount}
        for col, align, x in TALLY_COLS:
            if col == "desc":
                out.append((x, y, desc[0], align))
            elif cells.get(col):
                out.append((x, y, cells[col], align))
        for extra in desc[1:]:
            y += line_h
            out.append((130, y, extra, "left"))
        y += line_h * 1.4
    out += [(130, y, "Total", "left"), (720, y, "47", "right"), (1200, y, "5,628.00", "right")]
    y += line_h * 1.6
    out += [(130, y, "CGST @ 2.5%", "left"), (1200, y, "140.70", "right")]
    y += line_h
    out += [(130, y, "SGST @ 2.5%", "left"), (1200, y, "140.70", "right")]
    y += line_h
    out += [(130, y, "Grand Total", "left"), (1200, y, "5,909.40", "right")]
    return out


def tally_pdf() -> bytes:
    scale = 595 / 1240
    size = 9
    lines = []
    for x, y, text, align in _tally_placements(char_w=size * 0.5 / scale, line_h=30):
        px = x * scale - (len(text) * size * 0.5 if align == "right" else 0)
        lines.append((px, 842 - y * scale - 20, text))
    return text_pdf(lines, font_size=size)


def tally_png() -> bytes:
    font = ImageFont.load_default(size=20)
    img = Image.new("RGB", (1240, 900), "white")
    d = ImageDraw.Draw(img)
    for x, y, text, align in _tally_placements(char_w=10, line_h=29):
        w = d.textlength(text, font=font)
        d.text((x - w if align == "right" else x, y), text, fill="black", font=font)
    return png_bytes(img)


@pytest.mark.parametrize("make,name", [(tally_pdf, "tally.pdf"), (tally_png, "tally.png")])
def test_tally_layout(make, name):
    res = _extract(make(), name)
    roles = [c.role for c in res.diagnostics.columns]
    assert roles == ["serial", "product", "hsn", "qty", "rate", "unit", "total"]
    assert len(res.items) == 4, [i.product_name for i in res.items]
    for item, (product, hsn, qty, unit, rate, amount) in zip(res.items, TALLY_EXPECTED):
        if name.endswith(".pdf"):
            assert item.product_name == product
        else:  # OCR may drop the space in "1 kg"
            assert item.product_name.replace(" ", "") == product.replace(" ", "")
        assert (item.hsn_code, item.quantity, item.unit, item.rate, item.line_total) == (hsn, qty, unit, rate, amount)
        assert item.arithmetic_status == "VERIFIED"
    assert res.totals.printed_quantity == 47.0 and res.totals.printed_amount == 5628.0
    assert res.totals.grand_total == 5909.4
    assert res.invoice_total == 5909.4
    assert {c.field: c.status for c in res.totals.checks}["amount"] == "MATCH"
    assert not any("CGST" in i.product_name or "Total" in i.product_name for i in res.items)


# --------------------------------------------------------------------------
# Separate Qty / Unit / MRP / Disc % / GST % columns
# --------------------------------------------------------------------------


def test_percentage_columns_and_printed_mrp():
    header = [(40, "Item"), (330, "Qty"), (390, "Unit"), (450, "MRP"), (520, "Rate"), (590, "Disc%"),
              (660, "GST%"), (740, "Amount")]
    rows = [
        ["Maggi Noodles 70g", "48", "PCS", "14.00", "12.00", "0", "18", "679.68"],
        ["Colgate Strong Teeth 200g", "12", "PCS", "110.00", "92.00", "5", "18", "1,237.58"],
        ["Tata Tea Gold 500g", "10", "PKT", "330.00", "290.00", "", "5", "3,045.00"],
    ]
    scale = 595 / 1240
    lines = [(x * scale, 842 - 120 * scale, h) for x, h in header]
    for r_idx, row in enumerate(rows):
        y = 842 - (160 + r_idx * 34) * scale
        for (x, _), text in zip(header, row):
            if text:
                lines.append((x * scale, y, text))
    res = _extract(text_pdf(lines), "pct.pdf")
    assert [c.role for c in res.diagnostics.columns] == ["product", "qty", "unit", "mrp", "rate", "discount_pct",
                                                        "gst_rate", "total"]
    maggi, colgate, tea = res.items
    assert (maggi.quantity, maggi.unit, maggi.invoice_mrp, maggi.mrp, maggi.mrp_source) == (48.0, "PCS", 14.0, 14.0, "INVOICE")
    assert (maggi.gst_rate, maggi.discount_pct, maggi.line_total) == (18.0, 0.0, 679.68)
    assert maggi.arithmetic_status == "VERIFIED"
    # 12 × 92 − 5% = 1048.80, + 18% GST = 1237.58
    assert (colgate.discount_pct, colgate.gst_rate, colgate.line_total) == (5.0, 18.0, 1237.58)
    assert colgate.arithmetic_status == "VERIFIED", colgate.arithmetic_explanation
    assert tea.discount_pct is None and tea.unit == "PKT" and tea.unit_normalized == "pkt"
    assert tea.arithmetic_status == "VERIFIED"


# --------------------------------------------------------------------------
# Column boundaries from the table body
# --------------------------------------------------------------------------


def W(text, x0, x1, y=100.0):
    return table.Word(text, x0, y, x1, y + 20)


def test_right_aligned_values_under_short_headers_stay_in_their_column():
    """'77.68 (12%)' is wider than 'TAX' and starts under the gap before it."""
    rows = table.group_words_into_rows([
        W("Item", 20, 70, 60), W("Qty", 300, 340, 60), W("DISC.", 470, 530, 60), W("TAX", 610, 650, 60),
        W("AMOUNT", 720, 820, 60),
        W("Dal", 20, 60), W("5", 330, 340), W("0.0", 500, 530), W("77.68", 545, 600), W("(12%)", 606, 650),
        W("725.0", 760, 820),
        W("Rice", 20, 70, 140), W("2", 330, 340, 140), W("0.0", 500, 530, 140), W("0.0", 620, 650, 140),
        W("100.0", 760, 820, 140),
    ])
    res = table.extract_table(rows, False, "OCR_TABLE")
    dal, rice = res.items
    assert dal.discount == 0 and dal.tax_amount == table.Decimal("77.68") and dal.gst_rate == 12
    assert rice.tax_amount == 0 and rice.discount == 0
