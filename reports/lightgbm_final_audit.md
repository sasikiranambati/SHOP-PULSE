# ShopPulse AI — LightGBM Chronological Split Final Audit Report

**Auditor:** Senior Machine Learning Engineer  
**Audit Target:** Chronological Splits, Date Counts, Row Counts, and Model Integrity in `src/ml/train_lightgbm.py`  
**Execution Timestamp:** 2026-11-02 23:26:30  
**Audit Status:** **AUDIT PASSED (All Discrepancies Accounted For & Mathematically Reconciled)**

---

## 1. Executive Summary & Root Cause of Row Count Inconsistencies

The audit comprehensively examined `datasets/processed/train_features.csv`, `datasets/processed/validation_features.csv`, and `outputs/lightgbm_model.txt`.

### Inconsistency Investigation & Mathematical Proof:
The prompt raised two apparent discrepancies between calendar day arithmetic and actual recorded rows:
1. **Fitting Period:** $561 \text{ calendar days} \times 1,782 \text{ series} = 999,702 \text{ expected rows}$, but actual rows = **997,920** (Difference = $-1,782$ rows).
2. **Full Training Period:** $577 \text{ calendar days} \times 1,782 \text{ series} = 1,028,214 \text{ expected rows}$, but actual rows = **1,026,432** (Difference = $-1,782$ rows).

### The Root Cause:
* **The Missing Calendar Day:** **`2016-12-25` (Christmas Day)**.
* In the underlying Kaggle Store Sales dataset, supermarket and retail stores across Ecuador were completely closed on Christmas Day. Consequently, exactly **zero** sales transactions were recorded for `2016-12-25`.
* Every other single day in the date range has **exactly 1,782 rows** (54 stores × 33 product families).
* Missing rows = $1 \text{ missing date} \times 1,782 \text{ store-family combinations} = \mathbf{1,782 \text{ rows}}$.

### Reconciliation Table:
| Period | Calendar Days Span | Missing Calendar Dates | Actual Unique Dates | Formula (Recorded Dates × 1,782) | Actual Rows | Match Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Model Fitting** (`2016-01-01` to `2017-07-14`) | 561 days | 1 (`2016-12-25`) | **560 dates** | $560 \times 1,782$ | **997,920** | **EXACT MATCH** |
| **Internal Early Stopping** (`2017-07-15` to `2017-07-30`) | 16 days | 0 | **16 dates** | $16 \times 1,782$ | **28,512** | **EXACT MATCH** |
| **Full Training** (`2016-01-01` to `2017-07-30`) | 577 days | 1 (`2016-12-25`) | **576 dates** | $576 \times 1,782$ | **1,026,432** | **EXACT MATCH** |
| **Final Evaluation Holdout** (`2017-07-31` to `2017-08-15`) | 16 days | 0 | **16 dates** | $16 \times 1,782$ | **28,512** | **EXACT MATCH** |

The actual row counts in the dataset are mathematically correct and preserve the real-world operational reality of retail store closures on Christmas Day.

---

## 2. Verification of Dataset Date & Key Properties

From direct empirical inspection of `train_features.csv`:
- **Minimum Date:** `2016-01-01`
- **Maximum Date:** `2017-07-30`
- **Unique Dates:** **576**
- **Rows per Date:** Exactly **1,782** on every recorded date (Min: 1,782, Max: 1,782).
- **Store-Family Combinations per Date:** Exactly **1,782** (54 stores × 33 families).
- **Primary Key Uniqueness:** Exactly **0 duplicate** `(date, store_nbr, family)` records exist across the entire dataset.

---

## 3. Verification of the Chronological Split Implementation

The code in `src/ml/train_lightgbm.py` strictly enforces the revised four-period chronological split:

1. **Model Fitting Period:**
   - Code: `train_df[train_df["date"] <= pd.to_datetime("2017-07-14")]`
   - Verified row count: **997,920 rows** across 560 unique dates.
2. **Internal Early-Stopping Period:**
   - Code: `train_df[(train_df["date"] >= pd.to_datetime("2017-07-15")) & (train_df["date"] <= pd.to_datetime("2017-07-30"))]`
   - Verified row count: **28,512 rows** across 16 unique dates.
3. **Full Training Period (Retraining):**
   - Code: `train_df[train_df["date"] <= pd.to_datetime("2017-07-30")]`
   - Verified row count: **1,026,432 rows** across 576 unique dates.
4. **Final Untouched Recursive Evaluation Period:**
   - Code: `val_df` spanning `2017-07-31` to `2017-08-15`.
   - Verified row count: **28,512 rows** across 16 unique dates.

### Leakage Boundary Audit:
- $\text{Fitting Max Date (2017-07-14)} < \text{Internal Val Min Date (2017-07-15)}$.
- $\text{Full Train Max Date (2017-07-30)} < \text{Final Holdout Min Date (2017-07-31)}$.
- Zero date overlap between fitting and internal early stopping.
- Zero date overlap between training and final holdout evaluation.

---

## 4. Final Model Artifact & Hyperparameter Verification

The generated model artifact `outputs/lightgbm_model.txt` was parsed and audited:
- **File Size:** 3,408,894 bytes.
- **Total Boosting Trees:** Exactly **569 trees** (`Tree=0` through `Tree=568`).
- **Fixed Iteration Confirmation:** The model was trained without early stopping on the final dataset, strictly utilizing the 569 iterations selected during Phase 1.
- **Holdout Target Non-Contamination:** The final evaluation targets (`sales` from `2017-07-31` to `2017-08-15`) were never referenced during tree fitting, early stopping, or iteration selection.
- **Recursive Multi-Step Integrity:** In `simulate_recursive_forecast()`, actual sales for validation dates are never added to `sales_history`. Only previous predictions $\hat{y}$ are used to dynamically compute `lag_1` and rolling window statistics for subsequent days.

---

## 5. Audit Conclusion

# **AUDIT PASSED**

### Summary of Findings:
1. **Row Count Discrepancy Resolved:** The $-1,782$ row difference in the fitting and training sets is completely explained by the single closed-store Christmas Day (`2016-12-25`). All 576 recorded dates have exactly 1,782 records with zero duplicate keys.
2. **Two-Phase Chronological Split Confirmed:** Early stopping is strictly confined to the internal validation period (`2017-07-15` to `2017-07-30`).
3. **Final Retraining Confirmed:** The production model was freshly retrained on all 1,026,432 training rows through `2017-07-30` using exactly 569 trees.
4. **Leak-Free Recursive Evaluation Confirmed:** The 16-day holdout validation metrics (**RMSLE = 0.4016**, **WAPE = 15.88%**) are genuine out-of-sample recursive predictions with zero target leakage.
