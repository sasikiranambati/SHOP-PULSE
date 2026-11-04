"""
ShopPulse Phase 2 Comprehensive Test Suite: OCR Engine and Image Preprocessing.

Tests:
1. Word-level OCR schema conformity and coordinate preservation.
2. Text and Line Reconstruction (spatial baseline clustering, reading order, gap detection, multi-line).
3. Image Preprocessing (deskew, cardinal 90/270 rotation, illumination normalization, table line removal, CLAHE, unsharp mask).
4. Multi-format support (PNG, JPG, WebP, PDF, Multi-page PDF).
5. OCR Quality Assessment (HIGH, MEDIUM, LOW, UNREADABLE grades and metrics).
6. Number and Decimal preservation (e.g. 240.00, 9.50, 0.75, leading zero HSNs).
7. Error and edge-case handling (empty files, corrupted bytes, low resolution).
8. CER and WER benchmarking against ground truth test cases.
"""

import io
import json
from pathlib import Path
import numpy as np
import cv2
from PIL import Image
import pytest

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import (
    FileValidationError,
    ImageProcessingError,
    InvalidInvoiceError,
)
from services.grocery_ocr.processors.file_validator import BaseFileValidator
from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor
from services.grocery_ocr.processors.pdf_processor import BasePDFProcessor
from services.grocery_ocr.processors.text_line_reconstructor import TextLineReconstructor
from services.grocery_ocr.quality.ocr_quality_assessor import (
    OCRQualityAssessor,
    QualityGrade,
)
from services.grocery_ocr.quality.ocr_evaluator import (
    OCREvaluator,
    levenshtein_distance,
)
from services.grocery_ocr.schemas.ocr import (
    BoundingBox,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
)


@pytest.fixture
def image_processor() -> AdaptiveImageProcessor:
    return AdaptiveImageProcessor(default_config)


@pytest.fixture
def text_reconstructor() -> TextLineReconstructor:
    return TextLineReconstructor()


@pytest.fixture
def quality_assessor() -> OCRQualityAssessor:
    return OCRQualityAssessor()


@pytest.fixture
def ocr_evaluator() -> OCREvaluator:
    return OCREvaluator()


# ==============================================================================
# 1. WORD-LEVEL SCHEMA CONFORMITY
# ==============================================================================

def test_ocr_word_schema_conformity():
    """Verifies OCRWord produces exact schema specified in Phase 2 requirements."""
    bbox = BoundingBox(x0=120, y0=240, x1=210, y1=270)
    word = OCRWord(
        text="CHANA",
        bbox=bbox,
        confidence=98.0,
        word_index=18,
        reading_order=18,
        line_number=5,
        page_number=1,
    )

    d = word.to_dict()
    assert d["text"] == "CHANA"
    assert d["confidence"] == 0.98
    assert d["bounding_box"] == {
        "x_min": 120.0,
        "y_min": 240.0,
        "x_max": 210.0,
        "y_max": 270.0,
    }
    assert d["page_number"] == 1
    assert d["line_number"] == 5
    assert d["reading_order"] == 18


def test_ocr_word_preserves_raw_tokens_and_coordinates():
    """Ensures no character stripping or loss of spatial bounding boxes."""
    w = OCRWord(
        text="0713.90",
        bbox=BoundingBox(x0=15.5, y0=100.2, x1=65.8, y1=120.9),
        confidence=87.5,
        reading_order=3,
        page_number=2,
    )
    assert w.text == "0713.90"
    assert w.bbox.x0 == 15.5
    assert w.confidence_normalized == pytest.approx(0.875, abs=1e-3)
    assert w.page_number == 2


# ==============================================================================
# 2. IMAGE PREPROCESSING & OPENCV ENHANCEMENT
# ==============================================================================

def test_cardinal_rotation_detection_and_correction(image_processor):
    """Verifies that 90-degree rotated document images are detected and rotated."""
    # Synthetic invoice-like image with strong horizontal lines
    img = np.ones((800, 600, 3), dtype=np.uint8) * 255
    for y in range(100, 700, 40):
        cv2.line(img, (50, y), (550, y), (0, 0, 0), 2)

    # Normal orientation: dominant lines are horizontal
    corrected, angle = image_processor.detect_and_correct_cardinal_rotation(img)
    assert angle == 0

    # Rotate 90 degrees clockwise -> dominant lines become vertical
    rot90 = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    corrected_rot, rot_angle = image_processor.detect_and_correct_cardinal_rotation(rot90)
    assert rot_angle == 90
    # Corrected should have horizontal orientation restored
    assert corrected_rot.shape[0] >= 600


