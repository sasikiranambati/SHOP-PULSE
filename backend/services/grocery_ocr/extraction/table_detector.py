"""
Table detection and boundary localization for grocery invoice OCR.
Identifies header location, table start/end coordinates, data regions,
and distinguishes tabular items from pre-table letterhead and post-table summaries.
"""

import re
import statistics
from typing import Dict, List, Optional, Set, Tuple
from services.grocery_ocr.extraction.header_recognizer import HeaderCandidate, HeaderRecognizer
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRLine, OCRWord
from services.grocery_ocr.schemas.table import TableRow

logger = get_logger("extraction.table_detector")

# Summary and footer keyword triggers that demarcate table end
SUMMARY_PATTERNS = [
    re.compile(r"^(grand\s+total|total|sub\s*total|net\s+amount|net\s+payable|tot\s+amt|total\s+amt|round\s+off)", re.I),
    re.compile(r"(grand\s+total|sub\s*total|net\s+payable|balance\s+due|amount\s+due)", re.I),
    re.compile(r"amount\s+(in\s+words|chargeable)", re.I),
    re.compile(r"(rupees\s+(only|one|two|three|four|five|six|seven|eight|nine|ten)|inr\s+\d)", re.I),
    re.compile(r"(tax\s+summary|hsn\s+summary|gst\s+summary)", re.I),
    re.compile(r"(goods\s+once\s+sold|terms\s*(&|and)\s*conditions|e\.\s*&\s*o\.e\.|e\s*&\s*oe)", re.I),
    re.compile(r"(authorised\s+signatory|authorized\s+signatory|signature|for\s+[a-z\s]+traders)", re.I),
    re.compile(r"(bank\s+details|a/c\s+no|ifsc\s+code|account\s+no|branch\s+name|upi)", re.I),
    re.compile(r"(received\s+with\s+thanks|payment\s+mode)", re.I),
]

# Metadata keywords that typically appear in document header before table
METADATA_HEADER_PATTERNS = [
    re.compile(r"^(tax\s+invoice|retail\s+invoice|cash\s+bill|cash\s+memo|credit\s+bill|invoice|bill)$", re.I),
    re.compile(r"(invoice\s+no|bill\s+no|inv\s+no|voucher\s+no)", re.I),
    re.compile(r"(gstin|pan\s+no|dl\s+no|fssai)", re.I),
    re.compile(r"(date\s*:|invoice\s+date|bill\s+date)", re.I),
    re.compile(r"(bill\s+to|ship\s+to|party\s+name|buyer|consignee)", re.I),
    re.compile(r"(ph\s*:|phone\s*:|mobile\s*:|tel\s*:|email\s*:)", re.I),
]


class TableRegion:
    """Represents detected geometric boundaries of the invoice table."""

    def __init__(
        self,
        has_table: bool,
        table_start_y: float,
        table_end_y: float,
        table_start_x: float,
        table_end_x: float,
        header_row_indices: List[int],
        header_bbox: Optional[BoundingBox],
        data_bbox: Optional[BoundingBox],
        footer_bbox: Optional[BoundingBox],
        summary_start_y: Optional[float],
        confidence: float,
        is_repeated_header: bool = False,
        header_candidates: Optional[List[HeaderCandidate]] = None,
    ):
        self.has_table = has_table
        self.table_start_y = table_start_y
        self.table_end_y = table_end_y
        self.table_start_x = table_start_x
        self.table_end_x = table_end_x
        self.header_row_indices = header_row_indices
        self.header_bbox = header_bbox
        self.data_bbox = data_bbox
        self.footer_bbox = footer_bbox
        self.summary_start_y = summary_start_y
        self.confidence = confidence
        self.is_repeated_header = is_repeated_header
        self.header_candidates = header_candidates or []

    @property
    def table_bbox(self) -> Optional[BoundingBox]:
        if not self.has_table:
            return None
        return BoundingBox(
            x0=self.table_start_x,
            y0=self.table_start_y,
            x1=self.table_end_x,
            y1=self.table_end_y,
        )


