"""
Dynamic Schema Generator for ShopPulse Grocery OCR (Phase 2).
Generates an invoice-specific DocumentTableSchema from detected header anchors and spatial tokens.
Replaces rigid positional column inference with deterministic, header-anchored column boundaries.
"""

from enum import Enum
import re
import statistics
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple
from pydantic import BaseModel, ConfigDict, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ColumnDetectionError
from services.grocery_ocr.extraction.header_intelligence import (
    CANONICAL_HEADER_LABELS,
    HeaderCandidate,
    HeaderIntelligenceEngine,
)
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord
from services.grocery_ocr.schemas.table import (
    ColumnRoleType,
    DetectedColumn,
    TableCell,
    TableRow,
    TableResult,
)

logger = get_logger("extraction.dynamic_schema_generator")


class ExpectedDataType(str, Enum):
    """Expected semantic and primitive data type for a column."""
    TEXT = "TEXT"
    DECIMAL_CURRENCY = "DECIMAL_CURRENCY"
    DECIMAL_QUANTITY = "DECIMAL_QUANTITY"
    PERCENTAGE = "PERCENTAGE"
    INTEGER_SERIAL = "INTEGER_SERIAL"
    HSN_CODE = "HSN_CODE"
    UNKNOWN = "UNKNOWN"


# Mapping from canonical column role to expected data type
ROLE_TO_EXPECTED_DATA_TYPE: Dict[ColumnRoleType, ExpectedDataType] = {
    "serial": ExpectedDataType.INTEGER_SERIAL,
    "product": ExpectedDataType.TEXT,
    "hsn": ExpectedDataType.HSN_CODE,
    "qty": ExpectedDataType.DECIMAL_QUANTITY,
    "unit": ExpectedDataType.TEXT,
    "rate": ExpectedDataType.DECIMAL_CURRENCY,
    "purchase_price": ExpectedDataType.DECIMAL_CURRENCY,
    "selling_price": ExpectedDataType.DECIMAL_CURRENCY,
    "mrp": ExpectedDataType.DECIMAL_CURRENCY,
    "discount": ExpectedDataType.DECIMAL_CURRENCY,
    "discount_pct": ExpectedDataType.PERCENTAGE,
    "tax_amount": ExpectedDataType.DECIMAL_CURRENCY,
    "gst_rate": ExpectedDataType.PERCENTAGE,
    "taxable": ExpectedDataType.DECIMAL_CURRENCY,
    "total": ExpectedDataType.DECIMAL_CURRENCY,
    "unknown": ExpectedDataType.UNKNOWN,
    "ignore": ExpectedDataType.UNKNOWN,
}

# Mapping from canonical role to standard text alignment
ROLE_TO_ALIGNMENT: Dict[ColumnRoleType, Literal["left", "center", "right"]] = {
    "serial": "left",
    "product": "left",
    "hsn": "center",
    "qty": "center",
    "unit": "center",
    "rate": "right",
    "purchase_price": "right",
    "selling_price": "right",
    "mrp": "right",
    "discount": "right",
    "discount_pct": "right",
    "tax_amount": "right",
    "gst_rate": "right",
    "taxable": "right",
    "total": "right",
    "unknown": "center",
    "ignore": "center",
}


class DynamicColumnDefinition(BaseModel):
    """Immutable, document-specific column definition bound to spatial coordinates."""
    column_index: int = Field(..., ge=0, description="0-indexed horizontal column order")
    role: ColumnRoleType = Field(..., description="Canonical semantic role of column")
    header_text: str = Field(..., description="Verbatim header text read from document")
    normalized_role: str = Field(..., description="Uppercase canonical label e.g. PRODUCT, QUANTITY")
    expected_data_type: ExpectedDataType = Field(..., description="Expected data type for cell validation")
    x_start: float = Field(..., ge=0.0, description="Left coordinate boundary in pixels")
    x_end: float = Field(..., ge=0.0, description="Right coordinate boundary in pixels")
    alignment: Literal["left", "center", "right"] = Field(default="left", description="Horizontal text alignment")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Confidence in column identification")
    is_inferred: bool = Field(default=False, description="True if role was inferred without explicit header")
    inference_reason: Optional[str] = Field(None, description="Reason for role inference")
    is_required: bool = Field(default=False, description="True if column is critical for product creation")
    is_percent: bool = Field(default=False, description="True if column stores percentage values")
    bbox: Optional[BoundingBox] = Field(None, description="Header text bounding box")

    model_config = ConfigDict(frozen=True)

    def to_detected_column(self) -> DetectedColumn:
        """Converts to backward-compatible DetectedColumn schema."""
        return DetectedColumn(
            role=self.role,
            header_text=self.header_text,
            column_index=self.column_index,
            x_start=self.x_start,
            x_end=self.x_end if self.x_end != float("inf") else None,
            is_percent=self.is_percent,
            confidence=self.confidence,
            inferred=self.is_inferred,
            inference_reason=self.inference_reason,
            supporting_evidence=self.inference_reason,
            alignment=self.alignment,
            bbox=self.bbox,
            normalized_role=self.normalized_role,
        )


