"""
Unit tests for the ShopPulse Grocery OCR Engine (Phase 2 Architecture Foundation).
Validates schemas, Decimal precision, nullable values, service interfaces,
pipeline orchestration, dependency injection, and error propagation.
"""

from decimal import Decimal
import io
from pathlib import Path
import pytest
from PIL import Image

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import (
    FileValidationError,
    GroceryOCRError,
    InvalidInvoiceError,
    UnsupportedFileError,
)
from services.grocery_ocr.extraction.column_detector import BaseColumnDetector
from services.grocery_ocr.extraction.price_extractor import BasePriceExtractor
from services.grocery_ocr.extraction.product_extractor import BaseProductExtractor
from services.grocery_ocr.extraction.quantity_extractor import BaseQuantityExtractor
from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor
from services.grocery_ocr.engines.ocr_engine import MockOCREngine
from services.grocery_ocr.excel.workbook_generator import BaseWorkbookGenerator
from services.grocery_ocr.excel.workbook_parser import BaseWorkbookParser
from services.grocery_ocr.intelligence.grocery_classifier import BaseGroceryClassifier
from services.grocery_ocr.intelligence.product_matcher import BaseProductMatcher
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline
from services.grocery_ocr.processors.file_validator import BaseFileValidator
from services.grocery_ocr.processors.image_processor import BaseImageProcessor
from services.grocery_ocr.schemas import (
    BoundingBox,
    DetectedColumn,
    ExtractedInvoice,
    ExtractedInvoiceItem,
    InvoiceProcessingMetadata,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
    PackageSize,
    TableCell,
    TableRow,
    TableResult,
)
from services.grocery_ocr.validation.invoice_validator import BaseInvoiceValidator


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

