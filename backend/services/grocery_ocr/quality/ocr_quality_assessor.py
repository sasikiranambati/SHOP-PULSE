"""
ShopPulse Grocery Invoice Scanner - OCR Quality Assessment Layer.

Evaluates OCR output confidence, word reliability, image resolution, contrast,
blurriness, and text density before passing data to downstream extraction engines.
"""

from enum import Enum
from typing import Any, Dict, List, Optional
import numpy as np
import cv2
from pydantic import BaseModel, Field

from services.grocery_ocr.schemas.ocr import OCRDocumentResult, OCRPageResult


class QualityGrade(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNREADABLE = "UNREADABLE"


class OCRQualityReport(BaseModel):
    """Structured quality assessment report for an OCR extraction."""
    quality_grade: str = Field(..., description="HIGH, MEDIUM, LOW, or UNREADABLE")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Normalized document confidence [0.0, 1.0]")
    is_readable: bool = Field(..., description="Whether document text is sufficiently readable for extraction")
    warnings: List[str] = Field(default_factory=list, description="Quality diagnostics and warning messages")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Numerical quality metrics")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "quality_grade": self.quality_grade,
            "confidence_score": round(self.confidence_score, 4),
            "is_readable": self.is_readable,
            "warnings": self.warnings,
            "metrics": self.metrics,
        }