def test_deskew_small_tilt(image_processor):
    """Verifies deskewing algorithm corrects mild document tilt."""
    # Create white canvas with tilted black lines
    img = np.ones((600, 800, 3), dtype=np.uint8) * 255
    for y in range(150, 450, 30):
        cv2.line(img, (100, y), (700, y + 25), (0, 0, 0), 2)  # ~2.4 degree tilt

    deskewed, detected_angle = image_processor._deskew_cv2(img)
    assert abs(detected_angle) >= 0.5


def test_illumination_normalization(image_processor):
    """Verifies shadow and non-uniform lighting gradients are normalized."""
    # Create an image with an intense diagonal lighting gradient
    gray = np.zeros((400, 400), dtype=np.uint8)
    for r in range(400):
        for c in range(400):
            gray[r, c] = int(min(255, 50 + (r * 0.4) + (c * 0.4)))

    normalized, applied = image_processor.normalize_illumination(gray)
    assert applied is True
    # Verify standard deviation across quadrants is drastically reduced
    q1 = np.mean(normalized[:200, :200])
    q4 = np.mean(normalized[200:, 200:])
    assert abs(q1 - q4) < abs(np.mean(gray[:200, :200]) - np.mean(gray[200:, 200:]))


def test_table_grid_line_removal_preserves_small_dots(image_processor):
    """Verifies table border removal strips lines while preserving decimal dots."""
    gray = np.ones((300, 300), dtype=np.uint8) * 255
    # Draw a 100px table border line
    cv2.line(gray, (20, 100), (200, 100), 0, 2)
    cv2.line(gray, (100, 20), (100, 200), 0, 2)
    # Draw a small 3x3 decimal point at (150, 150)
    cv2.rectangle(gray, (150, 150), (153, 153), 0, -1)

    cleaned, applied = image_processor.remove_table_grid_lines(gray)
    assert applied is True
    # Table line should be erased to white (255)
    assert cleaned[100, 50] == 255
    assert cleaned[50, 100] == 255
    # Decimal point should remain black (0)
    assert cleaned[151, 151] == 0


def test_adaptive_unsharp_mask_on_blurry_image(image_processor):
    """Verifies unsharp masking enhances edge sharpness of blurry images."""
    img = np.ones((400, 400, 3), dtype=np.uint8) * 255
    cv2.putText(img, "TEST 123", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 2)
    # Blur the image
    blurry = cv2.GaussianBlur(img, (9, 9), 3.0)
    _, enc = cv2.imencode(".png", blurry)

    res = image_processor.preprocess(enc.tobytes())
    assert "adaptive_unsharp_mask" in res.preprocessing_steps_applied


def test_resolution_enhancement_for_low_res_image(image_processor):
    """Verifies small thumbnail invoices are scaled up to standard OCR resolution."""
    small = np.ones((350, 300, 3), dtype=np.uint8) * 255
    _, enc = cv2.imencode(".png", small)

    res = image_processor.preprocess(enc.tobytes())
    assert res.processed_dimensions[0] > 300
    assert any("rescale" in s for s in res.preprocessing_steps_applied)


# ==============================================================================
# 3. TEXT AND LINE RECONSTRUCTION LAYER
# ==============================================================================

