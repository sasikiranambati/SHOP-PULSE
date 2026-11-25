"""
End-to-end OCR fixture benchmark: every invoice in tests/fixtures/ground_truth through the same
function the API calls (services.invoice.extract_invoice_from_bytes), scored field by field.

Reference: printed_values.json (values verified against the printed pages: PDF text layer, text
file or visual inspection; null = not printed). ground_truth.json has documented discrepancies with
several pages (see printed_values.json "_discrepancies") and can be selected with --truth ground.

A predicted line is paired with the reference line whose normalised name it contains (or is
contained in). Fields are scored only where the reference defines them; nothing is inferred.
Uses an isolated in-memory database (no products), never backend/shoppulse.db.

    cd backend && .venv/bin/python tests/ocr_fixture_benchmark.py [--json out.json] [--only TC22,TC01] [--truth ground]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import db.models  # noqa: E402,F401
from db.session import Base  # noqa: E402
from services.invoice import extract_invoice_from_bytes  # noqa: E402
from services.unit_registry import try_normalize_unit  # noqa: E402

FIXTURES = HERE / "fixtures" / "ground_truth"
RECTIFICATION = HERE / "fixtures" / "ocr_rectification"
FIELDS = ["quantity", "unit", "purchase_price", "mrp", "printed_amount", "pack_size", "rate_basis_unit"]


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def same_num(a, b, tol=0.011) -> bool:
    return a is not None and b is not None and abs(float(a) - float(b)) < tol


def same_unit(a, b) -> bool:
    ua, ub = try_normalize_unit(a) if a else None, try_normalize_unit(b) if b else None
    return ua is not None and ua == ub


def same_pack(item, truth, truth_unit=None) -> bool:
    if isinstance(truth, (int, float)):
        value, unit = float(truth), truth_unit
    else:
        m = re.match(r"^\s*([\d.]+)\s*([a-zA-Z]+)\s*$", truth or "")
        if not m:
            return False
        value, unit = float(m.group(1)), m.group(2)
    if item.get("pack_size") is None:
        return False
    return same_num(item["pack_size"], value, 1e-6) and same_unit(item.get("pack_size_unit"), unit)


def score_invoice(items, truth_items):
    """Returns per-field (correct, total), matched lines, and spurious lines."""
    stats = {f: [0, 0] for f in ["name"] + FIELDS}
    used = set()
    line_ok = 0
    details = []
    for t in truth_items:
        tn = norm(t["product_name"])
        hit = None
        for idx, it in enumerate(items):
            if idx in used:
                continue
            n = norm(it.get("product_name"))
            if n and (tn in n or n in tn):
                hit = idx
                break
        stats["name"][1] += 1
        row = {"truth": t["product_name"], "got": None, "errors": []}
        if hit is None:
            for f in FIELDS:
                if t.get(f) is not None:
                    stats[f][1] += 1
            row["errors"].append("missing")
            details.append(row)
            continue
        used.add(hit)
        it = items[hit]
        row["got"] = it.get("product_name")
        stats["name"][0] += 1
        all_ok = True
        for f in FIELDS:
            tv = t.get(f)
            if tv is None:
                continue
            stats[f][1] += 1
            if f == "unit":
                ok = same_unit(it.get("unit"), tv)
            elif f == "pack_size":
                ok = same_pack(it, tv, t.get("pack_size_unit"))
            elif f == "rate_basis_unit":
                ok = same_unit(it.get("rate_basis_unit"), tv)
            elif f == "printed_amount":
                ok = same_num(it.get("line_total"), tv)
            else:
                ok = same_num(it.get(f), tv)
            if ok:
                stats[f][0] += 1
            else:
                all_ok = False
                got = it.get("line_total") if f == "printed_amount" else (
                    f"{it.get('pack_size')} {it.get('pack_size_unit')}" if f == "pack_size" else it.get(f))
                row["errors"].append(f"{f}: expected {tv}, got {got}")
        line_ok += all_ok
        details.append(row)
    spurious = [it.get("product_name") for i, it in enumerate(items) if i not in used]
    return stats, line_ok, spurious, details


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--only")
    ap.add_argument("--truth", choices=["printed", "ground"], default="printed")
    args = ap.parse_args()
    if args.truth == "printed":
        truth = json.loads((FIXTURES / "printed_values.json").read_text(encoding="utf-8"))["cases"]
    else:
        truth = json.loads((FIXTURES / "ground_truth.json").read_text())
    only = set(args.only.split(",")) if args.only else None

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    shop_id = uuid.uuid4()

    total = {f: [0, 0] for f in ["name"] + FIELDS}
    lines_ok = lines_total = spurious_total = 0
    report = []
    cases = [(k, v, FIXTURES / "invoices" / v["filename"]) for k, v in truth.items()]
    if (RECTIFICATION / "expected.json").exists():
        for fname, items in json.loads((RECTIFICATION / "expected.json").read_text()).items():
            cases.append((Path(fname).stem, {"filename": fname, "items": items}, RECTIFICATION / fname))
    for key, inv, path in cases:
        if only and not any(key.startswith(o) for o in only):
            continue
        data = path.read_bytes()
        t0 = time.perf_counter()
        try:
            res = extract_invoice_from_bytes(data, inv["filename"], db, shop_id)
            items = [i.model_dump() for i in res.items]
            status = res.status
        except Exception as exc:  # reported, not hidden
            items, status = [], f"ERROR {type(exc).__name__}: {exc}"
        ms = (time.perf_counter() - t0) * 1000
        stats, ok, spurious, details = score_invoice(items, inv["items"])
        for f in total:
            total[f][0] += stats[f][0]
            total[f][1] += stats[f][1]
        lines_ok += ok
        lines_total += len(inv["items"])
        spurious_total += len(spurious)
        report.append({"invoice": key, "status": status, "ms": round(ms), "expected": len(inv["items"]),
                       "extracted": len(items), "lines_fully_correct": ok, "spurious": spurious,
                       "errors": [d for d in details if d["errors"]]})
        print(f"{key:34s} {status:14.14s} {len(items):3d}/{len(inv['items']):<3d} ok={ok:<3d} "
              f"spurious={len(spurious)} {ms:7.0f} ms")

    print("\nField accuracy (correct / defined in ground truth):")
    summary = {}
    for f, (c, n) in total.items():
        pct = round(100.0 * c / n, 1) if n else None
        summary[f] = {"correct": c, "total": n, "pct": pct}
        print(f"  {f:16s} {c:4d}/{n:<4d} {pct if pct is not None else '-'}%")
    print(f"  complete lines   {lines_ok:4d}/{lines_total:<4d} {round(100.0 * lines_ok / lines_total, 1)}%")
    print(f"  spurious lines   {spurious_total}")
    if args.json:
        Path(args.json).write_text(json.dumps({"summary": summary, "lines_ok": lines_ok, "lines_total": lines_total,
                                               "spurious": spurious_total, "invoices": report}, indent=1))


if __name__ == "__main__":
    main()
