"""
OCR-based evidence and text-accuracy metrics.

Uses the EXISTING OCR engine (services.ocr / tesseract.js worker) strictly read-only, to
answer questions such as "does this page read better upright or upside down?" and "does the
enhanced variant read better than the corrected one?".  The OCR engine is not modified.

Also provides Character Error Rate (CER), Word Error Rate (WER) and critical-token recall
for measured comparisons against ground truth.
"""

from __future__ import annotations

import logging
import re
import shutil
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_PLAUSIBLE = re.compile(r"[A-Za-z0-9]")


@dataclass
class OcrReadout:
    text: str
    mean_confidence: float
    words: int
    confident_words: int
    confident_chars: int
    numeric_tokens: int
    score: float
    arithmetic_rows: int = 0
    psm: str = "3"
    details: Dict[str, float] = field(default_factory=dict)


def ocr_engine_available() -> bool:
    from services import ocr as ocr_service

    return shutil.which("node") is not None and ocr_service.WORKER_PATH.exists()


def _encode_png(img: np.ndarray) -> bytes:
    ok, enc = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    if not ok:
        raise ValueError("PNG encoding failed")
    return enc.tobytes()


_NUM = re.compile(r"(?<![\w.])\d{1,7}(?:,\d{2,3})*(?:\.\d{1,3})?(?![\w])")

# Weight of one arithmetically consistent table row in the readability score. A row whose
# quantity x rate = amount survives OCR intact is worth far more to invoice extraction than a
# few extra confident words, and it penalises layouts where OCR split the table into columns.
ARITHMETIC_ROW_WEIGHT = 30.0


def count_arithmetic_rows(text: str) -> int:
    """Lines containing three numbers with a x b = c (within 1%): intact invoice table rows."""
    rows = 0
    for line in (text or "").splitlines():
        nums = []
        for tok in _NUM.findall(line):
            try:
                nums.append(float(tok.replace(",", "")))
            except ValueError:
                continue
        if len(nums) < 3 or len(nums) > 14:
            continue
        found = False
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                prod = nums[i] * nums[j]
                if prod < 1:
                    continue
                for k in range(len(nums)):
                    if k in (i, j):
                        continue
                    if abs(prod - nums[k]) <= max(0.02, 0.01 * nums[k]):
                        found = True
                        break
                if found:
                    break
            if found:
                break
        rows += int(found)
    return rows


def summarize_ocr(result: Dict) -> OcrReadout:
    words = result.get("words") or []
    confident_words = 0
    confident_chars = 0
    numeric = 0
    weighted = 0.0
    confs: List[float] = []
    for w in words:
        text = str(w.get("text") or "").strip()
        conf = w.get("confidence")
        conf = float(conf) if conf is not None else 0.0
        confs.append(conf)
        alnum = len(_PLAUSIBLE.findall(text))
        if alnum < 2 or alnum / max(1, len(text)) < 0.6:
            continue
        if conf >= 60.0:
            confident_words += 1
            confident_chars += alnum
            weighted += alnum * (conf / 100.0) ** 2
            if re.fullmatch(r"[\d.,/-]*\d[\d.,/-]*", text):
                numeric += 1
    text = str(result.get("text") or "")
    arith = count_arithmetic_rows(text)
    return OcrReadout(
        text=text,
        mean_confidence=float(np.mean(confs)) if confs else 0.0,
        words=len(words),
        confident_words=confident_words,
        confident_chars=confident_chars,
        numeric_tokens=numeric,
        score=round(weighted + ARITHMETIC_ROW_WEIGHT * arith, 3),
        psm=str(result.get("psm") or "3"),
        arithmetic_rows=arith,
    )


def run_raw_ocr(img: np.ndarray, psm: str = "3") -> OcrReadout:
    """OCR an image exactly as given (no existing-pipeline preprocessing)."""
    from services.ocr import run_ocr_on_preprocessed_png

    return summarize_ocr(run_ocr_on_preprocessed_png(_encode_png(img), psm_mode=psm))