@pytest.fixture
def sample_png_bytes() -> bytes:
    """Generates a valid 100x100 white PNG in memory."""
    img = Image.new("RGB", (100, 100), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def mock_ocr_page() -> OCRPageResult:
    """Creates a synthetic OCRPageResult with word coordinates."""
    w1 = OCRWord(text="Item", bbox=BoundingBox(x0=20, y0=50, x1=80, y1=80), confidence=98.0, word_index=0)
    w2 = OCRWord(text="Description", bbox=BoundingBox(x0=90, y0=50, x1=220, y1=80), confidence=98.0, word_index=1)
    w3 = OCRWord(text="Qty", bbox=BoundingBox(x0=300, y0=50, x1=350, y1=80), confidence=98.0, word_index=2)
    w4 = OCRWord(text="Rate", bbox=BoundingBox(x0=420, y0=50, x1=480, y1=80), confidence=98.0, word_index=3)
    w5 = OCRWord(text="MRP", bbox=BoundingBox(x0=550, y0=50, x1=610, y1=80), confidence=98.0, word_index=4)
    w6 = OCRWord(text="Amount", bbox=BoundingBox(x0=700, y0=50, x1=780, y1=80), confidence=98.0, word_index=5)

    header_line = OCRLine(
        line_number=0,
        text="Item Description Qty Rate MRP Amount",
        words=[w1, w2, w3, w4, w5, w6],
        bbox=BoundingBox(x0=20, y0=50, x1=780, y1=80),
        confidence=98.0,
    )

    d1 = OCRWord(text="Tata", bbox=BoundingBox(x0=20, y0=100, x1=70, y1=130), confidence=95.0, word_index=6)
    d2 = OCRWord(text="Salt", bbox=BoundingBox(x0=80, y0=100, x1=130, y1=130), confidence=95.0, word_index=7)
    d3 = OCRWord(text="1kg", bbox=BoundingBox(x0=140, y0=100, x1=180, y1=130), confidence=95.0, word_index=8)
    d4 = OCRWord(text="10", bbox=BoundingBox(x0=300, y0=100, x1=330, y1=130), confidence=95.0, word_index=9)
    d5 = OCRWord(text="24.50", bbox=BoundingBox(x0=420, y0=100, x1=475, y1=130), confidence=95.0, word_index=10)
    d6 = OCRWord(text="28.00", bbox=BoundingBox(x0=550, y0=100, x1=605, y1=130), confidence=95.0, word_index=11)
    d7 = OCRWord(text="245.00", bbox=BoundingBox(x0=700, y0=100, x1=765, y1=130), confidence=95.0, word_index=12)

    data_line = OCRLine(
        line_number=1,
        text="Tata Salt 1kg 10 24.50 28.00 245.00",
        words=[d1, d2, d3, d4, d5, d6, d7],
        bbox=BoundingBox(x0=20, y0=100, x1=765, y1=130),
        confidence=95.0,
    )

    return OCRPageResult(
        page_number=1,
        width=800,
        height=1000,
        raw_text=f"{header_line.text}\n{data_line.text}",
        words=[w1, w2, w3, w4, w5, w6, d1, d2, d3, d4, d5, d6, d7],
        lines=[header_line, data_line],
        confidence=96.0,
    )


# --------------------------------------------------------------------------
# 1. Pydantic Schemas, Decimal Precision, and Nullable Values
# --------------------------------------------------------------------------

def test_missing_prices_and_quantities_remain_null():
    """Proves that missing prices and quantities are strictly None and NEVER defaulted to 0 or 1."""
    item = ExtractedInvoiceItem(
        item_id="item_null_test",
        raw_product_name="Unknown Grocery Pack",
    )
    assert item.quantity is None, "Missing quantity must remain None, not 1 or 0"
    assert item.purchase_price is None, "Missing purchase_price must remain None, not 0"
    assert item.selling_price is None, "Missing selling_price must remain None, not 0"
    assert item.mrp is None, "Missing mrp must remain None, not 0"
    assert item.printed_amount is None, "Missing printed_amount must remain None, not 0"
    assert item.calculated_amount is None


def test_financial_values_retain_decimal_precision():
    """Proves that financial fields retain exact Decimal precision without binary float drift."""
    # 5 × 129.46 = 647.30 (in float, 5 * 129.46 can produce 647.3000000000001)
    qty = Decimal("5.000")
    rate = Decimal("129.46")
    total = (qty * rate).quantize(Decimal("0.01"))

    item = ExtractedInvoiceItem(
        item_id="item_dec_test",
        raw_product_name="Hello Organic Chana Dal 1kg",
        quantity=qty,
        purchase_price=rate,
        printed_amount=total,
    )

    assert isinstance(item.quantity, Decimal)
    assert isinstance(item.purchase_price, Decimal)
    assert isinstance(item.printed_amount, Decimal)
    assert item.purchase_price == Decimal("129.46")
    assert item.printed_amount == Decimal("647.30")
    assert item.printed_amount != 647.2999999999999


def test_original_product_description_preserved_separately():
    """Proves that raw OCR text is preserved alongside normalized name, brand, and pack size."""
    raw = "  PARLE-G MILK SHAKTI 60 GM  "
    item = ExtractedInvoiceItem(
        item_id="item_preserve_test",
        raw_product_name=raw,
        normalized_product_name="Parle-G Milk Shakti",
        brand="Parle",
        package_size=PackageSize(value=Decimal("60"), unit="gm", raw_text="60 GM"),
    )
    assert item.raw_product_name == raw, "Original product name must be preserved verbatim"
    assert item.normalized_product_name == "Parle-G Milk Shakti"
    assert item.brand == "Parle"
    assert item.package_size.value == Decimal("60")


def test_ocr_evidence_is_not_discarded():
    """Proves that full word coordinates and OCR bounding boxes are preserved in document metadata."""
    bbox = BoundingBox(x0=10.5, y0=20.0, x1=50.2, y1=45.0)
    word = OCRWord(text="Fortune", bbox=bbox, confidence=97.5)
    page = OCRPageResult(page_number=1, width=1000, height=1200, words=[word], confidence=97.5)
    doc = OCRDocumentResult(pages=[page], total_pages=1, full_text="Fortune", average_confidence=97.5)

    meta = InvoiceProcessingMetadata(
        filename="bill.png",
        ocr_evidence=doc,
    )
    assert meta.ocr_evidence is not None
    assert len(meta.ocr_evidence.pages[0].words) == 1
    assert meta.ocr_evidence.pages[0].words[0].bbox.x0 == 10.5


# --------------------------------------------------------------------------
# 2. File Validator Service Tests
# --------------------------------------------------------------------------

def test_file_validator_accepts_valid_image(sample_png_bytes):
    validator = BaseFileValidator()
    res = validator.validate(sample_png_bytes, "invoice.png")
    assert res.is_valid is True
    assert res.document_type == "image"
    assert res.mime_type == "image/png"


def test_file_validator_accepts_pdf():
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
    validator = BaseFileValidator()
    res = validator.validate(pdf_bytes, "invoice.pdf")
    assert res.is_valid is True
    assert res.document_type == "pdf"
    assert res.mime_type == "application/pdf"


def test_file_validator_rejects_empty_file():
    validator = BaseFileValidator()
    with pytest.raises(InvalidInvoiceError):
        validator.validate(b"", "empty.png")


def test_file_validator_rejects_oversized_file():
    cfg = GroceryOCRConfig(max_file_size_bytes=100)
    validator = BaseFileValidator(cfg)
    with pytest.raises(FileValidationError):
        validator.validate(b"x" * 101, "large.png")


def test_file_validator_rejects_unsupported_extension(sample_png_bytes):
    validator = BaseFileValidator()
    with pytest.raises(UnsupportedFileError):
        validator.validate(sample_png_bytes, "malicious.exe")


# --------------------------------------------------------------------------
# 3. Image Processor Service Tests
# --------------------------------------------------------------------------

def test_image_processor_normalizes_to_png(sample_png_bytes):
    processor = BaseImageProcessor()
    res = processor.preprocess(sample_png_bytes)
    assert res.processed_bytes.startswith(b"\x89PNG")
    assert res.dpi == 300
    assert res.original_dimensions == (100, 100)
    assert res.processed_dimensions == (100, 100)


# --------------------------------------------------------------------------
# 4. Table Reconstructor Service Tests
# --------------------------------------------------------------------------

def test_table_reconstructor_groups_words_into_rows(mock_ocr_page):
    reconstructor = BaseTableReconstructor()
    table = reconstructor.reconstruct_table(mock_ocr_page)
    assert len(table.rows) == 2, "Expected 2 table rows (header + 1 data row)"
    assert "Item Description" in table.rows[0].raw_text
    assert "Tata Salt" in table.rows[1].raw_text


# --------------------------------------------------------------------------
# 5. Column Detector & Positional Inference Tests
# --------------------------------------------------------------------------

def test_column_detector_identifies_semantic_headers(mock_ocr_page):
    reconstructor = BaseTableReconstructor()
    detector = BaseColumnDetector()
    table = reconstructor.reconstruct_table(mock_ocr_page)
    columns = detector.detect_columns(table)

    roles = [c.role for c in columns]
    assert "product" in roles
    assert "qty" in roles
    assert "rate" in roles
    assert "mrp" in roles
    assert "total" in roles


def test_positional_inference_single_unknown_numeric_assigns_selling_price_and_lowers_confidence():
    """
    Verifies that an unknown column between Rate and MRP is inferred as selling_price
    ONLY when there is exactly 1 unknown column and it contains numeric values in >= 50% data rows.
    Confidence must be lowered to 65.0.
    """
    detector = BaseColumnDetector()

    header_row = TableRow(
        row_index=0,
        raw_text="Item | Rate | CustomSP | MRP | Amount",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Item", cleaned_text="Item"),
            TableCell(row_index=0, col_index=1, raw_text="Rate", cleaned_text="Rate"),
            TableCell(row_index=0, col_index=2, raw_text="CustomSP", cleaned_text="CustomSP"),
            TableCell(row_index=0, col_index=3, raw_text="MRP", cleaned_text="MRP"),
            TableCell(row_index=0, col_index=4, raw_text="Amount", cleaned_text="Amount"),
        ],
        is_header=True,
    )

    data_row = TableRow(
        row_index=1,
        raw_text="Ghee 1L | 520.00 | 580.00 | 620.00 | 2600.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Ghee 1L", cleaned_text="Ghee 1L"),
            TableCell(row_index=1, col_index=1, raw_text="520.00", cleaned_text="520.00"),
            TableCell(row_index=1, col_index=2, raw_text="580.00", cleaned_text="580.00"),  # numeric cell
            TableCell(row_index=1, col_index=3, raw_text="620.00", cleaned_text="620.00"),
            TableCell(row_index=1, col_index=4, raw_text="2600.00", cleaned_text="2600.00"),
        ],
    )

    table = TableResult(rows=[header_row, data_row])
    cols = detector.detect_columns(table, data_rows=[data_row])

    sp_col = next((c for c in cols if c.header_text == "CustomSP"), None)
    assert sp_col is not None
    assert sp_col.role == "selling_price"
    assert sp_col.confidence == 65.0, "Inferred role must have lowered confidence"


