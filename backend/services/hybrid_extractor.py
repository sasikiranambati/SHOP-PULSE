"""
Hybrid Invoice Extraction and Independent Cross-Verification Engine.

Coordinates online Vision Extraction (Gemini) with local OCR Table Detection (Tesseract).
Implements independent verification:
- Agreement between engines boosts confidence
- Disagreements are flagged for manual review rather than averaged or guessed
- Strict schema isolation of packaging, units, prices, and arithmetic validation
"""

import re
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Packaging units
PACK_SIZE_REGEX = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(ml|g|gm|gms|kg|kgs|l|ltr|ltrs|liter|litres)\b",
    re.IGNORECASE
)

# Common packaged FMCG goods that must not have their pack size mistaken for billing unit
PACKAGED_GOODS_REGEX = re.compile(
    r"\b(fortune|godrej|amul|tata|surf|rin|colgate|dove|sunsilk|pantene|nivea|head\s*&\s*shoulders|"
    r"horlicks|boost|bournvita|maggi|parle|britannia|cadbury|lays|kurkure|haldiram|dettol|lifebuoy|"
    r"lux|pears|cinthol|santoor|vim|harpic|pril|exo|patanjali|aashirvaad|everest|catch|mdh|dabur|"
    r"soap|shampoo|paste|cream|biscuit|oil|ghee|powder|sauce|noodle)\b",
    re.IGNORECASE
)


def extract_pack_size(name: str) -> Tuple[Optional[float], Optional[str]]:
    """Extracts pack size and unit from product title string (e.g. 500 GM -> (500.0, 'g'))."""
    match = PACK_SIZE_REGEX.search(name)
    if match:
        try:
            val = float(match.group(1))
            raw_u = match.group(2).lower()
            norm_u = "g" if raw_u in ("gm", "gms") else ("kg" if raw_u == "kgs" else ("l" if raw_u in ("ltr", "ltrs", "liter", "litres") else raw_u))
            return val, norm_u
        except ValueError:
            return None, None
    return None, None


def validate_arithmetic_strict(
    qty: Optional[float],
    rate: Optional[float],
    line_total: Optional[float],
    discount: Optional[float] = None,
    tax_amount: Optional[float] = None,
    gst_rate: Optional[float] = None,
) -> Tuple[str, List[str]]:
    """
    Evaluates multi-dimensional arithmetic relationships without trusting multiplication alone.
    Returns (validation_status, issues).
    """
    issues = []
    if qty is None or rate is None or line_total is None:
        if qty is None:
            issues.append("Quantity missing from invoice")
        if rate is None:
            issues.append("Unit rate/price missing from invoice")
        if line_total is None:
            issues.append("Line total missing from invoice")
        return "INSUFFICIENT_DATA", issues

    expected_raw = qty * rate
    disc_val = discount or 0.0
    tax_val = tax_amount or 0.0
    gst_pct = gst_rate or 0.0

    diff_standard = abs(expected_raw - line_total)
    diff_with_discount = abs((expected_raw - disc_val) - line_total)
    diff_with_tax = abs((expected_raw + tax_val) - line_total)
    diff_with_gst = abs((expected_raw * (1.0 + gst_pct / 100.0)) - line_total) if gst_pct else 999999.0
    diff_both = abs(((expected_raw - disc_val) * (1.0 + gst_pct / 100.0)) - line_total) if gst_pct else 999999.0

    min_diff = min(diff_standard, diff_with_discount, diff_with_tax, diff_with_gst, diff_both)

    if min_diff <= 0.05:
        return "EXACT_MATCH", []
    elif min_diff <= max(1.5, line_total * 0.015):
        return "MATCH_WITH_ROUNDING", []
    else:
        diff_act = abs(expected_raw - line_total)
        issues.append(f"Arithmetic discrepancy: {qty} × ₹{rate} = ₹{expected_raw:.2f} but line total is ₹{line_total:.2f} (diff: ₹{diff_act:.2f})")
        return "MISMATCH", issues


