"""
Table reconstruction visualizer for debugging OCR grids and associations.
Renders annotated overlays showing table bounds, header regions, column splits,
row clusters, word bounding boxes, and review-flagged cells.
"""

import io
from pathlib import Path
from typing import Optional, Union
from PIL import Image, ImageDraw, ImageFont

from services.grocery_ocr.schemas.table import TableReconstructionResult


class TableVisualizer:
    """
    Renders diagnostic visualization overlays on document page images
    to inspect and debug table reconstruction results.
    """

    def __init__(self, font_size: int = 12):
        self.font_size = font_size
        try:
            self.font = ImageFont.load_default()
        except Exception:
            self.font = None

    def render_annotation(
        self,
        image_input: Union[bytes, Image.Image],
        table_result: TableReconstructionResult,
        show_words: bool = True,
        show_columns: bool = True,
        show_rows: bool = True,
        show_cells: bool = True,
        highlight_review: bool = True,
    ) -> Image.Image:
        """
        Draws visual annotations onto the page image.

        Color Palette:
        - Table outer boundary: Forest Green (thick border)
        - Data boundary: Lime Green
        - Header region: Amber / Gold
        - Footer boundary: Gray
        - Column split lines: Cyan dashed/solid
        - Row boundaries: Magenta / Indigo
        - Individual words: Light Slate Gray
        - Flagged review cells: Crimson Red
        """
        if isinstance(image_input, bytes):
            img = Image.open(io.BytesIO(image_input)).convert("RGBA")
        else:
            img = image_input.convert("RGBA")

        # Create overlay layer for translucent highlights
        overlay = Image.new("RGBA", img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)
        w, h = img.size

        # 1. Draw Raw OCR Words (subtle)
        if show_words and table_result.raw_words:
            for word in table_result.raw_words:
                b = word.bbox
                draw.rectangle(
                    [b.x0, b.y0, b.x1, b.y1],
                    outline=(160, 174, 192, 120),  # slate gray
                    width=1,
                )

        # 2. Draw Table Boundaries
        if table_result.table_boundaries:
            tb = table_result.table_boundaries
            draw.rectangle(
                [tb.x0, tb.y0, min(w, tb.x1), min(h, tb.y1)],
                outline=(34, 139, 34, 240),  # forest green
                width=3,
            )
            draw.text((tb.x0 + 4, max(0, tb.y0 - 14)), "TABLE BOUNDARY", fill=(34, 139, 34, 255), font=self.font)

        # 3. Draw Header Region
        if table_result.header_boundaries:
            hb = table_result.header_boundaries
            # Translucent gold fill
            draw.rectangle(
                [hb.x0, hb.y0, min(w, hb.x1), min(h, hb.y1)],
                fill=(255, 215, 0, 40),
                outline=(218, 165, 32, 230),
                width=2,
            )
            draw.text((hb.x0 + 4, hb.y0 + 2), "HEADER", fill=(180, 120, 0, 255), font=self.font)

        # 4. Draw Column Boundaries & Vertical Dividers
        if show_columns and table_result.columns:
            y_top = table_result.table_boundaries.y0 if table_result.table_boundaries else 0.0
            y_bot = table_result.table_boundaries.y1 if table_result.table_boundaries else float(h)

            for col in table_result.columns:
                # Left split line
                if col.x_start is not None and col.x_start > 0:
                    draw.line([(col.x_start, y_top), (col.x_start, y_bot)], fill=(0, 180, 216, 200), width=2)
                # Header role tag
                x_tag = col.x_start or 0.0
                tag_label = f"[{col.column_index}] {col.role.upper()}"
                draw.text((x_tag + 4, min(h - 15, y_top + 4)), tag_label, fill=(0, 119, 182, 255), font=self.font)

        # 5. Draw Row Boundaries
        if show_rows and table_result.rows:
            for row in table_result.rows:
                if row.bbox:
                    rb = row.bbox
                    color = (255, 105, 180, 160) if not row.is_summary else (128, 128, 128, 160)
                    draw.line([(rb.x0, rb.y1), (rb.x1, rb.y1)], fill=color, width=1)
                    if row.is_continuation:
                        draw.text((rb.x0 - 25, rb.y0), "↳", fill=(220, 20, 60, 255), font=self.font)

        # 6. Highlight Review-Flagged Cells
        if highlight_review and table_result.rows:
            for row in table_result.rows:
                for cell in row.cells:
                    if cell.review_required and cell.bbox:
                        cb = cell.bbox
                        draw.rectangle(
                            [cb.x0, cb.y0, cb.x1, cb.y1],
                            fill=(255, 0, 0, 60),
                            outline=(220, 20, 60, 255),
                            width=2,
                        )
                        if cell.review_reason:
                            draw.text((cb.x0, cb.y1 + 1), "!", fill=(220, 20, 60, 255), font=self.font)

        # Alpha composite annotated overlay onto base image
        final_img = Image.alpha_composite(img, overlay).convert("RGB")
        return final_img

    def render_to_bytes(
        self,
        image_input: Union[bytes, Image.Image],
        table_result: TableReconstructionResult,
        **kwargs,
    ) -> bytes:
        """Renders annotations and returns PNG encoded byte stream."""
        annotated = self.render_annotation(image_input, table_result, **kwargs)
        buf = io.BytesIO()
        annotated.save(buf, format="PNG")
        return buf.getvalue()

    def save_visualization(
        self,
        image_input: Union[bytes, Image.Image],
        table_result: TableReconstructionResult,
        output_path: Union[str, Path],
        **kwargs,
    ) -> Path:
        """Saves annotated visualization to disk."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        annotated = self.render_annotation(image_input, table_result, **kwargs)
        annotated.save(path)
        return path

