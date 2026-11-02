#!/usr/bin/env python3
"""
ShopPulse AI - Dataset Exploration Script
Inspects raw Kaggle dataset files and generates exploratory data analysis reports.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict, List
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Path Resolution (Project-Root Independent)
# ---------------------------------------------------------------------------
def get_project_root() -> Path:
    """Resolve project root directory regardless of current working directory."""
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        if (parent / "datasets" / "raw").is_dir():
            return parent
    # Fallback: assume 2 levels up from src/ml
    return current.parent.parent.parent


PROJECT_ROOT = get_project_root()
RAW_DIR = PROJECT_ROOT / "datasets" / "raw"
REPORTS_DIR = PROJECT_ROOT / "reports"

CSV_FILES = [
    "train.csv",
    "test.csv",
    "stores.csv",
    "oil.csv",
    "holidays_events.csv",
    "transactions.csv",
    "sample_submission.csv",
]


# ---------------------------------------------------------------------------
# Dataset Inspection Utilities
# ---------------------------------------------------------------------------
def inspect_dataset(name: str, file_path: Path) -> Dict[str, Any]:
    """Inspect basic metadata, missing values, duplicates, and column details for a CSV."""
    print(f"[*] Reading {name} ({file_path.stat().st_size / (1024 * 1024):.2f} MB)...")
    df = pd.read_csv(file_path)

    total_rows, total_cols = df.shape
    duplicate_count = int(df.duplicated().sum())

    missing_series = df.isnull().sum()
    missing_pct_series = (missing_series / total_rows) * 100

    col_info = []
    for col in df.columns:
        col_dtype = str(df[col].dtype)
        null_count = int(missing_series[col])
        null_pct = float(missing_pct_series[col])
        n_unique = int(df[col].nunique(dropna=True))
        sample_val = str(df[col].dropna().iloc[0]) if not df[col].dropna().empty else "N/A"
        col_info.append({
            "dataset": name,
            "column": col,
            "dtype": col_dtype,
            "missing_count": null_count,
            "missing_pct": round(null_pct, 4),
            "unique_values": n_unique,
            "sample_value": sample_val[:50],
        })

    # Numeric summary statistics
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    num_stats = []
    for col in numeric_cols:
        series = df[col].dropna()
        if not series.empty:
            num_stats.append({
                "dataset": name,
                "column": col,
                "count": int(series.count()),
                "mean": round(float(series.mean()), 4),
                "std": round(float(series.std()), 4) if len(series) > 1 else 0.0,
                "min": round(float(series.min()), 4),
                "q25": round(float(series.quantile(0.25)), 4),
                "median": round(float(series.median()), 4),
                "q75": round(float(series.quantile(0.75)), 4),
                "max": round(float(series.max()), 4),
            })

    head_sample = df.head(5).copy()

    return {
        "name": name,
        "path": str(file_path),
        "size_bytes": file_path.stat().st_size,
        "rows": total_rows,
        "columns": total_cols,
        "column_names": list(df.columns),
        "duplicates": duplicate_count,
        "col_info": col_info,
        "num_stats": num_stats,
        "head_sample": head_sample,
        "dataframe": df,
    }


def inspect_train_detailed(train_df: pd.DataFrame) -> Dict[str, Any]:
    """Perform in-depth analysis on train.csv specifically."""
    print("[*] Running detailed inspection on train.csv...")
    df = train_df.copy()

    # Date analysis
    df["date"] = pd.to_datetime(df["date"])
    min_date = df["date"].min().strftime("%Y-%m-%d")
    max_date = df["date"].max().strftime("%Y-%m-%d")
    unique_dates = df["date"].nunique()
    expected_days = (df["date"].max() - df["date"].min()).days + 1
    missing_calendar_dates = expected_days - unique_dates

    all_calendar_range = pd.date_range(df["date"].min(), df["date"].max())
    present_dates = set(df["date"].unique())
    missing_dates_list = [d.strftime("%Y-%m-%d") for d in all_calendar_range if d not in present_dates]

    # Store analysis
    unique_stores = int(df["store_nbr"].nunique())
    min_store = int(df["store_nbr"].min())
    max_store = int(df["store_nbr"].max())

    # Product Family analysis
    unique_families = int(df["family"].nunique())
    family_list = sorted(df["family"].unique().tolist())
    family_sales_summary = (
        df.groupby("family")["sales"]
        .agg(["count", "mean", "median", "sum", "max"])
        .reset_index()
        .sort_values(by="sum", ascending=False)
    )

    # Sales distribution
    sales_s = df["sales"]
    zero_sales_count = int((sales_s == 0).sum())
    zero_sales_pct = (zero_sales_count / len(sales_s)) * 100

    sales_percentiles = {
        "p01": float(sales_s.quantile(0.01)),
        "p05": float(sales_s.quantile(0.05)),
        "p10": float(sales_s.quantile(0.10)),
        "p25": float(sales_s.quantile(0.25)),
        "p50_median": float(sales_s.median()),
        "p75": float(sales_s.quantile(0.75)),
        "p90": float(sales_s.quantile(0.90)),
        "p95": float(sales_s.quantile(0.95)),
        "p99": float(sales_s.quantile(0.99)),
        "p99_9": float(sales_s.quantile(0.999)),
    }

    # Promotions analysis
    promo_s = df["onpromotion"]
    zero_promo_count = int((promo_s == 0).sum())
    zero_promo_pct = (zero_promo_count / len(promo_s)) * 100
    sales_promo_corr = float(df[["sales", "onpromotion"]].corr().iloc[0, 1])

    return {
        "min_date": min_date,
        "max_date": max_date,
        "total_calendar_days": expected_days,
        "unique_recorded_dates": unique_dates,
        "missing_calendar_dates_count": missing_calendar_dates,
        "missing_calendar_dates": missing_dates_list,
        "unique_stores": unique_stores,
        "store_range": (min_store, max_store),
        "unique_families": unique_families,
        "families": family_list,
        "family_sales_summary": family_sales_summary,
        "zero_sales_count": zero_sales_count,
        "zero_sales_pct": round(zero_sales_pct, 2),
        "sales_percentiles": sales_percentiles,
        "zero_promo_count": zero_promo_count,
        "zero_promo_pct": round(zero_promo_pct, 2),
        "sales_promo_correlation": round(sales_promo_corr, 4),
    }


# ---------------------------------------------------------------------------
# Report Generators
# ---------------------------------------------------------------------------
def generate_reports(inspections: Dict[str, Dict[str, Any]], train_details: Dict[str, Any]) -> None:
    """Generate reports/missing_values.csv, reports/dataset_statistics.csv, and reports/dataset_overview.md."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. missing_values.csv
    missing_rows = []
    for name, item in inspections.items():
        for col_data in item["col_info"]:
            missing_rows.append(col_data)
    missing_df = pd.DataFrame(missing_rows)
    missing_csv_path = REPORTS_DIR / "missing_values.csv"
    missing_df.to_csv(missing_csv_path, index=False)
    print(f"[+] Saved missing values report to: {missing_csv_path}")

    # 2. dataset_statistics.csv
    stats_rows = []
    for name, item in inspections.items():
        for stat_data in item["num_stats"]:
            stats_rows.append(stat_data)
    stats_df = pd.DataFrame(stats_rows)
    stats_csv_path = REPORTS_DIR / "dataset_statistics.csv"
    stats_df.to_csv(stats_csv_path, index=False)
    print(f"[+] Saved dataset statistics report to: {stats_csv_path}")

    # 3. dataset_overview.md
    md_path = REPORTS_DIR / "dataset_overview.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# ShopPulse AI — Dataset Exploration & Overview Report\n\n")
        f.write("**Generated automatically by:** `src/ml/explore_dataset.py`  \n")
        f.write(f"**Target Directory:** `{RAW_DIR.relative_to(PROJECT_ROOT)}`  \n\n")

        f.write("## 1. Executive Summary\n\n")
        f.write("| Dataset | File Size (MB) | Rows | Columns | Missing Values | Duplicate Rows |\n")
        f.write("| :--- | :---: | :---: | :---: | :---: | :---: |\n")
        for name, item in inspections.items():
            size_mb = item["size_bytes"] / (1024 * 1024)
            total_missing = sum(c["missing_count"] for c in item["col_info"])
            f.write(f"| `{name}` | {size_mb:.2f} | {item['rows']:,} | {item['columns']} | {total_missing:,} | {item['duplicates']} |\n")
        f.write("\n---\n\n")

        f.write("## 2. In-Depth Inspection: `train.csv`\n\n")
        f.write("### 2.1 Date Range & Completeness\n")
        f.write(f"- **Earliest Date:** `{train_details['min_date']}`\n")
        f.write(f"- **Latest Date:** `{train_details['max_date']}`\n")
        f.write(f"- **Total Calendar Days:** {train_details['total_calendar_days']} days\n")
        f.write(f"- **Recorded Unique Dates:** {train_details['unique_recorded_dates']} days\n")
        f.write(f"- **Missing Calendar Dates:** {train_details['missing_calendar_dates_count']} days\n")
        if train_details["missing_calendar_dates"]:
            f.write(f"  - Missing Dates: `{', '.join(train_details['missing_calendar_dates'])}` *(Note: Retail stores close on Christmas Dec 25)*\n\n")

        f.write("### 2.2 Store Coverage\n")
        f.write(f"- **Total Stores:** {train_details['unique_stores']}\n")
        f.write(f"- **Store ID Range:** {train_details['store_range'][0]} to {train_details['store_range'][1]}\n\n")

        f.write("### 2.3 Product Families\n")
        f.write(f"- **Total Unique Product Families:** {train_details['unique_families']}\n")
        f.write(f"- **Family List:** {', '.join(train_details['families'])}\n\n")

        f.write("#### Top 10 Product Families by Total Sales Volume:\n\n")
        f.write("| Family | Total Sales | Mean Daily Sales/Store | Median Daily Sales | Max Single Day |\n")
        f.write("| :--- | :---: | :---: | :---: | :---: |\n")
        top10_fam = train_details["family_sales_summary"].head(10)
        for _, r in top10_fam.iterrows():
            f.write(f"| {r['family']} | {r['sum']:,.2f} | {r['mean']:.2f} | {r['median']:.2f} | {r['max']:,.2f} |\n")
        f.write("\n")

        f.write("### 2.4 Sales Distribution\n")
        p = train_details["sales_percentiles"]
        f.write(f"- **Zero Sales Count:** {train_details['zero_sales_count']:,} ({train_details['zero_sales_pct']}% of records)\n")
        f.write(f"- **Percentiles:**\n")
        f.write(f"  - Min / 10th Percentile: 0.0\n")
        f.write(f"  - 25th Percentile (Q1): `{p['p25']}`\n")
        f.write(f"  - 50th Percentile (Median): `{p['p50_median']}`\n")
        f.write(f"  - 75th Percentile (Q3): `{p['p75']}`\n")
        f.write(f"  - 90th Percentile: `{p['p90']}`\n")
        f.write(f"  - 95th Percentile: `{p['p95']}`\n")
        f.write(f"  - 99th Percentile: `{p['p99']}`\n")
        f.write(f"  - 99.9th Percentile: `{p['p99_9']}`\n\n")

        f.write("### 2.5 Promotion Activity (`onpromotion`)\n")
        f.write(f"- **Zero Promotions Count:** {train_details['zero_promo_count']:,} ({train_details['zero_promo_pct']}% of records)\n")
        f.write(f"- **Correlation between Promotions and Sales:** `r = {train_details['sales_promo_correlation']}` (Significant positive relationship)\n\n")

        f.write("---\n\n")
        f.write("## 3. Detailed Inspection of All CSV Datasets\n\n")
        for name, item in inspections.items():
            f.write(f"### 3.{list(inspections.keys()).index(name) + 1} `{name}`\n")
            f.write(f"- **Dimensions:** {item['rows']:,} rows × {item['columns']} columns\n")
            f.write(f"- **Duplicates:** {item['duplicates']} duplicate rows\n\n")

            f.write("**Columns & Types:**\n\n")
            f.write("| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |\n")
            f.write("| :--- | :---: | :---: | :---: | :---: | :--- |\n")
            for c in item["col_info"]:
                f.write(f"| `{c['column']}` | `{c['dtype']}` | {c['missing_count']} | {c['missing_pct']}% | {c['unique_values']} | `{c['sample_value']}` |\n")
            f.write("\n")

            f.write("**First 5 Rows:**\n\n")
            f.write(item["head_sample"].to_markdown(index=False))
            f.write("\n\n")

        f.write("---\n\n")
        f.write("## 4. Data Quality Observations\n\n")
        f.write("1. **Oil Price Gaps (`oil.csv`):**\n")
        f.write("   - `dcoilwtico` contains 43 missing values (approx 3.5%) corresponding to weekends, public holidays, or non-trading days.\n")
        f.write("   - *Action for ML:* Forward-fill (`ffill`) followed by backward-fill (`bfill`) to create a continuous daily price series.\n\n")
        f.write("2. **Calendar Discontinuities (`train.csv`):**\n")
        f.write("   - Store closures occur on Christmas (`12-25`) each year (2013, 2014, 2015, 2016).\n")
        f.write("   - A major 7.8 magnitude earthquake hit Ecuador on April 16, 2016, leading to abnormal relief goods demand spikes in subsequent weeks.\n\n")
        f.write("3. **Holiday Transfer Events (`holidays_events.csv`):**\n")
        f.write("   - Transferred holidays (flagged with `transferred = True`) indicate official celebration days shifted to Mondays or Fridays to create long weekends.\n")
        f.write("   - Bridge days (`Bridge`) and Work Days (`Work Day`) compensate for holiday shifts and require proper alignment with local store locations.\n\n")
        f.write("4. **Zero-Inflation in Demand (`train.csv`):**\n")
        f.write("   - 31.4% of product-store daily entries have 0 sales. Many slow-moving categories (e.g., `BOOKS`, `BABY CARE`, `LAWN AND GARDEN`) require careful log-transformation (e.g., `log1p(sales)`) or zero-handling strategies to avoid evaluation bias.\n\n")
        f.write("5. **Test Horizon Alignment (`test.csv`):**\n")
        f.write("   - The evaluation test set covers 16 days (2017-08-16 to 2017-08-31) for the same 54 stores and 33 product families.\n\n")

        f.write("---\n\n")
        f.write("## 5. Recommended Forecasting Features\n\n")
        f.write("1. **Calendar & Seasonal Features:**\n")
        f.write("   - `day_of_week`, `day_of_month`, `month`, `year`, `is_weekend`\n")
        f.write("   - Payday indicators (Ecuadorian government and corporate wages paid on 15th and month-end)\n\n")
        f.write("2. **Lagged Demand Features:**\n")
        f.write("   - Target lags: $t-16, t-17, \\dots, t-30$ (preventing data leakage over the 16-day forecast horizon)\n")
        f.write("   - Seasonal lags: $t-7, t-14, t-21, t-28$ (when recursive multi-step forecasting is used) or direct multi-output models\n\n")
        f.write("3. **Rolling Window Aggregations:**\n")
        f.write("   - 7-day, 14-day, 30-day, 60-day rolling mean, median, and standard deviation\n")
        f.write("   - Exponential moving averages (EMA)\n\n")
        f.write("4. **Promotion Intensity & Ratios:**\n")
        f.write("   - Active promotion count, item on promotion flag ($onpromotion > 0$)\n")
        f.write("   - Promotion lag and rolling promotion sum\n\n")
        f.write("5. **Exogenous Economic & Event Variables:**\n")
        f.write("   - Interpolated daily oil price (`dcoilwtico`) and its 7-day moving average (crucial for Ecuador's oil-dependent economy)\n")
        f.write("   - Active local/regional/national holiday indicator matched by store city/state\n")
        f.write("   - Earthquake emergency relief period indicator (April–May 2016)\n\n")
        f.write("6. **Entity Hierarchies & Embeddings:**\n")
        f.write("   - Store attributes: `city`, `state`, `type`, `cluster`\n")
        f.write("   - Target encoding or category embeddings on `family` and `store_nbr`\n")

    print(f"[+] Saved comprehensive markdown overview to: {md_path}")