class TableDetector:
    """
    Detects table regions and boundaries using OCR word coordinates,
    document geometry, text density, and semantic anchors.
    """

    def __init__(self, header_recognizer: Optional[HeaderRecognizer] = None):
        self.header_recognizer = header_recognizer or HeaderRecognizer()

    def detect_table_region(
        self,
        raw_rows: List[List[OCRWord]],
        page_width: float,
        page_height: float,
        page_number: int = 1,
        primary_header_signature: Optional[List[str]] = None,
    ) -> TableRegion:
        """
        Scans page row clusters to identify table headers, data boundaries, and summary footers.
        """
        if not raw_rows:
            return TableRegion(
                has_table=False,
                table_start_y=0.0,
                table_end_y=0.0,
                table_start_x=0.0,
                table_end_x=0.0,
                header_row_indices=[],
                header_bbox=None,
                data_bbox=None,
                footer_bbox=None,
                summary_start_y=None,
                confidence=0.0,
            )

        # Calculate median font height across rows
        heights = [w.bbox.height for row in raw_rows for w in row if w.bbox.height > 2.0]
        median_h = statistics.median(heights) if heights else 15.0

        # Step 1: Detect Header Row candidates
        header_indices, header_candidates, is_repeated = self._find_header_rows(
            raw_rows, median_h, page_width, primary_header_signature
        )

        if not header_indices:
            # Check if this could be a borderless table without explicit headers, or not a table at all (e.g. TC10 receipt)
            has_grid, grid_start_idx = self._evaluate_headerless_table_grid(raw_rows, median_h, page_width)
            if not has_grid:
                logger.info("No header or grid pattern found on page %d; not a table.", page_number)
                return TableRegion(
                    has_table=False,
                    table_start_y=0.0,
                    table_end_y=0.0,
                    table_start_x=0.0,
                    table_end_x=0.0,
                    header_row_indices=[],
                    header_bbox=None,
                    data_bbox=None,
                    footer_bbox=None,
                    summary_start_y=None,
                    confidence=10.0,
                )
            header_indices = []
            table_start_y = min(w.bbox.y0 for w in raw_rows[grid_start_idx])
            header_bbox = None
            first_data_idx = grid_start_idx
        else:
            table_start_y = min(w.bbox.y0 for idx in header_indices for w in raw_rows[idx])
            h_y0 = min(w.bbox.y0 for idx in header_indices for w in raw_rows[idx])
            h_y1 = max(w.bbox.y1 for idx in header_indices for w in raw_rows[idx])
            h_x0 = min(w.bbox.x0 for idx in header_indices for w in raw_rows[idx])
            h_x1 = max(w.bbox.x1 for idx in header_indices for w in raw_rows[idx])
            header_bbox = BoundingBox(x0=h_x0, y0=h_y0, x1=h_x1, y1=h_y1)
            first_data_idx = max(header_indices) + 1

        # Step 2: Detect Footer & Summary Region
        summary_start_y = None
        footer_row_indices: List[int] = []
        data_row_indices: List[int] = []

        for idx in range(first_data_idx, len(raw_rows)):
            row_words = raw_rows[idx]
            row_text = " ".join(w.text for w in row_words).strip()

            if self._is_summary_line(row_text, row_words, page_width):
                if summary_start_y is None:
                    summary_start_y = min(w.bbox.y0 for w in row_words)
                footer_row_indices.append(idx)
            elif summary_start_y is not None:
                # Any row below the first summary line belongs to the footer region
                footer_row_indices.append(idx)
            else:
                data_row_indices.append(idx)

        # Table ending position is where the data ends or summary starts
        if data_row_indices:
            data_y0 = min(w.bbox.y0 for idx in data_row_indices for w in raw_rows[idx])
            data_y1 = max(w.bbox.y1 for idx in data_row_indices for w in raw_rows[idx])
            data_x0 = min(w.bbox.x0 for idx in data_row_indices for w in raw_rows[idx])
            data_x1 = max(w.bbox.x1 for idx in data_row_indices for w in raw_rows[idx])
            data_bbox = BoundingBox(x0=data_x0, y0=data_y0, x1=data_x1, y1=data_y1)
            table_end_y = data_y1
            table_start_x = min(data_x0, header_bbox.x0 if header_bbox else data_x0)
            table_end_x = max(data_x1, header_bbox.x1 if header_bbox else data_x1)
        else:
            data_bbox = None
            table_end_y = header_bbox.y1 if header_bbox else table_start_y
            table_start_x = header_bbox.x0 if header_bbox else 0.0
            table_end_x = header_bbox.x1 if header_bbox else page_width

        # Compute footer bbox
        if footer_row_indices:
            f_y0 = min(w.bbox.y0 for idx in footer_row_indices for w in raw_rows[idx])
            f_y1 = max(w.bbox.y1 for idx in footer_row_indices for w in raw_rows[idx])
            f_x0 = min(w.bbox.x0 for idx in footer_row_indices for w in raw_rows[idx])
            f_x1 = max(w.bbox.x1 for idx in footer_row_indices for w in raw_rows[idx])
            footer_bbox = BoundingBox(x0=f_x0, y0=f_y0, x1=f_x1, y1=f_y1)
        else:
            footer_bbox = None

        confidence = 95.0 if header_indices else 65.0

        return TableRegion(
            has_table=True,
            table_start_y=table_start_y,
            table_end_y=table_end_y,
            table_start_x=table_start_x,
            table_end_x=table_end_x,
            header_row_indices=header_indices,
            header_bbox=header_bbox,
            data_bbox=data_bbox,
            footer_bbox=footer_bbox,
            summary_start_y=summary_start_y,
            confidence=confidence,
            is_repeated_header=is_repeated,
            header_candidates=header_candidates,
        )

    def _find_header_rows(
        self,
        raw_rows: List[List[OCRWord]],
        median_h: float,
        page_width: float,
        primary_header_signature: Optional[List[str]] = None,
    ) -> Tuple[List[int], List[HeaderCandidate], bool]:
        """
        Locates table header row(s).
        Prioritizes rows with high semantic role density and excludes letterhead metadata.
        """
        best_indices: List[int] = []
        best_candidates: List[HeaderCandidate] = []
        best_score = 0
        is_repeated = False

        scan_limit = min(25, len(raw_rows))

        for idx in range(scan_limit):
            row_words = raw_rows[idx]
            row_text = " ".join(w.text for w in row_words).strip()

            # Skip pre-table letterhead metadata rows
            if self._is_metadata_row(row_text):
                continue

            # Check single line header candidates
            candidates = self.header_recognizer.extract_header_candidates([row_words], median_h)
            unique_roles = {c.role for c in candidates if c.role != "unknown"}
            score = len(unique_roles)

            # Check if stacked with immediately following row
            if idx + 1 < len(raw_rows):
                next_row_words = raw_rows[idx + 1]
                next_text = " ".join(w.text for w in next_row_words).strip()
                v_gap = min(w.bbox.y0 for w in next_row_words) - max(w.bbox.y1 for w in row_words)

                # Only evaluate stacking if gap is tight and next row is not metadata or summary
                if v_gap <= max(12.0, median_h * 1.3) and not self._is_metadata_row(next_text) and not self._is_summary_line(next_text, next_row_words, page_width):
                    next_cands = self.header_recognizer.extract_header_candidates([next_row_words], median_h)
                    next_roles = {c.role for c in next_cands if c.role != "unknown"}

                    # Stack only if both rows contribute header signals
                    if unique_roles and next_roles:
                        stacked_candidates = self.header_recognizer.extract_header_candidates(
                            [row_words, next_row_words], median_h
                        )
                        stacked_unique_roles = {c.role for c in stacked_candidates if c.role != "unknown"}
                        stacked_score = len(stacked_unique_roles)

                        if stacked_score > score:
                            candidates = stacked_candidates
                            score = stacked_score
                            candidate_indices = [idx, idx + 1]
                        else:
                            candidate_indices = [idx]
                    else:
                        candidate_indices = [idx]
                else:
                    candidate_indices = [idx]
            else:
                candidate_indices = [idx]

            # Require at least 2 distinct semantic header roles (e.g. product + rate, or product + qty)
            if score >= 2 and score > best_score:
                best_score = score
                best_indices = candidate_indices
                best_candidates = candidates

        # Check for repeated header on page 2+ matching primary header signature
        if primary_header_signature and best_candidates:
            matched = sum(
                1 for c in best_candidates
                if c.role in primary_header_signature or c.raw_text.lower() in primary_header_signature
            )
            if matched >= 2:
                is_repeated = True

        return best_indices, best_candidates, is_repeated

    def _is_metadata_row(self, text: str) -> bool:
        """Checks if row is document letterhead metadata like invoice no, bill to, or date."""
        cleaned = re.sub(r"[^\w\s:]", " ", text).strip()
        # If text explicitly matches metadata keywords
        for pat in METADATA_HEADER_PATTERNS:
            if pat.search(cleaned):
                # Ensure it's not a table header that happens to contain "Invoice"
                if not any(hdr in cleaned.lower() for hdr in ["item description", "qty", "rate", "mrp", "hsn"]):
                    return True
        return False

    def _evaluate_headerless_table_grid(
        self,
        raw_rows: List[List[OCRWord]],
        median_h: float,
        page_width: float,
    ) -> Tuple[bool, int]:
        """
        Evaluates whether lines form a regular column grid without printed headers.
        """
        if len(raw_rows) < 3:
            return False, 0

        consecutive_tabular_rows = 0
        first_idx = -1

        for idx, row_words in enumerate(raw_rows):
            # A tabular row typically has >= 3 distinct horizontal word clusters with numbers on the right
            if len(row_words) >= 3:
                has_number = any(re.search(r"\d", w.text) for w in row_words)
                has_text = any(re.search(r"[a-zA-Z]", w.text) for w in row_words)
                if has_number and has_text:
                    consecutive_tabular_rows += 1
                    if first_idx == -1:
                        first_idx = idx
                    if consecutive_tabular_rows >= 3:
                        return True, first_idx
                    continue

            consecutive_tabular_rows = 0
            first_idx = -1

        return False, 0

    def _is_summary_line(self, text: str, words: List[OCRWord], page_width: float) -> bool:
        """Determines if a text row belongs to the footer or summary section."""
        cleaned = re.sub(r"[^\w\s.%]", " ", text.lower()).strip()
        if not cleaned:
            return False

        for pat in SUMMARY_PATTERNS:
            if pat.search(cleaned):
                return True

        # Check for isolated right-aligned total pattern e.g. "Total : 1450.00"
        if "total" in cleaned and any(re.search(r"\d+\.\d{2}", w.text) for w in words):
            return True

        return False
