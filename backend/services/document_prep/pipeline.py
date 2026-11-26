"""
Document preparation pipeline: photo in, OCR-ready page variants + full metadata out.

    ORIGINAL BYTES (kept untouched by the caller)
      -> EXIF orientation normalisation (exactly once)
      -> document boundary detection -> perspective correction (only when validated)
      -> orientation detection (0/90/180/270) -> deskew (expanded canvas, nothing clipped)
      -> geometry verification (residual skew, text preserved) - reverted if it fails
      -> quality analysis -> adaptive enhancement -> enhancement verification
      -> variant comparison with the existing OCR engine (difficult pages only)
      -> recommended variant + metadata for every transformation

Boundary detection runs before orientation detection: a page rectified out of its background
gives cleaner text-line evidence, and 90-degree turns commute with the perspective warp.

The OCR engine itself is never modified; it is only *called* to gather evidence.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import cv2
import numpy as np

from services.document_prep import analysis as an
from services.document_prep.config import DocumentPrepConfig, default_config
from services.document_prep.document_detector import DocumentDetection, detect_document, warp_document
from services.document_prep.enhancement import (binarize, enhancement_is_safe, native_denoise_for_dark_photo,
                                                plan_and_enhance)
from services.document_prep.loader import EXIF_ORIENTATION_NAMES, load_image
from services.document_prep.ocr_scoring import (
    OcrReadout, ocr_engine_available, run_pipeline_ocr_best_contrast, run_raw_ocr,
)
from services.document_prep.orientation import OrientationResult, detect_orientation, measure_residual_skew
from services.document_prep.quality import assess_quality

logger = logging.getLogger(__name__)

VARIANT_ORDER = ("original", "corrected", "enhanced", "binarized")
# Test-reading score below which even the best version is effectively unreadable (a clean
# invoice page scores several hundred; see ocr_scoring.summarize_ocr).
WEAK_READING_SCORE = 40.0
SELECTION_PRIORITY = {"corrected": 3, "enhanced": 2, "binarized": 1, "original": 0}
VARIANT_LABELS = {
    "original": "Original photo",
    "corrected": "Straightened (colour)",
    "enhanced": "Enhanced for reading",
    "binarized": "High-contrast black & white",
}


@dataclass
class PrepOptions:
    auto_orientation: bool = True
    perspective: bool = True
    deskew: bool = True
    enhance: bool = True
    compare_variants: Optional[bool] = None  # None = automatic (difficult pages only)
    use_ocr: Optional[bool] = None  # None = use the OCR engine when it is installed


@dataclass
class PreparedPage:
    variants: Dict[str, np.ndarray]  # BGR or gray uint8
    recommended_variant: str
    metadata: Dict[str, Any] = field(default_factory=dict)


def to_jsonable(value: Any) -> Any:
    """Convert numpy scalars/arrays and tuples into plain JSON types."""
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return to_jsonable(value.tolist())
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        f = float(value)
        return f if np.isfinite(f) else None
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def _step(name: str, applied: bool, reason: str, **details: Any) -> Dict[str, Any]:
    return {"step": name, "applied": bool(applied), "reason": reason, "details": details}


def _geometry_scale(analysis, size, opts: "PrepOptions", config: DocumentPrepConfig) -> float:
    """Enlargement to fold into a geometric warp when the text is smaller than OCR prefers."""
    if not opts.enhance or analysis.n_chars < 15 or not size:
        return 1.0
    char_h = analysis.char_height / max(analysis.scale, 1e-6)
    if char_h <= 0 or char_h >= 0.8 * config.target_char_height_px:
        return 1.0
    factor = min(3.0, config.target_char_height_px / char_h)
    factor = min(factor, config.output_max_side / float(max(size)))
    return factor if factor >= 1.15 else 1.0


def _to_bgr(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img


def prepare_page(
    data: bytes,
    filename: Optional[str] = None,
    options: Optional[PrepOptions] = None,
    config: DocumentPrepConfig = default_config,
    ocr_fn: Optional[Callable[[np.ndarray], OcrReadout]] = None,
    variant_ocr_fn: Optional[Callable[[np.ndarray], OcrReadout]] = None,
) -> PreparedPage:
    opts = options or PrepOptions()
    timings: Dict[str, float] = {}
    steps: List[Dict[str, Any]] = []
    warnings: List[str] = []
    t0 = time.perf_counter()

    def tick(name: str, start: float) -> None:
        timings[name] = round((time.perf_counter() - start) * 1000.0, 1)

    use_ocr = opts.use_ocr if opts.use_ocr is not None else (config.use_ocr_for_orientation and ocr_engine_available())
    if use_ocr:
        ocr_fn = ocr_fn or run_raw_ocr
        variant_ocr_fn = variant_ocr_fn or run_pipeline_ocr_best_contrast
    else:
        ocr_fn = None
        variant_ocr_fn = None

    # ---- 1. Load + EXIF -----------------------------------------------------------------
    s = time.perf_counter()
    loaded = load_image(data, filename, config)
    original = cv2.cvtColor(loaded.rgb, cv2.COLOR_RGB2BGR)
    tick("load", s)
    exif_name = EXIF_ORIENTATION_NAMES.get(loaded.exif_orientation or 0, "missing")
    steps.append(_step(
        "exif_orientation", loaded.exif_applied,
        f"EXIF orientation {loaded.exif_orientation} ({exif_name}) applied once" if loaded.exif_applied
        else ("No EXIF orientation metadata" if not loaded.exif_orientation else "EXIF says the photo is already upright"),
        exif_orientation=loaded.exif_orientation, original_size=list(loaded.original_size),
        working_size=list(loaded.size), decoded_scale=loaded.decoded_scale, notes=loaded.notes))

    # ---- 1b. Native-resolution denoise for dark, grainy photos ------------------------------
    s = time.perf_counter()
    working = original
    if opts.enhance:
        working, denoise_info = native_denoise_for_dark_photo(original)
        steps.append(_step(
            "native_denoise", denoise_info is not None,
            (f"Dark photo (paper level {denoise_info['paper_level']:.0f}): grain {denoise_info['grain_sigma']:.1f} would be "
             f"amplified x{denoise_info['brightening_gain']:.1f} by brightening, so it was reduced before any resizing")
            if denoise_info else "Not needed (photo is not dark and grainy)",
            **(denoise_info or {})))
    tick("native_denoise", s)

    # ---- 2. Document boundary + perspective -----------------------------------------------
    s = time.perf_counter()
    input_analysis = an.analyze_text(original, config.analysis_max_side)
    det: Optional[DocumentDetection] = None
    page = working
    geo_scale_used = 1.0
    region_mask = None
    if opts.perspective:
        det = detect_document(original, input_analysis, config)
        if det.found and det.quad and det.outline_reliable:
            region_mask = np.zeros(original.shape[:2], np.uint8)
            cv2.fillConvexPoly(region_mask, np.asarray(det.quad, np.int32), 255)
        if det.should_warp:
            warp_scale = _geometry_scale(input_analysis, det.output_size, opts, config)
            page = warp_document(working, det, warp_scale)
            geo_scale_used = warp_scale
        steps.append(_step(
            "document_detection", det.found,
            f"Page outline found by {det.method} (edge support {det.confidence:.2f})" if det.found
            else (det.reasons[0] if det.reasons else "No page outline"),
            quad=det.quad, area_fraction=det.area_fraction, touches_border=det.touches_border,
            text_outside_fraction=det.text_outside_fraction, candidates=det.candidates_considered))
        steps.append(_step(
            "perspective_correction", det.should_warp,
            f"Rectified to {det.output_size[0]}x{det.output_size[1]} (aspect {det.aspect_ratio}, {det.aspect_method})"
            if det.should_warp else "; ".join(det.reasons) or "Not needed",
            corner_deviation_deg=det.max_corner_deviation_deg, output_size=det.output_size,
            aspect_ratio=det.aspect_ratio, aspect_method=det.aspect_method))
    else:
        steps.append(_step("perspective_correction", False, "Disabled by user"))
    tick("document_detection", s)

    # ---- 3. Orientation + deskew ----------------------------------------------------------
    s = time.perf_counter()
    page_analysis = an.analyze_text(page, config.analysis_max_side) if page is not working else input_analysis
    orient: OrientationResult = detect_orientation(page, page_analysis, ocr_fn=ocr_fn,
                                                   ocr_max_side=config.orientation_ocr_max_side)
    rotation = orient.rotation_cw if opts.auto_orientation else 0
    corrected = an.rotate_cardinal_cw(page, rotation)
    steps.append(_step(
        "orientation", rotation != 0,
        (f"Turned {rotation} degrees clockwise ({orient.method}, confidence {orient.confidence:.2f})" if rotation
         else f"Already upright ({orient.method}, confidence {orient.confidence:.2f})")
        if opts.auto_orientation else "Automatic rotation disabled by user",
        detected_rotation_cw=orient.rotation_cw, confidence=orient.confidence, method=orient.method,
        line_direction_deg=orient.line_direction_deg, evidence=orient.evidence, notes=orient.reasons))
    tick("orientation", s)

    s = time.perf_counter()
    skew = orient.skew_deg if opts.auto_orientation else 0.0
    if not opts.auto_orientation and opts.deskew:
        res = measure_residual_skew(corrected)
        skew = res["line_angle"] if res["horizontal"] else 0.0
    deskew_applied = False
    if opts.deskew and config.min_skew_to_correct_deg <= abs(skew) <= config.max_skew_to_correct_deg:
        # Small text is enlarged inside the same warp (one resampling instead of two)
        deskew_scale = 1.0 if geo_scale_used != 1.0 else _geometry_scale(
            input_analysis, (corrected.shape[1], corrected.shape[0]), opts, config)
        corrected = an.rotate_bound(corrected, skew, scale=deskew_scale)
        geo_scale_used *= deskew_scale
        deskew_applied = True
    elif abs(skew) > config.max_skew_to_correct_deg:
        warnings.append(f"Tilt of {skew:.1f} degrees is too large to correct automatically.")
    steps.append(_step(
        "deskew", deskew_applied,
        (f"Straightened by {abs(skew):.2f} degrees on an expanded canvas (nothing clipped)"
         + (f"; enlarged x{geo_scale_used:.2f} in the same step" if geo_scale_used != 1.0 else "")) if deskew_applied
        else ("Tilt below correction threshold" if abs(skew) < config.min_skew_to_correct_deg else "Not applied"),
        measured_skew_deg=skew))
    tick("deskew", s)

    # ---- 4. Geometry verification ---------------------------------------------------------
    s = time.perf_counter()
    corrected_analysis = an.analyze_text(corrected, config.analysis_max_side)
    residual = measure_residual_skew(corrected)
    # Text preserved: compare character counts (scale-independent) before and after geometry
    chars_in = input_analysis.n_chars
    if det is not None and det.should_warp and region_mask is not None:
        # only text inside the page outline is expected to survive
        rm = cv2.resize(region_mask, (input_analysis.text_mask.shape[1], input_analysis.text_mask.shape[0]),
                        interpolation=cv2.INTER_NEAREST)
        cents = input_analysis.centroids.astype(int)
        if len(cents):
            inside = rm[np.clip(cents[:, 1], 0, rm.shape[0] - 1), np.clip(cents[:, 0], 0, rm.shape[1] - 1)] > 0
            chars_in = int(inside.sum())
    chars_out = corrected_analysis.n_chars
    preserved = chars_out >= 0.8 * chars_in if chars_in >= 20 else True
    horizontal_ok = residual["horizontal"] >= 1.0 or corrected_analysis.n_chars < 15
    geometry_ok = preserved and horizontal_ok and abs(residual["line_angle"]) < 1.5
    if not geometry_ok:
        warnings.append("Automatic straightening could not be verified; showing the page with only the main rotation applied.")
        corrected = an.rotate_cardinal_cw(working, rotation)
        corrected_analysis = an.analyze_text(corrected, config.analysis_max_side)
    steps.append(_step(
        "geometry_verification", True,
        "Text upright and level; text preserved" if geometry_ok else "Verification failed - geometric correction reverted",
        residual_line_angle_deg=residual["line_angle"], text_lines_horizontal=bool(residual["horizontal"]),
        chars_before=int(chars_in), chars_after=int(chars_out), passed=geometry_ok))
    tick("geometry_verification", s)

    # ---- 5. Quality --------------------------------------------------------------------
    s = time.perf_counter()
    geometry = {
        "rotation_cw": float(rotation),
        "skew_deg": float(skew),
        "perspective_deviation_deg": float(det.max_corner_deviation_deg) if det and det.found and det.outline_reliable else 0.0,
        "cut_off": 1.0 if det is not None and det.cut_off else 0.0,
    }
    quality_before = assess_quality(original, input_analysis, region_mask=region_mask, geometry=geometry)
    quality_corrected = assess_quality(corrected, corrected_analysis)
    tick("quality", s)

    # ---- 6. Enhancement ----------------------------------------------------------------
    s = time.perf_counter()
    variants: Dict[str, np.ndarray] = {"original": original, "corrected": corrected}
    enhancement_meta: Dict[str, Any] = {"applied": False}
    enhanced = None
    if opts.enhance:
        # Every operation has its own measured trigger (uneven light, low paper level, faint
        # ink, grain, blur, small text); on a clean page none of them fires and nothing changes.
        res = plan_and_enhance(corrected, quality_corrected, corrected_analysis, config)
        ok, why = enhancement_is_safe(res.verification)
        if not ok and len(res.steps) > 1:
            # Retry without the strongest operations before giving up
            res2 = plan_and_enhance(corrected, quality_corrected, corrected_analysis, config,
                                    allow={"sharpen": False, "contrast": False})
            ok2, why2 = enhancement_is_safe(res2.verification)
            if ok2:
                res, ok, why = res2, ok2, f"{why}; reduced to gentle enhancement"
        if len(res.steps) <= 1:
            enhancement_meta = {"applied": False, "reason": "Photo is already clear; no enhancement needed"}
        elif ok:
            enhanced = res.image
            variants["enhanced"] = enhanced
            enhancement_meta = {
                "applied": True,
                "steps": [{"name": st.name, "reason": st.reason, "params": st.params} for st in res.steps],
                "verification": res.verification,
                "verdict": why,
                "upscale_factor": res.upscale_factor,
            }
        else:
            enhancement_meta = {"applied": False, "rejected_reason": why, "verification": res.verification}
            warnings.append(f"Enhancement was not used because it would damage the text ({why}).")
    else:
        enhancement_meta = {"applied": False, "reason": "Disabled by user"}
    difficult = quality_before.grade in ("NEEDS_ENHANCEMENT", "POOR", "UNREADABLE") or quality_corrected.grade in (
        "NEEDS_ENHANCEMENT", "POOR")
    if enhanced is not None and difficult:
        ch = float(quality_corrected.metrics.get("char_height_px", 20)) * (enhancement_meta.get("upscale_factor") or 1.0)
        variants["binarized"] = binarize(enhanced, ch)
    steps.append(_step("enhancement", enhancement_meta.get("applied", False),
                       enhancement_meta.get("verdict") or enhancement_meta.get("reason")
                       or enhancement_meta.get("rejected_reason") or "", **{k: v for k, v in enhancement_meta.items()
                                                                            if k not in ("applied", "reason")}))
    tick("enhancement", s)

    final_default = "enhanced" if "enhanced" in variants else "corrected"
    s = time.perf_counter()
    final_img = variants[final_default]
    quality_after = assess_quality(final_img)
    tick("quality_after", s)

    # ---- 7. Variant comparison with the existing OCR engine -------------------------------
    s = time.perf_counter()
    compare = opts.compare_variants
    if compare is None:
        compare = config.compare_variants_with_ocr and (
            difficult or enhanced is not None or rotation != 0 or deskew_applied or bool(det and det.should_warp))
    selection: Dict[str, Any] = {"method": "rules", "scores": {}, "chosen": final_default}
    recommended = final_default
    needs_choice = False
    if compare and variant_ocr_fn is not None and quality_before.grade != "UNREADABLE":
        scores: Dict[str, Dict[str, float]] = {}
        try:
            names = [n for n in VARIANT_ORDER if n in variants]
            # Each OCR run is a separate worker process, so variants are read in parallel.
            with ThreadPoolExecutor(max_workers=min(len(names), max(1, config.max_parallel_ocr))) as pool:
                readouts = dict(zip(names, pool.map(lambda n: variant_ocr_fn(variants[n]), names)))
            for name in names:
                r = readouts[name]
                scores[name] = {"score": r.score, "confident_words": r.confident_words,
                                "arithmetic_rows": r.arithmetic_rows,
                                "numeric_tokens": r.numeric_tokens, "mean_confidence": round(r.mean_confidence, 1)}
            # Ties go to the corrected page, never to the uncorrected original
            best = max(scores, key=lambda k: (scores[k]["score"], SELECTION_PRIORITY[k]))
            base_score = scores[final_default]["score"]
            selection = {"method": "ocr_comparison", "scores": scores, "default": final_default}
            if best == "original" and "corrected" in scores and (rotation or deskew_applied or (det and det.should_warp)):
                # The uncorrected photo only "wins" when the old engine happens to cope with it;
                # keep the geometrically corrected page unless it is clearly worse.
                if scores["corrected"]["score"] >= scores["original"]["score"] * (1 - config.variant_ocr_margin) - 2:
                    best = "corrected"
            if best != final_default and scores[best]["score"] > base_score * (1 + config.variant_ocr_margin) + 2:
                recommended = best
                selection["chosen"] = best
                selection["reason"] = (f"\"{VARIANT_LABELS[best]}\" read better than \"{VARIANT_LABELS[final_default]}\" "
                                       "in a test reading")
            else:
                selection["chosen"] = final_default
                selection["reason"] = f"\"{VARIANT_LABELS[final_default]}\" read as well as or better than the other versions in a test reading"
            if scores[recommended]["score"] < 15:
                needs_choice = True
                selection["reason"] += "; OCR evidence is weak, please pick the clearest version"
        except Exception as exc:  # OCR is supporting evidence only
            logger.warning("Variant OCR comparison failed: %s", exc)
            selection = {"method": "rules", "scores": {}, "chosen": final_default,
                         "reason": f"OCR comparison unavailable ({type(exc).__name__})"}
    else:
        selection["reason"] = ("Clear page; no comparison needed" if not compare
                               else "OCR engine not available; rule-based choice")
    tick("variant_comparison", s)

    best_scores = selection.get("scores") or {}
    weak_reading = bool(best_scores) and max(v.get("score", 0.0) for v in best_scores.values()) < WEAK_READING_SCORE
    needs_confirmation = bool(opts.auto_orientation and orient.needs_confirmation and orient.rotation_cw != 0) or (
        opts.auto_orientation and orient.confidence < 0.4)
    timings["total"] = round((time.perf_counter() - t0) * 1000.0, 1)
    metadata = {
        "filename": filename,
        "source_mime": loaded.mime_type,
        "steps": steps,
        "orientation": {
            "auto_rotation_cw": rotation,
            "detected_rotation_cw": orient.rotation_cw,
            "confidence": orient.confidence,
            "method": orient.method,
            "skew_deg": skew,
            "deskew_applied": deskew_applied,
            "needs_confirmation": needs_confirmation,
            "notes": orient.reasons,
        },
        "document": {
            "found": bool(det and det.found),
            "perspective_corrected": bool(det and det.should_warp),
            "quad": det.quad if det else None,
            "reasons": det.reasons if det else [],
            "outline_reliable": bool(det.outline_reliable) if det else True,
            "cut_off": bool(det and det.cut_off),
            "cut_off_edges": list(det.cut_off_edges) if det else [],
        },
        "quality_before": quality_before.to_dict(),
        "quality_corrected": quality_corrected.to_dict(),
        "quality_after": quality_after.to_dict(),
        "enhancement": enhancement_meta,
        "variants": [v for v in VARIANT_ORDER if v in variants],
        "variant_labels": {v: VARIANT_LABELS[v] for v in VARIANT_ORDER if v in variants},
        "recommended_variant": recommended,
        "selection": selection,
        "needs_user_choice": needs_choice,
        # Retake advice follows the capture, not the enhanced result: enlarging or sharpening
        # can make metrics look better without restoring detail the camera did not record.
        # A test reading in which even the best version stays unreadable also asks for a retake.
        "retake_recommended": quality_before.grade in ("POOR", "UNREADABLE")
        or any(i.code == "cut_off" for i in quality_before.issues)
        or weak_reading,
        "warnings": warnings,
        "timings_ms": timings,
        "ocr_evidence_used": bool(use_ocr),
    }
    return PreparedPage(variants=variants, recommended_variant=recommended, metadata=to_jsonable(metadata))


def assess_capture(data: bytes, filename: Optional[str] = None,
                   config: DocumentPrepConfig = default_config) -> Dict[str, Any]:
    """Quality check of a photo that is uploaded directly (R10): the same capture grading and
    cut-off detection used by the camera flow, without preparing variants or running OCR."""
    t0 = time.perf_counter()
    loaded = load_image(data, filename, config)
    original = cv2.cvtColor(loaded.rgb, cv2.COLOR_RGB2BGR)
    analysis = an.analyze_text(original, config.analysis_max_side)
    det = detect_document(original, analysis, config)
    region_mask = None
    if det.found and det.quad and det.outline_reliable:
        region_mask = np.zeros(original.shape[:2], np.uint8)
        cv2.fillConvexPoly(region_mask, np.asarray(det.quad, np.int32), 255)
    geometry = {
        "perspective_deviation_deg": float(det.max_corner_deviation_deg) if det.found and det.outline_reliable else 0.0,
        "cut_off": 1.0 if det.cut_off else 0.0,
    }
    report = assess_quality(original, analysis, region_mask=region_mask, geometry=geometry)
    retake = report.grade in ("POOR", "UNREADABLE") or any(i.code == "cut_off" for i in report.issues)
    return to_jsonable({
        "filename": filename,
        "quality": report.to_dict(),
        "retake_recommended": retake,
        "document": {"found": det.found, "outline_reliable": det.outline_reliable, "cut_off": det.cut_off,
                     "cut_off_edges": det.cut_off_edges, "reasons": det.reasons},
        "exif_orientation": loaded.exif_orientation,
        "seconds": round(time.perf_counter() - t0, 2),
    })
