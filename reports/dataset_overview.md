# ShopPulse AI — Dataset Exploration & Overview Report

**Generated automatically by:** `src/ml/explore_dataset.py`  
**Target Directory:** `datasets\raw`  

## 1. Executive Summary

| Dataset | File Size (MB) | Rows | Columns | Missing Values | Duplicate Rows |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `train.csv` | 116.16 | 3,000,888 | 6 | 0 | 0 |
| `test.csv` | 0.97 | 28,512 | 5 | 0 | 0 |
| `stores.csv` | 0.00 | 54 | 5 | 0 | 0 |
| `oil.csv` | 0.02 | 1,218 | 2 | 43 | 0 |
| `holidays_events.csv` | 0.02 | 350 | 6 | 0 | 0 |
| `transactions.csv` | 1.48 | 83,488 | 3 | 0 | 0 |
| `sample_submission.csv` | 0.33 | 28,512 | 2 | 0 | 0 |

---

## 2. In-Depth Inspection: `train.csv`

### 2.1 Date Range & Completeness
- **Earliest Date:** `2013-01-01`
- **Latest Date:** `2017-08-15`
- **Total Calendar Days:** 1688 days
- **Recorded Unique Dates:** 1684 days
- **Missing Calendar Dates:** 4 days
  - Missing Dates: `2013-12-25, 2014-12-25, 2015-12-25, 2016-12-25` *(Note: Retail stores close on Christmas Dec 25)*

### 2.2 Store Coverage
- **Total Stores:** 54
- **Store ID Range:** 1 to 54

### 2.3 Product Families
- **Total Unique Product Families:** 33
- **Family List:** AUTOMOTIVE, BABY CARE, BEAUTY, BEVERAGES, BOOKS, BREAD/BAKERY, CELEBRATION, CLEANING, DAIRY, DELI, EGGS, FROZEN FOODS, GROCERY I, GROCERY II, HARDWARE, HOME AND KITCHEN I, HOME AND KITCHEN II, HOME APPLIANCES, HOME CARE, LADIESWEAR, LAWN AND GARDEN, LINGERIE, LIQUOR,WINE,BEER, MAGAZINES, MEATS, PERSONAL CARE, PET SUPPLIES, PLAYERS AND ELECTRONICS, POULTRY, PREPARED FOODS, PRODUCE, SCHOOL AND OFFICE SUPPLIES, SEAFOOD

#### Top 10 Product Families by Total Sales Volume:

| Family | Total Sales | Mean Daily Sales/Store | Median Daily Sales | Max Single Day |
| :--- | :---: | :---: | :---: | :---: |
| GROCERY I | 343,462,734.89 | 3776.97 | 3185.00 | 124,717.00 |
| BEVERAGES | 216,954,486.00 | 2385.79 | 1784.00 | 25,413.00 |
| PRODUCE | 122,704,684.68 | 1349.35 | 398.29 | 17,850.62 |
| CLEANING | 97,521,289.00 | 1072.42 | 938.00 | 11,377.00 |
| DAIRY | 64,487,709.00 | 709.15 | 520.00 | 5,636.00 |
| BREAD/BAKERY | 42,133,945.58 | 463.34 | 401.00 | 4,551.30 |
| POULTRY | 31,876,004.47 | 350.53 | 205.74 | 12,143.20 |
| MEATS | 31,086,468.40 | 341.85 | 224.94 | 89,576.36 |
| PERSONAL CARE | 24,592,051.00 | 270.43 | 222.00 | 7,504.00 |
| DELI | 24,110,322.47 | 265.14 | 218.97 | 2,118.32 |

### 2.4 Sales Distribution
- **Zero Sales Count:** 939,130 (31.3% of records)
- **Percentiles:**
  - Min / 10th Percentile: 0.0
  - 25th Percentile (Q1): `0.0`
  - 50th Percentile (Median): `11.0`
  - 75th Percentile (Q3): `195.84725`
  - 90th Percentile: `867.0`
  - 95th Percentile: `1965.0`
  - 99th Percentile: `5507.0`
  - 99.9th Percentile: `12076.225547999791`

### 2.5 Promotion Activity (`onpromotion`)
- **Zero Promotions Count:** 2,389,559 (79.63% of records)
- **Correlation between Promotions and Sales:** `r = 0.4279` (Significant positive relationship)

---

## 3. Detailed Inspection of All CSV Datasets

