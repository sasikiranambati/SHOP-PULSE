"""
Pydantic schemas representing table reconstruction results, columns, headers, and grid cells.
Stores spatial ranges, cell token bindings, and column role classifications for Phase 4.
"""

from typing import Any, Dict, List, Literal, Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field, model_validator
from services.grocery_ocr.schemas.ocr import BoundingBox, OCRWord

ColumnRoleType = Literal[
    "serial",
    "product",
    "hsn",
    "qty",
    "unit",
    "rate",
    "purchase_price",
    "selling_price",
    "mrp",
    "discount",
    "discount_pct",
    "tax_amount",
    "gst_rate",
    "total",
    "taxable",
    "unknown",
    "ignore",
]


class DetectedColumn(BaseModel):
    """Semantic column definition with detected role and spatial boundary coordinates."""
    role: ColumnRoleType = Field(default="unknown", description="Semantic role of the column")
    header_text: str = Field(..., description="Printed text from the invoice header line")
    column_index: int = Field(default=0, ge=0, description="0-indexed horizontal column order")
    x_start: Optional[float] = Field(None, description="Left coordinate boundary in pixels")
    x_end: Optional[float] = Field(None, description="Right coordinate boundary in pixels")
    is_percent: bool = Field(default=False, description="True if column header specifies percentage (%)")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Role detection confidence score")
    inferred: bool = Field(default=False, description="True if column role was deduced via positional/data inference")
    inference_reason: Optional[str] = Field(None, description="Reason and rule used for positional role inference")
    supporting_evidence: Optional[str] = Field(None, description="Summary of evidence supporting inferred role")
    alignment: Literal["left", "center", "right"] = Field(default="left", description="Horizontal text alignment")
    bbox: Optional[BoundingBox] = Field(None, description="Bounding box of header text or column region")
    normalized_role: Optional[str] = Field(None, description="Normalized canonical label name e.g. PRODUCT, QUANTITY")

    model_config = ConfigDict(frozen=True)


class TableCell(BaseModel):
    """Individual cell located at the intersection of a table row and detected column."""
    row_index: int = Field(..., ge=0, description="0-indexed table row")
    col_index: int = Field(..., ge=0, description="0-indexed column position")
    raw_text: str = Field(default="", description="Original string content inside this cell")
    cleaned_text: str = Field(default="", description="Sanitized text with OCR artifacts stripped")
    words: List[OCRWord] = Field(default_factory=list, description="Constituent OCR tokens with bounding boxes")
    bbox: Optional[BoundingBox] = Field(None, description="Spatial boundaries of the cell")
    is_numeric: bool = Field(default=False, description="True if cell text conforms to numeric patterns")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Cell OCR confidence")
    review_required: bool = Field(default=False, description="True if cell numeric association or format is ambiguous")
    review_reason: Optional[str] = Field(None, description="Reason cell requires review")
    inferred_role: Optional[ColumnRoleType] = Field(None, description="Inferred semantic role if column was unassigned")


class TableRow(BaseModel):
    """Horizontal line item or section boundary in the reconstructed table grid."""
    row_index: int = Field(..., ge=0, description="0-indexed row position within the table")
    cells: List[TableCell] = Field(default_factory=list, description="Cells corresponding to detected columns")
    raw_text: str = Field(default="", description="Full line text as read from the document")
    is_header: bool = Field(default=False, description="True if this row constitutes the table header")
    is_summary: bool = Field(default=False, description="True if row represents a subtotal, total, or tax footer")
    is_continuation: bool = Field(default=False, description="True if row is continuation line of multi-line product")
    parent_row_index: Optional[int] = Field(None, description="Row index of parent product if continuation")
    reconstructed_description: Optional[str] = Field(None, description="Reconstructed product description including continuations")
    original_lines: List[str] = Field(default_factory=list, description="Original unmerged line texts for multi-line products")
    bbox: Optional[BoundingBox] = Field(None, description="Spatial bounding box enclosing the row")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Row reconstruction confidence")
    warnings: List[str] = Field(default_factory=list, description="Row-level warnings or ambiguities")
    review_required: bool = Field(default=False, description="True if row has ambiguous values needing user check")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Row classification metadata")