def reconcile_hybrid_extraction(
    vision_data: Optional[Dict[str, Any]],
    ocr_items: List[Dict[str, Any]],
    ocr_meta: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Combines Vision extraction with OCR table detection.
    Independent verification rules:
    - If Vision is present and corroborates OCR, boost confidence.
    - If Vision and OCR disagree on numbers, flag with review reasons (do not invent/average).
    - If Vision is unavailable, fall back cleanly to local OCR with packaging separation.
    """
    reconciled_items = []

    if vision_data and vision_data.get("items"):
        vision_items = vision_data["items"]
        for v_item in vision_items:
            prod_name = str(v_item.get("product_name") or "").strip()
            source_text = str(v_item.get("source_row_text") or prod_name).strip()
            raw_qty = v_item.get("purchased_quantity")
            purchased_qty = float(raw_qty) if raw_qty is not None and raw_qty != "" else None
            purchase_unit = v_item.get("purchase_unit") or None

            pack_sz = v_item.get("pack_size")
            pack_sz_unit = v_item.get("pack_size_unit")
            if pack_sz is None:
                detected_sz, detected_sz_unit = extract_pack_size(prod_name)
                pack_sz = detected_sz
                pack_sz_unit = detected_sz_unit

            # Enforce packaging separation:
            # If pack size is present (e.g. 500 GM), purchased quantity must NEVER be 500 or have unit 'g'
            if pack_sz_unit and purchase_unit and purchase_unit.lower() == pack_sz_unit.lower():
                # Unit was mistakenly set to pack size unit (e.g. 'g')!
                purchase_unit = None

            raw_rate = v_item.get("unit_rate")
            unit_rate = float(raw_rate) if raw_rate is not None and raw_rate != "" else None

            raw_total = v_item.get("line_total")
            line_total = float(raw_total) if raw_total is not None and raw_total != "" else None

            discount = float(v_item.get("discount")) if v_item.get("discount") is not None else None
            tax_rate = float(v_item.get("tax_rate")) if v_item.get("tax_rate") is not None else None
            tax_amount = float(v_item.get("tax_amount")) if v_item.get("tax_amount") is not None else None
            hsn_code = str(v_item.get("hsn_code")).strip() if v_item.get("hsn_code") else None

            review_reasons = list(v_item.get("review_reasons") or [])

            # Check if an explicit unit was established
            if purchase_unit is None and pack_sz is not None:
                review_reasons.append("Quantity unit not established on invoice; please confirm if pieces or packs.")

            # Cross-verify with OCR candidate rows
            matching_ocr = None
            norm_v_name = re.sub(r"[^a-z0-9]", "", prod_name.lower())
            for o_item in ocr_items:
                norm_o_name = re.sub(r"[^a-z0-9]", "", str(o_item.get("product_name") or "").lower())
                if norm_v_name and norm_o_name and (norm_v_name in norm_o_name or norm_o_name in norm_v_name):
                    matching_ocr = o_item
                    break

            corroborated = False
            engine_disagreements = []
            confidence = float(v_item.get("confidence") or 88.0)

            if matching_ocr:
                o_qty = matching_ocr.get("quantity")
                o_rate = matching_ocr.get("purchase_price") or matching_ocr.get("rate")
                o_total = matching_ocr.get("line_total")

                # Check number agreement
                qty_agrees = o_qty is None or purchased_qty is None or abs(o_qty - purchased_qty) <= 0.01
                rate_agrees = o_rate is None or unit_rate is None or abs(o_rate - unit_rate) <= 0.1
                total_agrees = o_total is None or line_total is None or abs(o_total - line_total) <= 0.5

                if qty_agrees and rate_agrees and total_agrees:
                    corroborated = True
                    confidence = min(99.0, max(confidence, 96.0))
                else:
                    if not qty_agrees:
                        engine_disagreements.append(f"Quantity disagreement: Vision={purchased_qty}, OCR={o_qty}")
                        review_reasons.append(f"Engine disagreement on quantity: Vision read {purchased_qty}, OCR read {o_qty}")
                    if not rate_agrees:
                        engine_disagreements.append(f"Rate disagreement: Vision={unit_rate}, OCR={o_rate}")
                        review_reasons.append(f"Engine disagreement on rate: Vision read {unit_rate}, OCR read {o_rate}")
                    if not total_agrees:
                        engine_disagreements.append(f"Total disagreement: Vision={line_total}, OCR={o_total}")
                    confidence = max(40.0, confidence - 25.0)

            # Perform strict arithmetic check
            val_status, math_issues = validate_arithmetic_strict(
                purchased_qty, unit_rate, line_total, discount, tax_amount, tax_rate
            )
            review_reasons.extend(math_issues)

            # Never allow EXACT_MATCH if there are review reasons, engine disagreements, or missing packaging units
            if engine_disagreements or (purchase_unit is None and pack_sz is not None) or review_reasons:
                if val_status in ("EXACT_MATCH", "MATCH_WITH_ROUNDING") and (engine_disagreements or (purchase_unit is None and pack_sz is not None) or any("discrepancy" in r.lower() or "missing" in r.lower() or "not established" in r.lower() for r in review_reasons)):
                    val_status = "NEEDS_REVIEW"

            name_conf = 95.0 if prod_name and len(prod_name) >= 3 else 30.0
            qty_conf = 95.0 if purchased_qty is not None and purchased_qty > 0 else 0.0
            unit_conf = 90.0 if purchase_unit else 40.0
            rate_conf = 95.0 if unit_rate is not None and unit_rate > 0 else 0.0
            total_conf = 95.0 if line_total is not None and line_total > 0 else 0.0
            field_conf = {
                "name": name_conf,
                "quantity": qty_conf,
                "unit": unit_conf,
                "rate": rate_conf,
                "lineTotal": total_conf,
            }

            reconciled_items.append({
                "source_row_text": source_text,
                "product_name": prod_name,
                "hsn_code": hsn_code,
                "purchased_quantity": purchased_qty,
                "quantity": purchased_qty,
                "purchase_unit": purchase_unit,
                "unit": purchase_unit,
                "pack_size": pack_sz,
                "pack_size_unit": pack_sz_unit,
                "unit_rate": unit_rate,
                "rate": unit_rate,
                "purchase_price": unit_rate,
                "discount": discount,
                "tax_rate": tax_rate,
                "tax_amount": tax_amount,
                "line_total": line_total,
                "amount": line_total,
                "confidence": confidence,
                "validation_status": val_status,
                "review_reasons": list(dict.fromkeys(review_reasons)),
                "corroborated": corroborated,
                "engine_disagreements": engine_disagreements,
                "field_confidence": field_conf,
                "needs_review": bool(review_reasons) or val_status not in ("EXACT_MATCH", "MATCH_WITH_ROUNDING"),
            })

        # Check invoice total reconciliation
        subtotal_val = vision_data.get("subtotal") or ocr_meta.get("invoice_total")
        grand_total_val = vision_data.get("grand_total") or ocr_meta.get("invoice_total")
        calc_line_sum = sum(it["line_total"] for it in reconciled_items if it.get("line_total") is not None)
        invoice_review_reasons = []
        if grand_total_val and abs(grand_total_val - calc_line_sum) > max(1.5, calc_line_sum * 0.015):
            invoice_review_reasons.append(
                f"Invoice grand total (₹{grand_total_val:.2f}) differs from sum of line totals (₹{calc_line_sum:.2f})"
            )

        return {
            "engine_used": "hybrid_gemini_vision_and_ocr",
            "supplier_name": vision_data.get("supplier_name") or ocr_meta.get("supplier_name"),
            "invoice_number": vision_data.get("invoice_number") or ocr_meta.get("invoice_number"),
            "invoice_date": vision_data.get("invoice_date") or ocr_meta.get("invoice_date"),
            "subtotal": subtotal_val,
            "tax_amount": vision_data.get("tax_amount"),
            "grand_total": grand_total_val,
            "items": reconciled_items,
            "review_reasons": invoice_review_reasons,
            "vision_available": True,
        }

    # Fallback to pure local OCR table extraction
    for o_item in ocr_items:
        prod_name = str(o_item.get("product_name") or "").strip()
        source_text = str(o_item.get("source_text") or prod_name).strip()
        raw_qty = o_item.get("quantity")
        purchased_qty = float(raw_qty) if raw_qty is not None else None
        purchase_unit = o_item.get("unit") or None

        pack_sz, pack_sz_unit = extract_pack_size(prod_name)

        # Enforce packaging separation on OCR fallback:
        # If pack size is present (e.g. 500 GM), purchase unit must NOT be 'g' or 'gm'
        if pack_sz_unit and purchase_unit and purchase_unit.lower() in (pack_sz_unit.lower(), "gm", "gms"):
            purchase_unit = None

        raw_rate = o_item.get("purchase_price") or o_item.get("rate")
        unit_rate = float(raw_rate) if raw_rate is not None else None

        raw_total = o_item.get("line_total")
        line_total = float(raw_total) if raw_total is not None else None

        orig_issues = list(o_item.get("issues") or o_item.get("validation_issues") or [])
        validation_issues = list(orig_issues)
        review_reasons = list(orig_issues)
        if purchase_unit is None and pack_sz is not None:
            review_reasons.append("Unit not established on invoice; please confirm if pieces or packs.")

        # Arithmetic validation
        orig_arith = o_item.get("arithmetic_status")
        if orig_arith == "VERIFIED" and not orig_issues:
            val_status = "EXACT_MATCH"
            arith_status = "VERIFIED"
        elif orig_arith == "MISMATCH":
            val_status = "MISMATCH"
            arith_status = "MISMATCH"
        else:
            val_status, math_issues = validate_arithmetic_strict(
                purchased_qty, unit_rate, line_total,
                o_item.get("discount"), o_item.get("tax_amount"), o_item.get("gst_rate")
            )
            validation_issues.extend(math_issues)
            review_reasons.extend(math_issues)
            arith_status = "VERIFIED" if val_status in ("EXACT_MATCH", "MATCH_WITH_ROUNDING") else ("MISMATCH" if val_status == "MISMATCH" else "INSUFFICIENT_DATA")

        # Disallow EXACT_MATCH if missing rate or qty or math issues
        if not unit_rate or not purchased_qty or any("discrepancy" in r.lower() or "missing" in r.lower() for r in validation_issues):
            if val_status in ("EXACT_MATCH", "MATCH_WITH_ROUNDING"):
                val_status = "NEEDS_REVIEW" if (unit_rate and purchased_qty) else "INSUFFICIENT_DATA"

        conf = float(o_item.get("confidence") or 75.0)
        name_conf = 90.0 if prod_name and len(prod_name) >= 3 else 30.0
        qty_conf = 90.0 if purchased_qty is not None and purchased_qty > 0 else 0.0
        unit_conf = 85.0 if purchase_unit else 40.0
        rate_conf = 90.0 if unit_rate is not None and unit_rate > 0 else 0.0
        total_conf = 90.0 if line_total is not None and line_total > 0 else 0.0
        field_conf = {
            "name": name_conf,
            "quantity": qty_conf,
            "unit": unit_conf,
            "rate": rate_conf,
            "lineTotal": total_conf,
        }

        # Build item preserving all original fields
        reconciled_item = {
            **{k: v for k, v in o_item.items() if k not in ("product_name", "quantity", "unit", "rate", "purchase_price", "line_total", "issues")},
            "source_row_text": source_text,
            "product_name": prod_name,
            "hsn_code": o_item.get("hsn_code"),
            "purchased_quantity": purchased_qty,
            "quantity": purchased_qty,
            "purchase_unit": purchase_unit,
            "unit": purchase_unit,
            "pack_size": pack_sz,
            "pack_size_unit": pack_sz_unit,
            "unit_rate": unit_rate,
            "rate": unit_rate,
            "purchase_price": unit_rate,
            "selling_price": o_item.get("selling_price"),
            "invoice_mrp": o_item.get("invoice_mrp"),
            "discount": o_item.get("discount"),
            "discount_pct": o_item.get("discount_pct"),
            "taxable_amount": o_item.get("taxable_amount"),
            "tax_rate": o_item.get("gst_rate"),
            "tax_amount": o_item.get("tax_amount"),
            "line_total": line_total,
            "amount": line_total,
            "confidence": conf,
            "validation_status": val_status,
            "arithmetic_status": arith_status,
            "validation_issues": list(dict.fromkeys(validation_issues)),
            "review_reasons": list(dict.fromkeys(review_reasons)),
            "issues": list(dict.fromkeys(validation_issues)),
            "corroborated": False,
            "engine_disagreements": [],
            "field_confidence": field_conf,
            "needs_review": bool(validation_issues) or arith_status != "VERIFIED" or not unit_rate or not purchased_qty or conf < 85,
        }
        reconciled_items.append(reconciled_item)

    # Check invoice total reconciliation on fallback
    grand_total_val = ocr_meta.get("invoice_total")
    calc_line_sum = sum(it["line_total"] for it in reconciled_items if it.get("line_total") is not None)
    fallback_review_reasons = []
    if grand_total_val and abs(grand_total_val - calc_line_sum) > max(1.5, calc_line_sum * 0.015):
        fallback_review_reasons.append(
            f"Invoice total (₹{grand_total_val:.2f}) differs from sum of lines (₹{calc_line_sum:.2f})"
        )

    return {
        "engine_used": None,
        "supplier_name": ocr_meta.get("supplier_name"),
        "invoice_number": ocr_meta.get("invoice_number"),
        "invoice_date": ocr_meta.get("invoice_date"),
        "subtotal": ocr_meta.get("invoice_total"),
        "tax_amount": None,
        "grand_total": ocr_meta.get("invoice_total"),
        "items": reconciled_items,
        "review_reasons": fallback_review_reasons,
        "vision_available": False,
    }
