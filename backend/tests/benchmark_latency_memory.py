"""
Comprehensive Latency and Peak Memory Benchmarking Suite for ShopPulse Grocery OCR Pipeline.
Measures per-stage latency and peak resident memory consumption across small, medium, and large documents.
"""

import gc
import json
import os
import sys
import time
import tracemalloc
from typing import Any, Dict

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.grocery_ocr.engines.ocr_engine import TesseractOCREngine
from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "ground_truth", "invoices")

DOCUMENTS = {
    "small": {
        "file": "TC02_bordered_image.png",
        "description": "Small 1-page image (4 items, crisp layout)",
        "type": "image"
    },
    "medium": {
        "file": "TC13_sri_balaji_13items.png",
        "description": "Medium 1-page image (13 wholesale items, dot matrix table)",
        "type": "image"
    },
    "large": {
        "file": "TC07_long_40_lines.pdf",
        "description": "Large multi-line document (40 line items)",
        "type": "pdf"
    }
}

def benchmark_document(doc_key: str, doc_info: Dict[str, Any]) -> Dict[str, Any]:
    file_path = os.path.join(FIXTURES_DIR, doc_info["file"])
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    file_size_kb = round(len(file_bytes) / 1024.0, 1)

    gc.collect()
    tracemalloc.start()
    start_wall_time = time.perf_counter()

    pipeline = InvoicePipeline(ocr_engine=TesseractOCREngine())
    result = pipeline.process(file_bytes, doc_info["file"])

    end_wall_time = time.perf_counter()
    current_mem, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    total_latency_ms = round((end_wall_time - start_wall_time) * 1000.0, 2)
    peak_mem_mb = round(peak_mem / (1024.0 * 1024.0), 2)

    stage_timings = dict(result.metadata.stage_timings_ms)

    return {
        "doc_key": doc_key,
        "filename": doc_info["file"],
        "description": doc_info["description"],
        "file_size_kb": file_size_kb,
        "items_extracted": len(result.items),
        "status": result.status,
        "total_latency_ms": total_latency_ms,
        "peak_memory_mb": peak_mem_mb,
        "stage_timings_ms": stage_timings,
    }

def run_benchmarks():
    print("=" * 80)
    print("SHOPPULSE GROCERY OCR PIPELINE: LATENCY & MEMORY PROFILE")
    print("=" * 80)

    results = {}
    for key, info in DOCUMENTS.items():
        print(f"\nBenchmarking {key.upper()} document: {info['file']}...")
        bench = benchmark_document(key, info)
        results[key] = bench
        print(f"  -> File Size: {bench['file_size_kb']} KB")
        print(f"  -> Extracted Items: {bench['items_extracted']}")
        print(f"  -> Total Latency: {bench['total_latency_ms']} ms ({round(bench['total_latency_ms']/1000.0, 2)} s)")
        print(f"  -> Peak Memory: {bench['peak_memory_mb']} MB")
        print("  -> Stage Latency Breakdown:")
        for s_name, s_ms in bench.get("stage_timings_ms", {}).items():
            pct = round((s_ms / max(bench['total_latency_ms'], 1.0)) * 100.0, 1)
            print(f"     • {s_name:<32}: {s_ms:>8.2f} ms ({pct:>5.1f}%)")

    out_path = os.path.join(os.path.dirname(__file__), "fixtures", "ground_truth", "performance_benchmark.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nBenchmark results saved to: {out_path}")

if __name__ == "__main__":
    run_benchmarks()

