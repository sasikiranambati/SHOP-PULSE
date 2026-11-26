"""
Synthetic invoice-photo dataset for the document preparation (image preprocessing) layer.

Every case is rendered from text we control, so the exact ground-truth text, the expected
orientation and the expected tilt are known. Degradations imitate what shop owners' phone
photos suffer from: sideways / upside-down capture, tilt, perspective, shadows, low light,
blur, low resolution and faint print.

Deterministic: every random draw uses a fixed seed. Used by tests/test_document_prep*.py
and by tests/evaluate_document_prep.py (OCR before/after comparison).

    python -m doc_prep_dataset <out_dir>      (run from backend/tests) writes the dataset as PNGs.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES_REGULAR = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "DejaVuSans.ttf",
    "tahoma.ttf",
    "arial.ttf",
)
FONT_CANDIDATES_BOLD = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "DejaVuSans-Bold.ttf",
    "tahomabd.ttf",
    "arialbd.ttf",
)


@lru_cache(maxsize=64)
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES_BOLD if bold else FONT_CANDIDATES_REGULAR:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


# --------------------------------------------------------------------------
# Supplier header and metadata layout
# --------------------------------------------------------------------------
# The supplier name and the invoice metadata share the top rows of the page. The supplier name
# is drawn at a size that leaves HEADER_CLEARANCE_PT of space before the metadata block, in every
# font tested (DejaVu Sans, Liberation Sans). If a font is wider, the name shrinks to fit; if it still
# cannot fit at HEADER_MIN_SUPPLIER_PT, rendering raises ValueError instead of overlapping.
# Geometry is checked in tests/test_fixture_layout_geometry.py.
HEADER_SUPPLIER_PT = 36  # supplier name size (was 40, which ran into the metadata in DejaVu Sans Bold)
HEADER_CLEARANCE_PT = 24  # minimum gap between the supplier name and the metadata block
HEADER_MIN_SUPPLIER_PT = 20  # floor for the shrink fallback


@dataclass(frozen=True)
class TextBox:
    x0: int
    y0: int
    x1: int
    y1: int

    def overlaps(self, other: "TextBox", gap: int = 0) -> bool:
        return not (
            self.x1 + gap <= other.x0
            or other.x1 + gap <= self.x0
            or self.y1 + gap <= other.y0
            or other.y1 + gap <= self.y0
        )


@dataclass(frozen=True)
class HeaderMetaLayout:
    header_font_size: int
    header_font: ImageFont.FreeTypeFont
    header_box: TextBox
    header_line2_box: TextBox
    meta_font: ImageFont.FreeTypeFont
    meta_texts: Tuple[str, ...]
    meta_positions: Tuple[Tuple[float, float], ...]  # (x, y) of each metadata line
    meta_boxes: Tuple[TextBox, ...]

    def all_boxes(self) -> List[Tuple[str, TextBox]]:
        boxes = [("supplier", self.header_box), ("header_line2", self.header_line2_box)]
        boxes += [(f"meta_{i}", b) for i, b in enumerate(self.meta_boxes)]
        return boxes


_MEASURE = ImageDraw.Draw(Image.new("L", (1, 1)))


def _text_box(pos: Tuple[float, float], text: str, font: ImageFont.FreeTypeFont) -> TextBox:
    x0, y0, x1, y1 = _MEASURE.textbbox(pos, text, font=font)
    return TextBox(int(x0), int(y0), int(x1), int(y1))


def header_metadata_layout(width: int, scale: float, landscape: bool, invoice_no: str) -> HeaderMetaLayout:
    """Where the supplier name and the invoice metadata are drawn for one page size and font set."""

    def s(v: float) -> int:
        return int(round(v * scale))

    margin = s(80)
    meta_font = _font(s(24)) if landscape else _font(s(24), True)
    meta_texts = tuple(m.format(inv=invoice_no) for m in META_LINES_TEMPLATE)
    meta_positions: List[Tuple[float, float]] = []
    meta_boxes: List[TextBox] = []
    for i, text in enumerate(meta_texts):
        w = _MEASURE.textlength(text, font=meta_font)
        pos = (width - margin - w, s(70 + 36 * i))
        meta_positions.append(pos)
        meta_boxes.append(_text_box(pos, text, meta_font))
    meta_left = min(b.x0 for b in meta_boxes)

    size = s(HEADER_SUPPLIER_PT)
    floor = s(HEADER_MIN_SUPPLIER_PT)
    while True:
        header_font = _font(size, True)
        header_box = _text_box((margin, s(70)), HEADER_LINES[0], header_font)
        if header_box.x1 + s(HEADER_CLEARANCE_PT) <= meta_left:
            break
        if size <= floor:
            # Refuse to render an overlapping fixture rather than produce corrupted test data.
            raise ValueError(
                f"supplier header cannot clear the metadata block even at {HEADER_MIN_SUPPLIER_PT} pt "
                f"(header ends at x={header_box.x1}, metadata starts at x={meta_left})"
            )
        size -= 1

    return HeaderMetaLayout(
        header_font_size=size,
        header_font=header_font,
        header_box=header_box,
        header_line2_box=_text_box((margin, s(130)), HEADER_LINES[1], _font(s(22))),
        meta_font=meta_font,
        meta_texts=meta_texts,
        meta_positions=tuple(meta_positions),
        meta_boxes=tuple(meta_boxes),
    )


# --------------------------------------------------------------------------
# Invoice content (ground truth)
# --------------------------------------------------------------------------

ItemRow = Tuple[str, str, str, str, str, str, str, str]  # Sl, Desc, HSN, Qty, Unit, Rate, MRP, Amount

PAGE_1_ITEMS: List[ItemRow] = [
    ("1", "Aashirvaad Atta 5kg", "1101", "4", "bag", "245.00", "289.00", "980.00"),
    ("2", "Amul Taaza Milk 500ml", "0401", "24", "pkt", "27.50", "29.00", "660.00"),
    ("3", "Tata Salt 1kg", "2501", "20", "pkt", "22.00", "28.00", "440.00"),
    ("4", "MDH Jeera Powder 100g", "0909", "12", "pcs", "58.75", "72.00", "705.00"),
    ("5", "Parle-G Biscuits 250g", "1905", "24", "pkt", "9.50", "12.00", "228.00"),
    ("6", "Toor Dal Loose", "0713", "2.50", "kg", "132.40", "150.00", "331.00"),
    ("7", "Eno Fruit Salt 5g", "3004", "50", "pcs", "0.85", "1.00", "42.50"),
]

PAGE_2_ITEMS: List[ItemRow] = [
    ("8", "Fortune Sunflower Oil 1L", "1512", "12", "pcs", "140.00", "175.00", "1680.00"),
    ("9", "Maggi Noodles 70g", "1902", "48", "pkt", "11.00", "14.00", "528.00"),
    ("10", "Brooke Bond Red Label 250g", "0902", "6", "pkt", "112.25", "130.00", "673.50"),
    ("11", "Surf Excel Easy Wash 1kg", "3402", "10", "pkt", "96.00", "115.00", "960.00"),
]

HEADER_LINES = (
    "SRI LAKSHMI WHOLESALE TRADERS",
    "14 Market Road, Vijayawada  GSTIN 37ABCDE1234F1Z5",
)
META_LINES_TEMPLATE = ("Invoice No: INV-{inv}", "Date: 08/10/2026")
COLUMNS = ("Sl", "Item Description", "HSN", "Qty", "Unit", "Rate", "MRP", "Amount")
FOOTER_FAINT = "Goods once sold will not be taken back. E.&O.E."


@dataclass
class RenderedPage:
    image: np.ndarray  # BGR uint8
    ground_truth_lines: List[str]
    critical_tokens: List[str]  # decimals, HSN codes, leading-zero identifiers


def render_invoice_page(
    items: Sequence[ItemRow],
    invoice_no: str = "00427",
    landscape: bool = False,
    scale: float = 1.0,
    ink: int = 20,
    paper: int = 250,
    faint_footer: bool = True,
    total_label: str = "Grand Total",
) -> RenderedPage:
    """Render one clean invoice page with a bordered item table; returns image + exact text."""
    width, height = (1754, 1240) if landscape else (1240, 1754)
    width, height = int(width * scale), int(height * scale)
    img = Image.new("L", (width, height), paper)
    draw = ImageDraw.Draw(img)

    def s(v: float) -> int:
        return int(round(v * scale))

    margin = s(80)
    lines: List[str] = []
    critical: List[str] = []

    layout = header_metadata_layout(width, scale, landscape, invoice_no)
    draw.text((margin, s(70)), HEADER_LINES[0], font=layout.header_font, fill=ink)
    draw.text((margin, s(130)), HEADER_LINES[1], font=_font(s(22)), fill=ink)
    lines.extend(HEADER_LINES)
    for m, pos in zip(layout.meta_texts, layout.meta_positions):
        draw.text(pos, m, font=layout.meta_font, fill=ink)
    lines.extend(layout.meta_texts)
    critical.append(f"INV-{invoice_no}")
    draw.line((margin, s(190), width - margin, s(190)), fill=ink, width=max(1, s(3)))

    # Table geometry: proportional column widths
    fractions = (0.06, 0.34, 0.09, 0.08, 0.08, 0.12, 0.11, 0.12)
    table_w = width - 2 * margin
    xs = [margin]
    for f in fractions:
        xs.append(xs[-1] + int(table_w * f))
    xs[-1] = width - margin
    row_h = s(52)
    top = s(240)
    font = _font(s(23))
    bold = _font(s(23), True)
    numeric_cols = {0, 3, 5, 6, 7}

    def draw_row(y: int, cells: Sequence[str], f: ImageFont.FreeTypeFont) -> None:
        for ci, cell in enumerate(cells):
            tw = draw.textlength(cell, font=f)
            if ci in numeric_cols:
                x = xs[ci + 1] - s(12) - tw
            else:
                x = xs[ci] + s(12)
            draw.text((x, y + (row_h - s(23)) // 2 - s(2)), cell, font=f, fill=ink)

    draw_row(top, COLUMNS, bold)
    lines.append(" ".join(COLUMNS))
    for r, row in enumerate(items):
        y = top + row_h * (r + 1)
        draw_row(y, row, font)
        lines.append(" ".join(row))
        critical.extend([row[2], row[5], row[6], row[7]])
        if "." in row[3]:
            critical.append(row[3])
    table_bottom = top + row_h * (len(items) + 1)
    # Borders
    for i in range(len(items) + 2):
        y = top + row_h * i
        draw.line((xs[0], y, xs[-1], y), fill=ink, width=max(1, s(2)))
    for x in xs:
        draw.line((x, top, x, table_bottom), fill=ink, width=max(1, s(2)))

    total = sum(float(r[7]) for r in items)
    total_txt = f"{total_label}: Rs. {total:,.2f}"
    tw = draw.textlength(total_txt, font=bold)
    draw.text((width - margin - tw, table_bottom + s(30)), total_txt, font=bold, fill=ink)
    lines.append(total_txt)
    critical.append(f"{total:,.2f}")

    if faint_footer:
        faint_ink = int(paper - (paper - ink) * 0.45)
        draw.text((margin, table_bottom + s(110)), FOOTER_FAINT, font=_font(s(20)), fill=faint_ink)
        lines.append(FOOTER_FAINT)

    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_GRAY2BGR)
    return RenderedPage(image=bgr, ground_truth_lines=lines, critical_tokens=critical)


# --------------------------------------------------------------------------
# Degradations
# --------------------------------------------------------------------------


def rotate_cardinal(img: np.ndarray, clockwise_degrees: int) -> np.ndarray:
    """Rotate the content clockwise by 0/90/180/270 degrees (what a sideways capture looks like)."""
    k = (clockwise_degrees // 90) % 4
    if k == 0:
        return img.copy()
    codes = {1: cv2.ROTATE_90_CLOCKWISE, 2: cv2.ROTATE_180, 3: cv2.ROTATE_90_COUNTERCLOCKWISE}
    return cv2.rotate(img, codes[k])


def tilt(img: np.ndarray, degrees_ccw: float, background: Tuple[int, int, int] = (250, 250, 250)) -> np.ndarray:
    """Rotate counter-clockwise by a small angle on an expanded canvas (nothing is clipped)."""
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), degrees_ccw, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=background)


def _background(h: int, w: int, color: Tuple[int, int, int], seed: int, texture: float = 12.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = np.zeros((h, w, 3), np.float32)
    base[:] = color
    noise = rng.normal(0, texture, (h // 8 + 1, w // 8 + 1, 1)).astype(np.float32)
    noise = cv2.resize(noise, (w, h), interpolation=cv2.INTER_CUBIC)[..., None]
    grain = rng.normal(0, texture / 3, (h, w, 1)).astype(np.float32)
    return np.clip(base + noise + grain, 0, 255).astype(np.uint8)


def place_on_background(
    page: np.ndarray,
    corners_frac: Sequence[Tuple[float, float]],
    canvas_size: Tuple[int, int] = (1500, 2000),
    background_color: Tuple[int, int, int] = (70, 95, 125),
    seed: int = 7,
    texture: float = 12.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """Warp the page onto a textured background (phone photo of a sheet on a table).

    corners_frac: tl, tr, br, bl as fractions of the canvas (width, height).
    Returns (photo, corner pixel coordinates).
    """
    cw, ch = canvas_size
    h, w = page.shape[:2]
    src = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    dst = np.float32([[x * cw, y * ch] for x, y in corners_frac])
    hmat = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(page, hmat, (cw, ch), flags=cv2.INTER_AREA, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), hmat, (cw, ch), flags=cv2.INTER_LINEAR)
    bg = _background(ch, cw, background_color, seed, texture)
    alpha = (mask.astype(np.float32) / 255.0)[..., None]
    photo = (warped.astype(np.float32) * alpha + bg.astype(np.float32) * (1 - alpha)).astype(np.uint8)
    return photo, dst


def camera_quad(
    page_size: Tuple[int, int],
    canvas_size: Tuple[int, int],
    tilt_x_deg: float,
    tilt_y_deg: float,
    roll_deg: float = 0.0,
    fill: float = 0.78,
    focal_factor: float = 1.1,
) -> List[Tuple[float, float]]:
    """Corners (fractions of the canvas) of a flat page photographed by a pinhole camera.

    The page plane is rotated in 3-D and projected with a principal point at the canvas
    centre, so the true page aspect ratio is recoverable from the photo (unlike an arbitrary
    homography).
    """
    pw, ph = page_size
    cw, ch = canvas_size
    f = focal_factor * max(cw, ch)
    corners = np.array([[-pw / 2, -ph / 2, 0], [pw / 2, -ph / 2, 0], [pw / 2, ph / 2, 0], [-pw / 2, ph / 2, 0]],
                       dtype=np.float64)
    ax, ay, az = np.radians([tilt_x_deg, tilt_y_deg, roll_deg])
    rx = np.array([[1, 0, 0], [0, np.cos(ax), -np.sin(ax)], [0, np.sin(ax), np.cos(ax)]])
    ry = np.array([[np.cos(ay), 0, np.sin(ay)], [0, 1, 0], [-np.sin(ay), 0, np.cos(ay)]])
    rz = np.array([[np.cos(az), -np.sin(az), 0], [np.sin(az), np.cos(az), 0], [0, 0, 1]])
    pts = corners @ (rz @ ry @ rx).T
    # distance so the page spans `fill` of the shorter canvas side
    z = f * max(pw, ph) / (fill * min(cw, ch) if pw <= ph else fill * max(cw, ch))
    pts[:, 2] += z
    u = f * pts[:, 0] / pts[:, 2] + cw / 2
    v = f * pts[:, 1] / pts[:, 2] + ch / 2
    return [(float(x / cw), float(y / ch)) for x, y in zip(u, v)]


def add_shadow(img: np.ndarray, strength: float = 0.55, seed: int = 3) -> np.ndarray:
    """Soft-edged diagonal shadow such as a hand or phone casts over the page."""
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = (xx / w) * 0.8 + (yy / h) * 0.6 - 0.75
    shade = 1.0 - strength * (1.0 / (1.0 + np.exp(-d * 18.0)))
    vignette = 1.0 - 0.18 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2) * 2.5
    out = img.astype(np.float32) * (shade * vignette)[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def low_light(img: np.ndarray, gain: float = 0.33, noise_sigma: float = 7.0, seed: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = img.astype(np.float32) * gain + rng.normal(0, noise_sigma, img.shape).astype(np.float32)
    out = cv2.GaussianBlur(np.clip(out, 0, 255), (0, 0), 0.7)
    return np.clip(out, 0, 255).astype(np.uint8)


def blur(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def downscale(img: np.ndarray, factor: float) -> np.ndarray:
    h, w = img.shape[:2]
    return cv2.resize(img, (max(1, int(w * factor)), max(1, int(h * factor))), interpolation=cv2.INTER_AREA)


def jpeg_roundtrip(img: np.ndarray, quality: int = 85) -> np.ndarray:
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def faint_print(page: RenderedPage) -> np.ndarray:
    """Low-contrast thermal/dot-matrix style print: ink lifted towards the paper tone."""
    img = page.image.astype(np.float32)
    out = 250 - (250 - img) * 0.32
    return jpeg_roundtrip(np.clip(out, 0, 255).astype(np.uint8), 90)


# --------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------


@dataclass
class DatasetCase:
    case_id: str
    title: str
    pages: List[np.ndarray]  # BGR images as the camera would deliver them (after EXIF)
    ground_truth_pages: List[List[str]]
    critical_tokens: List[str]
    expected_rotation_cw: int = 0  # clockwise rotation the pipeline must apply to make the page upright
    expected_skew_deg: float = 0.0
    expect_document_detection: bool = False
    tags: List[str] = field(default_factory=list)

    @property
    def ground_truth_text(self) -> str:
        return "\n\n".join("\n".join(p) for p in self.ground_truth_pages)


def _paperize(img: np.ndarray) -> np.ndarray:
    return jpeg_roundtrip(img, 92)


@lru_cache(maxsize=1)
def build_dataset() -> Dict[str, DatasetCase]:
    p1 = render_invoice_page(PAGE_1_ITEMS)
    p2 = render_invoice_page(PAGE_2_ITEMS, invoice_no="00428", total_label="Page Total")
    land = render_invoice_page(PAGE_1_ITEMS[:5], landscape=True, invoice_no="00511")
    gt1, gt2 = p1.ground_truth_lines, p2.ground_truth_lines
    crit = p1.critical_tokens
    cases: List[DatasetCase] = []

    def add(case: DatasetCase) -> None:
        cases.append(case)

    add(DatasetCase("01_clear_portrait", "Clear portrait invoice", [_paperize(p1.image)], [gt1], crit, tags=["clear"]))
    add(DatasetCase("02_landscape", "Landscape invoice (correctly oriented, wider than tall)",
                    [_paperize(land.image)], [land.ground_truth_lines], land.critical_tokens, tags=["clear", "landscape"]))
    # Content rotated clockwise by X -> pipeline must rotate by (360 - X) clockwise
    add(DatasetCase("03_rotated_90", "Invoice rotated 90 degrees clockwise",
                    [_paperize(rotate_cardinal(p1.image, 90))], [gt1], crit, expected_rotation_cw=270, tags=["rotation"]))
    add(DatasetCase("04_rotated_180", "Invoice upside down (180 degrees)",
                    [_paperize(rotate_cardinal(p1.image, 180))], [gt1], crit, expected_rotation_cw=180, tags=["rotation"]))
    add(DatasetCase("05_rotated_270", "Invoice rotated 90 degrees anticlockwise (270)",
                    [_paperize(rotate_cardinal(p1.image, 270))], [gt1], crit, expected_rotation_cw=90, tags=["rotation"]))
    add(DatasetCase("06_tilted_4deg", "Slightly tilted invoice (4 degrees)",
                    [_paperize(tilt(p1.image, 4.0))], [gt1], crit, expected_skew_deg=4.0, tags=["skew"]))

    persp, _ = place_on_background(
        p1.image, camera_quad((1240, 1754), (1500, 2000), tilt_x_deg=24, tilt_y_deg=-14, roll_deg=3), seed=11)
    add(DatasetCase("07_perspective", "Perspective-distorted photograph on a table",
                    [jpeg_roundtrip(persp, 88)], [gt1], crit, expect_document_detection=True, tags=["perspective", "photo"]))

    shadow_photo, _ = place_on_background(
        p1.image, [(0.08, 0.05), (0.93, 0.06), (0.95, 0.95), (0.06, 0.94)], background_color=(60, 60, 60), seed=12)
    add(DatasetCase("08_shadow", "Shadow-heavy photograph",
                    [jpeg_roundtrip(add_shadow(shadow_photo, 0.6), 88)], [gt1], crit,
                    expect_document_detection=True, tags=["shadow", "photo"]))

    add(DatasetCase("09_low_light", "Low-light photograph",
                    [jpeg_roundtrip(low_light(p1.image), 85)], [gt1], crit, tags=["low_light"]))
    add(DatasetCase("10_blurry", "Blurry photograph (moderate defocus)",
                    [jpeg_roundtrip(blur(p1.image, 2.0), 90)], [gt1], crit, tags=["blur"]))
    add(DatasetCase("11_low_resolution", "Low-resolution photograph (45% scale)",
                    [jpeg_roundtrip(downscale(p1.image, 0.45), 90)], [gt1], crit, tags=["low_res"]))
    add(DatasetCase("12_multi_page", "Two-page invoice (second page sideways)",
                    [_paperize(p1.image), _paperize(rotate_cardinal(p2.image, 90))], [gt1, gt2],
                    crit + p2.critical_tokens, tags=["multi_page", "rotation"]))
    add(DatasetCase("13_small_decimals", "Small decimal values at reduced print size",
                    [_paperize(downscale(p1.image, 0.62))], [gt1], crit, tags=["decimals"]))
    add(DatasetCase("14_faint_print", "Faint printed text", [faint_print(p1)], [gt1], crit, tags=["faint"]))
    add(DatasetCase("15_table_borders_tilted_photo", "Bordered table, tilted 7 degrees, sideways photo",
                    [jpeg_roundtrip(rotate_cardinal(tilt(p1.image, -7.0), 270), 88)], [gt1], crit,
                    expected_rotation_cw=90, expected_skew_deg=-7.0, tags=["rotation", "skew", "table"]))
    similar, _ = place_on_background(
        p1.image, [(0.10, 0.08), (0.90, 0.10), (0.92, 0.93), (0.08, 0.91)],
        background_color=(228, 230, 232), seed=21, texture=4.0)
    add(DatasetCase("16_similar_background", "Paper on a background close to the paper colour",
                    [jpeg_roundtrip(similar, 88)], [gt1], crit, tags=["photo", "similar_bg"]))
    very_blurry = jpeg_roundtrip(blur(downscale(p1.image, 0.5), 4.5), 80)
    add(DatasetCase("17_unrecoverable", "Severely blurred, low-resolution capture (should ask for retake)",
                    [very_blurry], [gt1], crit, tags=["unreadable"]))
    return {c.case_id: c for c in cases}


def write_dataset(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for cid, case in build_dataset().items():
        files = []
        for i, page in enumerate(case.pages, start=1):
            name = f"{cid}_p{i}.png"
            cv2.imwrite(str(out_dir / name), page)
            files.append(name)
        manifest[cid] = {
            "title": case.title,
            "files": files,
            "expected_rotation_cw": case.expected_rotation_cw,
            "expected_skew_deg": case.expected_skew_deg,
            "ground_truth_pages": case.ground_truth_pages,
            "critical_tokens": case.critical_tokens,
            "tags": case.tags,
        }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "doc_prep_dataset_out")
    write_dataset(target)
    print(f"Wrote {len(build_dataset())} cases to {target}")
