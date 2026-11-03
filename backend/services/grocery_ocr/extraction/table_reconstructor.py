"""
Advanced Table Reconstruction Engine for ShopPulse Grocery OCR (Phase 4).
Implements layout-aware vertical row clustering, table boundary detection,
multi-line description continuation handling, numeric column association,
and multi-page invoice table continuation.
"""

from abc import ABC, abstractmethod
import statistics
from typing import Any, Dict, List, Optional, Tuple
import uuid

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import TableReconstructionError
from services.grocery_ocr.extraction.column_detector import BaseColumnDetector, IColumnDetector
from services.grocery_ocr.extraction.header_recognizer import HeaderRecognizer
from services.grocery_ocr.extraction.table_detector import TableDetector, TableRegion
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRDocumentResult, OCRPageResult, OCRWord
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableReconstructionResult,
    TableRow,
    TableResult,
)

logger = get_logger("extraction.table_reconstructor")


class ITableReconstructor(ABC):
    """Abstract interface for reconstructing 2D table structures from OCR tokens."""

    @abstractmethod
    def reconstruct_table(self, page_result: OCRPageResult) -> TableResult:
        """
        Reconstructs table grid from OCR words and bounding boxes for a single page.
        """
        pass

    @abstractmethod
    def reconstruct_document_tables(
        self,
        document: OCRDocumentResult,
    ) -> List[TableReconstructionResult]:
        """
        Reconstructs tables across all pages of a multi-page invoice document,
        handling repeated headers, continuous product numbering, and page transitions.
        """
        pass