def test_positional_inference_non_numeric_gap_leaves_column_unknown():
    detector = BaseColumnDetector()

    header_row = TableRow(
        row_index=0,
        raw_text="Item | Rate | Notes | MRP | Amount",
        cells=[
            TableCell(row_index=0, col_index=0, raw_text="Item", cleaned_text="Item"),
            TableCell(row_index=0, col_index=1, raw_text="Rate", cleaned_text="Rate"),
            TableCell(row_index=0, col_index=2, raw_text="Notes", cleaned_text="Notes"),
            TableCell(row_index=0, col_index=3, raw_text="MRP", cleaned_text="MRP"),
            TableCell(row_index=0, col_index=4, raw_text="Amount", cleaned_text="Amount"),
        ],
        is_header=True,
    )

    data_row = TableRow(
        row_index=1,
        raw_text="Ghee 1L | 520.00 | Fragile | 620.00 | 2600.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Ghee 1L", cleaned_text="Ghee 1L"),
            TableCell(row_index=1, col_index=1, raw_text="520.00", cleaned_text="520.00"),
            TableCell(row_index=1, col_index=2, raw_text="Fragile", cleaned_text="Fragile"),  # text, not numeric
            TableCell(row_index=1, col_index=3, raw_text="620.00", cleaned_text="620.00"),
            TableCell(row_index=1, col_index=4, raw_text="2600.00", cleaned_text="2600.00"),
        ],
    )

    table = TableResult(rows=[header_row, data_row])
    cols = detector.detect_columns(table, data_rows=[data_row])

    notes_col = next(c for c in cols if c.header_text == "Notes")
    assert notes_col.role == "unknown", "Non-numeric gap must remain unknown"


