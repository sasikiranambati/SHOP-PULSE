# ShopPulse AI — Preprocessing Pipeline Calendar Gap & Lag Feature Audit

**Auditor:** Senior Time-Series Machine Learning Engineer  
**Audit Target:** Impact of Missing Calendar Date (`2016-12-25`) on Lag and Rolling Features  
**Target Codebase:** `src/ml/preprocess_dataset.py`, `src/ml/verify_preprocessing.py`, `src/ml/test_pipeline_e2e.py`, `src/ml/train_lightgbm.py`  
**Execution Timestamp:** 2026-11-02 23:40:00  
**Audit Verdict:** **FAIL: Feature generation is inconsistent or introduces incorrect temporal information.**

---

## Executive Summary

A read-only investigation was conducted into ShopPulse AI's dataset preprocessing pipeline to determine how the missing calendar date `2016-12-25` (Christmas Day retail store closure in Ecuador) affects historical lag and rolling feature calculations across the training, validation, and recursive forecasting pipelines.

### Key Audit Discoveries:
1. **Row-Based vs Calendar-Based:** The preprocessing pipeline in `src/ml/preprocess_dataset.py` relies exclusively on **row-based shifting** (`grouped.shift(k)`). It does **not** reindex store-family series to a continuous daily calendar (`freq='D'`).
2. **December 26 `lag_1` Behavior:** For December 26, 2016, `lag_1` corresponds to **Option B: December 24 sales (previous available row interpretation)**, representing a $t-2$ calendar-day observation rather than $t-1$.
3. **Day-of-Week Seasonality Corruption:** Because shifting operates on rows rather than calendar days, the absence of `2016-12-25` induces a **-1 day phase shift** across all seasonal lags (`lag_7`, `lag_14`, `lag_28`). For example, on Monday `2016-12-26`, `lag_7` pulls sales from **Sunday `2016-12-18`** rather than **Monday `2016-12-19`**.
4. **Architectural Inconsistency:** `src/ml/preprocess_dataset.py` uses **row-based index shifts** (`.shift(k)`), whereas `src/ml/train_lightgbm.py` uses **calendar-day date subtraction** (`cur_date_ts - pd.Timedelta(days=k)`).
5. **Operational Scope of Distortion:** The distortion affects **49,896 training rows** (4.86% of the 1,026,432 training set) spanning the 28 days following Christmas 2016 (`2016-12-26` to `2017-01-22`). 
6. **Validation Window Insulation:** Because no calendar gaps exist in 2017 between June and August, the final holdout validation period (`2017-07-31` to `2017-08-15`) and early-stopping period (`2017-07-15` to `2017-07-30`) were temporally insulated from numerical distortion.

---

## 1. Feature Generation Implementation Details

### A. Preprocessing Script (`src/ml/preprocess_dataset.py`)
In `preprocess_dataset.py`, historical features are computed inside `compute_lag_and_rolling_features()` (lines 282–321):

```python
def compute_lag_and_rolling_features(full_series_df: pd.DataFrame) -> pd.DataFrame:
    df = full_series_df.sort_values(["store_nbr", "family", "date"]).copy()
    grouped = df.groupby(["store_nbr", "family"])["sales"]

    # Historical Lags:
    df["lag_1"] = grouped.shift(1).astype(np.float32)
    df["lag_7"] = grouped.shift(7).astype(np.float32)
    df["lag_14"] = grouped.shift(14).astype(np.float32)
    df["lag_28"] = grouped.shift(28).astype(np.float32)

    # Rolling Window Statistics (Shift-1 applied):
    df["rolling_mean_7"] = (
        grouped.transform(lambda s: s.shift(1).rolling(window=7, min_periods=1).mean()).astype(np.float32)
    )
    df["rolling_std_7"] = (
        grouped.transform(lambda s: s.shift(1).rolling(window=7, min_periods=1).std()).fillna(0.0).astype(np.float32)
    )
    df["rolling_mean_14"] = (
        grouped.transform(lambda s: s.shift(1).rolling(window=14, min_periods=1).mean()).astype(np.float32)
    )
    df["rolling_mean_28"] = (
        grouped.transform(lambda s: s.shift(1).rolling(window=28, min_periods=1).mean()).astype(np.float32)
    )
```

