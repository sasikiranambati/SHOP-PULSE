"""
ShopPulse Grocery Invoice Scanner - Text and Line Reconstruction Layer.

Reconstructs coherent text lines from spatial OCR words. Handles baseline clustering,
horizontal reading order, gap detection between words/columns, multi-line continuations,
and sequential reading order assignment.
"""

from typing import List, Optional, Tuple, Dict, Any
import numpy as np
import logging
import re
import uuid

from services.grocery_ocr.schemas.ocr import BoundingBox, OCRDocumentResult, OCRLine, OCRPageResult, OCRWord

logger = logging.getLogger("grocery_ocr.text_line_reconstructor")


class TextLineReconstructor:
    """
    Dedicated spatial line reconstruction engine.
    Groups word-level OCR tokens into horizontally aligned text lines
    while strictly preserving bounding boxes, spatial ordering, and reading sequence.
    """

    def __init__(
        self,
        vertical_overlap_ratio: float = 0.45,
        default_line_height_tolerance: float = 6.0,
        column_gap_multiplier: float = 2.5,
    ):
        self.vertical_overlap_ratio = vertical_overlap_ratio
        self.default_line_height_tolerance = default_line_height_tolerance
        self.column_gap_multiplier = column_gap_multiplier

    def reconstruct_lines(
        self,
        words: List[OCRWord],
        page_width: int = 1000,
        page_height: int = 1500,
    ) -> List[OCRLine]:
        """
        Reconstructs coherent lines of text from an unorganized or stream-ordered list of OCR words.

        Args:
            words: Extracted OCR words with bounding box coordinates.
            page_width: Page pixel width.
            page_height: Page pixel height.

        Returns:
            List of spatially ordered OCRLine instances with sequential line_numbers
            and constituent words assigned their line_number and reading_order.
        """
        if not words:
            return []

        # Filter out empty or whitespace-only words
        valid_words = [w for w in words if w.text and w.text.strip()]
        if not valid_words:
            return []

        # Compute median word height to dynamically adapt clustering tolerance
        heights = [w.bbox.height for w in valid_words if w.bbox.height > 0]
        median_h = float(np.median(heights)) if heights else 15.0
        line_tolerance = max(self.default_line_height_tolerance, median_h * 0.40)

        # Sort words primarily by vertical coordinate (top-to-bottom), then horizontal (left-to-right)
        sorted_by_y = sorted(valid_words, key=lambda w: (w.bbox.y0, w.bbox.x0))

        # Spatial baseline clustering
        line_clusters: List[List[OCRWord]] = []
        cluster_baselines: List[float] = []  # Stores mean y_center of cluster

        for word in sorted_by_y:
            w_box = word.bbox
            w_center_y = (w_box.y0 + w_box.y1) / 2.0
            w_h = max(1.0, w_box.height)

            best_cluster_idx: Optional[int] = None
            best_overlap = 0.0

            for idx, cluster in enumerate(line_clusters):
                # Calculate bounding box of current cluster
                c_y0 = min(cw.bbox.y0 for cw in cluster)
                c_y1 = max(cw.bbox.y1 for cw in cluster)
                c_h = max(1.0, c_y1 - c_y0)
                c_center_y = cluster_baselines[idx]

                # Prevent vertical cluster snowballing across distinct text rows: a merge may not make
                # the line taller than the larger of the two boxes (plus 2 px) once that exceeds the
                # normal limit. A tall box on the same row (the OCR engine sometimes reports header words
                # with a box twice the text height) still joins its row instead of becoming a line of its
                # own, while a word from the next row, which would extend the line, is still refused.
                potential_new_h = max(c_y1, w_box.y1) - min(c_y0, w_box.y0)
                growth_limit = max(median_h * 1.6, 25.0, max(c_h, w_h) + 2.0)
                if potential_new_h > growth_limit:
                    continue

                # 1. Vertical interval overlap
                overlap = max(0.0, min(w_box.y1, c_y1) - max(w_box.y0, c_y0))
                overlap_ratio = overlap / min(w_h, c_h)

                # 2. Center-to-center baseline distance
                center_dist = abs(w_center_y - c_center_y)

                if overlap_ratio >= self.vertical_overlap_ratio or center_dist <= line_tolerance:
                    if overlap_ratio > best_overlap:
                        best_overlap = overlap_ratio
                        best_cluster_idx = idx

            if best_cluster_idx is not None:
                line_clusters[best_cluster_idx].append(word)
                # Update cluster mean center
                all_centers = [(cw.bbox.y0 + cw.bbox.y1) / 2.0 for cw in line_clusters[best_cluster_idx]]
                cluster_baselines[best_cluster_idx] = float(np.mean(all_centers))
            else:
                line_clusters.append([word])
                cluster_baselines.append(w_center_y)

        # Sort clusters strictly top-to-bottom based on their minimum y0 coordinate
        cluster_tuples = []
        for cluster in line_clusters:
            min_y = min(w.bbox.y0 for w in cluster)
            cluster_tuples.append((min_y, cluster))
        cluster_tuples.sort(key=lambda t: t[0])

        reconstructed_lines: List[OCRLine] = []
        global_reading_order = 0

        for line_idx, (_, cluster_words) in enumerate(cluster_tuples):
            # Sort words within line horizontally from left to right
            cluster_words.sort(key=lambda w: w.bbox.x0)

            # Reconstruct words with line_number and reading_order assigned
            updated_line_words: List[OCRWord] = []
            for w in cluster_words:
                updated_word = OCRWord(
                    text=w.text,
                    bbox=w.bbox,
                    confidence=w.confidence,
                    word_index=w.word_index,
                    reading_order=global_reading_order,
                    line_number=line_idx,
                    page_number=w.page_number,
                )
                updated_line_words.append(updated_word)
                global_reading_order += 1

            # Construct line text with appropriate spacing
            line_text = self._join_words_with_gap_awareness(updated_line_words)

            x0 = min(w.bbox.x0 for w in updated_line_words)
            y0 = min(w.bbox.y0 for w in updated_line_words)
            x1 = max(w.bbox.x1 for w in updated_line_words)
            y1 = max(w.bbox.y1 for w in updated_line_words)
            mean_conf = float(np.mean([w.confidence for w in updated_line_words]))

            reconstructed_lines.append(
                OCRLine(
                    line_number=line_idx,
                    text=line_text,
                    words=updated_line_words,
                    bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
                    confidence=round(mean_conf, 2),
                )
            )

        return reconstructed_lines

    def _join_words_with_gap_awareness(self, words: List[OCRWord]) -> str:
        """Joins line words into a string, preserving normal spaces and hyphenated compounds."""
        if not words:
            return ""
        if len(words) == 1:
            return words[0].text.strip()

        parts: List[str] = [words[0].text.strip()]
        for i in range(1, len(words)):
            prev_word = words[i - 1].text.strip()
            curr_word = words[i].text.strip()

            # If previous word ended with a hyphen, attach directly (e.g. "Parle-" + "G")
            if prev_word.endswith("-") or curr_word.startswith("-"):
                parts.append(curr_word)
            else:
                parts.append(" " + curr_word)

        return "".join(parts).strip()

    def detect_word_gaps(self, line: OCRLine) -> List[Dict[str, Any]]:
        """
        Analyzes horizontal gaps between adjacent words in a line.
        Significant gaps indicate column boundaries (e.g., between Item Name and Qty).
        """
        if len(line.words) < 2:
            return []

        # Calculate average character width in this line
        total_chars = sum(len(w.text) for w in line.words if len(w.text) > 0)
        total_width = sum(w.bbox.width for w in line.words)
        char_w = (total_width / total_chars) if total_chars > 0 else 8.0
        large_gap_threshold = max(20.0, char_w * self.column_gap_multiplier)

        gaps: List[Dict[str, Any]] = []
        for i in range(len(line.words) - 1):
            w_left = line.words[i]
            w_right = line.words[i + 1]
            gap_px = w_right.bbox.x0 - w_left.bbox.x1
            is_large = gap_px >= large_gap_threshold
            gaps.append({
                "left_word": w_left.text,
                "right_word": w_right.text,
                "left_idx": i,
                "right_idx": i + 1,
                "gap_px": round(gap_px, 2),
                "is_column_gap": is_large,
            })

        return gaps

    def detect_multiline_continuations(
        self,
        lines: List[OCRLine],
        item_col_max_x: float = 450.0,
    ) -> List[Tuple[int, int]]:
        """
        Identifies pairs of lines where line (i+1) is a continuation of item description
        from line (i). A continuation line typically has words located strictly within the
        description column without numeric price/qty columns to the right.
        """
        pairs: List[Tuple[int, int]] = []
        for i in range(len(lines) - 1):
            curr_line = lines[i]
            next_line = lines[i + 1]

            # If next line is short, exclusively in description column, and lacks numeric values
            next_words = next_line.words
            if not next_words:
                continue

            max_x = max(w.bbox.x1 for w in next_words)
            has_numbers = any(any(c.isdigit() for c in w.text) for w in next_words)

            if max_x <= item_col_max_x and not has_numbers:
                # Vertical proximity check
                vert_dist = next_line.bbox.y0 - curr_line.bbox.y1
                if 0 <= vert_dist <= (curr_line.bbox.height * 1.5):
                    pairs.append((curr_line.line_number, next_line.line_number))

        return pairs


