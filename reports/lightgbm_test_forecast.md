# ShopPulse AI — Milestone 3.3: Final Test-Set Demand Forecast Report

**Author:** Senior Time-Series Machine Learning Engineer  
**Execution Timestamp:** 2026-11-03 01:04:11  
**Forecast Origin:** `2017-08-15`  
**Forecast Horizon:** `2017-08-16` to `2017-08-31` (16 days out-of-sample)  
**Total Predictions Generated:** 28,512 rows (54 stores × 33 product families × 16 days)  

## 1. Executive Summary & Model Loading

Final out-of-sample demand forecasts for the Kaggle competition evaluation period (`2017-08-16` to `2017-08-31`) have been successfully generated using the audited LightGBM global model.

- **Model Artifact:** `outputs/lightgbm_model.txt`
- **Tree Count:** Exactly 997 boosting rounds (verified).
- **Input Features:** Exactly 34 features (7 categorical + 27 numerical).
- **Retraining Status:** **Zero retraining performed.** Model parameters and weights from Milestone 3.2 were completely preserved.

> [!IMPORTANT]
> **Distinction Between Predictions and Measured Performance:**  
> The Kaggle test dataset does not contain ground-truth sales labels (`actual_sales` is unobserved). Therefore, no test evaluation metrics (RMSLE, WAPE, MAE, RMSE) are reported for this period. Evaluation metrics were rigorously established on the 16-day validation holdout (RMSLE: 0.4017, WAPE: 16.38%).

---

## 2. Test Forecast Prediction Statistics

| Metric | Forecast Value | Domain Interpretation |
| :--- | :---: | :--- |
| **Total Predicted Network Volume** | **12,604,981.7 units** | Total across all 54 stores over 16 days |
| **Mean Predicted Sales / Row** | **442.09 units** | Average daily sales per store-family combination |
| **Median Predicted Sales / Row** | **27.86 units** | Median daily sales (robust against extreme volume) |
| **Standard Deviation** | **1196.50 units** | High variance across fast vs slow moving items |
| **Minimum Prediction** | **0.0000 units** | Non-negative constraint strictly enforced (`max(0, ...)`) |
| **Maximum Prediction** | **15,475.46 units** | Peak volume category at large format store |

---

## 3. Daily Network Sales Forecast Progression

| Date | Day of Week | Total Predicted Network Units | Store-Family Mean |
| :---: | :---: | :---: | :---: |
| `2017-08-16` | Wednesday | **815,130.9** | 457.42 |
| `2017-08-17` | Thursday | **648,298.5** | 363.80 |
| `2017-08-18` | Friday | **771,962.0** | 433.20 |
| `2017-08-19` | Saturday | **891,086.7** | 500.05 |
| `2017-08-20` | Sunday | **1,008,405.4** | 565.88 |
| `2017-08-21` | Monday | **781,859.6** | 438.75 |
| `2017-08-22` | Tuesday | **711,048.2** | 399.02 |
| `2017-08-23` | Wednesday | **750,162.6** | 420.97 |
| `2017-08-24` | Thursday | **650,318.1** | 364.94 |
| `2017-08-25` | Friday | **752,586.7** | 422.33 |
| `2017-08-26` | Saturday | **893,229.3** | 501.25 |
| `2017-08-27` | Sunday | **987,721.4** | 554.28 |
| `2017-08-28` | Monday | **753,852.0** | 423.04 |
| `2017-08-29` | Tuesday | **728,026.4** | 408.54 |
| `2017-08-30` | Wednesday | **768,169.5** | 431.07 |
| `2017-08-31` | Thursday | **693,124.6** | 388.96 |

---

## 4. Top 10 Product Families by Predicted Volume

| Family | Total Predicted Volume (Units) | Mean Daily Units / Store | Volume Share (%) |
| :--- | :---: | :---: | :---: |
| `GROCERY I` | 3,707,182.6 | 4290.72 | 29.41% |
| `BEVERAGES` | 2,883,404.7 | 3337.27 | 22.88% |
| `PRODUCE` | 1,934,738.5 | 2239.28 | 15.35% |
| `CLEANING` | 967,414.0 | 1119.69 | 7.67% |
| `DAIRY` | 691,555.0 | 800.41 | 5.49% |
| `BREAD/BAKERY` | 443,583.2 | 513.41 | 3.52% |
| `POULTRY` | 304,773.0 | 352.75 | 2.42% |
| `MEATS` | 303,509.5 | 351.28 | 2.41% |
| `PERSONAL CARE` | 255,139.1 | 295.30 | 2.02% |
| `DELI` | 246,918.1 | 285.78 | 1.96% |

---

## 5. Top 10 Stores by Predicted Volume

| Store Number | Total Predicted Units | Mean Units / Category-Day | Store Share (%) |
| :---: | :---: | :---: | :---: |
| Store 44 | 671,135.2 | 1271.09 | 5.32% |
| Store 45 | 623,542.0 | 1180.95 | 4.95% |
| Store 47 | 570,965.3 | 1081.37 | 4.53% |
| Store 3 | 551,870.5 | 1045.21 | 4.38% |
| Store 49 | 514,139.8 | 973.75 | 4.08% |
| Store 46 | 440,758.0 | 834.77 | 3.50% |
| Store 48 | 368,890.0 | 698.66 | 2.93% |
| Store 51 | 364,342.7 | 690.04 | 2.89% |
| Store 52 | 359,570.5 | 681.00 | 2.85% |
| Store 8 | 327,528.5 | 620.32 | 2.60% |

---

## 6. Recursive Forecasting Safeguards & Leakage Audit

- [x] **Forecast Origin ($T = \text{2017-08-15}$):** Known historical sales through $T$ were buffered from training and validation sets.
- [x] **No Target Leakage:** Zero actual future sales were accessed during prediction.
- [x] **No Transactions Leakage:** Transaction volumes were excluded from feature inputs.
- [x] **Dynamic Roll-Forward:** Previous days' model predictions dynamically updated subsequent lags (`lag_1`, `lag_7`, `lag_14`, `lag_28`) and rolling windows.
- [x] **Calendar-Correct Lookup:** Historical lookups strictly match calendar days with verified closure safeguards.
- [x] **Non-Negative Transformation:** Predictions inverted via $\hat{y} = \max(0, \exp(\hat{y}_{\text{log1p}}) - 1)$.

---

## 7. Kaggle Submission Verification

- [x] **Output File:** `outputs/submission.csv`
- [x] **Row Count:** Exactly 28,512 rows matching `datasets/raw/test.csv`.
- [x] **Required Columns:** Exactly `id` and `sales`.
- [x] **ID Integrity:** IDs run sequentially from `3000888` to `3029399` with zero missing or duplicate IDs.
- [x] **No Synthetic IDs:** Zero synthetic closure IDs (`-1`) present in submission.
- [x] **Non-Negativity:** Minimum sales prediction is $\ge 0.0$.

---

## 8. Artifact Locations

- Model: `outputs/lightgbm_model.txt`
- Detailed Predictions: `outputs/lightgbm_test_predictions.csv`
- Kaggle Submission: `outputs/submission.csv`
- Markdown Report: `reports/lightgbm_test_forecast.md`