def run_pipeline_ocr(img: np.ndarray, psm: str = "3") -> OcrReadout:
    """OCR an image the way the existing invoice pipeline does: its own AdaptiveImageProcessor,
    then the tesseract.js worker. This is what the prepared document will actually go through."""
    from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor
    from services.ocr import run_ocr_on_preprocessed_png

    prepared = AdaptiveImageProcessor().preprocess(_encode_png(img)).processed_bytes
    return summarize_ocr(run_ocr_on_preprocessed_png(prepared, psm_mode=psm))


def run_pipeline_ocr_best_contrast(img: np.ndarray, psm: str = "3") -> OcrReadout:
    """The better of the two contrast treatments the invoice pipeline can read a page with.

    The pipeline reads the processor's automatic treatment first and the other one when the first gives
    weak extraction evidence (InvoicePipeline._read_page_adaptive), so a prepared version is scored by
    its better reading. Measured on the document-preparation photo set: scoring by the automatic
    treatment alone preferred a binarized page that reads characters worse (11_low_resolution: 4/7 lines
    instead of 7/7 with the enhanced page); scoring by the better treatment selected versions that
    extract 98/103 lines instead of 95/103. Costs one extra reading per compared version."""
    from services.grocery_ocr.processors.image_processor import AdaptiveImageProcessor
    from services.ocr import run_ocr_on_preprocessed_png

    png = _encode_png(img)
    first = AdaptiveImageProcessor().preprocess(png)
    other = "stretch" if (first.metadata or {}).get("contrast_treatment") == "clahe" else "clahe"
    readouts = [summarize_ocr(run_ocr_on_preprocessed_png(prep.processed_bytes, psm_mode=psm))
                for prep in (first, AdaptiveImageProcessor().preprocess(png, contrast=other))]
    return max(readouts, key=lambda r: r.score)


OcrFunction = Callable[[np.ndarray], OcrReadout]


# --------------------------------------------------------------------------
# Accuracy metrics against ground truth
# --------------------------------------------------------------------------


def normalize_text(text: str) -> str:
    text = text.replace("—", "-").replace("–", "-").replace("|", " ")
    return re.sub(r"\s+", " ", text).strip()


def _levenshtein(a: Sequence, b: Sequence) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def character_error_rate(reference: str, hypothesis: str) -> float:
    ref = normalize_text(reference)
    hyp = normalize_text(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return _levenshtein(ref, hyp) / float(len(ref))


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref = normalize_text(reference).split()
    hyp = normalize_text(hypothesis).split()
    if not ref:
        return 0.0 if not hyp else 1.0
    return _levenshtein(ref, hyp) / float(len(ref))


def bag_of_words_recall(reference: str, hypothesis: str) -> float:
    """Fraction of reference words found in the OCR output, order-independent.

    Table OCR may legitimately emit cells in a different reading order; this metric
    measures text completeness without penalising order.
    """
    from collections import Counter

    ref = Counter(normalize_text(reference).split())
    hyp = Counter(normalize_text(hypothesis).split())
    total = sum(ref.values())
    if not total:
        return 1.0
    return sum(min(c, hyp.get(w, 0)) for w, c in ref.items()) / float(total)


def critical_token_recall(tokens: Sequence[str], hypothesis: str) -> float:
    """Fraction of critical tokens (decimals, HSN codes, leading-zero numbers) read exactly."""
    if not tokens:
        return 1.0
    hyp_tokens = normalize_text(hypothesis).replace(",", " , ").split()
    hyp_set = set(normalize_text(hypothesis).split()) | set(hyp_tokens)
    found = 0
    for t in tokens:
        if t in hyp_set or re.search(r"(?<![\d.])" + re.escape(t) + r"(?![\d])", hypothesis):
            found += 1
    return found / float(len(tokens))