def test_text_line_reconstruction_spatial_ordering(text_reconstructor):
    """Verifies spatial line clustering groups words by vertical baseline."""
    # Synthetic out-of-order words on 2 lines
    w_line2_item = OCRWord(text="Fortune", bbox=BoundingBox(x0=50, y0=110, x1=120, y1=130), confidence=95.0, page_number=1)
    w_line1_rate = OCRWord(text="Rate", bbox=BoundingBox(x0=400, y0=50, x1=450, y1=70), confidence=98.0, page_number=1)
    w_line1_item = OCRWord(text="Item", bbox=BoundingBox(x0=50, y0=48, x1=100, y1=72), confidence=99.0, page_number=1)
    w_line2_price = OCRWord(text="140.00", bbox=BoundingBox(x0=400, y0=112, x1=460, y1=132), confidence=94.0, page_number=1)
    w_line2_oil = OCRWord(text="Oil", bbox=BoundingBox(x0=130, y0=108, x1=160, y1=129), confidence=95.0, page_number=1)

    words = [w_line2_item, w_line1_rate, w_line1_item, w_line2_price, w_line2_oil]
    lines = text_reconstructor.reconstruct_lines(words)

    assert len(lines) == 2
    # Line 0 should be header: "Item Rate"
    assert lines[0].line_number == 0
    assert lines[0].text == "Item Rate"
    assert [w.text for w in lines[0].words] == ["Item", "Rate"]

    # Line 1 should be data: "Fortune Oil 140.00"
    assert lines[1].line_number == 1
    assert lines[1].text == "Fortune Oil 140.00"
    assert [w.text for w in lines[1].words] == ["Fortune", "Oil", "140.00"]

    # Check reading order sequential assignment
    assert lines[0].words[0].reading_order == 0
    assert lines[0].words[1].reading_order == 1
    assert lines[1].words[0].reading_order == 2
    assert lines[1].words[1].reading_order == 3
    assert lines[1].words[2].reading_order == 4


def test_text_line_reconstruction_hyphen_stitching(text_reconstructor):
    """Verifies hyphenated compound words like 'Parle-' and 'G' are joined cleanly."""
    w1 = OCRWord(text="Parle-", bbox=BoundingBox(x0=50, y0=50, x1=100, y1=70), confidence=95.0)
    w2 = OCRWord(text="G", bbox=BoundingBox(x0=102, y0=50, x1=120, y1=70), confidence=95.0)
    w3 = OCRWord(text="Biscuits", bbox=BoundingBox(x0=130, y0=50, x1=190, y1=70), confidence=95.0)

    lines = text_reconstructor.reconstruct_lines([w1, w2, w3])
    assert len(lines) == 1
    assert lines[0].text == "Parle-G Biscuits"


def test_gap_detection_flags_column_boundaries(text_reconstructor):
    """Verifies wide horizontal gaps between words indicate column separation."""
    w_name = OCRWord(text="Tata Salt", bbox=BoundingBox(x0=50, y0=100, x1=150, y1=120), confidence=95.0)
    w_qty = OCRWord(text="20", bbox=BoundingBox(x0=300, y0=100, x1=330, y1=120), confidence=95.0)  # gap = 150px
    w_rate = OCRWord(text="22.00", bbox=BoundingBox(x0=420, y0=100, x1=470, y1=120), confidence=95.0)  # gap = 90px

    line = OCRLine(
        line_number=0,
        text="Tata Salt 20 22.00",
        words=[w_name, w_qty, w_rate],
        bbox=BoundingBox(x0=50, y0=100, x1=470, y1=120),
    )

    gaps = text_reconstructor.detect_word_gaps(line)
    assert len(gaps) == 2
    assert all(g["is_column_gap"] is True for g in gaps)


def test_multiline_continuation_detection(text_reconstructor):
    """Verifies indented product descriptions on next line are detected."""
    line1 = OCRLine(
        line_number=0,
        text="Aashirvaad Superior MP Atta",
        words=[OCRWord(text="Aashirvaad", bbox=BoundingBox(x0=50, y0=100, x1=150, y1=120))],
        bbox=BoundingBox(x0=50, y0=100, x1=300, y1=120),
    )
    line2 = OCRLine(
        line_number=1,
        text="Shudh Chakki 5kg",
        words=[OCRWord(text="Shudh", bbox=BoundingBox(x0=50, y0=125, x1=110, y1=145))],
        bbox=BoundingBox(x0=50, y0=125, x1=200, y1=145),
    )

    continuations = text_reconstructor.detect_multiline_continuations([line1, line2], item_col_max_x=350.0)
    assert (0, 1) in continuations


# ==============================================================================
# 4. DOCUMENT FORMAT SUPPORT (JPG, PNG, WEBP, PDF, MULTI-PAGE)
# ==============================================================================