# --------------------------------------------------------------------------
# 6. Extraction Services Tests (Product, Quantity, Price)
# --------------------------------------------------------------------------

def test_product_extractor_separates_pack_size():
    extractor = BaseProductExtractor()
    row = TableRow(
        row_index=1,
        raw_text="1 Tata Salt 1kg",
        cells=[TableCell(row_index=1, col_index=0, raw_text="1 Tata Salt 1kg", cleaned_text="1 Tata Salt 1kg")],
    )
    cols = [DetectedColumn(role="product", header_text="Item", column_index=0)]
    raw_name, norm_name = extractor.extract_product_name(row, cols)
    pack_size = extractor.extract_pack_size(raw_name)

    assert raw_name == "1 Tata Salt 1kg"
    assert norm_name == "Tata Salt 1kg"
    assert pack_size is not None
    assert pack_size.value == Decimal("1")
    assert pack_size.unit == "kg"


def test_quantity_extractor_does_not_default_to_one():
    extractor = BaseQuantityExtractor()
    row = TableRow(
        row_index=1,
        raw_text="Item | Qty | Rate",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Sugar", cleaned_text="Sugar"),
            TableCell(row_index=1, col_index=1, raw_text="", cleaned_text=""),  # blank qty cell!
            TableCell(row_index=1, col_index=2, raw_text="40.00", cleaned_text="40.00"),
        ],
    )
    cols = [
        DetectedColumn(role="product", header_text="Item", column_index=0),
        DetectedColumn(role="qty", header_text="Qty", column_index=1),
        DetectedColumn(role="rate", header_text="Rate", column_index=2),
    ]
    qty, unit = extractor.extract_quantity(row, cols)
    assert qty is None, "Missing quantity must remain None, not 1"