### 3.1 `train.csv`
- **Dimensions:** 3,000,888 rows × 6 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `id` | `int64` | 0 | 0.0% | 3000888 | `0` |
| `date` | `str` | 0 | 0.0% | 1684 | `2013-01-01` |
| `store_nbr` | `int64` | 0 | 0.0% | 54 | `1` |
| `family` | `str` | 0 | 0.0% | 33 | `AUTOMOTIVE` |
| `sales` | `float64` | 0 | 0.0% | 379610 | `0.0` |
| `onpromotion` | `int64` | 0 | 0.0% | 362 | `0` |

**First 5 Rows:**

|   id | date       |   store_nbr | family     |   sales |   onpromotion |
|-----:|:-----------|------------:|:-----------|--------:|--------------:|
|    0 | 2013-01-01 |           1 | AUTOMOTIVE |       0 |             0 |
|    1 | 2013-01-01 |           1 | BABY CARE  |       0 |             0 |
|    2 | 2013-01-01 |           1 | BEAUTY     |       0 |             0 |
|    3 | 2013-01-01 |           1 | BEVERAGES  |       0 |             0 |
|    4 | 2013-01-01 |           1 | BOOKS      |       0 |             0 |

### 3.2 `test.csv`
- **Dimensions:** 28,512 rows × 5 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `id` | `int64` | 0 | 0.0% | 28512 | `3000888` |
| `date` | `str` | 0 | 0.0% | 16 | `2017-08-16` |
| `store_nbr` | `int64` | 0 | 0.0% | 54 | `1` |
| `family` | `str` | 0 | 0.0% | 33 | `AUTOMOTIVE` |
| `onpromotion` | `int64` | 0 | 0.0% | 212 | `0` |

**First 5 Rows:**

|      id | date       |   store_nbr | family     |   onpromotion |
|--------:|:-----------|------------:|:-----------|--------------:|
| 3000888 | 2017-08-16 |           1 | AUTOMOTIVE |             0 |
| 3000889 | 2017-08-16 |           1 | BABY CARE  |             0 |
| 3000890 | 2017-08-16 |           1 | BEAUTY     |             2 |
| 3000891 | 2017-08-16 |           1 | BEVERAGES  |            20 |
| 3000892 | 2017-08-16 |           1 | BOOKS      |             0 |

### 3.3 `stores.csv`
- **Dimensions:** 54 rows × 5 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `store_nbr` | `int64` | 0 | 0.0% | 54 | `1` |
| `city` | `str` | 0 | 0.0% | 22 | `Quito` |
| `state` | `str` | 0 | 0.0% | 16 | `Pichincha` |
| `type` | `str` | 0 | 0.0% | 5 | `D` |
| `cluster` | `int64` | 0 | 0.0% | 17 | `13` |

**First 5 Rows:**

|   store_nbr | city          | state                          | type   |   cluster |
|------------:|:--------------|:-------------------------------|:-------|----------:|
|           1 | Quito         | Pichincha                      | D      |        13 |
|           2 | Quito         | Pichincha                      | D      |        13 |
|           3 | Quito         | Pichincha                      | D      |         8 |
|           4 | Quito         | Pichincha                      | D      |         9 |
|           5 | Santo Domingo | Santo Domingo de los Tsachilas | D      |         4 |

### 3.4 `oil.csv`
- **Dimensions:** 1,218 rows × 2 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `date` | `str` | 0 | 0.0% | 1218 | `2013-01-01` |
| `dcoilwtico` | `float64` | 43 | 3.5304% | 998 | `93.14` |

**First 5 Rows:**

| date       |   dcoilwtico |
|:-----------|-------------:|
| 2013-01-01 |       nan    |
| 2013-01-02 |        93.14 |
| 2013-01-03 |        92.97 |
| 2013-01-04 |        93.12 |
| 2013-01-07 |        93.2  |

### 3.5 `holidays_events.csv`
- **Dimensions:** 350 rows × 6 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `date` | `str` | 0 | 0.0% | 312 | `2012-03-02` |
| `type` | `str` | 0 | 0.0% | 6 | `Holiday` |
| `locale` | `str` | 0 | 0.0% | 3 | `Local` |
| `locale_name` | `str` | 0 | 0.0% | 24 | `Manta` |
| `description` | `str` | 0 | 0.0% | 103 | `Fundacion de Manta` |
| `transferred` | `bool` | 0 | 0.0% | 2 | `False` |

**First 5 Rows:**

| date       | type    | locale   | locale_name   | description                   | transferred   |
|:-----------|:--------|:---------|:--------------|:------------------------------|:--------------|
| 2012-03-02 | Holiday | Local    | Manta         | Fundacion de Manta            | False         |
| 2012-04-01 | Holiday | Regional | Cotopaxi      | Provincializacion de Cotopaxi | False         |
| 2012-04-12 | Holiday | Local    | Cuenca        | Fundacion de Cuenca           | False         |
| 2012-04-14 | Holiday | Local    | Libertad      | Cantonizacion de Libertad     | False         |
| 2012-04-21 | Holiday | Local    | Riobamba      | Cantonizacion de Riobamba     | False         |