### B. Findings on Pipeline Construction:
- **No Calendar Reindexing:** The input dataframe `full_series_df` (`cleaned_train`) contains only the dates recorded in Kaggle's raw `train.csv`. The pipeline never executes `.reindex(pd.date_range(...))` or `.asfreq('D')`.
- **Pure Row Shifting:** `shift(k)` steps backward by $k$ rows in the grouped slice. If a calendar date is omitted from the table, `shift(k)` skips the missing day entirely.
- **Verification Scripts:**
  - `src/ml/verify_preprocessing.py`: Only verifies that `lag_1` and rolling values exist and are non-null on a single sample row.
  - `src/ml/test_pipeline_e2e.py` (lines 236–249): Tests `sub.loc[i, "lag_1"] == sub.loc[i - 1, "sales"]` across row indices `i in range(10, 25)` (January 2016). It asserts row-based equality and never tests across calendar gaps.

---

## 2. Row-Based vs. Calendar-Based Determination

The implementation is **100% row-based**.

| Feature | Preprocessing Implementation | Calendar-Based Requirement | Discrepancy Across Missing Dates |
| :--- | :--- | :--- | :--- |
| **`lag_1`** | `grouped.shift(1)` | $t - 1 \text{ day}$ | Pulls $t - 2 \text{ days}$ on the day following a gap |
| **`lag_7`** | `grouped.shift(7)` | $t - 7 \text{ days}$ | Pulls $t - 8 \text{ days}$ for 6 days following a gap |
| **`lag_14`** | `grouped.shift(14)` | $t - 14 \text{ days}$ | Pulls $t - 15 \text{ days}$ for 13 days following a gap |
| **`lag_28`** | `grouped.shift(28)` | $t - 28 \text{ days}$ | Pulls $t - 29 \text{ days}$ for 27 days following a gap |
| **`rolling_mean_7`** | 7-row rolling mean of `shift(1)` | 7-day average of $t-7 \dots t-1$ | Spans 8 calendar days across a gap |

---

## 3. Empirical Evidence: December 23–28, 2016

To inspect the empirical behavior, we audited the actual records in `datasets/processed/train_features.csv` for two distinct entities:
- **Entity A:** Store 1, Product Family `GROCERY I`
- **Entity B:** Store 44, Product Family `BEVERAGES`

### Empirical Data Table (Store 1, GROCERY I):

| Date | Day | Row Index | Sales | `lag_1` (Actual) | Source Row for `lag_1` | `lag_7` (Actual) | Source Row for `lag_7` | True Calendar $t-7$ Sales |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2016-12-23** | Friday | 357 | 5,386.0 | 5,055.0 | 2016-12-22 (Thu) | 3,481.0 | 2016-12-16 (Fri) | 3,481.0 (Fri) |
| **2016-12-24** | Saturday | 358 | 3,609.0 | 5,386.0 | 2016-12-23 (Fri) | 3,451.0 | 2016-12-17 (Sat) | 3,451.0 (Sat) |
| **2016-12-25** | Sunday | — | **MISSING** | — | — | — | — | — |
| **2016-12-26** | **Monday** | **359** | 904.0 | **3,609.0** | **2016-12-24 (Sat)** | **2,044.0** | **2016-12-18 (Sun)** | **3,872.0 (Mon)** |
| **2016-12-27** | Tuesday | 360 | 3,156.0 | 904.0 | 2016-12-26 (Mon) | 3,872.0 | 2016-12-19 (Mon) | 4,080.0 (Tue) |
| **2016-12-28** | Wednesday | 361 | 2,761.0 | 3,156.0 | 2016-12-27 (Tue) | 4,080.0 | 2016-12-20 (Tue) | 5,162.0 (Wed) |

### Empirical Data Table (Store 44, BEVERAGES):

| Date | Day | Row Index | Sales | `lag_1` (Actual) | Source Row for `lag_1` | `lag_7` (Actual) | Source Row for `lag_7` | True Calendar $t-7$ Sales |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2016-12-23** | Friday | 357 | 11,122.0 | 9,752.0 | 2016-12-22 (Thu) | 9,047.0 | 2016-12-16 (Fri) | 9,047.0 (Fri) |
| **2016-12-24** | Saturday | 358 | 10,786.0 | 11,122.0 | 2016-12-23 (Fri) | 14,315.0 | 2016-12-17 (Sat) | 14,315.0 (Sat) |
| **2016-12-25** | Sunday | — | **MISSING** | — | — | — | — | — |
| **2016-12-26** | **Monday** | **359** | 13,781.0 | **10,786.0** | **2016-12-24 (Sat)** | **16,208.0** | **2016-12-18 (Sun)** | **9,719.0 (Mon)** |
| **2016-12-27** | Tuesday | 360 | 9,107.0 | 13,781.0 | 2016-12-26 (Mon) | 9,719.0 | 2016-12-19 (Mon) | 9,981.0 (Tue) |
| **2016-12-28** | Wednesday | 361 | 9,592.0 | 9,107.0 | 2016-12-27 (Tue) | 9,981.0 | 2016-12-20 (Tue) | 8,074.0 (Wed) |