def test_price_extractor_returns_decimal_values():
    extractor = BasePriceExtractor()
    row = TableRow(
        row_index=1,
        raw_text="Tata Salt | ₹24.50 | 28.00 | ₹245.00",
        cells=[
            TableCell(row_index=1, col_index=0, raw_text="Tata Salt", cleaned_text="Tata Salt"),
            TableCell(row_index=1, col_index=1, raw_text="₹24.50", cleaned_text="₹24.50"),
            TableCell(row_index=1, col_index=2, raw_text="28.00", cleaned_text="28.00"),
            TableCell(row_index=1, col_index=3, raw_text="₹245.00", cleaned_text="₹245.00"),
        ],
    )
    cols = [
        DetectedColumn(role="product", header_text="Item", column_index=0),
        DetectedColumn(role="rate", header_text="Rate", column_index=1),
        DetectedColumn(role="mrp", header_text="MRP", column_index=2),
        DetectedColumn(role="total", header_text="Amount", column_index=3),
    ]
    prices = extractor.extract_prices(row, cols)
    assert prices["purchase_price"] == Decimal("24.50")
    assert prices["mrp"] == Decimal("28.00")
    assert prices["printed_amount"] == Decimal("245.00")
    assert prices["selling_price"] is None, "Absent selling price must be None, not 0"


# --------------------------------------------------------------------------
# 7. Intelligence & Validation Services Tests
# --------------------------------------------------------------------------

def test_grocery_classifier_identifies_staples_and_brands():
    classifier = BaseGroceryClassifier()
    res = classifier.classify("Fortune Sunflower Refined Oil 1L Pouch")
    assert res.is_grocery is True
    assert res.brand == "Fortune"
    assert res.category in ("Cooking oils", "Edible Oils & Ghee")


def test_invoice_validator_verifies_correct_arithmetic():
    validator = BaseInvoiceValidator()
    item = ExtractedInvoiceItem(
        item_id="item_val_ok",
        raw_product_name="Besan 500g",
        quantity=Decimal("10.000"),
        purchase_price=Decimal("70.00"),
        printed_amount=Decimal("700.00"),
    )
    validated = validator.validate_item(item)
    assert validated.validation_status == "VERIFIED"
    assert validated.calculated_amount == Decimal("700.00")
    assert validated.validation_issues == []


def test_invoice_validator_flags_arithmetic_mismatch():
    validator = BaseInvoiceValidator()
    item = ExtractedInvoiceItem(
        item_id="item_val_mismatch",
        raw_product_name="Besan 500g",
        quantity=Decimal("10.000"),
        purchase_price=Decimal("70.00"),
        printed_amount=Decimal("850.00"),  # mismatch: 10 × 70 = 700 != 850
    )
    validated = validator.validate_item(item)
    assert validated.validation_status == "MISMATCH"
    assert any("Arithmetic mismatch" in issue for issue in validated.validation_issues)


# --------------------------------------------------------------------------
# 8. Excel Roundtrip Tests
# --------------------------------------------------------------------------

def test_excel_generator_and_parser_roundtrip():
    generator = BaseWorkbookGenerator()
    parser = BaseWorkbookParser()

    meta = InvoiceProcessingMetadata(filename="test.png")
    item = ExtractedInvoiceItem(
        item_id="item_xl_1",
        raw_product_name="Fortune Besan 500g",
        normalized_product_name="Fortune Besan 500g",
        brand="Fortune",
        category="Atta, Rice & Grains",
        quantity=Decimal("10"),
        unit="pcs",
        purchase_price=Decimal("70.00"),
        selling_price=Decimal("78.00"),
        mrp=Decimal("90.00"),
        printed_amount=Decimal("700.00"),
        validation_status="VERIFIED",
    )
    inv = ExtractedInvoice(
        invoice_id="inv_xl_test",
        original_filename="test.png",
        items=[item],
        metadata=meta,
    )

    xlsx_bytes = generator.generate(inv)
    assert len(xlsx_bytes) > 1000
    assert xlsx_bytes.startswith(b"PK")  # ZIP / XLSX magic signature

    parsed_inv = parser.parse(xlsx_bytes)
    assert len(parsed_inv.items) == 1
    p_item = parsed_inv.items[0]
    assert p_item.raw_product_name == "Fortune Besan 500g"
    assert p_item.quantity == Decimal("10")
    assert p_item.purchase_price == Decimal("70.00")
    assert p_item.mrp == Decimal("90.00")


# --------------------------------------------------------------------------
# 9. Pipeline Orchestration & Dependency Injection Tests
# --------------------------------------------------------------------------

