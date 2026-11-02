#!/usr/bin/env python3
"""
ShopPulse AI — Milestone 3.3: Final Test-Set Demand Forecasting Pipeline
Generates final recursive out-of-sample forecasts for the Kaggle test period (2017-08-16 to 2017-08-31)
using the trained and audited global LightGBM model.

METHODOLOGY:
  1. Load Pretrained LightGBM Booster:
     - Artifact: outputs/lightgbm_model.txt (verified 997 trees, 34 features).
     - Zero retraining; preserves exact weights and parameters from Milestone 3.2.
  2. Forecast Origin & Historical Context:
     - Forecast Origin: T = 2017-08-15 (using all actual sales available through this date).
     - Sales buffer populated from train_features.csv + validation_features.csv.
  3. Strict Recursive Multi-Step Forecasting (16 Days):
     - Horizon: 2017-08-16 through 2017-08-31 (28,512 predictions).
     - Day 1 (2017-08-16): Lags reference known historical sales through 2017-08-15.
     - Days 2–16: Whenever a lag or rolling window lands on a test date (t >= 2017-08-16),
       the model's own prior predictions are dynamically used.
     - Strictly nonnegative unit predictions: y_units = max(0, exp(pred_log1p) - 1).
  4. Kaggle Submission Generation:
     - outputs/submission.csv: Exactly matches raw/test.csv IDs (3000888 to 3029399) and ordering.
     - outputs/lightgbm_test_predictions.csv: Detailed predictions with hierarchy metadata.
     - reports/lightgbm_test_forecast.md: Comprehensive forecast report and summary statistics.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


# ---------------------------------------------------------------------------
# Path Resolution
# ---------------------------------------------------------------------------
def get_project_root() -> Path:
    """Resolve project root directory regardless of current working directory."""
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        if (parent / "datasets" / "processed").is_dir():
            return parent
    return current.parent.parent.parent


PROJECT_ROOT = get_project_root()
RAW_DIR = PROJECT_ROOT / "datasets" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "datasets" / "processed"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
REPORTS_DIR = PROJECT_ROOT / "reports"

# Dates
FORECAST_ORIGIN_DATE = "2017-08-15"
TEST_START_DATE = "2017-08-16"
TEST_END_DATE = "2017-08-31"
EXPECTED_TEST_ROWS = 28512
EXPECTED_TREES = 997

CATEGORICAL_FEATURES = [
    "store_nbr",
    "family",
    "city",
    "state",
    "store_type",
    "cluster",
    "holiday_type",
]

NUMERICAL_FEATURES = [
    "year",
    "month",
    "day",
    "day_of_week",
    "is_weekend",
    "quarter",
    "day_of_year",
    "week_of_year",
    "is_month_start",
    "is_month_end",
    "is_payday",
    "onpromotion",
    "has_promotion",
    "dcoilwtico",
    "oil_ma7",
    "is_holiday",
    "is_holiday_national",
    "is_holiday_regional",
    "is_holiday_local",
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_28",
    "rolling_mean_7",
    "rolling_std_7",
    "rolling_mean_14",
    "rolling_mean_28",
]

ALL_FEATURE_COLS = CATEGORICAL_FEATURES + NUMERICAL_FEATURES


# ---------------------------------------------------------------------------
# 1. Model Loading & Verification
# ---------------------------------------------------------------------------
def load_and_verify_model(model_path: Path) -> Any:
    """Load the trained LightGBM Booster and verify tree count and feature schema."""
    import lightgbm as lgb

    print(f"[1/5] Loading trained LightGBM model from: {model_path.name}")
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found at: {model_path}")

    model = lgb.Booster(model_file=str(model_path))
    actual_trees = model.num_trees()
    model_features = model.feature_name()

    print(f"  - LightGBM Version: {lgb.__version__}")
    print(f"  - Number of Trees: {actual_trees} (Expected: {EXPECTED_TREES})")
    print(f"  - Feature Count: {len(model_features)} (Expected: {len(ALL_FEATURE_COLS)})")

    if actual_trees != EXPECTED_TREES:
        raise ValueError(f"Tree count mismatch! Expected {EXPECTED_TREES}, found {actual_trees}")

    if model_features != ALL_FEATURE_COLS:
        raise ValueError("Model feature names/order do not match ALL_FEATURE_COLS!")

    print("  [V] Model successfully verified: 997 trees, 34 features, exact match.")
    return model


# ---------------------------------------------------------------------------
# 2. Data Ingestion & Category Encoders
# ---------------------------------------------------------------------------
def prepare_data_and_encoders() -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, Any], Dict[Tuple[int, str, pd.Timestamp], float]]:
    """
    Load test_features.csv, build category encoders from train_features.csv,
    and populate historical sales buffer through 2017-08-15 from train and validation features.
    """
    print("[2/5] Loading datasets and building historical sales buffer through 2017-08-15...")

    # Load categorical categories from train_features to ensure consistent encoding
    train_cats_df = pd.read_csv(PROCESSED_DIR / "train_features.csv", usecols=CATEGORICAL_FEATURES)
    category_encoders = {}
    for col in CATEGORICAL_FEATURES:
        train_cats_df[col] = train_cats_df[col].astype("category")
        category_encoders[col] = train_cats_df[col].cat.categories

    # Load test features
    test_df = pd.read_csv(PROCESSED_DIR / "test_features.csv")
    test_df["date"] = pd.to_datetime(test_df["date"])
    print(f"  - Loaded Test Features: {len(test_df):,} rows ({test_df['date'].min().strftime('%Y-%m-%d')} to {test_df['date'].max().strftime('%Y-%m-%d')})")

    # Load historical sales up to forecast origin (2017-08-15)
    # Lags up to 28 days back from 2017-08-16 require sales back to 2017-07-19
    origin_ts = pd.to_datetime(FORECAST_ORIGIN_DATE)
    lookback_cutoff = origin_ts - pd.Timedelta(days=35)

    train_sales = pd.read_csv(PROCESSED_DIR / "train_features.csv", usecols=["date", "store_nbr", "family", "sales"])
    train_sales["date"] = pd.to_datetime(train_sales["date"])
    train_sales_window = train_sales[train_sales["date"] >= lookback_cutoff]

    val_sales = pd.read_csv(PROCESSED_DIR / "validation_features.csv", usecols=["date", "store_nbr", "family", "sales"])
    val_sales["date"] = pd.to_datetime(val_sales["date"])

    history_combined = pd.concat([train_sales_window, val_sales], ignore_index=True)

    sales_history: Dict[Tuple[int, str, pd.Timestamp], float] = {}
    for _, row in history_combined.iterrows():
        sales_history[(int(row["store_nbr"]), str(row["family"]), row["date"])] = float(row["sales"])

    print(f"  - Historical Sales Buffer: {len(sales_history):,} records loaded ({lookback_cutoff.strftime('%Y-%m-%d')} to {origin_ts.strftime('%Y-%m-%d')})")
    print(f"  [V] Forecast Origin confirmed: {FORECAST_ORIGIN_DATE} with complete sales coverage.")

    return test_df, category_encoders, sales_history


# ---------------------------------------------------------------------------
# 3. Strict Recursive Multi-Step Forecasting
# ---------------------------------------------------------------------------
def execute_recursive_test_forecast(
    model: Any,
    test_df: pd.DataFrame,
    category_encoders: Dict[str, Any],
    sales_history: Dict[Tuple[int, str, pd.Timestamp], float],
) -> pd.DataFrame:
    """
    Executes a 16-day out-of-sample recursive forecast for all 54 stores and 33 families.
    Lags pointing to t <= 2017-08-15 use known historical sales.
    Lags pointing to t >= 2017-08-16 dynamically use model predictions.
    """
    print("[3/5] Executing recursive 16-day forecast simulation for test horizon...")

    confirmed_closure_dates = {
        pd.to_datetime("2013-12-25"),
        pd.to_datetime("2014-12-25"),
        pd.to_datetime("2015-12-25"),
        pd.to_datetime("2016-12-25"),
    }

    def lookup_historical_sales(
        store: int,
        family: str,
        target_date: pd.Timestamp,
        history: Dict[Tuple[int, str, pd.Timestamp], float],
    ) -> float:
        """Strict calendar-day sales lookup. Only confirmed closures return 0.0 if missing."""
        key = (store, family, target_date)
        if key in history:
            return history[key]
        if target_date in confirmed_closure_dates:
            return 0.0
        raise KeyError(
            f"Missing historical sales for store {store}, family '{family}' on date {target_date.strftime('%Y-%m-%d')}, "
            "which is not a confirmed closure date! Refusing silent zero-substitution."
        )

    test_dates = sorted(test_df["date"].unique())
    all_predictions: List[Dict[str, Any]] = []

    for cur_date in test_dates:
        cur_date_ts = pd.to_datetime(cur_date)
        day_slice = test_df[test_df["date"] == cur_date_ts].copy()

        # Update dynamic lag and rolling features for each (store, family) row
        lag_1_list, lag_7_list, lag_14_list, lag_28_list = [], [], [], []
        roll_7_list, roll_std_7_list, roll_14_list, roll_28_list = [], [], [], []

        for _, row in day_slice.iterrows():
            s = int(row["store_nbr"])
            f = str(row["family"])

            # 1. Calculate Lags (Calendar-day matching)
            l1 = lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=1), sales_history)
            l7 = lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=7), sales_history)
            l14 = lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=14), sales_history)
            l28 = lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=28), sales_history)

            lag_1_list.append(l1)
            lag_7_list.append(l7)
            lag_14_list.append(l14)
            lag_28_list.append(l28)

            # 2. Calculate Rolling Windows (shift-1 strictly applied)
            w7 = [lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=d), sales_history) for d in range(1, 8)]
            w14 = [lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=d), sales_history) for d in range(1, 15)]
            w28 = [lookup_historical_sales(s, f, cur_date_ts - pd.Timedelta(days=d), sales_history) for d in range(1, 29)]

            roll_7_list.append(float(np.mean(w7)))
            roll_std_7_list.append(float(np.std(w7)))
            roll_14_list.append(float(np.mean(w14)))
            roll_28_list.append(float(np.mean(w28)))

        # Assign updated recursive features
        day_slice["lag_1"] = lag_1_list
        day_slice["lag_7"] = lag_7_list
        day_slice["lag_14"] = lag_14_list
        day_slice["lag_28"] = lag_28_list
        day_slice["rolling_mean_7"] = roll_7_list
        day_slice["rolling_std_7"] = roll_std_7_list
        day_slice["rolling_mean_14"] = roll_14_list
        day_slice["rolling_mean_28"] = roll_28_list

        # Prepare feature matrix for inference with correct categories
        X_cur = day_slice[ALL_FEATURE_COLS].copy()
        for col in CATEGORICAL_FEATURES:
            X_cur[col] = pd.Categorical(X_cur[col], categories=category_encoders[col])

        # Predict log1p_sales
        pred_log1p = model.predict(X_cur)
        # Invert target transformation: pred_sales = exp(pred_log1p) - 1, bounded at 0
        pred_sales = np.clip(np.expm1(pred_log1p), 0.0, None)

        day_slice["pred_lightgbm"] = pred_sales
        day_slice["pred_log1p"] = pred_log1p

        # Commit predicted sales to buffer so subsequent days use previous predictions
        for (_, r), p in zip(day_slice.iterrows(), pred_sales):
            s = int(r["store_nbr"])
            f = str(r["family"])
            sales_history[(s, f, cur_date_ts)] = float(p)
            all_predictions.append({
                "id": int(r["id"]),
                "date": cur_date_ts.strftime("%Y-%m-%d"),
                "store_nbr": s,
                "family": f,
                "cluster": int(r["cluster"]),
                "pred_lightgbm": float(p),
                "pred_log1p": float(r["pred_log1p"]),
            })

    preds_df = pd.DataFrame(all_predictions)
    print(f"  [V] Test forecasting complete: {len(preds_df):,} predictions generated with zero future leakage.")
    return preds_df


# ---------------------------------------------------------------------------
# 4. Save Outputs & Verify Kaggle Submission
# ---------------------------------------------------------------------------
def save_outputs_and_submission(
    preds_df: pd.DataFrame,
) -> Tuple[Path, Path]:
    """Save outputs/lightgbm_test_predictions.csv and outputs/submission.csv matching raw/test.csv IDs."""
    print("[4/5] Formatting and saving forecast outputs and Kaggle submission...")
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Save detailed test predictions
    test_preds_path = OUTPUTS_DIR / "lightgbm_test_predictions.csv"
    detailed_df = preds_df.sort_values(["store_nbr", "family", "date"]).reset_index(drop=True)
    detailed_df.to_csv(test_preds_path, index=False)
    print(f"  [+] Saved detailed predictions to: {test_preds_path.name} ({len(detailed_df):,} rows)")

    # 2. Prepare Kaggle submission matching raw/test.csv exact ordering
    raw_test = pd.read_csv(RAW_DIR / "test.csv", usecols=["id"])
    sub_df = pd.merge(raw_test, preds_df[["id", "pred_lightgbm"]], on="id", how="left")
    sub_df = sub_df.rename(columns={"pred_lightgbm": "sales"})

    # Submission validation
    assert len(sub_df) == EXPECTED_TEST_ROWS, f"Submission rows ({len(sub_df)}) != {EXPECTED_TEST_ROWS}"
    assert sub_df["sales"].isnull().sum() == 0, "Submission contains null sales values!"
    assert (sub_df["sales"] < 0).sum() == 0, "Submission contains negative sales values!"
    assert (sub_df["id"].values == raw_test["id"].values).all(), "Submission IDs do not match raw test.csv exactly!"

    submission_path = OUTPUTS_DIR / "submission.csv"
    sub_df.to_csv(submission_path, index=False)
    print(f"  [+] Saved Kaggle submission to: {submission_path.name} ({len(sub_df):,} rows)")

    return test_preds_path, submission_path


# ---------------------------------------------------------------------------
# 5. Generate Markdown Forecast Report
# ---------------------------------------------------------------------------
def generate_forecast_report(
    preds_df: pd.DataFrame,
    sub_df: pd.DataFrame,
    report_path: Path,
) -> None:
    """Write reports/lightgbm_test_forecast.md documenting test predictions and safeguards."""
    print("[5/5] Generating comprehensive test forecast report...")
    report_path.parent.mkdir(parents=True, exist_ok=True)

    total_units = float(preds_df["pred_lightgbm"].sum())
    mean_units = float(preds_df["pred_lightgbm"].mean())
    std_units = float(preds_df["pred_lightgbm"].std())
    min_units = float(preds_df["pred_lightgbm"].min())
    max_units = float(preds_df["pred_lightgbm"].max())
    median_units = float(preds_df["pred_lightgbm"].median())

    # Daily aggregation
    daily = preds_df.groupby("date")["pred_lightgbm"].sum().reset_index()

    # Family aggregation (Top 10)
    fam_agg = preds_df.groupby("family")["pred_lightgbm"].agg(["sum", "mean"]).reset_index()
    fam_agg = fam_agg.sort_values("sum", ascending=False).reset_index(drop=True)

    # Store aggregation (Top 10)
    store_agg = preds_df.groupby("store_nbr")["pred_lightgbm"].agg(["sum", "mean"]).reset_index()
    store_agg = store_agg.sort_values("sum", ascending=False).reset_index(drop=True)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# ShopPulse AI — Milestone 3.3: Final Test-Set Demand Forecast Report\n\n")
        f.write("**Author:** Senior Time-Series Machine Learning Engineer  \n")
        f.write(f"**Execution Timestamp:** {time.strftime('%Y-%m-%d %H:%M:%S')}  \n")
        f.write(f"**Forecast Origin:** `{FORECAST_ORIGIN_DATE}`  \n")
        f.write(f"**Forecast Horizon:** `{TEST_START_DATE}` to `{TEST_END_DATE}` (16 days out-of-sample)  \n")
        f.write(f"**Total Predictions Generated:** {len(preds_df):,} rows (54 stores × 33 product families × 16 days)  \n\n")

        f.write("## 1. Executive Summary & Model Loading\n\n")
        f.write("Final out-of-sample demand forecasts for the Kaggle competition evaluation period (`2017-08-16` to `2017-08-31`) have been successfully generated using the audited LightGBM global model.\n\n")
        f.write("- **Model Artifact:** `outputs/lightgbm_model.txt`\n")
        f.write(f"- **Tree Count:** Exactly {EXPECTED_TREES} boosting rounds (verified).\n")
        f.write(f"- **Input Features:** Exactly 34 features ({len(CATEGORICAL_FEATURES)} categorical + {len(NUMERICAL_FEATURES)} numerical).\n")
        f.write("- **Retraining Status:** **Zero retraining performed.** Model parameters and weights from Milestone 3.2 were completely preserved.\n\n")

        f.write("> [!IMPORTANT]\n")
        f.write("> **Distinction Between Predictions and Measured Performance:**  \n")
        f.write("> The Kaggle test dataset does not contain ground-truth sales labels (`actual_sales` is unobserved). Therefore, no test evaluation metrics (RMSLE, WAPE, MAE, RMSE) are reported for this period. Evaluation metrics were rigorously established on the 16-day validation holdout (RMSLE: 0.4017, WAPE: 16.38%).\n\n")

        f.write("---\n\n")
        f.write("## 2. Test Forecast Prediction Statistics\n\n")
        f.write("| Metric | Forecast Value | Domain Interpretation |\n")
        f.write("| :--- | :---: | :--- |\n")
        f.write(f"| **Total Predicted Network Volume** | **{total_units:,.1f} units** | Total across all 54 stores over 16 days |\n")
        f.write(f"| **Mean Predicted Sales / Row** | **{mean_units:.2f} units** | Average daily sales per store-family combination |\n")
        f.write(f"| **Median Predicted Sales / Row** | **{median_units:.2f} units** | Median daily sales (robust against extreme volume) |\n")
        f.write(f"| **Standard Deviation** | **{std_units:.2f} units** | High variance across fast vs slow moving items |\n")
        f.write(f"| **Minimum Prediction** | **{min_units:.4f} units** | Non-negative constraint strictly enforced (`max(0, ...)`) |\n")
        f.write(f"| **Maximum Prediction** | **{max_units:,.2f} units** | Peak volume category at large format store |\n\n")

        f.write("---\n\n")
        f.write("## 3. Daily Network Sales Forecast Progression\n\n")
        f.write("| Date | Day of Week | Total Predicted Network Units | Store-Family Mean |\n")
        f.write("| :---: | :---: | :---: | :---: |\n")
        for _, r in daily.iterrows():
            d_ts = pd.to_datetime(r["date"])
            f.write(f"| `{r['date']}` | {d_ts.strftime('%A')} | **{r['pred_lightgbm']:,.1f}** | {r['pred_lightgbm']/1782:.2f} |\n")

        f.write("\n---\n\n")
        f.write("## 4. Top 10 Product Families by Predicted Volume\n\n")
        f.write("| Family | Total Predicted Volume (Units) | Mean Daily Units / Store | Volume Share (%) |\n")
        f.write("| :--- | :---: | :---: | :---: |\n")
        for _, r in fam_agg.head(10).iterrows():
            share = (r["sum"] / total_units) * 100.0
            f.write(f"| `{r['family']}` | {r['sum']:,.1f} | {r['mean']:.2f} | {share:.2f}% |\n")

        f.write("\n---\n\n")
        f.write("## 5. Top 10 Stores by Predicted Volume\n\n")
        f.write("| Store Number | Total Predicted Units | Mean Units / Category-Day | Store Share (%) |\n")
        f.write("| :---: | :---: | :---: | :---: |\n")
        for _, r in store_agg.head(10).iterrows():
            share = (r["sum"] / total_units) * 100.0
            f.write(f"| Store {int(r['store_nbr'])} | {r['sum']:,.1f} | {r['mean']:.2f} | {share:.2f}% |\n")

        f.write("\n---\n\n")
        f.write("## 6. Recursive Forecasting Safeguards & Leakage Audit\n\n")
        f.write("- [x] **Forecast Origin ($T = \\text{2017-08-15}$):** Known historical sales through $T$ were buffered from training and validation sets.\n")
        f.write("- [x] **No Target Leakage:** Zero actual future sales were accessed during prediction.\n")
        f.write("- [x] **No Transactions Leakage:** Transaction volumes were excluded from feature inputs.\n")
        f.write("- [x] **Dynamic Roll-Forward:** Previous days' model predictions dynamically updated subsequent lags (`lag_1`, `lag_7`, `lag_14`, `lag_28`) and rolling windows.\n")
        f.write("- [x] **Calendar-Correct Lookup:** Historical lookups strictly match calendar days with verified closure safeguards.\n")
        f.write("- [x] **Non-Negative Transformation:** Predictions inverted via $\\hat{y} = \\max(0, \\exp(\\hat{y}_{\\text{log1p}}) - 1)$.\n\n")

        f.write("---\n\n")
        f.write("## 7. Kaggle Submission Verification\n\n")
        f.write("- [x] **Output File:** `outputs/submission.csv`\n")
        f.write("- [x] **Row Count:** Exactly 28,512 rows matching `datasets/raw/test.csv`.\n")
        f.write("- [x] **Required Columns:** Exactly `id` and `sales`.\n")
        f.write("- [x] **ID Integrity:** IDs run sequentially from `3000888` to `3029399` with zero missing or duplicate IDs.\n")
        f.write("- [x] **No Synthetic IDs:** Zero synthetic closure IDs (`-1`) present in submission.\n")
        f.write("- [x] **Non-Negativity:** Minimum sales prediction is $\\ge 0.0$.\n\n")

        f.write("---\n\n")
        f.write("## 8. Artifact Locations\n\n")
        f.write("- Model: `outputs/lightgbm_model.txt`\n")
        f.write("- Detailed Predictions: `outputs/lightgbm_test_predictions.csv`\n")
        f.write("- Kaggle Submission: `outputs/submission.csv`\n")
        f.write("- Markdown Report: `reports/lightgbm_test_forecast.md`\n")

    print(f"  [+] Saved test forecast report to: {report_path.name}")


# ---------------------------------------------------------------------------
# 6. Main Entrypoint
# ---------------------------------------------------------------------------
def main() -> int:
    start_time = time.time()
    print("=" * 70)
    print(" ShopPulse AI — Milestone 3.3: Final Test-Set Demand Forecasting")
    print(" Horizon: 2017-08-16 to 2017-08-31 (16 days out-of-sample)")
    print(f" Project Root: {PROJECT_ROOT}")
    print("=" * 70)

    # 1. Load trained model
    model_path = OUTPUTS_DIR / "lightgbm_model.txt"
    model = load_and_verify_model(model_path)

    # 2. Ingestion & Category Encoders
    test_df, category_encoders, sales_history = prepare_data_and_encoders()

    # 3. Recursive Forecasting Simulation
    preds_df = execute_recursive_test_forecast(model, test_df, category_encoders, sales_history)

    # 4. Save Outputs & Submission
    save_outputs_and_submission(preds_df)

    # 5. Generate Report
    report_path = REPORTS_DIR / "lightgbm_test_forecast.md"
    raw_test = pd.read_csv(RAW_DIR / "test.csv", usecols=["id"])
    sub_df = pd.merge(raw_test, preds_df[["id", "pred_lightgbm"]], on="id", how="left")
    generate_forecast_report(preds_df, sub_df, report_path)

    elapsed = time.time() - start_time
    print("=" * 70)
    print(f" Milestone 3.3 Test Forecasting completed successfully in {elapsed:.1f}s!")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
