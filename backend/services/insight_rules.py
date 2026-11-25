"""
Thresholds and priority rules for proactive insights (Stage 7.5), kept in one place.

The insight engine (services/actionable_insights.py) gathers facts from the shop's records; the
functions here decide whether a fact is worth reporting and at which priority. Every rule is
deterministic and documented, so a priority can always be explained from its evidence.
"""
from dataclasses import asdict, dataclass
from typing import Dict, Optional

from schemas.actionable_insights import DataQuality, InsightPriority
from schemas.forecast import ConfidenceLevel


@dataclass(frozen=True)
class InsightThresholds:
    # Supplier lead time used for forecast-based stockout alerts (same default as /demand-forecast)
    lead_time_days: int = 3
    # Forecast stockout within this many days is reported (HIGH); within the lead time it is imminent
    stockout_watch_days: int = 7
    # Fast movers projected to run out within this horizon get a replenishment-planning insight
    replenishment_horizon_days: int = 14

    # Recent demand: an out-of-stock product with sales in this window "has observable demand"
    demand_lookback_days: int = 30

    # Product movement windows (rolling, equal length: current vs previous)
    product_window_days: int = 14
    fast_moving_min_transactions: int = 3   # never "fast-moving" from a single sale
    fast_moving_min_active_days: int = 2    # sales on at least this many different days
    fast_moving_top_n: int = 5              # highest-volume products reported
    increasing_demand_min_growth_pct: float = 50.0
    increasing_demand_min_previous_transactions: int = 2

    # Slow-moving stock: no sales in this window, for products at least this old
    slow_moving_window_days: int = 30
    slow_moving_min_product_age_days: int = 30
    # Excess stock: stock would last longer than this at the observed sales rate
    excess_stock_cover_days: float = 90.0
    excess_stock_min_transactions: int = 3

    # Shop sales trend: rolling window vs the previous equal window
    sales_trend_window_days: int = 7
    sales_trend_min_transactions_per_window: int = 5
    sales_trend_significant_pct: float = 20.0
    sales_trend_major_decline_pct: float = 40.0

    # Unusual day: the last complete UTC day vs the average of the days before it
    unusual_day_lookback_days: int = 14
    unusual_day_min_active_days: int = 10
    unusual_day_low_ratio: float = 0.5
    unusual_day_high_ratio: float = 2.0

    # Data quality of observed insights, by number of transactions behind them
    quality_high_min_transactions: int = 10
    quality_medium_min_transactions: int = 5

    def as_dict(self) -> Dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


DEFAULT_THRESHOLDS = InsightThresholds()


PRIORITY_RANK: Dict[InsightPriority, int] = {
    InsightPriority.CRITICAL: 0,
    InsightPriority.HIGH: 1,
    InsightPriority.MEDIUM: 2,
    InsightPriority.LOW: 3,
    InsightPriority.INFO: 4,
}


def observed_quality(transactions: int, t: InsightThresholds = DEFAULT_THRESHOLDS) -> DataQuality:
    """Quality of an insight based on recorded sales: more transactions, stronger evidence."""
    if transactions >= t.quality_high_min_transactions:
        return DataQuality.HIGH
    if transactions >= t.quality_medium_min_transactions:
        return DataQuality.MEDIUM
    if transactions > 0:
        return DataQuality.LOW
    return DataQuality.INSUFFICIENT


def forecast_quality(confidence: ConfidenceLevel) -> DataQuality:
    return {
        ConfidenceLevel.HIGH: DataQuality.HIGH,
        ConfidenceLevel.MEDIUM: DataQuality.MEDIUM,
        ConfidenceLevel.LOW: DataQuality.LOW,
    }.get(confidence, DataQuality.INSUFFICIENT)


# ------------------------------------------------------------------------------ priority rules

def out_of_stock_priority(recent_units_sold: float) -> InsightPriority:
    """Out of stock: CRITICAL when the product sold in the demand window, otherwise MEDIUM (monitor)."""
    return InsightPriority.CRITICAL if recent_units_sold > 0 else InsightPriority.MEDIUM


def forecast_stockout_priority(
    days_to_stockout: float, confidence: ConfidenceLevel, t: InsightThresholds = DEFAULT_THRESHOLDS
) -> Optional[InsightPriority]:
    """
    Forecast run-out for an in-stock product.
    - within the lead time: CRITICAL with HIGH/MEDIUM confidence, HIGH with LOW confidence;
    - within the watch window: HIGH, or MEDIUM with LOW confidence;
    - otherwise, or without a forecast (confidence NONE): no insight.
    Low-confidence estimates are never escalated to the top level.
    """
    if confidence == ConfidenceLevel.NONE:
        return None
    strong = confidence in (ConfidenceLevel.HIGH, ConfidenceLevel.MEDIUM)
    if days_to_stockout <= t.lead_time_days:
        return InsightPriority.CRITICAL if strong else InsightPriority.HIGH
    if days_to_stockout <= t.stockout_watch_days:
        return InsightPriority.HIGH if strong else InsightPriority.MEDIUM
    return None


def low_stock_priority() -> InsightPriority:
    """At or below the shop's configured minimum stock level (and not out of stock)."""
    return InsightPriority.MEDIUM


def sales_trend_priority(change_pct: float, t: InsightThresholds = DEFAULT_THRESHOLDS) -> Optional[InsightPriority]:
    """
    Shop sales vs the previous equal window.
    - decline of at least the major threshold: HIGH; at least the significant threshold: MEDIUM;
    - increase of at least the significant threshold: LOW (positive);
    - smaller changes are not significant: no insight.
    """
    if change_pct <= -t.sales_trend_major_decline_pct:
        return InsightPriority.HIGH
    if change_pct <= -t.sales_trend_significant_pct:
        return InsightPriority.MEDIUM
    if change_pct >= t.sales_trend_significant_pct:
        return InsightPriority.LOW
    return None


def unusual_day_priority(ratio: float, t: InsightThresholds = DEFAULT_THRESHOLDS) -> Optional[InsightPriority]:
    """Last complete day vs the recent daily average: unusually low is MEDIUM, unusually high is LOW."""
    if ratio <= t.unusual_day_low_ratio:
        return InsightPriority.MEDIUM
    if ratio >= t.unusual_day_high_ratio:
        return InsightPriority.LOW
    return None


def replenishment_priority() -> InsightPriority:
    """Strong observed demand and the forecast shows stock lasting under the replenishment horizon."""
    return InsightPriority.MEDIUM


def slow_moving_priority() -> InsightPriority:
    """Stock that has not sold during the whole observation window: worth reviewing (inefficiency)."""
    return InsightPriority.MEDIUM


def excess_stock_priority() -> InsightPriority:
    return InsightPriority.LOW


def fast_moving_priority() -> InsightPriority:
    """Observed high volume or rising demand: useful information (LOW)."""
    return InsightPriority.LOW