def test_pipeline_orchestration_with_mock_engine(sample_png_bytes, mock_ocr_page):
    """Verifies that the invoice pipeline orchestrator coordinates all stages cleanly."""
    mock_engine = MockOCREngine(predefined_result=mock_ocr_page)
    pipeline = InvoicePipeline(ocr_engine=mock_engine)

    result = pipeline.process(sample_png_bytes, "test_invoice.png")

    assert result.status in ("SUCCESS", "NEEDS_REVIEW")
    assert result.original_filename == "test_invoice.png"
    assert len(result.items) == 1
    assert result.metadata.ocr_evidence is not None
    assert "file_validation" in result.metadata.pipeline_stages_completed
    assert "ocr_recognition" in result.metadata.pipeline_stages_completed
    assert "table_and_column_detection" in result.metadata.pipeline_stages_completed
    assert "invoice_validation" in result.metadata.pipeline_stages_completed

    item = result.items[0]
    assert item.raw_product_name == "Tata Salt 1kg"
    assert item.quantity == Decimal("10.000")
    assert item.purchase_price == Decimal("24.50")
    assert item.mrp == Decimal("28.00")
    assert item.printed_amount == Decimal("245.00")
    assert item.validation_status == "VERIFIED"


def test_pipeline_dependency_injection_custom_classifier(sample_png_bytes, mock_ocr_page):
    """Proves that custom service dependencies can be cleanly injected."""
    class CustomClassifier(BaseGroceryClassifier):
        def classify(self, item_name: str, hsn: str = None):
            res = super().classify(item_name, hsn)
            return res.model_copy(update={"category": "Custom Premium Grocery"})

    mock_engine = MockOCREngine(predefined_result=mock_ocr_page)
    custom_classifier = CustomClassifier()

    pipeline = InvoicePipeline(
        ocr_engine=mock_engine,
        grocery_classifier=custom_classifier,
    )

    result = pipeline.process(sample_png_bytes, "test_invoice.png")
    assert result.items[0].category == "Custom Premium Grocery"


def test_pipeline_error_propagation_on_unsupported_file():
    """Proves that validation errors safely transition invoice status to FAILED without crashing."""
    pipeline = InvoicePipeline()
    result = pipeline.process(b"some binary payload", "malware.exe")

    assert result.status == "FAILED"
    assert "Unsupported file extension" in (result.reason or "")
    assert len(result.items) == 0


# ==========================================================================
# PHASE 3: Document Input, Preprocessing, and Word-Level OCR Tests
# ==========================================================================

def test_bounding_box_aliases_and_properties():
    """Verifies that BoundingBox supports both x0/y0 and x_min/y_min aliases."""
    box = BoundingBox(x_min=10.0, y_min=20.0, x_max=110.0, y_max=60.0)
    assert box.x0 == 10.0
    assert box.y0 == 20.0
    assert box.x1 == 110.0
    assert box.y1 == 60.0
    assert box.x_min == 10.0
    assert box.y_min == 20.0
    assert box.x_max == 110.0
    assert box.y_max == 60.0
    assert box.width == 100.0
    assert box.height == 40.0
    assert box.center_x == 60.0
    assert box.center_y == 40.0

    d_minmax = box.to_dict(alias_format="minmax")
    assert d_minmax == {"x_min": 10.0, "y_min": 20.0, "x_max": 110.0, "y_max": 60.0}


def test_ocr_word_aliases_and_reading_order():
    """Verifies word-level coordinates, aliases, reading order, and normalized confidence."""
    word = OCRWord(
        text="BESAN",
        confidence=96.0,
        bounding_box={"x_min": 100.0, "y_min": 200.0, "x_max": 180.0, "y_max": 225.0},
        page_number=1,
        reading_order=15,
    )
    assert word.text == "BESAN"
    assert word.reading_order == 15
    assert word.word_index == 15
    assert word.page_number == 1
    assert word.bbox.x0 == 100.0
    assert word.bbox.y0 == 200.0
    assert word.bbox.x1 == 180.0
    assert word.bbox.y1 == 225.0
    assert word.confidence == 96.0
    assert word.confidence_normalized == 0.96

    # Test initialization with 0.0 - 1.0 confidence normalized to 0 - 100
    word2 = OCRWord(
        text="CHANA",
        bbox=BoundingBox(x0=0, y0=0, x1=10, y1=10),
        confidence=0.88,
    )
    assert word2.confidence == 88.0
    assert word2.confidence_normalized == 0.88


