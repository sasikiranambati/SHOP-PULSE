"""
Reference supplier invoice used as a regression fixture.

The 13 rows below are the values printed on the reference invoice supplied with the
bug report (columns: S.No. | ITEMS | HSN | QTY. | RATE | DISC. | TAX | AMOUNT).
The original scan was not available in the repository, so the document is rendered
here in the same layout. The rendering deliberately reproduces what breaks naive
parsers: numbers inside product names ("CHANA 50 KG", "OIL CAN 10"), quantity and
unit printed in one cell ("1.0 BOR"), descriptions wrapped onto a second line,
discount/tax percentages printed under the amount, "-" for missing HSN codes, table
rules and a TOTAL row.

If the original scan is added as tests/fixtures/reference_invoice.(png|jpg|jpeg|pdf),
the regression tests run against it as well.

Expected values are test data only; production code never sees them.
"""

import io
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FIXTURE_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class RefRow:
    sno: int
    product: str
    hsn: Optional[str]
    qty: str          # as printed
    unit: str         # as printed
    rate: str
    disc: str
    disc_pct: Optional[str]
    tax: str
    tax_pct: Optional[str]
    amount: str

    @property
    def quantity(self) -> Decimal:
        return Decimal(self.qty)


ROWS: List[RefRow] = [
    RefRow(1, "CHANA 50 KG", None, "1.0", "BOR", "2760.0", "0.0", None, "0.0", None, "2760.0"),
    RefRow(2, "FORTUNE BESAN 500 GM", None, "10.0", "PCS", "70.0", "0.0", None, "0.0", None, "700.0"),
    RefRow(3, "FORTUNE OIL 1 KG", None, "3.0", "PET", "1378.62", "124.08", "3%", "4.01", "0.1%", "4015.8"),
    RefRow(4, "HELLO ORGANIC CHANA DAL 1 KG", "30", "5.0", "PCS", "129.46", "0.0", None, "77.68", "12%", "725.0"),
    RefRow(5, "MASOOR DAL 50 KG", None, "1.0", "BOR", "4825.0", "0.0", None, "0.0", None, "4825.0"),
    RefRow(6, "OIL CAN 10", None, "10.0", "PCS", "1975.0", "0.0", None, "0.0", None, "19,750.0"),
    RefRow(7, "SUGAR", None, "2.0", "PCS", "1925.0", "0.0", None, "0.0", None, "3850.0"),
    RefRow(8, "SOYABEAN CHUNKS 15 KG", None, "2.0", "BOR", "1230.0", "0.0", None, "0.0", None, "2460.0"),
    RefRow(9, "SONAL SABUDANA KHICHDI 500 GM", "30", "25.0", "KGS", "40.18", "0.0", None, "120.54", "12%", "1125.0"),
    RefRow(10, "SABUDANA 30 KG", None, "1.0", "KGS", "1336.66", "0.0", None, "3.34", "0.25%", "1340.0"),
    RefRow(11, "UDAD DAL 1 KG", None, "20.0", "KGS", "47.95", "0.0", None, "0.96", "0.1%", "960.0"),
    RefRow(12, "RAJAMM", None, "25.0", "KGS", "44.96", "0.0", None, "1.12", "0.1%", "1125.0"),
    RefRow(13, "PARLE-G", None, "5.0", "PET", "648.38", "0.0", None, "8.10", "0.25%", "3250.0"),
]

TOTALS = {
    "quantity": Decimal("110"),
    "discount": Decimal("124.08"),
    "tax": Decimal("215.76"),
    "amount": Decimal("46885.80"),
    "received": Decimal("0.00"),
    "balance": Decimal("46885.80"),
}

# Column left edges and right edges (px at 1240 px page width); numbers are right-aligned
COLS = {
    "sno": (40, 95), "items": (100, 430), "hsn": (440, 500), "qty": (510, 640),
    "rate": (650, 780), "disc": (790, 900), "tax": (910, 1030), "amount": (1040, 1200),
}
HEADERS = {"sno": "S.No.", "items": "ITEMS", "hsn": "HSN", "qty": "QTY.", "rate": "RATE",
           "disc": "DISC.", "tax": "TAX", "amount": "AMOUNT"}
WRAP_CHARS = 24


def _wrap(text: str, width: int = WRAP_CHARS) -> List[str]:
    lines, cur = [], ""
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    return lines + [cur]


