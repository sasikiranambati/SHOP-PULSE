"""
Contract for proactive, prioritized business insights (Stage 7.5).

Every insight is computed deterministically from the shop's own records. Each one carries the
evidence behind it, and each evidence item says where the value came from:
- OBSERVED: recorded sales or stock (what has happened);
- FORECAST: the demand-forecast engine's estimate (what may happen);
- CONFIGURED: a value the shop set (e.g. a minimum stock level).
"""
from enum import Enum
from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel


class InsightPriority(str, Enum):
    CRITICAL = "CRITICAL"  # needs immediate attention
    HIGH = "HIGH"          # needs attention soon
    MEDIUM = "MEDIUM"      # monitor or address
    LOW = "LOW"            # useful, not urgent (positive trends, opportunities)
    INFO = "INFO"          # observation only, no action needed


class InsightCategory(str, Enum):
    INVENTORY_RISK = "INVENTORY_RISK"
    LOW_STOCK = "LOW_STOCK"
    SALES_TREND = "SALES_TREND"
    FAST_MOVING = "FAST_MOVING"
    SLOW_MOVING = "SLOW_MOVING"
    INVENTORY_OPPORTUNITY = "INVENTORY_OPPORTUNITY"
    DATA_QUALITY = "DATA_QUALITY"


class EvidenceSource(str, Enum):
    OBSERVED = "OBSERVED"
    FORECAST = "FORECAST"
    CONFIGURED = "CONFIGURED"


class DataQuality(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INSUFFICIENT = "INSUFFICIENT"


class InsightEvidence(BaseModel):
    label: str
    value: str
    source: EvidenceSource


class ActionableInsight(BaseModel):
    # Stable for the same condition: "<type>:<product id>" or "<type>:shop"
    id: str
    type: str
    category: InsightCategory
    priority: InsightPriority
    title: str
    description: str
    evidence: List[InsightEvidence]
    product_id: Optional[UUID] = None
    product_name: Optional[str] = None
    unit: Optional[str] = None
    current_value: Optional[float] = None
    threshold_value: Optional[float] = None
    observation_start: Optional[str] = None
    observation_end: Optional[str] = None
    data_quality: DataQuality
    suggested_action: Optional[str] = None
    # False for observations that need no action (priority INFO, positive trends)
    is_actionable: bool


class DailyBusinessSummary(BaseModel):
    """Today's figures (UTC day so far) and the most important findings. Missing data stays missing."""
    period_start: str
    period_end: str
    today_sales: float
    today_transactions: int
    products_sold_today: int
    # The same part of yesterday (00:00 UTC up to the same time), an equivalent partial period
    same_time_yesterday_sales: float
    same_time_yesterday_transactions: int
    out_of_stock_count: int
    below_minimum_count: int
    forecast_stockout_risk_count: Optional[int] = None  # None when the forecast could not be computed
    highlights: List[str]
    data_notes: List[str]
    has_sales_history: bool


class ActionableInsightsResponse(BaseModel):
    generated_at: str
    # Counts across all insights, before filtering
    counts_by_priority: Dict[str, int]
    counts_by_category: Dict[str, int]
    total: int  # matching the filters, before limit/offset
    insights: List[ActionableInsight]
    summary: DailyBusinessSummary
    # The thresholds this result was computed with (for explainability)
    thresholds: Dict[str, float]