class DocumentTableSchema(BaseModel):
    """Complete document-specific table schema generated from invoice headers."""
    columns: List[DynamicColumnDefinition] = Field(default_factory=list)
    header_row_index: Optional[int] = Field(None, description="Index of header row, or None if headerless")
    header_text: Optional[str] = Field(None, description="Full raw text of the header line")
    has_explicit_headers: bool = Field(default=True, description="True if generated from recognized headers")
    has_product_column: bool = Field(default=False, description="True if a product description column is present")
    has_quantity_column: bool = Field(default=False, description="True if a quantity column is present")
    has_price_or_amount: bool = Field(default=False, description="True if at least one price/amount column is present")
    is_valid_schema: bool = Field(default=False, description="True if schema has sufficient columns to parse items")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Overall schema confidence")
    warnings: List[str] = Field(default_factory=list, description="Schema generation warnings or ambiguities")

    model_config = ConfigDict(frozen=True)

    @property
    def column_count(self) -> int:
        return len(self.columns)

    def get_column_by_role(self, role: ColumnRoleType) -> Optional[DynamicColumnDefinition]:
        return next((c for c in self.columns if c.role == role), None)

    def get_column_by_index(self, index: int) -> Optional[DynamicColumnDefinition]:
        return next((c for c in self.columns if c.column_index == index), None)

    def to_detected_columns(self) -> List[DetectedColumn]:
        return [c.to_detected_column() for c in self.columns]