def test_ocr_page_and_document_aliases():
    """Verifies OCRPageResult and InvoiceOCRResult alias properties."""
    from services.grocery_ocr.schemas.ocr import InvoiceOCRResult

    word = OCRWord(text="SUGAR", bbox=BoundingBox(x0=10, y0=10, x1=50, y1=30), confidence=95.0)
    page = OCRPageResult(
        page_number=1,
        width=800,
        height=1200,
        raw_text="SUGAR 1KG",
        words=[word],
    )
    assert page.page_width == 800
    assert page.page_height == 1200
    assert page.extracted_text == "SUGAR 1KG"

    doc = InvoiceOCRResult(
        filename="test.png",
        pages=[page],
        total_pages=1,
        full_text="SUGAR 1KG",
        processing_time_ms=1500.0,
    )
    assert doc.processing_time == 1.5
    assert doc.filename == "test.png"
    assert doc.document_id.startswith("doc_")


def test_adaptive_image_processor_deskew_correction():
    """Verifies that the OpenCV preprocessor detects and corrects document skew."""
    import cv2
    import numpy as np
    from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor

    processor = AdaptiveImageProcessor()

    # Create a synthetic white image with horizontal lines and text rotated by 3 degrees
    img = np.ones((800, 1000, 3), dtype=np.uint8) * 255
    # Draw horizontal text-like lines
    for y in range(100, 700, 60):
        cv2.line(img, (100, y), (900, y), (0, 0, 0), thickness=2)
        cv2.putText(img, "Sri Balaji Kirana Store Line Items", (120, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)

    # Rotate by +3.0 degrees
    center = (500, 400)
    M = cv2.getRotationMatrix2D(center, 3.0, 1.0)
    rotated = cv2.warpAffine(img, M, (1000, 800), borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    _, enc = cv2.imencode(".png", rotated)
    skewed_bytes = enc.tobytes()

    deskewed_bytes, detected_angle = processor.deskew(skewed_bytes)
    assert abs(detected_angle) >= 0.5, f"Expected detected skew >= 0.5 deg, got {detected_angle}"
    assert deskewed_bytes.startswith(b"\x89PNG")


def test_adaptive_image_processor_clahe_contrast():
    """Verifies that low-contrast faded images trigger CLAHE enhancement."""
    import cv2
    import numpy as np
    from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor

    processor = AdaptiveImageProcessor()

    # Create a low-contrast washed-out image (std < 30)
    low_contrast = np.ones((500, 600, 3), dtype=np.uint8) * 220
    cv2.putText(low_contrast, "Faded Thermal Receipt", (50, 250), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (190, 190, 190), 2)
    _, enc = cv2.imencode(".png", low_contrast)
    faded_bytes = enc.tobytes()

    res = processor.preprocess(faded_bytes)
    assert res.metadata.get("is_low_contrast") is True
    assert "clahe_contrast_enhancement" in res.preprocessing_steps_applied


def test_adaptive_image_processor_debug_persistence(tmp_path):
    """Verifies that intermediate preprocessed images are saved when debug_dir is set."""
    from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor
    from services.grocery_ocr.config import GroceryOCRConfig

    config = GroceryOCRConfig(debug_dir=tmp_path)
    processor = AdaptiveImageProcessor(config=config)

    # Simple 400x400 PNG
    img = Image.new("RGB", (400, 400), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    res = processor.preprocess(raw_bytes)
    debug_paths = res.metadata.get("debug_image_paths", {})
    assert "01_original" in debug_paths
    assert "04_preprocessed" in debug_paths
    assert Path(debug_paths["04_preprocessed"]).exists()


def test_pdf_processor_extract_digital_text_stream():
    """Verifies that digital PDFs are parsed directly with 100% confidence and word bounding boxes."""
    from services.grocery_ocr.processors.pdf_processor import BasePDFProcessor

    tc01_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if not tc01_path.exists():
        pytest.skip("TC01-clean-digital.pdf fixture not found")

    content = tc01_path.read_bytes()
    processor = BasePDFProcessor()
    res = processor.process(content)

    assert res.is_digital is True
    assert res.page_count >= 1
    assert res.digital_document is not None
    assert res.digital_document.total_pages >= 1

    page1 = res.digital_document.pages[0]
    assert len(page1.words) >= 50
    assert page1.confidence == 100.0

    # Verify word coordinates and reading order
    for idx, w in enumerate(page1.words[:10]):
        assert w.bbox.width > 0
        assert w.bbox.height > 0
        assert w.reading_order == idx
        assert w.page_number == 1

    # Check that supplier header text was extracted
    words_text = [w.text for w in page1.words]
    assert "SRI" in words_text
    assert "BALAJI" in words_text


def test_pdf_processor_rasterizes_scanned_pdf_pages_at_300_dpi():
    """Verifies that scanned PDFs without digital text are rasterized at 300 DPI."""
    from services.grocery_ocr.processors.pdf_processor import BasePDFProcessor

    tc01_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if not tc01_path.exists():
        pytest.skip("TC01-clean-digital.pdf fixture not found")

    content = tc01_path.read_bytes()
    processor = BasePDFProcessor()

    # Force rasterization
    rasterized = processor.rasterize_pages(content, dpi=300)
    assert len(rasterized) >= 1
    assert rasterized[0].startswith(b"\x89PNG")

    with Image.open(io.BytesIO(rasterized[0])) as img:
        assert img.width > 1500
        assert img.height > 2000


def test_file_validator_rejects_corrupted_image():
    """Verifies that corrupted image bytes raise InvalidInvoiceError."""
    validator = BaseFileValidator()
    with pytest.raises(InvalidInvoiceError):
        validator.validate(b"\xff\xd8\xff\xe0CORRUPTED_TRUNCATED_JPEG_DATA", "damaged.jpg")


def test_file_validator_rejects_corrupted_pdf():
    """Verifies that truncated or invalid PDF header raises InvalidInvoiceError."""
    validator = BaseFileValidator()
    with pytest.raises(InvalidInvoiceError):
        validator.validate(b"NOT_A_VALID_PDF_STREAM", "damaged.pdf")


def test_tesseract_ocr_engine_real_sri_balaji_numeric_fidelity():
    """
    Evaluates real Tesseract OCR engine on the Sri Balaji invoice image.
    Verifies that critical financial numbers, decimals, and grocery units are recognized.
    """
    from services.grocery_ocr.engines.ocr_engine import TesseractOCREngine

    sri_balaji_path = Path("tests/fixtures/invoices/original_invoice_sri_balaji.png")
    if not sri_balaji_path.exists():
        pytest.skip("original_invoice_sri_balaji.png fixture not found")

    engine = TesseractOCREngine()
    if not engine.is_available():
        pytest.skip("Node.js OCR worker not available in this environment")

    img_bytes = sri_balaji_path.read_bytes()
    result = engine.recognize(img_bytes, page_number=1)

    assert result.page_number == 1
    assert result.width == 1389
    assert result.height == 1132
    assert len(result.words) > 200
    assert result.confidence > 75.0

    all_words = [w.text for w in result.words]

    # Verify critical Section 7 values
    critical_values = ["2760.00", "700.00", "1378.62", "4,015.80", "50", "KG", "500", "GM", "10", "PCS"]
    for val in critical_values:
        assert any(val in w for w in all_words), f"Critical value '{val}' was not recognized in OCR words"


def test_pipeline_digital_pdf_end_to_end():
    """Verifies that InvoicePipeline processes digital PDFs cleanly via digital extraction bypass."""
    tc01_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if not tc01_path.exists():
        pytest.skip("TC01-clean-digital.pdf fixture not found")

    content = tc01_path.read_bytes()
    pipeline = InvoicePipeline()
    result = pipeline.process(content, "TC01-clean-digital.pdf")

    assert result.status in ("SUCCESS", "NEEDS_REVIEW")
    assert result.original_filename == "TC01-clean-digital.pdf"
    assert result.metadata.ocr_evidence is not None
    assert result.metadata.ocr_evidence.total_pages >= 1
    assert "file_validation" in result.metadata.pipeline_stages_completed
    assert "page_preparation" in result.metadata.pipeline_stages_completed
    assert "ocr_recognition" in result.metadata.pipeline_stages_completed

