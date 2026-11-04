"""
ShopPulse Grocery Invoice Scanner - Text and Line Reconstruction Layer.

Reconstructs coherent text lines from spatial OCR words. Handles baseline clustering,
horizontal reading order, gap detection between words/columns, multi-line continuations,
and sequential reading order assignment.
"""

from typing import List, Optional, Tuple, Dict, Any
import numpy as np
import logging

from services.grocery_ocr.schemas.ocr import BoundingBox, OCRLine, OCRWord

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
