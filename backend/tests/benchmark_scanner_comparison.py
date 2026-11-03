"""
ShopPulse Phase 10: Old vs New Scanner Empirical Benchmark Comparison Harness.
Executes both the legacy OCR scanner and the new modular grocery OCR pipeline
on the 32-invoice ground truth test dataset across all 15 required dimensions:
1. Product name extraction
2. Brand recognition
3. Grocery classification
4. Quantity extraction
5. Unit extraction
6. Package-size recognition
7. Purchase price extraction
8. Selling price extraction
9. MRP extraction
10. Printed amount extraction
11. Row association accuracy
12. Complete-row accuracy
13. Excel generation success rate
14. Excel parsing success rate
15. End-to-end processing success rate
"""

import io
import json
import logging
import os
import sys
import time
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.session import Base
import db.models  # noqa: F401
from db.models.shop import Shop
from db.models.user import User
from services import invoice as legacy_invoice_service
from services.grocery_ocr.engines.ocr_engine import TesseractOCREngine
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline

logger = logging.getLogger("benchmark")
logging.basicConfig(level=logging.ERROR)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "ground_truth"
INVOICES_DIR = FIXTURES_DIR / "invoices"
GROUND_TRUTH_FILE = FIXTURES_DIR / "ground_truth.json"
RESULTS_FILE = FIXTURES_DIR / "benchmark_results.json"


def init_benchmark_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()

    # Seed test user and test shop
    u_id = uuid.uuid4()
    s_id = uuid.uuid4()
    u = User(id=u_id, email="benchmark@shoppulse.in", hashed_password="pw", is_active=True)
    db.add(u)
    db.commit()

    shop = Shop(
        id=s_id,
        owner_id=u_id,
        owner_name="Benchmark Owner",
        shop_name="Benchmark Kirana Supermarket",
        business_type="Grocery/Kirana",
        location="Hyderabad",
    )
    db.add(shop)
    db.commit()
    return db, s_id


def fuzzy_name_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    # Normalize strings: lowercase and remove non-alphanumeric
    clean_a = "".join(c.lower() for c in a if c.isalnum() or c.isspace()).split()
    clean_b = "".join(c.lower() for c in b if c.isalnum() or c.isspace()).split()
    if not clean_a or not clean_b:
        return False
    set_a = set(clean_a)
    set_b = set(clean_b)
    overlap = len(set_a.intersection(set_b))
    return (overlap / max(len(set_a), len(set_b))) >= 0.5 or (a.lower() in b.lower()) or (b.lower() in a.lower())


def numeric_equal(val: Any, target: Any, tol: float = 0.05) -> bool:
    if val is None and target is None:
        return True
    if val is None or target is None:
        return False
    try:
        f_val = float(val)
        f_target = float(target)
        return abs(f_val - f_target) <= tol
    except (ValueError, TypeError):
        return False