class DynamicSchemaGenerator:
    """
    Dynamic Schema Generator Engine.
    Converts unstructured header candidate tokens and spatial evidence into an immutable DocumentTableSchema.
    Features:
    - Dynamic whitespace valley boundary calculation between columns.
    - Resolves multi-line stacked headers.
    - Disambiguates duplicate or ambiguous roles.
    - Fallback schema generation for headerless invoices.
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        header_intelligence: Optional[HeaderIntelligenceEngine] = None,
    ):
        self.config = config or default_config
        self.header_intelligence = header_intelligence or HeaderIntelligenceEngine()

    def generate_schema(
        self,
        table: TableResult,
        data_rows: Optional[List[TableRow]] = None,
    ) -> DocumentTableSchema:
        """
        Generates an immutable DocumentTableSchema from table headers and rows.
        """
        logger.debug("Generating dynamic schema for table with %d rows", len(table.rows))
        try:
            if not table.rows:
                return DocumentTableSchema(is_valid_schema=False, warnings=["Table has no rows."])

            # 1. Determine header row index
            header_row_idx = table.header_row_index
            if header_row_idx is None:
                header_row_idx = self._find_header_row_index(table.rows)

            if header_row_idx is None:
                # Headerless table schema deduction
                return self._generate_headerless_schema(table.rows)

            header_row = table.rows[header_row_idx]
            header_row.is_header = True
            table.header_row_index = header_row_idx
            table.header_text = header_row.raw_text

            # Mark rows before header as non-product metadata
            for r_i in range(header_row_idx):
                table.rows[r_i].is_header = True

            rows_to_check = data_rows if data_rows is not None else [
                r for r in table.rows[header_row_idx + 1 :] if not r.is_summary and not r.is_header
            ]

            # Calculate document median text height
            all_words = [w for r in table.rows for c in r.cells for w in c.words]
            heights = [w.bbox.height for w in all_words if w.bbox.height > 2.0]
            median_h = statistics.median(heights) if heights else 15.0

            # 2. Extract header candidates
            header_words = [w for c in header_row.cells for w in c.words]
            if header_words:
                candidates = self.header_intelligence.extract_header_candidates([header_words], median_h)
            else:
                # Direct cell classification if words absent
                candidates = []
                for idx, cell in enumerate(header_row.cells):
                    role, conf, norm = self.header_intelligence.classify_text(cell.raw_text)
                    box = cell.bbox or BoundingBox(
                        x0=float(idx * 100.0),
                        y0=0.0,
                        x1=float((idx + 1) * 100.0 - 10.0),
                        y1=20.0,
                    )
                    candidates.append(
                        HeaderCandidate(
                            raw_text=cell.raw_text,
                            role=role,
                            normalized_label=norm,
                            bbox=box,
                            words=cell.words,
                            confidence=conf,
                            is_percent="%" in cell.raw_text,
                        )
                    )

            if not candidates:
                return self._generate_headerless_schema(table.rows)

            # Filter delimiter-only noise candidates
            clean_cands: List[HeaderCandidate] = [
                c for c in candidates
                if not re.match(r"^[\s\|\:\/\-\=\~\.]+$", c.raw_text.strip())
            ]

            if not clean_cands or all(c.role == "unknown" for c in clean_cands):
                return self._generate_headerless_schema(table.rows)

            # 3. Disambiguate duplicate roles (e.g. two RATE columns, or separate CGST/SGST)
            disambiguated_cands = self._disambiguate_header_roles(clean_cands)

            # 4. Calculate continuous horizontal column boundaries
            schema_columns = self._calculate_column_boundaries(disambiguated_cands, rows_to_check, median_h)

            # 5. Apply conservative positional role inference for unknown columns with data evidence
            schema_columns = self._apply_conservative_role_inference(schema_columns, rows_to_check)

            has_prod = any(c.role == "product" for c in schema_columns)
            has_qty = any(c.role == "qty" for c in schema_columns)
            has_price = any(c.role in ("rate", "purchase_price", "selling_price", "total") for c in schema_columns)
            is_valid = has_prod or (has_qty and has_price)

            conf = (
                sum(c.confidence for c in schema_columns) / len(schema_columns)
                if schema_columns else 50.0
            )

            schema = DocumentTableSchema(
                columns=schema_columns,
                header_row_index=header_row_idx,
                header_text=header_row.raw_text,
                has_explicit_headers=True,
                has_product_column=has_prod,
                has_quantity_column=has_qty,
                has_price_or_amount=has_price,
                is_valid_schema=is_valid,
                confidence=round(conf, 1),
            )
            return schema

        except Exception as exc:
            logger.error("Dynamic schema generation failed: %s", exc)
            raise ColumnDetectionError(f"Dynamic schema generation failed: {exc}", details={"error": str(exc)})

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
                role, _, _ = self.header_intelligence.classify_text(cell.raw_text)
                if role != "unknown":
                    score += 1
            if score >= 2 and score > best_score:
                best_score = score
                best_idx = idx
        return best_idx

    def _disambiguate_header_roles(self, cands: List[HeaderCandidate]) -> List[HeaderCandidate]:
        """
        Disambiguates duplicate or ambiguous roles across header candidates.
        Example: If two RATE columns exist:
          - First containing 'pur' or 'buy' -> purchase_price
          - Second containing 'sell' or 'sale' -> selling_price
        """
        roles_count: Dict[ColumnRoleType, int] = {}
        for c in cands:
            roles_count[c.role] = roles_count.get(c.role, 0) + 1

        # If duplicate 'rate' roles, inspect header text
        if roles_count.get("rate", 0) > 1:
            for c in cands:
                if c.role == "rate":
                    txt = c.raw_text.lower()
                    if any(k in txt for k in ["pur", "buy", "cost", "dp"]):
                        c.role = "purchase_price"
                        c.normalized_label = CANONICAL_HEADER_LABELS["purchase_price"]
                    elif any(k in txt for k in ["sell", "sale", "sp", "retail"]):
                        c.role = "selling_price"
                        c.normalized_label = CANONICAL_HEADER_LABELS["selling_price"]

        return cands

    def _calculate_column_boundaries(
        self,
        cands: List[HeaderCandidate],
        data_rows: List[TableRow],
        median_h: float,
    ) -> List[DynamicColumnDefinition]:
        """
        Calculates optimal non-overlapping [x_start, x_end] boundaries using whitespace valleys.
        """
        if not cands:
            return []

        if len(cands) == 1:
            c = cands[0]
            exp_type = ROLE_TO_EXPECTED_DATA_TYPE.get(c.role, ExpectedDataType.TEXT)
            align = ROLE_TO_ALIGNMENT.get(c.role, "left")
            is_req = c.role in ("product", "qty", "rate", "purchase_price", "total")
            return [
                DynamicColumnDefinition(
                    column_index=0,
                    role=c.role,
                    header_text=c.raw_text,
                    normalized_role=c.normalized_label,
                    expected_data_type=exp_type,
                    x_start=0.0,
                    x_end=float("inf"),
                    alignment=align,
                    confidence=c.confidence,
                    is_required=is_req,
                    is_percent=c.is_percent,
                    bbox=c.bbox,
                )
            ]

        # Collect data word x-coordinates
        data_words: List[OCRWord] = []
        for r in data_rows:
            for cell in r.cells:
                data_words.extend(cell.words)

        split_boundaries: List[float] = []

        # Find split point between candidate k and candidate k+1
        for i in range(len(cands) - 1):
            curr_col = cands[i]
            next_col = cands[i + 1]

            curr_hx0 = curr_col.bbox.x0
            curr_hx1 = curr_col.bbox.x1
            next_hx0 = next_col.bbox.x0
            next_hx1 = next_col.bbox.x1

            search_min_x = curr_hx0
            search_max_x = next_hx1 + 30.0

            region_words = [
                w for w in data_words
                if search_min_x <= w.bbox.center_x <= search_max_x
            ]

            if len(region_words) >= 2:
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

                col_c1 = (curr_hx0 + curr_hx1) / 2.0
                col_c2 = (next_hx0 + next_hx1) / 2.0
                if col_c1 < best_split < col_c2:
                    split_boundaries.append(best_split)
                else:
                    split_boundaries.append((curr_hx1 + next_hx0) / 2.0)
            else:
                split_boundaries.append((curr_hx1 + next_hx0) / 2.0)

        # Assemble DynamicColumnDefinition instances
        columns: List[DynamicColumnDefinition] = []
        for i, c in enumerate(cands):
            x_start = 0.0 if i == 0 else split_boundaries[i - 1]
            x_end = float("inf") if i == len(cands) - 1 else split_boundaries[i]
            exp_type = ROLE_TO_EXPECTED_DATA_TYPE.get(c.role, ExpectedDataType.TEXT)
            align = ROLE_TO_ALIGNMENT.get(c.role, "left")
            is_req = c.role in ("product", "qty", "rate", "purchase_price", "total")

            columns.append(
                DynamicColumnDefinition(
                    column_index=i,
                    role=c.role,
                    header_text=c.raw_text,
                    normalized_role=c.normalized_label,
                    expected_data_type=exp_type,
                    x_start=round(x_start, 1),
                    x_end=round(x_end, 1) if x_end != float("inf") else float("inf"),
                    alignment=align,
                    confidence=c.confidence,
                    is_required=is_req,
                    is_percent=c.is_percent,
                    bbox=c.bbox,
                )
            )

        return columns

    def _apply_conservative_role_inference(
        self,
        cols: List[DynamicColumnDefinition],
        data_rows: List[TableRow],
    ) -> List[DynamicColumnDefinition]:
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
                res_cols[idx] = res_cols[idx].model_copy(update={
                    "role": "selling_price",
                    "normalized_role": "SELLING_PRICE",
                    "expected_data_type": ExpectedDataType.DECIMAL_CURRENCY,
                    "confidence": 65.0,
                    "is_inferred": True,
                    "inference_reason": "POSITIONAL_BETWEEN_RATE_AND_MRP",
                    "alignment": "right",
                })

        # Rule 2: Unknown between Discount and Total -> tax_amount
        disc_idx = next((i for i, c in enumerate(res_cols) if c.role in ("discount", "discount_pct")), -1)
        tot_idx = next((i for i, c in enumerate(res_cols) if c.role in ("total", "taxable")), -1)

        if disc_idx >= 0 and tot_idx > disc_idx + 1:
            gap_indices = [i for i in range(disc_idx + 1, tot_idx) if res_cols[i].role == "unknown"]
            if len(gap_indices) == 1 and self._column_is_predominantly_numeric(gap_indices[0], data_rows):
                idx = gap_indices[0]
                res_cols[idx] = res_cols[idx].model_copy(update={
                    "role": "tax_amount",
                    "normalized_role": "TAX",
                    "expected_data_type": ExpectedDataType.DECIMAL_CURRENCY,
                    "confidence": 65.0,
                    "is_inferred": True,
                    "inference_reason": "POSITIONAL_BETWEEN_DISCOUNT_AND_TOTAL",
                    "alignment": "right",
                })

        # Rule 3: Leading column containing sequential integers -> serial
        if res_cols and res_cols[0].role == "unknown":
            if self._column_is_sequential_integer(0, data_rows):
                res_cols[0] = res_cols[0].model_copy(update={
                    "role": "serial",
                    "normalized_role": "SERIAL",
                    "expected_data_type": ExpectedDataType.INTEGER_SERIAL,
                    "confidence": 80.0,
                    "is_inferred": True,
                    "inference_reason": "SEQUENTIAL_INTEGER_PATTERN",
                    "alignment": "left",
                })

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
            is_increasing = all(vals[k] < vals[k + 1] for k in range(len(vals) - 1))
            if is_increasing and vals[0] in (1, 0):
                return True
        return False

    def _generate_headerless_schema(self, rows: List[TableRow]) -> DocumentTableSchema:
        """
        Infers schema for headerless tables by clustering cell data types across rows.
        """
        logger.info("Generating headerless schema from %d table rows", len(rows))
        data_rows = [r for r in rows if not r.is_summary and any(c.cleaned_text for c in r.cells)]
        if not data_rows:
            return DocumentTableSchema(
                has_explicit_headers=False,
                is_valid_schema=False,
                warnings=["Headerless table contains no readable data rows."],
            )

        # Group words by horizontal center coordinates
        words = [w for r in data_rows for c in r.cells for w in c.words]
        if not words:
            return DocumentTableSchema(
                has_explicit_headers=False,
                is_valid_schema=False,
                warnings=["Headerless table contains no tokens with coordinates."],
            )

        # Cluster tokens by horizontal centers
        sorted_x = sorted(w.bbox.center_x for w in words)
        centers: List[float] = []
        cluster_tol = 45.0

        for x in sorted_x:
            if not centers or abs(x - centers[-1]) > cluster_tol:
                centers.append(x)
            else:
                centers[-1] = (centers[-1] + x) / 2.0

        if len(centers) < 2:
            return DocumentTableSchema(
                has_explicit_headers=False,
                is_valid_schema=False,
                warnings=["Headerless table has insufficient column separation."],
            )

        # Build column intervals
        splits: List[float] = []
        for i in range(len(centers) - 1):
            splits.append((centers[i] + centers[i + 1]) / 2.0)

        inferred_cols: List[DynamicColumnDefinition] = []
        for i in range(len(centers)):
            x_start = 0.0 if i == 0 else splits[i - 1]
            x_end = float("inf") if i == len(centers) - 1 else splits[i]

            # Sample words in this column
            col_words = [w for w in words if x_start <= w.bbox.center_x < x_end]
            has_digits = sum(1 for w in col_words if any(ch.isdigit() for ch in w.text))
            has_letters = sum(1 for w in col_words if any(ch.isalpha() for ch in w.text))

            # Deduce role
            if i == 0 and has_digits > (len(col_words) * 0.7) and has_letters == 0:
                role: ColumnRoleType = "serial"
            elif has_letters > has_digits:
                role = "product"
            elif i == len(centers) - 1 and has_digits > 0:
                role = "total"
            elif has_digits > 0 and i > 0:
                role = "qty" if i == 1 or (i == 2 and any(c.role == "product" for c in inferred_cols)) else "rate"
            else:
                role = "unknown"

            exp_type = ROLE_TO_EXPECTED_DATA_TYPE.get(role, ExpectedDataType.TEXT)
            align = ROLE_TO_ALIGNMENT.get(role, "left")

            inferred_cols.append(
                DynamicColumnDefinition(
                    column_index=i,
                    role=role,
                    header_text=f"[Inferred {role.upper()}]",
                    normalized_role=CANONICAL_HEADER_LABELS.get(role, role.upper()),
                    expected_data_type=exp_type,
                    x_start=round(x_start, 1),
                    x_end=round(x_end, 1) if x_end != float("inf") else float("inf"),
                    alignment=align,
                    confidence=60.0,
                    is_inferred=True,
                    inference_reason="HEADERLESS_DATA_TYPE_CLUSTERING",
                )
            )

        has_prod = any(c.role == "product" for c in inferred_cols)
        has_qty = any(c.role == "qty" for c in inferred_cols)
        has_price = any(c.role in ("rate", "purchase_price", "total") for c in inferred_cols)

        return DocumentTableSchema(
            columns=inferred_cols,
            header_row_index=None,
            header_text=None,
            has_explicit_headers=False,
            has_product_column=has_prod,
            has_quantity_column=has_qty,
            has_price_or_amount=has_price,
            is_valid_schema=has_prod and (has_qty or has_price),
            confidence=60.0,
            warnings=["Schema inferred without explicit header row."],
        )