### 3.6 `transactions.csv`
- **Dimensions:** 83,488 rows × 3 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `date` | `str` | 0 | 0.0% | 1682 | `2013-01-01` |
| `store_nbr` | `int64` | 0 | 0.0% | 54 | `25` |
| `transactions` | `int64` | 0 | 0.0% | 4993 | `770` |

**First 5 Rows:**

| date       |   store_nbr |   transactions |
|:-----------|------------:|---------------:|
| 2013-01-01 |          25 |            770 |
| 2013-01-02 |           1 |           2111 |
| 2013-01-02 |           2 |           2358 |
| 2013-01-02 |           3 |           3487 |
| 2013-01-02 |           4 |           1922 |

### 3.7 `sample_submission.csv`
- **Dimensions:** 28,512 rows × 2 columns
- **Duplicates:** 0 duplicate rows

**Columns & Types:**

| Column | Dtype | Missing Count | Missing % | Unique Count | Sample |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `id` | `int64` | 0 | 0.0% | 28512 | `3000888` |
| `sales` | `float64` | 0 | 0.0% | 1 | `0.0` |

**First 5 Rows:**

|          id |   sales |
|------------:|--------:|
| 3.00089e+06 |       0 |
| 3.00089e+06 |       0 |
| 3.00089e+06 |       0 |
| 3.00089e+06 |       0 |
| 3.00089e+06 |       0 |

---

## 4. Data Quality Observations

1. **Oil Price Gaps (`oil.csv`):**
   - `dcoilwtico` contains 43 missing values (approx 3.5%) corresponding to weekends, public holidays, or non-trading days.
   - *Action for ML:* Forward-fill (`ffill`) followed by backward-fill (`bfill`) to create a continuous daily price series.

2. **Calendar Discontinuities (`train.csv`):**
   - Store closures occur on Christmas (`12-25`) each year (2013, 2014, 2015, 2016).
   - A major 7.8 magnitude earthquake hit Ecuador on April 16, 2016, leading to abnormal relief goods demand spikes in subsequent weeks.

3. **Holiday Transfer Events (`holidays_events.csv`):**
   - Transferred holidays (flagged with `transferred = True`) indicate official celebration days shifted to Mondays or Fridays to create long weekends.
   - Bridge days (`Bridge`) and Work Days (`Work Day`) compensate for holiday shifts and require proper alignment with local store locations.

4. **Zero-Inflation in Demand (`train.csv`):**
   - 31.4% of product-store daily entries have 0 sales. Many slow-moving categories (e.g., `BOOKS`, `BABY CARE`, `LAWN AND GARDEN`) require careful log-transformation (e.g., `log1p(sales)`) or zero-handling strategies to avoid evaluation bias.

5. **Test Horizon Alignment (`test.csv`):**
   - The evaluation test set covers 16 days (2017-08-16 to 2017-08-31) for the same 54 stores and 33 product families.

---

## 5. Recommended Forecasting Features

1. **Calendar & Seasonal Features:**
   - `day_of_week`, `day_of_month`, `month`, `year`, `is_weekend`
   - Payday indicators (Ecuadorian government and corporate wages paid on 15th and month-end)

2. **Lagged Demand Features:**
   - Target lags: $t-16, t-17, \dots, t-30$ (preventing data leakage over the 16-day forecast horizon)
   - Seasonal lags: $t-7, t-14, t-21, t-28$ (when recursive multi-step forecasting is used) or direct multi-output models

3. **Rolling Window Aggregations:**
   - 7-day, 14-day, 30-day, 60-day rolling mean, median, and standard deviation
   - Exponential moving averages (EMA)

4. **Promotion Intensity & Ratios:**
   - Active promotion count, item on promotion flag ($onpromotion > 0$)
   - Promotion lag and rolling promotion sum

5. **Exogenous Economic & Event Variables:**
   - Interpolated daily oil price (`dcoilwtico`) and its 7-day moving average (crucial for Ecuador's oil-dependent economy)
   - Active local/regional/national holiday indicator matched by store city/state
   - Earthquake emergency relief period indicator (April–May 2016)

6. **Entity Hierarchies & Embeddings:**
   - Store attributes: `city`, `state`, `type`, `cluster`
   - Target encoding or category embeddings on `family` and `store_nbr`