def run_benchmark():
    if not GROUND_TRUTH_FILE.exists():
        print(f"Error: Master ground truth annotations file {GROUND_TRUTH_FILE} not found.")
        sys.exit(1)

    with open(GROUND_TRUTH_FILE, "r", encoding="utf-8") as f:
        ground_truth: Dict[str, Any] = json.load(f)

    db, shop_id = init_benchmark_db()
    new_pipeline = InvoicePipeline(ocr_engine=TesseractOCREngine())

    print("================================================================================")
    print("  SHOPPULSE GROCERY INVOICE SCANNER EMPIRICAL BENCHMARK: OLD VS NEW ENGINE")
    print(f"  Total Invoices in Test Suite: {len(ground_truth)}")
    total_expected_rows = sum(len(inv["items"]) for inv in ground_truth.values())
    print(f"  Total Ground Truth Line Items: {total_expected_rows}")
    print("================================================================================\n")

    # Metrics collectors
    metrics = {
        "old": {
            "name_matches": 0,
            "brand_matches": 0,
            "category_matches": 0,
            "quantity_matches": 0,
            "unit_matches": 0,
            "pack_size_matches": 0,
            "purchase_price_matches": 0,
            "selling_price_matches": 0,
            "mrp_matches": 0,
            "printed_amount_matches": 0,
            "row_association_correct": 0,
            "complete_rows": 0,
            "excel_generated": 0,
            "excel_parsed": 0,
            "e2e_success": 0,
            "total_items_extracted": 0,
            "total_expected_items": total_expected_rows,
            "invoices_processed": 0,
            "total_time_ms": 0.0,
        },
        "new": {
            "name_matches": 0,
            "brand_matches": 0,
            "category_matches": 0,
            "quantity_matches": 0,
            "unit_matches": 0,
            "pack_size_matches": 0,
            "purchase_price_matches": 0,
            "selling_price_matches": 0,
            "mrp_matches": 0,
            "printed_amount_matches": 0,
            "row_association_correct": 0,
            "complete_rows": 0,
            "excel_generated": 0,
            "excel_parsed": 0,
            "e2e_success": 0,
            "total_items_extracted": 0,
            "total_expected_items": total_expected_rows,
            "invoices_processed": 0,
            "total_time_ms": 0.0,
        },
    }

    per_invoice_details = []

    for inv_id, truth in ground_truth.items():
        fname = truth["filename"]
        fpath = INVOICES_DIR / fname
        if not fpath.exists():
            print(f"Skipping {fname}: file not found.")
            continue

        file_bytes = fpath.read_bytes()
        expected_items = truth["items"]
        print(f"Evaluating {inv_id} ({fname}) - {len(expected_items)} expected items...")

        # -------------------------------------------------------------
        # 1. EVALUATE OLD SCANNER
        # -------------------------------------------------------------
        old_items = []
        old_excel_gen = False
        old_excel_parse = False
        old_e2e = False
        t0 = time.time()
        try:
            old_resp = legacy_invoice_service._extract_invoice_legacy(
                file_bytes=file_bytes,
                filename=fname,
                db=db,
                shop_id=shop_id,
            )
            old_time = (time.time() - t0) * 1000.0
            metrics["old"]["total_time_ms"] += old_time
            metrics["old"]["invoices_processed"] += 1
            old_items = old_resp.items
            old_e2e = (old_resp.status in ("success", "needs_review") or len(expected_items) == 0)
            if old_resp.excel_download_url:
                old_excel_gen = True
                old_excel_parse = True  # Old scanner does basic parsing
        except Exception as e:
            logger.debug("Old scanner failed on %s: %s", fname, e)
            old_time = (time.time() - t0) * 1000.0
            metrics["old"]["total_time_ms"] += old_time
            metrics["old"]["invoices_processed"] += 1
            if len(expected_items) == 0:
                old_e2e = True

        if old_e2e:
            metrics["old"]["e2e_success"] += 1
        if old_excel_gen:
            metrics["old"]["excel_generated"] += 1
        if old_excel_parse:
            metrics["old"]["excel_parsed"] += 1

        metrics["old"]["total_items_extracted"] += len(old_items)

        # -------------------------------------------------------------
        # 2. EVALUATE NEW SCANNER
        # -------------------------------------------------------------
        new_items = []
        new_excel_gen = False
        new_excel_parse = False
        new_e2e = False
        t0 = time.time()
        try:
            new_inv = new_pipeline.process(file_bytes, fname)
            new_time = (time.time() - t0) * 1000.0
            metrics["new"]["total_time_ms"] += new_time
            metrics["new"]["invoices_processed"] += 1
            new_items = new_inv.items
            new_e2e = (new_inv.status in ("SUCCESS", "NEEDS_REVIEW") or (new_inv.status == "FAILED" and len(expected_items) == 0))
            if new_inv.metadata.custom_properties.get("xlsx_file_path"):
                new_excel_gen = True
            if "workbook_parsing" in new_inv.metadata.pipeline_stages_completed:
                new_excel_parse = True
        except Exception as e:
            logger.debug("New scanner failed on %s: %s", fname, e)
            new_time = (time.time() - t0) * 1000.0
            metrics["new"]["total_time_ms"] += new_time
            metrics["new"]["invoices_processed"] += 1
            if len(expected_items) == 0:
                new_e2e = True

        if new_e2e:
            metrics["new"]["e2e_success"] += 1
        if new_excel_gen:
            metrics["new"]["excel_generated"] += 1
        if new_excel_parse:
            metrics["new"]["excel_parsed"] += 1

        metrics["new"]["total_items_extracted"] += len(new_items)

        # -------------------------------------------------------------
        # 3. SCORE FIELD-LEVEL MATCHES (OLD vs GROUND TRUTH)
        # -------------------------------------------------------------
        matched_truth_indices_old = set()
        for extracted in old_items:
            best_idx = None
            best_score = 0
            for idx, exp in enumerate(expected_items):
                if idx in matched_truth_indices_old:
                    continue
                if fuzzy_name_match(extracted.product_name, exp["product_name"]):
                    best_idx = idx
                    break
            if best_idx is not None:
                matched_truth_indices_old.add(best_idx)
                exp = expected_items[best_idx]
                metrics["old"]["name_matches"] += 1

                # Brand
                if exp.get("brand") and extracted.brand and exp["brand"].lower() in extracted.brand.lower():
                    metrics["old"]["brand_matches"] += 1
                elif not exp.get("brand") and not extracted.brand:
                    metrics["old"]["brand_matches"] += 1

                # Category
                if exp.get("is_grocery") is not None:
                    if exp["is_grocery"] == extracted.is_grocery:
                        metrics["old"]["category_matches"] += 1

                # Quantity
                if numeric_equal(extracted.quantity, exp.get("quantity")):
                    metrics["old"]["quantity_matches"] += 1

                # Unit
                if exp.get("unit") and extracted.unit and exp["unit"].lower() == extracted.unit.lower():
                    metrics["old"]["unit_matches"] += 1
                elif not exp.get("unit") and not extracted.unit:
                    metrics["old"]["unit_matches"] += 1

                # Pack size
                if exp.get("pack_size") and extracted.pack_size:
                    metrics["old"]["pack_size_matches"] += 1
                elif not exp.get("pack_size") and not extracted.pack_size:
                    metrics["old"]["pack_size_matches"] += 1

                # Purchase price
                if numeric_equal(extracted.purchase_price, exp.get("purchase_price")):
                    metrics["old"]["purchase_price_matches"] += 1

                # Selling price
                if numeric_equal(extracted.selling_price, exp.get("selling_price")):
                    metrics["old"]["selling_price_matches"] += 1

                # MRP
                if numeric_equal(extracted.mrp, exp.get("mrp")):
                    metrics["old"]["mrp_matches"] += 1

                # Printed amount
                if numeric_equal(extracted.printed_amount or extracted.line_total, exp.get("printed_amount")):
                    metrics["old"]["printed_amount_matches"] += 1

                # Row association (checks that price * qty relates to this item, not another)
                if numeric_equal(extracted.line_total, exp.get("printed_amount")):
                    metrics["old"]["row_association_correct"] += 1

                # Complete Row: Name, Qty, Rate, and Amount all correct
                if (
                    numeric_equal(extracted.quantity, exp.get("quantity"))
                    and numeric_equal(extracted.purchase_price, exp.get("purchase_price"))
                    and numeric_equal(extracted.printed_amount or extracted.line_total, exp.get("printed_amount"))
                ):
                    metrics["old"]["complete_rows"] += 1

        # -------------------------------------------------------------
        # 4. SCORE FIELD-LEVEL MATCHES (NEW vs GROUND TRUTH)
        # -------------------------------------------------------------
        matched_truth_indices_new = set()
        for extracted in new_items:
            best_idx = None
            for idx, exp in enumerate(expected_items):
                if idx in matched_truth_indices_new:
                    continue
                extracted_name = extracted.normalized_product_name or extracted.raw_product_name
                if fuzzy_name_match(extracted_name, exp["product_name"]):
                    best_idx = idx
                    break
            if best_idx is not None:
                matched_truth_indices_new.add(best_idx)
                exp = expected_items[best_idx]
                metrics["new"]["name_matches"] += 1

                # Brand
                if exp.get("brand") and extracted.brand and exp["brand"].lower() in extracted.brand.lower():
                    metrics["new"]["brand_matches"] += 1
                elif not exp.get("brand") and not extracted.brand:
                    metrics["new"]["brand_matches"] += 1

                # Category
                if exp.get("is_grocery") is not None:
                    if exp["is_grocery"] == extracted.is_grocery:
                        metrics["new"]["category_matches"] += 1

                # Quantity
                if numeric_equal(extracted.quantity, exp.get("quantity")):
                    metrics["new"]["quantity_matches"] += 1

                # Unit
                if exp.get("unit") and extracted.unit and exp["unit"].lower() == extracted.unit.lower():
                    metrics["new"]["unit_matches"] += 1
                elif not exp.get("unit") and not extracted.unit:
                    metrics["new"]["unit_matches"] += 1

                # Pack size
                if exp.get("pack_size") and extracted.package_size:
                    metrics["new"]["pack_size_matches"] += 1
                elif not exp.get("pack_size") and not extracted.package_size:
                    metrics["new"]["pack_size_matches"] += 1

                # Purchase price
                if numeric_equal(extracted.purchase_price, exp.get("purchase_price")):
                    metrics["new"]["purchase_price_matches"] += 1

                # Selling price
                if numeric_equal(extracted.selling_price, exp.get("selling_price")):
                    metrics["new"]["selling_price_matches"] += 1

                # MRP
                if numeric_equal(extracted.mrp, exp.get("mrp")):
                    metrics["new"]["mrp_matches"] += 1

                # Printed amount
                if numeric_equal(extracted.printed_amount, exp.get("printed_amount")):
                    metrics["new"]["printed_amount_matches"] += 1

                # Row association
                if numeric_equal(extracted.printed_amount, exp.get("printed_amount")):
                    metrics["new"]["row_association_correct"] += 1

                # Complete Row: Name, Qty, Rate, and Amount all correct
                if (
                    numeric_equal(extracted.quantity, exp.get("quantity"))
                    and numeric_equal(extracted.purchase_price, exp.get("purchase_price"))
                    and numeric_equal(extracted.printed_amount, exp.get("printed_amount"))
                ):
                    metrics["new"]["complete_rows"] += 1

        per_invoice_details.append({
            "invoice_id": inv_id,
            "filename": fname,
            "expected_items": len(expected_items),
            "old_extracted_items": len(old_items),
            "new_extracted_items": len(new_items),
            "old_matched": len(matched_truth_indices_old),
            "new_matched": len(matched_truth_indices_new),
            "old_e2e": old_e2e,
            "new_e2e": new_e2e,
        })

    # -------------------------------------------------------------
    # 5. CALCULATE PERCENTAGES, PRECISION, RECALL, DELTAS
    # -------------------------------------------------------------
    num_inv = len(ground_truth)
    total_truth = total_expected_rows

    def pct(nom, den):
        return round((nom / den) * 100.0, 1) if den > 0 else 0.0

    comparison_table = [
        {"dimension": "1. Product Name Extraction", "old": pct(metrics["old"]["name_matches"], total_truth), "new": pct(metrics["new"]["name_matches"], total_truth)},
        {"dimension": "2. Brand Recognition", "old": pct(metrics["old"]["brand_matches"], total_truth), "new": pct(metrics["new"]["brand_matches"], total_truth)},
        {"dimension": "3. Grocery Classification", "old": pct(metrics["old"]["category_matches"], total_truth), "new": pct(metrics["new"]["category_matches"], total_truth)},
        {"dimension": "4. Quantity Extraction", "old": pct(metrics["old"]["quantity_matches"], total_truth), "new": pct(metrics["new"]["quantity_matches"], total_truth)},
        {"dimension": "5. Unit Extraction", "old": pct(metrics["old"]["unit_matches"], total_truth), "new": pct(metrics["new"]["unit_matches"], total_truth)},
        {"dimension": "6. Package-Size Recognition", "old": pct(metrics["old"]["pack_size_matches"], total_truth), "new": pct(metrics["new"]["pack_size_matches"], total_truth)},
        {"dimension": "7. Purchase Price Extraction", "old": pct(metrics["old"]["purchase_price_matches"], total_truth), "new": pct(metrics["new"]["purchase_price_matches"], total_truth)},
        {"dimension": "8. Selling Price Extraction", "old": pct(metrics["old"]["selling_price_matches"], total_truth), "new": pct(metrics["new"]["selling_price_matches"], total_truth)},
        {"dimension": "9. MRP Extraction", "old": pct(metrics["old"]["mrp_matches"], total_truth), "new": pct(metrics["new"]["mrp_matches"], total_truth)},
        {"dimension": "10. Printed Amount Extraction", "old": pct(metrics["old"]["printed_amount_matches"], total_truth), "new": pct(metrics["new"]["printed_amount_matches"], total_truth)},
        {"dimension": "11. Row Association Accuracy", "old": pct(metrics["old"]["row_association_correct"], total_truth), "new": pct(metrics["new"]["row_association_correct"], total_truth)},
        {"dimension": "12. Complete-Row Accuracy", "old": pct(metrics["old"]["complete_rows"], total_truth), "new": pct(metrics["new"]["complete_rows"], total_truth)},
        {"dimension": "13. Excel Generation Success", "old": pct(metrics["old"]["excel_generated"], num_inv), "new": pct(metrics["new"]["excel_generated"], num_inv)},
        {"dimension": "14. Excel Parsing Success", "old": pct(metrics["old"]["excel_parsed"], num_inv), "new": pct(metrics["new"]["excel_parsed"], num_inv)},
        {"dimension": "15. End-to-End Success Rate", "old": pct(metrics["old"]["e2e_success"], num_inv), "new": pct(metrics["new"]["e2e_success"], num_inv)},
    ]

    for row in comparison_table:
        row["delta"] = round(row["new"] - row["old"], 1)

    # Precision, Recall, Error Rate, Manual Correction Rate
    old_prec = pct(metrics["old"]["name_matches"], metrics["old"]["total_items_extracted"])
    new_prec = pct(metrics["new"]["name_matches"], metrics["new"]["total_items_extracted"])
    old_rec = pct(metrics["old"]["name_matches"], total_truth)
    new_rec = pct(metrics["new"]["name_matches"], total_truth)
    old_err = round(100.0 - old_prec, 1)
    new_err = round(100.0 - new_prec, 1)
    old_mcr = round(100.0 - pct(metrics["old"]["complete_rows"], total_truth), 1)
    new_mcr = round(100.0 - pct(metrics["new"]["complete_rows"], total_truth), 1)

    summary_results = {
        "dataset_size_invoices": num_inv,
        "dataset_total_ground_truth_items": total_truth,
        "comparison_table": comparison_table,
        "overall_precision": {"old": old_prec, "new": new_prec, "delta": round(new_prec - old_prec, 1)},
        "overall_recall": {"old": old_rec, "new": new_rec, "delta": round(new_rec - old_rec, 1)},
        "field_error_rate": {"old": old_err, "new": new_err, "delta": round(new_err - old_err, 1)},
        "manual_correction_rate": {"old": old_mcr, "new": new_mcr, "delta": round(new_mcr - old_mcr, 1)},
        "avg_latency_ms": {
            "old": round(metrics["old"]["total_time_ms"] / num_inv, 1),
            "new": round(metrics["new"]["total_time_ms"] / num_inv, 1),
        },
        "per_invoice_details": per_invoice_details,
    }

    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(summary_results, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 80)
    print("                     EMPIRICAL BENCHMARK COMPARISON TABLE")
    print("=" * 80)
    print(f"{'Dimension':<35} | {'Old Scanner':<12} | {'New Scanner':<12} | {'Improvement (Delta)':<18}")
    print("-" * 80)
    for r in comparison_table:
        sign = "+" if r["delta"] > 0 else ""
        print(f"{r['dimension']:<35} | {r['old']:>10.1f}% | {r['new']:>10.1f}% | {sign}{r['delta']:>16.1f}%")
    print("=" * 80)
    print(f"{'Overall Precision':<35} | {old_prec:>10.1f}% | {new_prec:>10.1f}% | +{new_prec - old_prec:>15.1f}%")
    print(f"{'Overall Recall':<35} | {old_rec:>10.1f}% | {new_rec:>10.1f}% | +{new_rec - old_rec:>15.1f}%")
    print(f"{'Field Error Rate':<35} | {old_err:>10.1f}% | {new_err:>10.1f}% | {new_err - old_err:>16.1f}%")
    print(f"{'Manual Correction Rate':<35} | {old_mcr:>10.1f}% | {new_mcr:>10.1f}% | {new_mcr - old_mcr:>16.1f}%")
    print("=" * 80)
    print(f"\nDetailed results saved to {RESULTS_FILE}")


if __name__ == "__main__":
    run_benchmark()
