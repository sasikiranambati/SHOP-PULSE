"""Geometry checks for the synthetic invoice renderer (tests/doc_prep_dataset.py).

The supplier header and the invoice metadata block are drawn on the same rows. If their text
boxes overlap, OCR reads a corrupted word (for example "TRADERS" running into "Invoice No").
These tests check the computed text boxes, not OCR output, for several fonts, orientations and
scales. They do not change any expected value used by other tests.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import doc_prep_dataset as dpd

DEJAVU = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
LIBERATION = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)
FONT_SETS = {"dejavu": DEJAVU, "liberation": LIBERATION}


@pytest.fixture
def use_font_set(monkeypatch):
    """Point the renderer at one font family (regular + bold) and clear its font cache."""

    def _use(name: str) -> None:
        regular, bold = FONT_SETS[name]
        if not (Path(regular).exists() and Path(bold).exists()):
            pytest.skip(f"font set {name!r} is not installed on this machine")
        monkeypatch.setattr(dpd, "FONT_CANDIDATES_REGULAR", (regular,))
        monkeypatch.setattr(dpd, "FONT_CANDIDATES_BOLD", (bold,))
        dpd._font.cache_clear()

    yield _use
    dpd._font.cache_clear()


def _assert_no_overlap(layout: dpd.HeaderMetaLayout, gap: int = 0) -> None:
    boxes = layout.all_boxes()
    names = [name for name, _ in boxes]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (na, a), (nb, b) = boxes[i], boxes[j]
            assert not a.overlaps(b, gap=gap), f"{na} {a} overlaps {nb} {b}"


@pytest.mark.parametrize("font_set", sorted(FONT_SETS))
@pytest.mark.parametrize("landscape", [False, True])
@pytest.mark.parametrize("scale", [1.0, 0.62, 0.45])
def test_header_and_metadata_boxes_never_overlap(use_font_set, font_set, landscape, scale):
    use_font_set(font_set)
    width = int((1754 if landscape else 1240) * scale)
    layout = dpd.header_metadata_layout(width, scale, landscape, "00427")
    _assert_no_overlap(layout)


@pytest.mark.parametrize("font_set", sorted(FONT_SETS))
def test_supplier_name_clears_metadata_by_the_required_clearance(use_font_set, font_set):
    use_font_set(font_set)
    layout = dpd.header_metadata_layout(1240, 1.0, False, "00427")
    supplier = layout.header_box
    meta_left = min(box.x0 for box in layout.meta_boxes)
    assert supplier.x1 + dpd.HEADER_CLEARANCE_PT <= meta_left, (supplier, meta_left)


@pytest.mark.parametrize("font_set", sorted(FONT_SETS))
def test_shrink_fallback_still_clears_when_default_size_is_too_large(use_font_set, monkeypatch, font_set):
    """If a font is much wider than expected, the header shrinks instead of overlapping."""
    use_font_set(font_set)
    monkeypatch.setattr(dpd, "HEADER_SUPPLIER_PT", 90)
    layout = dpd.header_metadata_layout(1240, 1.0, False, "00427")
    assert layout.header_font_size < 90
    _assert_no_overlap(layout)


@pytest.mark.parametrize("font_set", sorted(FONT_SETS))
@pytest.mark.parametrize("landscape", [False, True])
@pytest.mark.parametrize("scale", [1.0, 0.62, 0.45])
def test_default_supplier_size_clears_without_shrinking(use_font_set, font_set, landscape, scale):
    """The fixed size must be sufficient on its own; the shrink fallback is only a safety net."""
    use_font_set(font_set)
    width = int((1754 if landscape else 1240) * scale)
    layout = dpd.header_metadata_layout(width, scale, landscape, "00427")
    assert layout.header_font_size == round(dpd.HEADER_SUPPLIER_PT * scale), layout.header_font_size


def test_unfittable_header_raises_instead_of_overlapping(use_font_set, monkeypatch):
    """If the name cannot clear the metadata even at the floor, no overlapping fixture is produced."""
    use_font_set("dejavu")
    monkeypatch.setattr(dpd, "HEADER_SUPPLIER_PT", 90)
    monkeypatch.setattr(dpd, "HEADER_MIN_SUPPLIER_PT", 88)
    with pytest.raises(ValueError, match="cannot clear the metadata block"):
        dpd.header_metadata_layout(1240, 1.0, False, "00427")


def test_rendered_page_uses_the_checked_layout(use_font_set):
    """The renderer must draw the same header size and metadata positions the geometry check uses."""
    use_font_set("dejavu")
    layout = dpd.header_metadata_layout(1240, 1.0, False, "00427")
    page = dpd.render_invoice_page(dpd.PAGE_1_ITEMS)
    assert page.image.shape[:2] == (1754, 1240)
    assert dpd.HEADER_LINES[0] in page.ground_truth_lines
    assert layout.header_font_size == dpd.HEADER_SUPPLIER_PT
    _assert_no_overlap(layout)