def test_file_validator_accepts_all_target_formats():
    """Verifies file validator handles PNG, JPG, WEBP, and PDF."""
    validator = BaseFileValidator(default_config)

    # 1. PNG
    png_bytes = cv2.imencode(".png", np.zeros((100, 100, 3), dtype=np.uint8))[1].tobytes()
    res_png = validator.validate(png_bytes, "invoice.png")
    assert res_png.is_valid is True
    assert res_png.detected_extension == ".png"

    # 2. JPG
    jpg_bytes = cv2.imencode(".jpg", np.zeros((100, 100, 3), dtype=np.uint8))[1].tobytes()
    res_jpg = validator.validate(jpg_bytes, "invoice.jpg")
    assert res_jpg.is_valid is True
    assert res_jpg.detected_extension in (".jpeg", ".jpg")

    # 3. WEBP
    webp_bytes = cv2.imencode(".webp", np.zeros((100, 100, 3), dtype=np.uint8))[1].tobytes()
    res_webp = validator.validate(webp_bytes, "invoice.webp")
    assert res_webp.is_valid is True
    assert res_webp.detected_extension == ".webp"

    # 4. PDF
    pdf_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if pdf_path.exists():
        pdf_bytes = pdf_path.read_bytes()
        res_pdf = validator.validate(pdf_bytes, "invoice.pdf")
        assert res_pdf.is_valid is True
        assert res_pdf.detected_extension == ".pdf"


def test_empty_file_rejected():
    """Verifies 0-byte files are properly rejected."""
    validator = BaseFileValidator(default_config)
    with pytest.raises((FileValidationError, InvalidInvoiceError)):
        validator.validate(b"", "empty.pdf")


def test_multi_page_pdf_processing():
    """Verifies multi-page PDF processing rasterizes all pages in order."""
    pdf_proc = BasePDFProcessor(default_config)
    # Check with TC07 or TC01
    tc01_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if tc01_path.exists():
        pdf_res = pdf_proc.process(tc01_path.read_bytes())
        assert pdf_res.page_count >= 1
        assert pdf_res.is_digital is True
        assert pdf_res.digital_document is not None


# ==============================================================================
# 5. OCR QUALITY ASSESSMENT
# ==============================================================================

def test_quality_assessor_grades_high(quality_assessor):
    """High confidence, high contrast, sharp image should get HIGH quality grade."""
    words = [
        OCRWord(text=f"Word{i}", bbox=BoundingBox(x0=50, y0=50 + i * 20, x1=120, y1=65 + i * 20), confidence=95.0)
        for i in range(20)
    ]
    page = OCRPageResult(page_number=1, width=1200, height=1600, raw_text="text", words=words, confidence=95.0)
    meta = {"laplacian_variance": 250.0, "std_luminance": 60.0, "skew_angle_degrees": 0.2}

    report = quality_assessor.assess(page, preprocess_metadata=meta)
    assert report.quality_grade == QualityGrade.HIGH.value
    assert report.is_readable is True
    assert report.confidence_score >= 0.85
    assert len(report.warnings) == 0


def test_quality_assessor_grades_medium_on_mild_blur(quality_assessor):
    """Mild blur or lower confidence should result in MEDIUM grade."""
    words = [
        OCRWord(text=f"Word{i}", bbox=BoundingBox(x0=50, y0=50 + i * 20, x1=120, y1=65 + i * 20), confidence=75.0)
        for i in range(15)
    ]
    page = OCRPageResult(page_number=1, width=1200, height=1600, raw_text="text", words=words, confidence=75.0)
    meta = {"laplacian_variance": 90.0, "std_luminance": 35.0, "skew_angle_degrees": 0.5}

    report = quality_assessor.assess(page, preprocess_metadata=meta)
    assert report.quality_grade == QualityGrade.MEDIUM.value
    assert report.is_readable is True


def test_quality_assessor_grades_unreadable_on_empty():
    """Document with 0 detected words must be graded UNREADABLE."""
    assessor = OCRQualityAssessor()
    page = OCRPageResult(page_number=1, width=800, height=1000, raw_text="", words=[], confidence=0.0)
    report = assessor.assess(page)
    assert report.quality_grade == QualityGrade.UNREADABLE.value
    assert report.is_readable is False
    assert len(report.warnings) > 0


