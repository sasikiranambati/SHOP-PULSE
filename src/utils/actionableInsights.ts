/**
 * Display helpers for Stage 7.5 actionable insights.
 *
 * Priorities are decided by the backend (services/insight_rules.py); the UI only maps them to labels
 * and colours, so the Dashboard and the Insights page always show the same priority for an insight.
 */
import type {
  ActionableInsight,
  EvidenceSource,
  InsightCategory,
  InsightDataQuality,
  InsightPriority,
} from '../api/insights';

export const PRIORITY_ORDER: InsightPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export interface PriorityMeta {
  label: string;
  description: string;
  badgeClass: string;
  dotClass: string;
  borderClass: string;
}

export const PRIORITY_META: Record<InsightPriority, PriorityMeta> = {
  CRITICAL: {
    label: 'Critical',
    description: 'Needs immediate attention',
    badgeClass: 'bg-[#FDF1EF] text-[#B93838] border border-[#EF806D]/50',
    dotClass: 'bg-[#B93838]',
    borderClass: 'border-l-[#B93838]',
  },
  HIGH: {
    label: 'High',
    description: 'Needs attention soon',
    badgeClass: 'bg-[#FDF1EF] text-[#C0573F] border border-[#EF806D]/30',
    dotClass: 'bg-[#EF806D]',
    borderClass: 'border-l-[#EF806D]',
  },
  MEDIUM: {
    label: 'Medium',
    description: 'Monitor or address',
    badgeClass: 'bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/50',
    dotClass: 'bg-[#D6AE62]',
    borderClass: 'border-l-[#D6AE62]',
  },
  LOW: {
    label: 'Low',
    description: 'Useful, not urgent',
    badgeClass: 'bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/30',
    dotClass: 'bg-[#23866A]',
    borderClass: 'border-l-[#23866A]',
  },
  INFO: {
    label: 'Info',
    description: 'For information only',
    badgeClass: 'bg-[#F3EFE3] text-[#5E6C64] border border-[#DDE9DF]',
    dotClass: 'bg-[#83958A]',
    borderClass: 'border-l-[#83958A]',
  },
};

export const CATEGORY_LABEL: Record<InsightCategory, string> = {
  INVENTORY_RISK: 'Stockout risk',
  LOW_STOCK: 'Low stock',
  SALES_TREND: 'Sales trend',
  FAST_MOVING: 'Fast-moving',
  SLOW_MOVING: 'Slow-moving',
  INVENTORY_OPPORTUNITY: 'Inventory opportunity',
  DATA_QUALITY: 'Data availability',
};

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  OBSERVED: 'Recorded',
  FORECAST: 'Forecast',
  CONFIGURED: 'Your setting',
};

export const SOURCE_CLASS: Record<EvidenceSource, string> = {
  OBSERVED: 'bg-[#E7F3EE] text-[#153D32]',
  FORECAST: 'bg-[#F0F6FB] text-[#3567A8]',
  CONFIGURED: 'bg-[#F3EFE3] text-[#5E6C64]',
};

export const QUALITY_LABEL: Record<InsightDataQuality, string> = {
  HIGH: 'Strong evidence',
  MEDIUM: 'Moderate evidence',
  LOW: 'Limited evidence',
  INSUFFICIENT: 'Insufficient data',
};

export type PriorityFilter = InsightPriority | 'ALL';
export type CategoryFilter = InsightCategory | 'ALL';

/** Keeps the backend order (already sorted by priority); filters never re-rank. */
export function filterInsights(
  insights: ActionableInsight[],
  priority: PriorityFilter = 'ALL',
  category: CategoryFilter = 'ALL'
): ActionableInsight[] {
  return insights.filter(
    (i) => (priority === 'ALL' || i.priority === priority) && (category === 'ALL' || i.category === category)
  );
}

/** Dashboard: the most urgent actionable insights (CRITICAL, HIGH, then MEDIUM), in backend order. */
export function topPriorityActions(insights: ActionableInsight[], limit = 4): ActionableInsight[] {
  return insights
    .filter((i) => i.is_actionable && (i.priority === 'CRITICAL' || i.priority === 'HIGH' || i.priority === 'MEDIUM'))
    .slice(0, limit);
}