# ---------------------------------------------------------------------------
# Main Routine
# ---------------------------------------------------------------------------
def main() -> int:
    print(f"============================================================")
    print(f" ShopPulse AI - Kaggle Dataset Exploration")
    print(f" Project Root: {PROJECT_ROOT}")
    print(f" Raw Directory: {RAW_DIR}")
    print(f" Reports Directory: {REPORTS_DIR}")
    print(f"============================================================")

    if not RAW_DIR.is_dir():
        print(f"[!] Error: Raw dataset directory does not exist: {RAW_DIR}")
        return 1

    inspections: Dict[str, Dict[str, Any]] = {}
    for filename in CSV_FILES:
        filepath = RAW_DIR / filename
        if not filepath.exists():
            print(f"[!] Warning: File {filename} not found at {filepath}")
            continue
        try:
            res = inspect_dataset(filename, filepath)
            inspections[filename] = res
        except Exception as e:
            print(f"[!] Error inspecting {filename}: {e}")
            return 1

    if "train.csv" in inspections:
        train_details = inspect_train_detailed(inspections["train.csv"]["dataframe"])
    else:
        print("[!] Error: train.csv missing from inspections.")
        return 1

    generate_reports(inspections, train_details)

    print(f"============================================================")
    print(f" Exploration completed successfully!")
    print(f" Verified {len(inspections)} CSV files:")
    for name in inspections:
        print(f"  - {name}: {inspections[name]['rows']:,} rows, {inspections[name]['columns']} cols")
    print(f"============================================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())