class OCRQualityAssessor:
    """
    Automated pre-extraction quality assessment engine.
    Computes quality grades and diagnostic metrics across physical image features
    and OCR token confidence distributions.
    """

    def __init__(
        self,
        min_acceptable_confidence: float = 0.60,
        high_confidence_threshold: float = 0.85,
        max_low_conf_ratio_high: float = 0.12,
        max_low_conf_ratio_med: float = 0.35,
        min_blur_threshold: float = 80.0,
        unreadable_blur_threshold: float = 35.0,
    ):
        self.min_acceptable_confidence = min_acceptable_confidence
        self.high_confidence_threshold = high_confidence_threshold
        self.max_low_conf_ratio_high = max_low_conf_ratio_high
        self.max_low_conf_ratio_med = max_low_conf_ratio_med
        self.min_blur_threshold = min_blur_threshold
        self.unreadable_blur_threshold = unreadable_blur_threshold

    def assess(
        self,
        page_result: OCRPageResult,
        preprocess_metadata: Optional[Dict[str, Any]] = None,
        image_bytes: Optional[bytes] = None,
        skew_angle: float = 0.0,
    ) -> OCRQualityReport:
        """
        Assesses a single OCR page result.
        """
        meta = preprocess_metadata or {}
        words = page_result.words
        total_words = len(words)
        warnings: List[str] = []

        # 1. Physical image metrics from preprocessing metadata or image bytes
        blurriness = float(meta.get("laplacian_variance", 200.0))
        contrast = float(meta.get("std_luminance", 50.0))
        skew = float(meta.get("skew_angle_degrees", skew_angle))

        if image_bytes and "laplacian_variance" not in meta:
            try:
                nparr = np.frombuffer(image_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    blurriness = float(cv2.Laplacian(img, cv2.CV_64F).var())
                    _, std_val = cv2.meanStdDev(img)
                    contrast = float(std_val[0][0])
            except Exception:
                pass

        # Resolution check
        w, h = page_result.width, page_result.height
        resolution_adequate = min(w, h) >= 400
        if not resolution_adequate:
            warnings.append(f"Image resolution ({w}x{h}) is below recommended OCR threshold (min 400px)")

        # 2. Token confidence analysis
        if total_words == 0:
            return OCRQualityReport(
                quality_grade=QualityGrade.UNREADABLE.value,
                confidence_score=0.0,
                is_readable=False,
                warnings=["No readable text tokens detected in the document."],
                metrics={
                    "skew_angle": round(skew, 2),
                    "blurriness": round(blurriness, 2),
                    "contrast": round(contrast, 2),
                    "total_words": 0,
                    "low_confidence_ratio": 1.0,
                    "line_count": 0,
                    "resolution_adequate": resolution_adequate,
                },
            )

        # Word confidence normalized to [0.0, 1.0]
        conf_values = [w.confidence_normalized for w in words]
        avg_conf = float(np.mean(conf_values))
        low_conf_words = [w for w in words if w.confidence_normalized < 0.70]
        low_conf_ratio = len(low_conf_words) / total_words

        if blurriness < self.unreadable_blur_threshold:
            warnings.append(f"Severe image blur detected (sharpness: {blurriness:.1f})")
        elif blurriness < self.min_blur_threshold:
            warnings.append(f"Moderate image blur detected (sharpness: {blurriness:.1f})")

        if contrast < 25.0:
            warnings.append(f"Low image contrast detected (spread: {contrast:.1f})")

        if abs(skew) >= 3.0:
            warnings.append(f"Document skew detected ({skew:+.1f} degrees)")

        if low_conf_ratio > self.max_low_conf_ratio_med:
            warnings.append(f"High proportion of low-confidence tokens ({low_conf_ratio * 100:.1f}%)")

        if avg_conf < self.min_acceptable_confidence:
            warnings.append(f"Average OCR confidence ({avg_conf * 100:.1f}%) is below recommended threshold")

        # 3. Quality grade determination
        if blurriness < self.unreadable_blur_threshold or avg_conf < 0.40 or (total_words < 5 and not page_result.raw_text.strip()):
            grade = QualityGrade.UNREADABLE.value
            is_readable = False
        elif (
            avg_conf >= self.high_confidence_threshold
            and low_conf_ratio <= self.max_low_conf_ratio_high
            and blurriness >= self.min_blur_threshold
            and abs(skew) < 3.0
        ):
            grade = QualityGrade.HIGH.value
            is_readable = True
        elif avg_conf >= self.min_acceptable_confidence and low_conf_ratio <= self.max_low_conf_ratio_med:
            grade = QualityGrade.MEDIUM.value
            is_readable = True
        else:
            grade = QualityGrade.LOW.value
            is_readable = True

        return OCRQualityReport(
            quality_grade=grade,
            confidence_score=round(avg_conf, 4),
            is_readable=is_readable,
            warnings=warnings,
            metrics={
                "skew_angle": round(skew, 2),
                "blurriness": round(blurriness, 2),
                "contrast": round(contrast, 2),
                "total_words": total_words,
                "low_confidence_ratio": round(low_conf_ratio, 4),
                "line_count": len(page_result.lines),
                "resolution_adequate": resolution_adequate,
            },
        )

    def assess_document(self, doc_result: OCRDocumentResult) -> OCRQualityReport:
        """Aggregates quality assessment across all document pages."""
        if not doc_result.pages:
            return OCRQualityReport(
                quality_grade=QualityGrade.UNREADABLE.value,
                confidence_score=0.0,
                is_readable=False,
                warnings=["Document contains zero pages."],
                metrics={"total_words": 0, "low_confidence_ratio": 1.0, "line_count": 0},
            )

        reports = [self.assess(p, preprocess_metadata=doc_result.preprocessing_metadata) for p in doc_result.pages]
        grades = [r.quality_grade for r in reports]

        if any(g == QualityGrade.UNREADABLE.value for g in grades) and all(g == QualityGrade.UNREADABLE.value for g in grades):
            overall_grade = QualityGrade.UNREADABLE.value
            is_readable = False
        elif any(g == QualityGrade.LOW.value for g in grades):
            overall_grade = QualityGrade.LOW.value
            is_readable = True
        elif any(g == QualityGrade.MEDIUM.value for g in grades):
            overall_grade = QualityGrade.MEDIUM.value
            is_readable = True
        else:
            overall_grade = QualityGrade.HIGH.value
            is_readable = True

        all_warnings: List[str] = []
        for r in reports:
            for w in r.warnings:
                if w not in all_warnings:
                    all_warnings.append(w)

        avg_conf = float(np.mean([r.confidence_score for r in reports]))
        total_words = sum(r.metrics.get("total_words", 0) for r in reports)
        total_lines = sum(r.metrics.get("line_count", 0) for r in reports)
        avg_skew = float(np.mean([r.metrics.get("skew_angle", 0.0) for r in reports]))
        avg_blur = float(np.mean([r.metrics.get("blurriness", 200.0) for r in reports]))
        avg_contrast = float(np.mean([r.metrics.get("contrast", 50.0) for r in reports]))
        avg_low_conf = float(np.mean([r.metrics.get("low_confidence_ratio", 0.0) for r in reports]))

        return OCRQualityReport(
            quality_grade=overall_grade,
            confidence_score=round(avg_conf, 4),
            is_readable=is_readable,
            warnings=all_warnings,
            metrics={
                "skew_angle": round(avg_skew, 2),
                "blurriness": round(avg_blur, 2),
                "contrast": round(avg_contrast, 2),
                "total_words": total_words,
                "low_confidence_ratio": round(avg_low_conf, 4),
                "line_count": total_lines,
                "total_pages": len(reports),
            },
        )