HEADER_WORDS = {
    "product", "item", "description", "particulars", "qty", "quantity", "qnty",
    "rate", "price", "unit", "total", "amount", "tax", "discount", "mrp", "hsn",
    "s.no", "sno", "no", "unit price", "unit rate", "basic rate", "item description",
}
SERIAL_HEADERS = {"s.no.", "s.no", "sl.no", "sr.no", "sno", "no", "#", "slno"}


def build_ocr_document_from_raw_text(
    text: str,
    filename: str = "document.txt",
    base_y: float = 50.0,
    line_height: float = 35.0,
) -> OCRDocumentResult:
    """
    Constructs an OCRDocumentResult from plain text lines.
    Aligns tabular columns spatially using cell delimiters (| or multiple spaces/tabs)
    or recognized header roles, ensuring table reconstructor and column detector
    can accurately isolate columns.
    """
    text_lines = text.splitlines()
    ocr_words: List[OCRWord] = []
    ocr_lines: List[OCRLine] = []
    w_idx = 0
    header_col_count = 0
    desc_col_idx = 0

    for line_idx, line in enumerate(text_lines):
        stripped = line.strip()
        if not stripped:
            continue
        line_y0 = float(base_y + line_idx * line_height)
        line_y1 = line_y0 + 25.0
        line_words: List[OCRWord] = []

        cells: List[str] = []
        if "|" in stripped:
            raw_cells = [c.strip() for c in stripped.split("|")]
            if raw_cells and raw_cells[0] == "":
                raw_cells.pop(0)
            if raw_cells and raw_cells[-1] == "":
                raw_cells.pop()
            cells = raw_cells
        elif re.search(r"\t+|\s{2,}", stripped):
            cells = re.split(r"\t+|\s{2,}", stripped)
        else:
            tokens = stripped.split()
            tok_lower = {t.lower() for t in tokens}
            if len(tokens) >= 3 and len(tok_lower & HEADER_WORDS) >= 2:
                cells = tokens
            elif header_col_count > 1 and len(tokens) >= header_col_count:
                num_trailing = header_col_count - 1
                cells = [" ".join(tokens[:-num_trailing])] + tokens[-num_trailing:]
            else:
                cells = [stripped]

        cell_words_flat = [w.lower() for c in cells for w in c.split()]
        if len(cells) >= 3 and len(set(cell_words_flat) & HEADER_WORDS) >= 2:
            header_col_count = len(cells)
            first_c = cells[0].lower().strip()
            if first_c in SERIAL_HEADERS or first_c.startswith("s.") or first_c.startswith("sl"):
                desc_col_idx = 1
            else:
                desc_col_idx = 0

        if len(cells) > 1:
            col_x = 50.0
            for c_i, cell in enumerate(cells):
                cell_words = cell.split()
                curr_x = col_x
                for tok in cell_words:
                    wx0 = curr_x
                    wx1 = wx0 + float(len(tok) * 8)
                    word_obj = OCRWord(
                        text=tok,
                        bbox=BoundingBox(x0=wx0, y0=line_y0, x1=wx1, y1=line_y1),
                        confidence=100.0,
                        word_index=w_idx,
                        reading_order=w_idx,
                        page_number=1,
                    )
                    ocr_words.append(word_obj)
                    line_words.append(word_obj)
                    w_idx += 1
                    curr_x = wx1 + 8.0
                if c_i == desc_col_idx:
                    step = 280.0
                elif desc_col_idx == 1 and c_i == 0:
                    step = 80.0
                else:
                    step = 130.0
                col_x += step
        else:
            for match in re.finditer(r"\S+", stripped):
                tok = match.group()
                x0 = float(50 + match.start() * 10)
                x1 = float(50 + match.end() * 10)
                word_obj = OCRWord(
                    text=tok,
                    bbox=BoundingBox(x0=x0, y0=line_y0, x1=x1, y1=line_y1),
                    confidence=100.0,
                    word_index=w_idx,
                    reading_order=w_idx,
                    page_number=1,
                )
                ocr_words.append(word_obj)
                line_words.append(word_obj)
                w_idx += 1

        if line_words:
            ocr_lines.append(
                OCRLine(
                    line_number=line_idx,
                    text=stripped,
                    words=line_words,
                    bbox=BoundingBox(
                        x0=min(w.bbox.x0 for w in line_words),
                        y0=line_y0,
                        x1=max(w.bbox.x1 for w in line_words),
                        y1=line_y1,
                    ),
                    confidence=100.0,
                )
            )

    page = OCRPageResult(
        page_number=1,
        width=1800,
        height=max(800, 100 + len(text_lines) * 35),
        raw_text=text,
        words=ocr_words,
        lines=ocr_lines,
        confidence=100.0,
        processing_status="SUCCESS",
        metadata={"format": "plain_text", "is_digital": True, "source": "raw_stream"},
    )
    return OCRDocumentResult(
        document_id=f"doc_{uuid.uuid4().hex[:12]}",
        filename=filename,
        total_pages=1,
        pages=[page],
        full_text=text,
        processing_time_ms=0.0,
        engine_name="plain_text_spatial_generator",
    )