class BaseTableReconstructor(ITableReconstructor):
    """
    Advanced table reconstruction engine.
    Converts unstructured OCR tokens and coordinates into robust, structured
    table rows, columns, and grid cells with strict numeric association safety.
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        table_detector: Optional[TableDetector] = None,
        column_detector: Optional[IColumnDetector] = None,
        header_recognizer: Optional[HeaderRecognizer] = None,
    ):
        self.config = config or default_config
        self.header_recognizer = header_recognizer or HeaderRecognizer()
        self.table_detector = table_detector or TableDetector(self.header_recognizer)
        self.column_detector = column_detector or BaseColumnDetector(self.config, self.header_recognizer)

    def reconstruct_table(
        self,
        page_result: OCRPageResult,
        primary_header_signature: Optional[List[str]] = None,
        document_id: Optional[str] = None,
    ) -> TableReconstructionResult:
        """
        Reconstructs table for a single invoice page.
        """
        logger.debug(
            "Reconstructing table for page %d (%d words)",
            page_result.page_number,
            len(page_result.words),
        )
        doc_id = document_id or f"doc_{uuid.uuid4().hex[:12]}"
        try:
            if not page_result.words:
                logger.info("Page %d contains no OCR words; returning empty TableResult", page_result.page_number)
                return TableReconstructionResult(
                    document_id=doc_id,
                    page_number=page_result.page_number,
                    has_table=False,
                    review_status="NO_TABLE_DETECTED",
                    confidence=0.0,
                    warnings=["Page contains no OCR words."],
                )

            page_width = float(page_result.width)
            page_height = float(page_result.height)

            # Calculate document median text height for dynamic tolerances
            valid_heights = [w.bbox.height for w in page_result.words if w.bbox.height > 2.0]
            median_h = statistics.median(valid_heights) if valid_heights else 15.0

            # Step 1: Dynamic adaptive vertical clustering into physical lines
            physical_rows_words = self._group_words_into_rows(page_result.words, median_h)

            # Step 2: Table Region Detection (Header, Data, Footer, Summary boundaries)
            table_region = self.table_detector.detect_table_region(
                physical_rows_words,
                page_width=page_width,
                page_height=page_height,
                page_number=page_result.page_number,
                primary_header_signature=primary_header_signature,
            )

            if not table_region.has_table:
                logger.info("Page %d has no product table detected (e.g. payment receipt or plain text)", page_result.page_number)
                return TableReconstructionResult(
                    document_id=doc_id,
                    page_number=page_result.page_number,
                    has_table=False,
                    review_status="NO_TABLE_DETECTED",
                    confidence=20.0,
                    warnings=["No product table detected on this document page."],
                    raw_words=page_result.words,
                )

            # Step 3: Column Detection on Header Line(s)
            header_row_idx = table_region.header_row_indices[-1] if table_region.header_row_indices else None

            # Build initial TableRow representations for header detection
            interim_rows: List[TableRow] = []
            for r_idx, r_words in enumerate(physical_rows_words):
                is_hdr = r_idx in table_region.header_row_indices
                is_sum = table_region.summary_start_y is not None and any(
                    w.bbox.y0 >= (table_region.summary_start_y - 2.0) for w in r_words
                )
                interim_rows.append(
                    TableRow(
                        row_index=r_idx,
                        cells=self._group_row_words_into_basic_cells(r_idx, r_words),
                        raw_text=" ".join(w.text for w in r_words).strip(),
                        is_header=is_hdr,
                        is_summary=is_sum,
                    )
                )

            interim_table = TableResult(
                rows=interim_rows,
                header_row_index=header_row_idx,
                header_text=interim_rows[header_row_idx].raw_text if header_row_idx is not None else None,
                page_number=page_result.page_number,
            )

            # Detect semantic columns using advanced column detector
            columns = self.column_detector.detect_columns(interim_table)

            # Step 4: Map each physical row's tokens into column cells with strict numeric association
            table_rows: List[TableRow] = []
            page_warnings: List[str] = []

            for r_idx, r_words in enumerate(physical_rows_words):
                row_text = " ".join(w.text for w in r_words).strip()
                is_hdr = r_idx in table_region.header_row_indices
                is_sum = table_region.summary_start_y is not None and any(
                    w.bbox.y0 >= (table_region.summary_start_y - 2.0) for w in r_words
                )
                # Compute enclosing bounding box for row
                r_x0 = min(w.bbox.x0 for w in r_words)
                r_y0 = min(w.bbox.y0 for w in r_words)
                r_x1 = max(w.bbox.x1 for w in r_words)
                r_y1 = max(w.bbox.y1 for w in r_words)
                row_box = BoundingBox(x0=r_x0, y0=r_y0, x1=r_x1, y1=r_y1)

                cells, row_warns, needs_review = self._associate_row_words_to_columns(
                    r_idx, r_words, columns
                )
                if row_warns:
                    page_warnings.extend(row_warns)

                table_rows.append(
                    TableRow(
                        row_index=r_idx,
                        cells=cells,
                        raw_text=row_text,
                        is_header=is_hdr,
                        is_summary=is_sum,
                        bbox=row_box,
                        confidence=page_result.confidence,
                        warnings=row_warns,
                        review_required=needs_review,
                    )
                )

            # Step 5: Multi-line description continuation detection
            # Detect wrapped product descriptions (e.g. FORTUNE \n BESAN \n 500 GM)
            reconstructed_product_rows = self._reconstruct_multiline_product_rows(
                table_rows,
                columns=columns,
                median_h=median_h,
                header_row_idx=header_row_idx,
            )

            # Step 6: Assemble structured TableReconstructionResult
            ocr_conf = (
                sum(w.confidence for w in page_result.words) / len(page_result.words)
                if page_result.words else 0.0
            )
            col_conf = (
                sum(c.confidence for c in columns) / len(columns)
                if columns else 50.0
            )
            row_conf = 95.0 if not any(r.review_required for r in reconstructed_product_rows) else 70.0
            overall_conf = round(row_conf * 0.4 + col_conf * 0.4 + ocr_conf * 0.2, 1)

            # Determine review status
            review_status = "CONFIRMED"
            if any(r.review_required for r in reconstructed_product_rows):
                review_status = "REVIEW_REQUIRED"
            elif any(c.inferred for c in columns):
                review_status = "REVIEW_REQUIRED"
            elif ocr_conf < 60.0:
                review_status = "REVIEW_REQUIRED"

            # Build 2D matrix of cell values and bounding boxes
            cell_vals = [[c.cleaned_text for c in r.cells] for r in table_rows]
            cell_coords = [[c.bbox for c in r.cells] for r in table_rows]

            # Original and normalized headers
            orig_headers = [c.header_text for c in columns]
            norm_headers = [c.normalized_role or c.role.upper() for c in columns]
            col_coords = [c.bbox or BoundingBox(x0=c.x_start or 0.0, y0=0.0, x1=c.x_end or page_width, y1=page_height) for c in columns]
            col_role_map = {str(c.column_index): c.role for c in columns}
            for c in columns:
                col_role_map[c.header_text] = c.role

            table_result = TableReconstructionResult(
                document_id=doc_id,
                page_number=page_result.page_number,
                table_boundaries=table_region.table_bbox,
                data_boundaries=table_region.data_bbox,
                header_boundaries=table_region.header_bbox,
                footer_boundaries=table_region.footer_bbox,
                original_headers=orig_headers,
                normalized_headers=norm_headers,
                column_coordinates=col_coords,
                column_role_mappings=col_role_map,
                columns=columns,
                column_positions=columns,
                detected_headers=[c for c in columns if c.role != "unknown"],
                rows=table_rows,
                reconstructed_rows=reconstructed_product_rows,
                header_row_index=header_row_idx,
                header_text=interim_rows[header_row_idx].raw_text if header_row_idx is not None else None,
                cell_values=cell_vals,
                cell_coordinates=cell_coords,
                ocr_confidence=round(ocr_conf, 1),
                row_confidence=round(row_conf, 1),
                column_mapping_confidence=round(col_conf, 1),
                confidence=overall_conf,
                warnings=page_warnings,
                review_status=review_status,
                has_table=True,
                raw_words=page_result.words,
                metadata={
                    "total_physical_rows": len(table_rows),
                    "total_product_rows": len(reconstructed_product_rows),
                    "is_repeated_header": table_region.is_repeated_header,
                },
            )

            return table_result

        except Exception as exc:
            logger.error("Table reconstruction failed: %s", exc)
            raise TableReconstructionError(
                f"Table reconstruction failed: {exc}", details={"error": str(exc)}
            )

    def reconstruct_document_tables(
        self,
        document: OCRDocumentResult,
    ) -> List[TableReconstructionResult]:
        """
        Reconstructs tables across all pages of a multi-page document.
        Detects repeated headers on subsequent pages and maintains global row continuity.
        """
        results: List[TableReconstructionResult] = []
        primary_headers: Optional[List[str]] = None

        global_row_counter = 0

        for page in document.pages:
            table_res = self.reconstruct_table(
                page,
                primary_header_signature=primary_headers,
                document_id=document.document_id,
            )

            if primary_headers is None and table_res.has_table and table_res.columns:
                primary_headers = [c.role for c in table_res.columns if c.role != "unknown"]

            # Re-index reconstructed rows continuously across pages
            for r in table_res.reconstructed_rows:
                r.metadata["global_product_index"] = global_row_counter
                global_row_counter += 1

            results.append(table_res)

        return results

    def _group_words_into_rows(
        self,
        words: List[OCRWord],
        median_h: float,
    ) -> List[List[OCRWord]]:
        """
        Groups words into horizontal physical rows using dynamic adaptive vertical clustering.
        Words on the same line share baseline overlap within dynamic tolerance.
        """
        if not words:
            return []

        # Sort words primarily top-to-bottom, secondarily left-to-right
        sorted_words = sorted(words, key=lambda w: (w.bbox.y0, w.bbox.x0))

        clusters: List[List[OCRWord]] = []
        adaptive_tol = max(3.0, median_h * 0.45)

        for w in sorted_words:
            placed = False
            for cluster in clusters:
                # Compare against vertical range of the cluster
                c_y0 = min(cw.bbox.y0 for cw in cluster)
                c_y1 = max(cw.bbox.y1 for cw in cluster)
                c_h = c_y1 - c_y0

                vert_overlap = min(w.bbox.y1, c_y1) - max(w.bbox.y0, c_y0)
                min_h = min(w.bbox.height, c_h) if c_h > 0 else w.bbox.height

                # Overlap test: >= 40% vertical overlap OR baseline difference within adaptive tolerance
                if min_h > 0 and (vert_overlap / min_h) >= 0.4:
                    cluster.append(w)
                    placed = True
                    break
                elif abs(w.bbox.y1 - c_y1) <= adaptive_tol and abs(w.bbox.y0 - c_y0) <= adaptive_tol:
                    cluster.append(w)
                    placed = True
                    break

            if not placed:
                clusters.append([w])

        # Sort words in each cluster strictly left-to-right
        for cluster in clusters:
            cluster.sort(key=lambda w: w.bbox.x0)

        # Sort clusters top-to-bottom
        clusters.sort(key=lambda cluster: min(w.bbox.y0 for w in cluster))
        return clusters

    def _associate_row_words_to_columns(
        self,
        row_idx: int,
        row_words: List[OCRWord],
        columns: List[DetectedColumn],
    ) -> Tuple[List[TableCell], List[str], bool]:
        """
        Associates OCR words in a horizontal row to detected columns.
        Enforces strict numeric association rules:
        - Never silently move numbers across columns
        - Verifies numeric conformity
        - Marks uncertain cells as REVIEW_REQUIRED
        """
        if not columns:
            basic_cells = self._group_row_words_into_basic_cells(row_idx, row_words)
            return basic_cells, [], False

        # Prepare bucket for each column
        col_word_buckets: List[List[OCRWord]] = [[] for _ in columns]
        warnings: List[str] = []
        needs_review = False

        for w in row_words:
            cx = w.bbox.center_x
            matched_col_idx = -1

            # Find matching column by spatial boundaries
            for c_idx, col in enumerate(columns):
                x_start = col.x_start if col.x_start is not None else 0.0
                x_end = col.x_end if col.x_end is not None else float("inf")

                if x_start <= cx < x_end:
                    matched_col_idx = c_idx
                    break

            if matched_col_idx >= 0:
                col_word_buckets[matched_col_idx].append(w)
            else:
                # Fallback to closest column boundary
                distances = [
                    abs(cx - ((c.x_start or 0.0) + (c.x_end or (c.x_start or 0.0) + 100.0)) / 2.0)
                    for c in columns
                ]
                closest_idx = int(distances.index(min(distances)))
                col_word_buckets[closest_idx].append(w)
                warnings.append(
                    f"Word '{w.text}' at x={cx:.1f} was outside all column ranges; bound to column {closest_idx}."
                )
                needs_review = True

        # Build TableCell for each column
        cells: List[TableCell] = []
        for c_idx, col in enumerate(columns):
            words = col_word_buckets[c_idx]
            if not words:
                # Empty cell
                cells.append(
                    TableCell(
                        row_index=row_idx,
                        col_index=c_idx,
                        raw_text="",
                        cleaned_text="",
                        words=[],
                        bbox=None,
                        is_numeric=False,
                        confidence=100.0,
                    )
                )
                continue

            words.sort(key=lambda cw: cw.bbox.x0)
            raw_text = " ".join(cw.text for cw in words).strip()
            cleaned_text = raw_text

            x0 = min(cw.bbox.x0 for cw in words)
            y0 = min(cw.bbox.y0 for cw in words)
            x1 = max(cw.bbox.x1 for cw in words)
            y1 = max(cw.bbox.y1 for cw in words)
            cell_box = BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1)

            avg_conf = sum(cw.confidence for cw in words) / len(words)
            has_digit = any(ch.isdigit() for ch in raw_text)
            has_alpha = any(ch.isalpha() for ch in raw_text)
            is_numeric = has_digit and not has_alpha

            cell_review = False
            cell_reason = None

            # Check numeric association sanity for numeric columns
            if col.role in ("qty", "rate", "purchase_price", "selling_price", "mrp", "total", "tax_amount"):
                if has_alpha:
                    # An alpha string inside a strictly numeric column requires review
                    cell_review = True
                    cell_reason = f"Alphanumeric token '{raw_text}' found in numeric column '{col.role}'."
                    needs_review = True

            cells.append(
                TableCell(
                    row_index=row_idx,
                    col_index=c_idx,
                    raw_text=raw_text,
                    cleaned_text=cleaned_text,
                    words=words,
                    bbox=cell_box,
                    is_numeric=is_numeric,
                    confidence=round(avg_conf, 1),
                    review_required=cell_review,
                    review_reason=cell_reason,
                    inferred_role=col.role if col.inferred else None,
                )
            )

        return cells, warnings, needs_review

    def _reconstruct_multiline_product_rows(
        self,
        table_rows: List[TableRow],
        columns: List[DetectedColumn],
        median_h: float,
        header_row_idx: Optional[int],
    ) -> List[TableRow]:
        """
        Consolidates wrapped multi-line descriptions into complete product line items.
        Example:
            Line 1: 1 | FORTUNE BESAN | 10 | 45.00 | 450.00
            Line 2:   | 500 GM        |    |       |
        Consolidates description into "FORTUNE BESAN 500 GM" while preserving original lines.
        Crucial: Never merges separate products that have their own quantities, rates, or serial numbers!
        """
        if not table_rows:
            return []

        # Find key column indices
        desc_col_idx = next((i for i, c in enumerate(columns) if c.role == "product"), 1 if len(columns) > 1 else 0)
        serial_col_idx = next((i for i, c in enumerate(columns) if c.role == "serial"), -1)
        numeric_col_indices = [
            i for i, c in enumerate(columns)
            if c.role in ("qty", "rate", "purchase_price", "selling_price", "mrp", "total")
        ]

        # Only evaluate data rows (after header, not summary)
        data_rows = [
            r for r_i, r in enumerate(table_rows)
            if not r.is_header
            and (header_row_idx is None or r_i > header_row_idx)
            and not r.is_summary
            and any(c.cleaned_text for c in r.cells)
        ]

        if not data_rows:
            return []

        consolidated_rows: List[TableRow] = []
        curr_parent: Optional[TableRow] = None

        for row in data_rows:
            # Check if this row has numeric values in primary numeric columns
            has_numeric_data = any(
                row.cells[ci].cleaned_text.strip() != ""
                for ci in numeric_col_indices
                if ci < len(row.cells)
            )

            # Check if this row has a serial number
            has_serial = False
            if serial_col_idx >= 0 and serial_col_idx < len(row.cells):
                txt = row.cells[serial_col_idx].cleaned_text.strip()
                has_serial = txt.isdigit()

            # Description cell content
            desc_text = (
                row.cells[desc_col_idx].cleaned_text.strip()
                if desc_col_idx < len(row.cells)
                else ""
            )

            # Evaluate if row qualifies as a continuation of curr_parent
            is_continuation = False
            if curr_parent is not None and not has_numeric_data and not has_serial and desc_text:
                # Check vertical proximity: continuation line must be within 1.8 * median_h
                prev_y1 = curr_parent.bbox.y1 if curr_parent.bbox else 0.0
                curr_y0 = row.bbox.y0 if row.bbox else 0.0
                v_gap = curr_y0 - prev_y1

                if v_gap <= max(18.0, median_h * 1.8):
                    is_continuation = True

            if is_continuation and curr_parent is not None:
                # Mark continuation line
                row.is_continuation = True
                row.parent_row_index = curr_parent.row_index

                # Append to parent's original lines
                curr_parent.original_lines.append(row.raw_text)

                # Update reconstructed description
                prev_desc = curr_parent.reconstructed_description or (
                    curr_parent.cells[desc_col_idx].cleaned_text
                    if desc_col_idx < len(curr_parent.cells)
                    else ""
                )
                new_desc = f"{prev_desc} {desc_text}".strip()
                curr_parent.reconstructed_description = new_desc

                # Update parent description cell text and words
                if desc_col_idx < len(curr_parent.cells):
                    parent_cell = curr_parent.cells[desc_col_idx]
                    combined_words = list(parent_cell.words) + list(row.cells[desc_col_idx].words)
                    curr_parent.cells[desc_col_idx] = TableCell(
                        row_index=curr_parent.row_index,
                        col_index=desc_col_idx,
                        raw_text=new_desc,
                        cleaned_text=new_desc,
                        words=combined_words,
                        bbox=parent_cell.bbox,
                        is_numeric=False,
                        confidence=parent_cell.confidence,
                    )

                # Expand parent row bounding box to enclose continuation line
                if curr_parent.bbox and row.bbox:
                    curr_parent.bbox = BoundingBox(
                        x0=min(curr_parent.bbox.x0, row.bbox.x0),
                        y0=min(curr_parent.bbox.y0, row.bbox.y0),
                        x1=max(curr_parent.bbox.x1, row.bbox.x1),
                        y1=max(curr_parent.bbox.y1, row.bbox.y1),
                    )
            else:
                # This row starts a new independent product item
                row.original_lines = [row.raw_text]
                row.reconstructed_description = desc_text
                curr_parent = row
                consolidated_rows.append(row)

        return consolidated_rows

    def _group_row_words_into_basic_cells(
        self,
        row_idx: int,
        r_words: List[OCRWord],
    ) -> List[TableCell]:
        """Simple baseline cell clustering for pre-column initialization."""
        if not r_words:
            return []

        cells: List[TableCell] = []
        current_words: List[OCRWord] = [r_words[0]]

        for w in r_words[1:]:
            prev_w = current_words[-1]
            gap = w.bbox.x0 - prev_w.bbox.x1
            avg_h = (prev_w.bbox.height + w.bbox.height) / 2.0
            max_gap = max(25.0, avg_h * 0.9)

            if gap <= max_gap:
                current_words.append(w)
            else:
                cells.append(self._build_cell(row_idx, len(cells), current_words))
                current_words = [w]

        if current_words:
            cells.append(self._build_cell(row_idx, len(cells), current_words))

        return cells

    def _build_cell(self, row_idx: int, col_idx: int, words: List[OCRWord]) -> TableCell:
        raw_text = " ".join(w.text for w in words).strip()
        cleaned_text = raw_text
        x0 = min(w.bbox.x0 for w in words)
        y0 = min(w.bbox.y0 for w in words)
        x1 = max(w.bbox.x1 for w in words)
        y1 = max(w.bbox.y1 for w in words)
        avg_conf = sum(w.confidence for w in words) / len(words)
        is_numeric = any(ch.isdigit() for ch in raw_text) and not any(ch.isalpha() for ch in raw_text)

        return TableCell(
            row_index=row_idx,
            col_index=col_idx,
            raw_text=raw_text,
            cleaned_text=cleaned_text,
            words=words,
            bbox=BoundingBox(x0=x0, y0=y0, x1=x1, y1=y1),
            is_numeric=is_numeric,
            confidence=avg_conf,
        )