class TableReconstructionResult(BaseModel):
    """
    Structured result of advanced table reconstruction (Phase 4).
    Contains spatial boundaries, headers, column role mappings, rows, cells, and confidence metrics.
    """
    document_id: str = Field(
        default_factory=lambda: f"doc_{uuid.uuid4().hex[:12]}",
        description="Unique document identifier"
    )
    page_number: int = Field(default=1, ge=1, description="Page number containing this table")
    table_boundaries: Optional[BoundingBox] = Field(None, description="Outer bounding box enclosing entire table")
    data_boundaries: Optional[BoundingBox] = Field(None, description="Bounding box enclosing table data region")
    header_boundaries: Optional[BoundingBox] = Field(None, description="Bounding box enclosing table header rows")
    footer_boundaries: Optional[BoundingBox] = Field(None, description="Bounding box enclosing summary/footer rows")
    original_headers: List[str] = Field(default_factory=list, description="Original header strings read from document")
    normalized_headers: List[str] = Field(default_factory=list, description="Normalized semantic header labels")
    column_coordinates: List[BoundingBox] = Field(default_factory=list, description="Bounding boxes for each column span")
    column_role_mappings: Dict[str, str] = Field(default_factory=dict, description="Mapping from column index/header to role")
    columns: List[DetectedColumn] = Field(default_factory=list, description="Detected semantic columns")
    column_positions: List[DetectedColumn] = Field(default_factory=list, description="Backward-compatible column list")
    detected_headers: List[DetectedColumn] = Field(default_factory=list, description="Backward-compatible header list")
    rows: List[TableRow] = Field(default_factory=list, description="Ordered list of data rows extracted from table")
    reconstructed_rows: List[TableRow] = Field(default_factory=list, description="Reconstructed product rows (including multi-line)")
    header_row_index: Optional[int] = Field(None, description="Index of header row, or None for headerless tables")
    header_text: Optional[str] = Field(None, description="Full text of detected header line")
    cell_values: List[List[str]] = Field(default_factory=list, description="2D grid of cleaned cell text values [row][col]")
    cell_coordinates: List[List[Optional[BoundingBox]]] = Field(default_factory=list, description="2D grid of cell bounding boxes")
    ocr_confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Mean OCR confidence of table words")
    row_confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Row clustering confidence score")
    column_mapping_confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Column detection confidence")
    confidence: float = Field(default=0.0, ge=0.0, le=100.0, description="Overall table reconstruction confidence")
    warnings: List[str] = Field(default_factory=list, description="Reconstruction diagnostics and warnings")
    review_status: str = Field(default="CONFIRMED", description="CONFIRMED | REVIEW_REQUIRED | NO_TABLE_DETECTED")
    has_table: bool = Field(default=True, description="True if a valid table was detected on this page")
    raw_words: List[OCRWord] = Field(default_factory=list, description="Raw OCR tokens belonging to table region")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional table metrics and diagnostics")

    @model_validator(mode="before")
    @classmethod
    def sync_table_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Sync columns <-> column_positions
            cols = data.get("columns") or data.get("column_positions") or []
            data["columns"] = cols
            data["column_positions"] = cols

            # Sync rows <-> reconstructed_rows without overwriting explicitly provided reconstructed_rows
            if "reconstructed_rows" not in data or not data["reconstructed_rows"]:
                data["reconstructed_rows"] = data.get("rows") or []
            if "rows" not in data or not data["rows"]:
                data["rows"] = data.get("reconstructed_rows") or []

            # Sync detected_headers
            if "detected_headers" not in data or not data["detected_headers"]:
                data["detected_headers"] = [c for c in cols if isinstance(c, DetectedColumn) and c.role != "unknown"]

            # Populate original_headers & normalized_headers if missing
            if ("original_headers" not in data or not data["original_headers"]) and cols:
                data["original_headers"] = [
                    c.header_text if isinstance(c, DetectedColumn) else c.get("header_text", "")
                    for c in cols
                ]
            if ("normalized_headers" not in data or not data["normalized_headers"]) and cols:
                data["normalized_headers"] = [
                    c.normalized_role or c.role.upper() if isinstance(c, DetectedColumn) else str(c.get("role", "")).upper()
                    for c in cols
                ]

            # Populate column_role_mappings if missing
            if ("column_role_mappings" not in data or not data["column_role_mappings"]) and cols:
                mappings = {}
                for idx, c in enumerate(cols):
                    role_val = c.role if isinstance(c, DetectedColumn) else c.get("role", "unknown")
                    header_val = c.header_text if isinstance(c, DetectedColumn) else c.get("header_text", f"col_{idx}")
                    mappings[str(idx)] = role_val
                    mappings[header_val] = role_val
                data["column_role_mappings"] = mappings

            # Sync overall confidence
            if "confidence" not in data or data["confidence"] == 0.0:
                rc = data.get("row_confidence", 100.0)
                cc = data.get("column_mapping_confidence", 100.0)
                oc = data.get("ocr_confidence", 100.0)
                data["confidence"] = round((rc * 0.4 + cc * 0.4 + oc * 0.2), 1)

        return data


# TableResult is backward-compatible canonical alias for Phase 2/3 callers
TableResult = TableReconstructionResult