### Specific Findings on Inquiries:

1. **`lag_1` on December 26:**
   - **Result:** Matches **Option B: December 24 sales (previous available row interpretation)**.
   - For Store 1, `lag_1` is `3,609.0` (Christmas Eve sales).
   - For Store 44, `lag_1` is `10,786.0` (Christmas Eve sales).
   - It does **not** reflect December 25 sales ($0.0$).
2. **`lag_7` Day-of-Week Seasonality Distortion:**
   - On Monday `2016-12-26`, `lag_7` was designed to capture same-day-of-week seasonality (Monday `2016-12-19`).
   - Instead, row $i-7$ lands on Sunday `2016-12-18` ($t-8$ calendar days).
   - For Store 44, Sunday sales were **16,208 units**, while true previous Monday sales were **9,719 units**.
   - As a result, Monday was assigned a seasonal expectation that was **66.8% higher** than actual prior Monday sales, confusing Sunday shopping peaks with regular weekday traffic.

---

## 4. Impact on Rolling Windows

Rolling statistics are computed via `s.shift(1).rolling(window=k, min_periods=1).mean()`.

### Window Composition Across the Gap:
On `2016-12-26` (Row 359), the 7-row window contains:
$$\text{Window Dates} = [12\text{-}18, 12\text{-}19, 12\text{-}20, 12\text{-}21, 12\text{-}22, 12\text{-}23, 12\text{-}24]$$

### Observations:
1. **Calendar Elapsed Span:** The window encompasses dates from December 18 to December 24. While it contains 7 rows, it skips December 25.
2. **Distortion of Moving Average:**
   - If stores were closed on Christmas Day, the true 7-day sales ending December 25 would include zero sales for December 25:
     $$\text{True 7-Day Calendar Mean} = \frac{3872 + 4080 + 5162 + 5055 + 5386 + 3609 + 0}{7} = \mathbf{3,880.57}$$
   - Because December 25 was omitted, the row shift reached back an extra day to pull Sunday `2016-12-18` (sales = 2,044.0):
     $$\text{Computed Row Mean} = \frac{2044 + 3872 + 4080 + 5162 + 5055 + 5386 + 3609}{7} = \mathbf{4,172.57}$$
   - The rolling mean was artificially inflated by $+7.5\%$ for Store 1.
3. **Temporal Span on Dec 27 & Dec 28:**
   - On `2016-12-27`, the 7-row window contains `['2016-12-19' to '2016-12-26']`, physically spanning **8 calendar days**.
   - On `2016-12-28`, the 7-row window physically spans **8 calendar days**.
   - True 7-calendar-day window alignment is only restored on `2017-01-02`.

---

## 5. Preprocessing vs. Recursive Forecasting Consistency Audit

A direct code comparison was conducted between `src/ml/preprocess_dataset.py` and `src/ml/train_lightgbm.py`:

```
┌────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────┐
│ Preprocessing Pipeline (preprocess_dataset.py)         │ Recursive Simulation Engine (train_lightgbm.py)        │
├────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ df["lag_1"] = grouped.shift(1)                         │ l1 = sales_history.get((s, f, date - Timedelta(days=1))│
│ df["lag_7"] = grouped.shift(7)                         │ l7 = sales_history.get((s, f, date - Timedelta(days=7))│
│ df["lag_14"] = grouped.shift(14)                       │ l14 = sales_history.get((s, f, date - Timedelta(days=14│
│ df["lag_28"] = grouped.shift(28)                       │ l28 = sales_history.get((s, f, date - Timedelta(days=28│
│ df["rolling_mean_7"] = s.shift(1).rolling(7).mean()    │ w7 = [sales_history.get(..., date - Timedelta(days=d))]│
└────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

### Analysis:
1. **Definitional Inconsistency:**
   - `preprocess_dataset.py` uses **row-based indexing**.
   - `train_lightgbm.py` uses **calendar-day timedelta subtraction**.
2. **Behavioral Divergence Across Gaps:**
   - If evaluated across Christmas (`2016-12-26`):
     - `train_lightgbm.py` looks up `2016-12-25` in `sales_history`. Finding it absent, `.get(..., 0.0)` returns **`0.0`**.
     - `preprocess_dataset.py` returned **`3,609.0`** (sales from `2016-12-24`).
     - For `lag_7`, `train_lightgbm.py` looks up `2016-12-19` (Monday), returning **`3,872.0`**.
     - `preprocess_dataset.py` returned **`2,044.0`** (Sunday `2016-12-18`).
3. **Why Did This Not Corrupt Milestone 3.2 Evaluation?**
   - The recursive evaluation in Milestone 3.2 was conducted on the holdout period `2017-07-31` to `2017-08-15`.
   - The historical sales buffer spanned `2017-06-25` to `2017-07-30`.
   - In 2017, there are **zero missing calendar days** between June and August.
   - Because every calendar day was present, $date - \text{Timedelta(days=}k\text{)}$ and row index $i - k$ yielded **numerically identical values** during the evaluation.
   - On Day 1 (`2017-07-31`):
     - `lag_1`: 1,086.0 (both)
     - `lag_7`: 2,612.0 (both)
     - `lag_14`: 2,720.0 (both)
     - `lag_28`: 2,952.0 (both)
     - `rolling_mean_7`: 2,359.2856 vs 2,359.2857 (both)

---

## 6. Operational Impact on Model Training and Forecasting

### A. Impact on Training Data:
* **Dates Affected:** `2016-12-26` to `2017-01-22` (28 calendar days).
  - `lag_1`: 1 date (`2016-12-26`)
  - `lag_7`: 6 dates (`2016-12-26` to `2016-12-31`)
  - `lag_14`: 13 dates (`2016-12-26` to `2017-01-07`)
  - `lag_28`: 27 dates (`2016-12-26` to `2017-01-21`)
* **Row Count Affected:** $28 \text{ dates} \times 1,782 \text{ series} = \mathbf{49,896 \text{ rows}}$.
* **Percentage of Training Set:** $49,896 / 1,026,432 = \mathbf{4.86\%}$.
* **Clean Training Rows:** **95.14%** of the training dataset contains perfect calendar alignment.

### B. Impact on Future Inference (Production Risk):
* If the forecasting horizon includes Christmas Day (e.g., forecasting December 2017 or December 2026 for retail store operations):
  - The model will receive contradictory feature definitions between training and recursive inference.
  - The recursive buffer will output $0.0$ for closed holidays, whereas the model was trained on row-shifted values that skipped closed holidays.

---

## 7. Recommended Correction

To achieve production-grade consistency and eliminate temporal leakage/phase shifts, the following refactoring is recommended for future milestones:

### 1. Panel Reindexing to a Complete Daily Calendar:
Before feature calculation in `src/ml/preprocess_dataset.py`, reindex each `(store_nbr, family)` series to a continuous daily frequency:
```python
# Generate continuous calendar index for all store-family series
all_dates = pd.date_range(start=min_date, end=max_date, freq="D")
full_panel_index = pd.MultiIndex.from_product(
    [df["store_nbr"].unique(), df["family"].unique(), all_dates],
    names=["store_nbr", "family", "date"]
)
df_complete = df.set_index(["store_nbr", "family", "date"]).reindex(full_panel_index).reset_index()
```

### 2. Operational Zero-Filling for Store Closures:
- For known closed dates (`2016-12-25` and national holidays where stores are closed), explicitly fill `sales = 0.0`.
- Forward-fill oil prices (`dcoilwtico`).
- Holiday metadata is populated correctly for `2016-12-25` (`is_holiday = 1`, `holiday_type = 'Holiday'`).
- Preserve an explicit boolean flag: `is_closed = 1`.

### 3. Unified Lag Formulation:
With a complete daily panel:
- `grouped.shift(k)` is mathematically identical to calendar day $t-k$.
- `lag_7` will always represent the exact same day of the week (Monday to Monday).
- Preprocessing and recursive simulation will share an identical, bug-free mathematical definition.

---

## 8. Final Audit Verdict

# **FAIL: Feature generation is inconsistent or introduces incorrect temporal information.**

### Summary Rationale:
1. **Temporal Information Distortion:** The preprocessing pipeline introduces a -1 day-of-week phase shift into 49,896 training rows across the 28 days following Christmas 2016 (`lag_7` maps Sunday sales onto Monday).
2. **Definitional Inconsistency:** `src/ml/preprocess_dataset.py` relies on row-based `.shift(k)`, whereas `src/ml/train_lightgbm.py` relies on calendar-based `pd.Timedelta(days=k)`.
3. **Insulation Context:** While the Milestone 3.2 evaluation holdout (`2017-07-31` to `2017-08-15`) was temporally insulated due to a 7-month gap with zero missing dates, the underlying feature generation pipeline fails the strict time-series consistency audit and requires panel reindexing before production deployment.
