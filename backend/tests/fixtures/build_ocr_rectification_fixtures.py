"""
Builds the OCR rectification fixtures (tests/fixtures/ocr_rectification/) and their expected values.

Formats the main dataset does not cover, each with values defined here before extraction:
- OR01: wholesale invoice with a separate Pack column (25 kg bag, 50 kg bag, 15 L tin, 1 kg packet)
- OR02: header synonyms (Particulars / Nos / UOM / Unit Price / Value)
- OR03: two-page scanned PDF (table continues on page 2, total on page 2)
- OR04: rate printed per kg while the quantity is in bags (must be flagged, never mis-costed)
Generic product names and test values only. Rendered like tests/fixtures/build_ground_truth_dataset.py.

    cd backend && .venv/bin/python tests/fixtures/build_ocr_rectification_fixtures.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "ocr_rectification"


def _font(size: int, bold: bool = False):
    for name in (("arialbd.ttf", "DejaVuSans-Bold.ttf") if bold else ("arial.ttf", "DejaVuSans.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default(size=size)


def render(title: str, invoice_no: str, columns, rows, total: str | None, width: int = 1300) -> Image.Image:
    row_h = 42
    height = 280 + len(rows) * row_h + 150
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    d.text((50, 40), title, fill="black", font=_font(24, True))
    d.text((50, 80), f"TAX INVOICE | Inv No: {invoice_no} | Date: 12/11/2026", fill="black", font=_font(16))
    d.text((50, 105), "GSTIN: 29AABCT1332L1ZQ | Wholesale Grocery Distributors", fill="#444444", font=_font(16))
    y = 150
    d.line([(40, y - 5), (width - 40, y - 5)], fill="#333333", width=2)
    d.line([(40, y + 35), (width - 40, y + 35)], fill="#333333", width=2)
    for name, x in columns:
        d.text((x, y), name, fill="black", font=_font(24, True))
    y += 45
    for row in rows:
        for val, (_, x) in zip(row, columns):
            d.text((x, y), str(val), fill="#111111", font=_font(20))
        d.line([(40, y + 32), (width - 40, y + 32)], fill="#cccccc", width=1)
        y += row_h
    d.line([(40, y), (width - 40, y)], fill="#333333", width=2)
    if total:
        d.text((width - 450, y + 15), f"Grand Total: {total}", fill="black", font=_font(24, True))
    return img


def build() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    expected: dict = {}

    # OR01: separate Pack column
    cols = [("Item", 50), ("Pack", 430), ("Qty", 580), ("Unit", 680), ("Rate", 800), ("Amount", 1010)]
    items = [
        ("Basmati Rice", "25 kg", 2, "bag", 2350.00, 4700.00, 25, "kg"),
        ("Sugar", "50 kg", 1, "bag", 2200.00, 2200.00, 50, "kg"),
        ("Sunflower Oil", "15 L", 3, "tin", 1950.00, 5850.00, 15, "L"),
        ("Toor Dal", "1 kg", 10, "pkt", 135.00, 1350.00, 1, "kg"),
    ]
    rows = [[n, p, str(q), u, f"{r:.2f}", f"{a:.2f}"] for n, p, q, u, r, a, _, _ in items]
    render("Agro Bulk Traders", "ABT-7101", cols, rows, "14,100.00").save(OUT / "OR01_pack_column_wholesale.png")
    expected["OR01_pack_column_wholesale.png"] = [
        {"product_name": n, "quantity": q, "unit": u, "purchase_price": r, "printed_amount": a,
         "pack_size": ps, "pack_size_unit": pu} for n, _, q, u, r, a, ps, pu in items]

    # OR02: header synonyms
    cols = [("Particulars", 50), ("Nos", 560), ("UOM", 680), ("Unit Price", 800), ("Value", 1050)]
    items2 = [("Toor Dal 1kg", 12, "pkt", 132.00, 1584.00), ("Tata Salt 1kg", 25, "pkt", 24.00, 600.00),
              ("Basmati Rice 5kg", 6, "bag", 540.00, 3240.00)]
    rows = [[n, str(q), u, f"{r:.2f}", f"{a:.2f}"] for n, q, u, r, a in items2]
    render("Coastal Grocers", "CG-2290", cols, rows, "5,424.00").save(OUT / "OR02_header_synonyms.png")
    expected["OR02_header_synonyms.png"] = [
        {"product_name": n, "quantity": q, "unit": u, "purchase_price": r, "printed_amount": a} for n, q, u, r, a in items2]

    # OR03: two-page scanned PDF
    cols = [("Item Description", 50), ("Qty", 560), ("Unit", 680), ("Rate", 800), ("Amount", 1050)]
    p1 = [("Aashirvaad Atta 10kg", 5, "bag", 375.00, 1875.00), ("Fortune Mustard Oil 1L", 8, "btl", 145.00, 1160.00),
          ("Tata Tea Gold 500g", 6, "pkt", 290.00, 1740.00)]
    p2 = [("Maggi Noodles 70g", 48, "pkt", 11.00, 528.00), ("Surf Excel 1kg", 10, "pkt", 118.00, 1180.00)]
    pages = [render("Metro Wholesale Mart", "MWM-5501", cols,
                    [[n, str(q), u, f"{r:.2f}", f"{a:.2f}"] for n, q, u, r, a in p1], None),
             render("Metro Wholesale Mart (page 2)", "MWM-5501", cols,
                    [[n, str(q), u, f"{r:.2f}", f"{a:.2f}"] for n, q, u, r, a in p2], "6,483.00")]
    pages[0].save(OUT / "OR03_two_page_scanned.pdf", save_all=True, append_images=pages[1:], resolution=150)
    expected["OR03_two_page_scanned.pdf"] = [
        {"product_name": n, "quantity": q, "unit": u, "purchase_price": r, "printed_amount": a} for n, q, u, r, a in p1 + p2]

    # OR04: rate per kg, quantity in bags (2 bags x 50 kg x 44.00 = 4400.00)
    cols = [("Item", 50), ("Pack", 430), ("Qty", 580), ("Unit", 680), ("Rate/kg", 800), ("Amount", 1010)]
    render("Agro Bulk Traders", "ABT-7102", cols, [["Sugar", "50 kg", "2", "bag", "44.00", "4400.00"]],
           "4,400.00").save(OUT / "OR04_rate_per_kg.png")
    expected["OR04_rate_per_kg.png"] = [{"product_name": "Sugar", "quantity": 2, "unit": "bag", "purchase_price": 44.00,
                                         "printed_amount": 4400.00, "pack_size": 50, "pack_size_unit": "kg",
                                         "rate_basis_unit": "kg"}]

    (OUT / "expected.json").write_text(json.dumps(expected, indent=1))
    return expected


if __name__ == "__main__":
    for k, v in build().items():
        print(k, len(v), "lines")
