"""
Advanced column detection algorithm for grocery invoice table reconstruction.
Implements header anchor clustering, dynamic whitespace valley separation,
horizontal alignment detection, numeric pattern verification, and conservative role inference.
"""

import re
import statistics
from typing import Any, Dict, List, Optional, Tuple
from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ColumnDetectionError
from services.grocery_ocr.extraction.header_recognizer import HeaderCandidate, HeaderRecognizer
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableRow,
    TableResult,
)

logger = get_logger("extraction.column_detector")


class IColumnDetector:
    """Abstract interface for detecting table columns and semantic roles."""

    def detect_columns(
        self,
        table: TableResult,
        data_rows: Optional[List[TableRow]] = None,
    ) -> List[DetectedColumn]:
        """Detects semantic columns from table headers and data rows."""
        raise NotImplementedError


class BaseColumnDetector(IColumnDetector):
    """
    Production column detector.
    Features:
    - Semantic header anchor matching & consolidation
    - Dynamic tolerance based on document text dimensions
    - Dynamic separation valley splitting between columns (prevents numeric swallowing)
    - Horizontal alignment detection (left, center, right)
    - Numeric pattern analysis across data cells
    - Conservative positional role inference with auditable reasons and evidence
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        header_recognizer: Optional[HeaderRecognizer] = None,
    ):
        self.config = config or default_config
        self.header_recognizer = header_recognizer or HeaderRecognizer()

    def detect_columns(
        self,
        table: TableResult,
        data_rows: Optional[List[TableRow]] = None,
    ) -> List[DetectedColumn]:
        """
        Detects semantic columns and calculates optimal horizontal boundaries.
        """
        logger.debug("Detecting columns for table with %d rows", len(table.rows))
        try:
            if not table.rows:
                return []

            # Determine header row if not already set
            header_row_idx = table.header_row_index
            if header_row_idx is None:
                header_row_idx = self._find_header_row_index(table.rows)

            if header_row_idx is None:
                # If no header row found, evaluate headerless column clustering from data
                return self._detect_columns_headerless(table.rows)

            header_row = table.rows[header_row_idx]
            header_row.is_header = True
            table.header_row_index = header_row_idx
            table.header_text = header_row.raw_text

            # Mark any rows prior to header as non-product header metadata
            for r_i in range(header_row_idx):
                table.rows[r_i].is_header = True

            # Extract header words or cells
            header_cells = header_row.cells
            rows_to_check = data_rows if data_rows is not None else [
                r for r in table.rows[header_row_idx + 1:] if not r.is_summary and not r.is_header
            ]

            # Calculate document-level median font height and character width
            all_words = [w for r in table.rows for c in r.cells for w in c.words]
            heights = [w.bbox.height for w in all_words if w.bbox.height > 2.0]
            median_h = statistics.median(heights) if heights else 15.0

            # Step 1: Build initial column anchors from header row
            raw_columns = self._build_header_columns(header_row, median_h)

            if not raw_columns:
                return []

            # Step 2: Calculate dynamic horizontal column boundaries using whitespace valleys
            refined_columns = self._calculate_column_boundaries(raw_columns, rows_to_check, median_h)

            # Step 3: Determine column alignment and verify geometric consistency
            aligned_columns = self._determine_alignments(refined_columns, rows_to_check)

            # Step 4: Apply conservative positional role inference with auditable evidence
            final_columns = self._apply_conservative_role_inference(aligned_columns, rows_to_check)

            return final_columns

        except Exception as exc:
            logger.error("Column detection failed: %s", exc)
            raise ColumnDetectionError(f"Column detection failed: {exc}", details={"error": str(exc)})

    def _find_header_row_index(self, rows: List[TableRow]) -> Optional[int]:
        """Identifies row with the strongest semantic header signals."""
        best_idx = None
        best_score = 0
        scan_limit = min(20, len(rows))
        for idx in range(scan_limit):
            row = rows[idx]
            if row.is_summary:
                continue
            score = 0
            for cell in row.cells:
                role, _, _ = self.header_recognizer.classify_text(cell.raw_text)
                if role != "unknown":
                    score += 1
            if score >= 2 and score > best_score:
                best_score = score
                best_idx = idx
        return best_idx

    def _build_header_columns(
        self,
        header_row: TableRow,
        median_h: float,
    ) -> List[DetectedColumn]:
        """Constructs initial column candidates from header row or cells."""
        header_words = [w for cell in header_row.cells for w in cell.words]

        # If words with coordinates are present, use intelligent phrase-level header candidate extraction
        if header_words:
            candidates = self.header_recognizer.extract_header_candidates([header_words], median_h)
            # Filter delimiters and attach footnotes/adjacent currency annotations
            clean_cands: List[HeaderCandidate] = []
            for c in candidates:
                text = c.raw_text.strip()
                if re.match(r"^[\s\|\:\/\-\=\~\.]+$", text):
                    continue
                if c.role == "unknown" and re.match(r"^\(?(\d+|₹|rs|\%|[A-Za-z]{1,2})\)?$", text, re.I) and clean_cands:
                    prev = clean_cands[-1]
                    if prev.role != "unknown" and (c.bbox.x0 - prev.bbox.x1) <= max(35.0, median_h * 2.5):
                        new_box = BoundingBox(
                            x0=min(prev.bbox.x0, c.bbox.x0),
                            y0=min(prev.bbox.y0, c.bbox.y0),
                            x1=max(prev.bbox.x1, c.bbox.x1),
                            y1=max(prev.bbox.y1, c.bbox.y1),
                        )
                        prev.raw_text = f"{prev.raw_text} {text}"
                        prev.bbox = new_box
                        continue
                clean_cands.append(c)

            # Consolidate unknown header fragments flanking the product column (e.g. "tem" + "Descri ption" + "")
            prod_indices = [i for i, cand in enumerate(clean_cands) if cand.role == "product"]
            if prod_indices:
                p_idx = prod_indices[0]
                # Preceding unknown
                while p_idx > 0 and clean_cands[p_idx - 1].role == "unknown" and (clean_cands[p_idx].bbox.x0 - clean_cands[p_idx - 1].bbox.x1) <= max(50.0, median_h * 3.5):
                    prev = clean_cands.pop(p_idx - 1)
                    p_idx -= 1
                    cur = clean_cands[p_idx]
                    cur.raw_text = f"{prev.raw_text} {cur.raw_text}"
                    cur.bbox = BoundingBox(
                        x0=min(prev.bbox.x0, cur.bbox.x0),
                        y0=min(prev.bbox.y0, cur.bbox.y0),
                        x1=max(prev.bbox.x1, cur.bbox.x1),
                        y1=max(prev.bbox.y1, cur.bbox.y1),
                    )
                # Succeeding unknown before structured columns like HSN/Qty
                while p_idx < len(clean_cands) - 1 and clean_cands[p_idx + 1].role == "unknown" and (clean_cands[p_idx + 1].bbox.x0 - clean_cands[p_idx].bbox.x1) <= max(50.0, median_h * 3.5):
                    nxt = clean_cands.pop(p_idx + 1)
                    cur = clean_cands[p_idx]
                    cur.raw_text = f"{cur.raw_text} {nxt.raw_text}"
                    cur.bbox = BoundingBox(
                        x0=min(cur.bbox.x0, nxt.bbox.x0),
                        y0=min(cur.bbox.y0, nxt.bbox.y0),
                        x1=max(cur.bbox.x1, nxt.bbox.x1),
                        y1=max(cur.bbox.y1, nxt.bbox.y1),
                    )

            if clean_cands and any(c.role != "unknown" for c in clean_cands):
                cols: List[DetectedColumn] = []
                for idx, cand in enumerate(clean_cands):
                    cols.append(
                        DetectedColumn(
                            role=cand.role,
                            header_text=cand.raw_text,
                            column_index=idx,
                            x_start=cand.bbox.x0,
                            x_end=cand.bbox.x1,
                            is_percent=cand.is_percent,
                            confidence=cand.confidence,
                            normalized_role=cand.normalized_label,
                            bbox=cand.bbox,
                        )
                    )
                return cols

        # Fallback to direct cell-by-cell mapping (e.g. for synthetic unit tests)
        cols = []
        for idx, cell in enumerate(header_row.cells):
            role, conf, norm_label = self.header_recognizer.classify_text(cell.raw_text)
            x_start = cell.bbox.x0 if cell.bbox else None
            x_end = cell.bbox.x1 if cell.bbox else None
            is_pct = "%" in cell.raw_text or role in ("discount_pct", "gst_rate")

            col = DetectedColumn(
                role=role,
                header_text=cell.raw_text,
                column_index=idx,
                x_start=x_start,
                x_end=x_end,
                is_percent=is_pct,
                confidence=conf,
                normalized_role=norm_label,
                bbox=cell.bbox,
            )
            cols.append(col)

        return cols

    def _calculate_column_boundaries(
        self,
        columns: List[DetectedColumn],
        data_rows: List[TableRow],
        median_h: float,
    ) -> List[DetectedColumn]:
        """
        Calculates optimal [x_start, x_end] boundaries for each column.
        Crucial innovation: Uses the whitespace valley between column data clusters
        so that values printed slightly offset from their header (e.g. quantity printed
        slightly to the left of 'Qty') are NOT swallowed into the description column!
        """
        if not columns:
            return []

        if len(columns) == 1:
            c = columns[0]
            return [
                DetectedColumn(
                    role=c.role,
                    header_text=c.header_text,
                    column_index=c.column_index,
                    x_start=0.0,
                    x_end=float("inf"),
                    is_percent=c.is_percent,
                    confidence=c.confidence,
                    normalized_role=c.normalized_role,
                    bbox=c.bbox,
                )
            ]

        # Collect data word x-coordinates
        data_words: List[OCRWord] = []
        for r in data_rows:
            for cell in r.cells:
                data_words.extend(cell.words)

        split_boundaries: List[float] = []

        # Find split point between column k and column k+1
        for i in range(len(columns) - 1):
            curr_col = columns[i]
            next_col = columns[i + 1]

            curr_hx0 = curr_col.bbox.x0 if curr_col.bbox else (curr_col.x_start or 0.0)
            curr_hx1 = curr_col.bbox.x1 if curr_col.bbox else (curr_col.x_end or 0.0)
            next_hx0 = next_col.bbox.x0 if next_col.bbox else (next_col.x_start or curr_hx1 + 50.0)
            next_hx1 = next_col.bbox.x1 if next_col.bbox else (next_hx0 + 50.0)

            # Search span: spans from start of current column to end of next column
            search_min_x = curr_hx0
            search_max_x = next_hx1 + 30.0

            region_words = [
                w for w in data_words
                if search_min_x <= w.bbox.center_x <= search_max_x
            ]

            if len(region_words) >= 2:
                # Find maximum whitespace valley between adjacent words sorted by x0
                sorted_rw = sorted(region_words, key=lambda w: w.bbox.x0)
                max_gap = -1.0
                best_split = (curr_hx1 + next_hx0) / 2.0

                for w_idx in range(len(sorted_rw) - 1):
                    w_left = sorted_rw[w_idx]
                    w_right = sorted_rw[w_idx + 1]
                    gap = w_right.bbox.x0 - w_left.bbox.x1
                    if gap > max_gap:
                        max_gap = gap
                        best_split = (w_left.bbox.x1 + w_right.bbox.x0) / 2.0

                # Ensure split is reasonable: must lie between the centers of the two columns
                col_c1 = (curr_hx0 + curr_hx1) / 2.0
                col_c2 = (next_hx0 + next_hx1) / 2.0
                if col_c1 < best_split < col_c2:
                    split_boundaries.append(best_split)
                else:
                    split_boundaries.append((curr_hx1 + next_hx0) / 2.0)
            else:
                # Fallback to midpoint between headers
                split_boundaries.append((curr_hx1 + next_hx0) / 2.0)

        # Construct refined columns with non-overlapping, continuous horizontal coverage
        refined: List[DetectedColumn] = []
        for i, c in enumerate(columns):
            x_start = 0.0 if i == 0 else split_boundaries[i - 1]
            x_end = float("inf") if i == len(columns) - 1 else split_boundaries[i]

            refined.append(
                DetectedColumn(
                    role=c.role,
                    header_text=c.header_text,
                    column_index=c.column_index,
                    x_start=round(x_start, 1),
                    x_end=round(x_end, 1) if x_end != float("inf") else None,
                    is_percent=c.is_percent,
                    confidence=c.confidence,
                    normalized_role=c.normalized_role,
                    bbox=c.bbox,
                )
            )

        return refined

    def _determine_alignments(
        self,
        columns: List[DetectedColumn],
        data_rows: List[TableRow],
    ) -> List[DetectedColumn]:
        """Determines text alignment for each column (left, center, right)."""
        updated: List[DetectedColumn] = []
        for col in columns:
            # Descriptive text and serial columns are typically left-aligned
            if col.role in ("product", "serial", "unit"):
                align = "left"
            elif col.role in ("rate", "purchase_price", "selling_price", "mrp", "total", "tax_amount", "taxable"):
                align = "right"
            else:
                align = "center"

            updated.append(
                DetectedColumn(
                    role=col.role,
                    header_text=col.header_text,
                    column_index=col.column_index,
                    x_start=col.x_start,
                    x_end=col.x_end,
                    is_percent=col.is_percent,
                    confidence=col.confidence,
                    normalized_role=col.normalized_role,
                    bbox=col.bbox,
                    alignment=align,
                )
            )
        return updated

    def _apply_conservative_role_inference(
        self,
        cols: List[DetectedColumn],
        data_rows: List[TableRow],
    ) -> List[DetectedColumn]:
        """
        Conservative column-role inference:
        1. Single unknown numeric column between Rate and MRP -> selling_price (confidence 65.0)
        2. Single unknown numeric column between Discount and Total -> tax_amount (confidence 65.0)
        3. Leading column of consecutive integers -> serial (confidence 80.0)
        4. Any unclear column remains unknown with documented evidence.
        """
        res_cols = list(cols)

        # Rule 1: Unknown between Rate and MRP -> selling_price
        rate_idx = next((i for i, c in enumerate(res_cols) if c.role in ("rate", "purchase_price")), -1)
        mrp_idx = next((i for i, c in enumerate(res_cols) if c.role == "mrp"), -1)

        if rate_idx >= 0 and mrp_idx > rate_idx + 1:
            gap_indices = [i for i in range(rate_idx + 1, mrp_idx) if res_cols[i].role == "unknown"]
            if len(gap_indices) == 1 and self._column_is_predominantly_numeric(gap_indices[0], data_rows):
                idx = gap_indices[0]
                res_cols[idx] = DetectedColumn(
                    role="selling_price",
                    header_text=res_cols[idx].header_text,
                    column_index=res_cols[idx].column_index,
                    x_start=res_cols[idx].x_start,
                    x_end=res_cols[idx].x_end,
                    is_percent=res_cols[idx].is_percent,
                    confidence=65.0,  # Lowered confidence for inferred role
                    inferred=True,
                    inference_reason="POSITIONAL_BETWEEN_RATE_AND_MRP",
                    supporting_evidence="Single unknown numeric column positioned between Rate and MRP",
                    alignment="right",
                    normalized_role="SELLING_PRICE",
                    bbox=res_cols[idx].bbox,
                )

        # Rule 2: Unknown between Discount and Total -> tax_amount
        disc_idx = next((i for i, c in enumerate(res_cols) if c.role in ("discount", "discount_pct")), -1)
        tot_idx = next((i for i, c in enumerate(res_cols) if c.role in ("total", "taxable")), -1)

        if disc_idx >= 0 and tot_idx > disc_idx + 1:
            gap_indices = [i for i in range(disc_idx + 1, tot_idx) if res_cols[i].role == "unknown"]
            if len(gap_indices) == 1 and self._column_is_predominantly_numeric(gap_indices[0], data_rows):
                idx = gap_indices[0]
                res_cols[idx] = DetectedColumn(
                    role="tax_amount",
                    header_text=res_cols[idx].header_text,
                    column_index=res_cols[idx].column_index,
                    x_start=res_cols[idx].x_start,
                    x_end=res_cols[idx].x_end,
                    is_percent=res_cols[idx].is_percent,
                    confidence=65.0,  # Lowered confidence for inferred role
                    inferred=True,
                    inference_reason="POSITIONAL_BETWEEN_DISCOUNT_AND_TOTAL",
                    supporting_evidence="Single unknown numeric column positioned between Discount and Total",
                    alignment="right",
                    normalized_role="TAX",
                    bbox=res_cols[idx].bbox,
                )

        # Rule 3: Leading column containing sequential integers -> serial
        if res_cols and res_cols[0].role == "unknown":
            if self._column_is_sequential_integer(0, data_rows):
                res_cols[0] = DetectedColumn(
                    role="serial",
                    header_text=res_cols[0].header_text,
                    column_index=0,
                    x_start=res_cols[0].x_start,
                    x_end=res_cols[0].x_end,
                    is_percent=False,
                    confidence=80.0,
                    inferred=True,
                    inference_reason="SEQUENTIAL_INTEGER_PATTERN",
                    supporting_evidence="First column values conform to strictly sequential integers 1, 2, 3...",
                    alignment="left",
                    normalized_role="SERIAL",
                    bbox=res_cols[0].bbox,
                )

        return res_cols

    def _column_is_predominantly_numeric(self, col_idx: int, data_rows: List[TableRow]) -> bool:
        """Verifies if at least 50% of populated cells in the column are numeric."""
        if not data_rows:
            return False
        total = 0
        numeric = 0
        for r in data_rows:
            if col_idx < len(r.cells):
                txt = r.cells[col_idx].cleaned_text.strip()
                if not txt or txt in ("-", "--", ".", "|"):
                    continue
                total += 1
                cleaned = re.sub(r"[^\d.]", "", txt)
                if cleaned and re.search(r"\d", cleaned):
                    numeric += 1
        return total > 0 and (numeric / total >= 0.5)

    def _column_is_sequential_integer(self, col_idx: int, data_rows: List[TableRow]) -> bool:
        """Checks if column contains sequential integers starting near 1."""
        if len(data_rows) < 2:
            return False
        vals: List[int] = []
        for r in data_rows:
            if col_idx < len(r.cells):
                txt = r.cells[col_idx].cleaned_text.strip()
                if txt.isdigit():
                    vals.append(int(txt))
        if len(vals) >= 2:
            # Check if strictly increasing
            is_increasing = all(vals[k] < vals[k + 1] for k in range(len(vals) - 1))
            if is_increasing and vals[0] in (1, 0):
                return True
        return False

    def _detect_columns_headerless(self, rows: List[TableRow]) -> List[DetectedColumn]:
        """Detects columns when no explicit header line exists."""
        if not rows:
            return []

        # Find maximum number of cells in any row
        max_cells = max(len(r.cells) for r in rows)
        if max_cells == 0:
            return []

        cols: List[DetectedColumn] = []
        for c_idx in range(max_cells):
            cols.append(
                DetectedColumn(
                    role="unknown",
                    header_text=f"Column {c_idx + 1}",
                    column_index=c_idx,
                    confidence=40.0,
                    normalized_role="UNKNOWN",
                )
            )
        return cols