def render_png(font_size: int = 20, stacked_percentages: bool = True, dash_for_missing_hsn: bool = True,
               table_rules: bool = True) -> Image.Image:
    font = ImageFont.load_default(size=font_size)
    big = ImageFont.load_default(size=font_size + 10)
    line_h = int(font_size * 1.45)
    img = Image.new("RGB", (1240, 1500), "white")
    d = ImageDraw.Draw(img)

    def right(col: str, y: int, text: str) -> None:
        x1 = COLS[col][1]
        w = d.textlength(text, font=font)
        d.text((x1 - w, y), text, fill="black", font=font)

    def left(col: str, y: int, text: str, f=font) -> None:
        d.text((COLS[col][0], y), text, fill="black", font=f)

    d.text((40, 30), "SHREE GANESH TRADERS", fill="black", font=big)
    d.text((40, 75), "Station Road, Nagpur  |  Phone: 9876501234", fill="black", font=font)
    d.text((40, 115), "TAX INVOICE", fill="black", font=font)
    d.text((40, 155), "Bill To: Verma General Store", fill="black", font=font)
    d.text((760, 155), "Invoice No.: 112", fill="black", font=font)
    d.text((760, 185), "Invoice Date: 03/10/2026", fill="black", font=font)

    y = 240
    d.rectangle([30, y - 8, 1210, y + line_h], fill=(225, 225, 225))
    for col, title in HEADERS.items():
        (left if col in ("sno", "items") else right)(col, y, title)
    y += line_h + 10
    table_top = y - 10

    for row in ROWS:
        desc = _wrap(row.product)
        left("sno", y, str(row.sno))
        left("items", y, desc[0])
        hsn = row.hsn or ("-" if dash_for_missing_hsn else "")
        if hsn:
            right("hsn", y, hsn)
        right("qty", y, f"{row.qty} {row.unit}")
        right("rate", y, row.rate)
        disc = row.disc if not row.disc_pct or stacked_percentages else f"{row.disc} ({row.disc_pct})"
        tax = row.tax if not row.tax_pct or stacked_percentages else f"{row.tax} ({row.tax_pct})"
        right("disc", y, disc)
        right("tax", y, tax)
        right("amount", y, row.amount)
        extra = 0
        if len(desc) > 1:
            left("items", y + line_h, desc[1])
            extra = 1
        if stacked_percentages and (row.disc_pct or row.tax_pct):
            if row.disc_pct:
                right("disc", y + line_h, f"({row.disc_pct})")
            if row.tax_pct:
                right("tax", y + line_h, f"({row.tax_pct})")
            extra = 1
        y += line_h * (1 + extra) + 12
        if table_rules:
            d.line([30, y - 7, 1210, y - 7], fill=(170, 170, 170), width=1)

    if table_rules:
        for x in (97, 435, 505, 645, 785, 905, 1035):
            d.line([x, table_top, x, y - 7], fill=(190, 190, 190), width=1)

    d.rectangle([30, y - 4, 1210, y + line_h], fill=(235, 235, 235))
    left("items", y, "TOTAL")
    right("qty", y, "110")
    right("disc", y, "₹ 124.08")
    right("tax", y, "₹ 215.76")
    right("amount", y, "₹ 46,885.80")
    y += line_h + 30
    d.text((760, y), "Received Amount   ₹ 0.00", fill="black", font=font)
    d.text((760, y + line_h), "Balance Amount   ₹ 46,885.80", fill="black", font=font)
    d.text((40, y + 3 * line_h), "Terms: Goods once sold will not be taken back.", fill="black", font=font)
    return img.crop((0, 0, 1240, min(1500, y + 5 * line_h)))


def photo_like(img: Image.Image, angle: float = 1.5, blur: float = 0.6, quality: int = 70,
               width: int = 1100) -> bytes:
    """Slightly rotated, softened and JPEG-compressed copy, like a phone photo."""
    out = img.convert("RGB").rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
    out = out.filter(ImageFilter.GaussianBlur(blur))
    out = out.resize((width, int(out.height * width / out.width)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _pdf(objects: List[bytes]) -> bytes:
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def render_pdf() -> bytes:
    """Digital (text) PDF of the same invoice, with percentages printed inline."""
    scale = 595 / 1240
    lines = []

    def put(x_px: float, y_px: float, text: str, right_align_to: Optional[float] = None) -> None:
        size = 9
        x = x_px * scale
        if right_align_to is not None:
            x = right_align_to * scale - len(text) * size * 0.5
        lines.append((x, 842 - y_px * scale - 20, text.replace("₹", "Rs.")))

    put(40, 30, "SHREE GANESH TRADERS")
    put(40, 75, "TAX INVOICE")
    put(760, 75, "Invoice No.: 112")
    put(760, 100, "Invoice Date: 03/10/2026")
    y = 160
    for col, title in HEADERS.items():
        if col in ("sno", "items"):
            put(COLS[col][0], y, title)
        else:
            put(0, y, title, right_align_to=COLS[col][1])
    y += 34
    for row in ROWS:
        cells = {
            "hsn": row.hsn or "", "qty": f"{row.qty} {row.unit}", "rate": row.rate,
            "disc": f"{row.disc} ({row.disc_pct})" if row.disc_pct else row.disc,
            "tax": f"{row.tax} ({row.tax_pct})" if row.tax_pct else row.tax, "amount": row.amount,
        }
        put(COLS["sno"][0], y, str(row.sno))
        put(COLS["items"][0], y, row.product)
        for col, val in cells.items():
            if val:
                put(0, y, val, right_align_to=COLS[col][1])
        y += 30
    put(COLS["items"][0], y, "TOTAL")
    put(0, y, "110", right_align_to=COLS["qty"][1])
    put(0, y, "124.08", right_align_to=COLS["disc"][1])
    put(0, y, "215.76", right_align_to=COLS["tax"][1])
    put(0, y, "46,885.80", right_align_to=COLS["amount"][1])
    put(760, y + 50, "Received Amount Rs. 0.00")
    put(760, y + 80, "Balance Amount Rs. 46,885.80")

    return text_pdf(lines)


def text_pdf(lines: List[Tuple[float, float, str]], font_size: int = 9) -> bytes:
    """One-page digital PDF (Helvetica) with each text placed at (x, y) in PDF points."""
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = f"BT /F1 {font_size} Tf\n".encode() + b"".join(
        f"1 0 0 1 {x:.2f} {yy:.2f} Tm ({esc(t)}) Tj\n".encode("latin-1") for x, yy, t in lines) + b"ET"
    stream = b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"
    return _pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        stream,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def original_scan_files() -> List[Path]:
    """The original invoice scan, if someone adds it to the fixtures directory."""
    return [p for ext in ("png", "jpg", "jpeg", "pdf") for p in FIXTURE_DIR.glob(f"reference_invoice.{ext}")]