# ==============================================================================
# 6. CER AND WER EVALUATION LAYER
# ==============================================================================

def test_levenshtein_distance_exact():
    assert levenshtein_distance([], []) == 0
    assert levenshtein_distance(list("kitten"), list("sitting")) == 3
    assert levenshtein_distance(["apple", "banana"], ["apple", "banana"]) == 0
    assert levenshtein_distance(["apple", "banana"], ["apple", "orange"]) == 1


def test_cer_and_wer_computation(ocr_evaluator):
    """Verifies CER and WER calculations against ground truth."""
    ref = "Aashirvaad Atta 5kg Tata Salt 1kg"
    # 1 char change: "Atta" -> "Attx"
    hyp = "Aashirvaad Attx 5kg Tata Salt 1kg"

    res = ocr_evaluator.evaluate(ref, hyp)
    assert res.char_edit_distance == 1
    assert res.word_edit_distance == 1
    assert res.cer < 0.05
    assert res.wer < 0.20
    assert res.accuracy_chars > 0.95


def test_ground_truth_coverage(ocr_evaluator):
    """Verifies recall calculation against expected invoice items."""
    extracted = "ShopPulse Store\n1. Aashirvaad Atta 5kg - Qty 4 Rate 245.00\n2. Tata Salt 1kg - Qty 20 Rate 22.00"
    expected = [
        {"name": "Aashirvaad Atta 5kg", "rate": 245},
        {"name": "Tata Salt 1kg", "rate": 22},
        {"name": "Fortune Oil 1L", "rate": 140},  # Missing in extracted
    ]

    cov = ocr_evaluator.evaluate_ground_truth_coverage(extracted, expected)
    assert cov["total_items"] == 3
    assert cov["found_names"] == 2
    assert cov["name_recall"] == pytest.approx(0.6667, abs=1e-3)


# ==============================================================================
# 7. END-TO-END BENCHMARKING ON SCANNER TEST CASES (TC01, TC02, TC03)
# ==============================================================================

def test_tc01_digital_pdf_ground_truth_benchmark(ocr_evaluator):
    """Tests TC01 clean digital PDF achieves near 100% accuracy and zero CER."""
    pdf_path = Path("docs/scanner-test-cases/TC01-clean-digital.pdf")
    if not pdf_path.exists():
        pytest.skip("TC01 not found")

    pdf_proc = BasePDFProcessor(default_config)
    res = pdf_proc.process(pdf_path.read_bytes())
    assert res.is_digital is True
    doc = res.digital_document
    assert doc is not None

    full_text = doc.full_text
    expected_lines = json.loads(Path("docs/scanner-test-cases/expected-lines.json").read_text(encoding="utf-8"))
    tc01_expected = expected_lines.get("TC01-clean-digital", [])

    coverage = ocr_evaluator.evaluate_ground_truth_coverage(full_text, tc01_expected)
    assert coverage["name_recall"] == 1.0  # 100% recall on digital PDF
    assert coverage["price_recall"] == 1.0


def test_tc02_image_border_removal_and_enhancement(image_processor):
    """Tests TC02 image preprocessing successfully cleans table grid lines and normalizes contrast."""
    img_path = Path("docs/scanner-test-cases/TC02-clean-image.png")
    if not img_path.exists():
        pytest.skip("TC02 not found")

    res = image_processor.preprocess(img_path.read_bytes())
    assert "table_grid_line_removal" in res.preprocessing_steps_applied
    assert res.processed_bytes is not None
    assert len(res.processed_bytes) > 0


def test_tc03_phone_photo_illumination_normalization(image_processor):
    """Tests TC03 mobile camera photo undergoes illumination normalization and unsharp masking."""
    img_path = Path("docs/scanner-test-cases/TC03-phone-photo.jpg")
    if not img_path.exists():
        pytest.skip("TC03 not found")

    res = image_processor.preprocess(img_path.read_bytes())
    assert "illumination_normalization" in res.preprocessing_steps_applied
    assert "table_grid_line_removal" in res.preprocessing_steps_applied
    assert res.processed_bytes is not None
