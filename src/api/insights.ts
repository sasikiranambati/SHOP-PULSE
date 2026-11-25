/**
 * @file insights.ts
 * @description Frontend API client for Shelfora AI Insights module.
 */

import { apiClient } from './client';

export interface SalesOverview {
  total_sales: number;
  transaction_count: number;
  average_transaction_value: number;
  previous_period_sales: number;
  previous_period_transactions: number;
  sales_growth_rate: number | null;
  period: string;
  start_date: string;
  end_date: string;
}

export interface ProductPerformanceItem {
  product_id: string;
  product_name: string;
  category: string;
  quantity_sold: number;
  revenue: number;
  unit: string;
  previous_quantity_sold: number;
  growth_rate: number | null;
}

export interface ProductPerformance {
  best_selling: ProductPerformanceItem[];
  slow_moving: ProductPerformanceItem[];
  increasing_sales: ProductPerformanceItem[];
  declining_sales: ProductPerformanceItem[];
}

export interface SalesTrendPoint {
  date: string;
  label: string;
  revenue: number;
  transaction_count: number;
}

export interface SalesTrends {
  interval: string;
  points: SalesTrendPoint[];
  peak_day: string | null;
  peak_revenue: number;
}

export interface SalesInsightsData {
  overview: SalesOverview;
  performance: ProductPerformance;
  trends: SalesTrends;
  has_sufficient_data: boolean;
  data_summary_note: string | null;
}


export interface InventoryStatusCounts {
  in_stock: number;
  low_stock: number;
  out_of_stock: number;
  overstocked: number;
  needs_attention: number;
  total_products: number;
}

export interface InventoryInsightItem {
  product_id: string;
  product_name: string;
  category: string;
  current_stock: number;
  minimum_stock_threshold: number;
  unit: string;
  status: 'IN STOCK' | 'LOW STOCK' | 'OUT OF STOCK' | 'OVERSTOCKED' | 'NEEDS ATTENTION';
  recommended_action: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  selling_price: number;
  purchase_price: number | null;
  last_updated: string | null;
  is_threshold_configured: boolean;
}

export interface InventoryInsightsData {
  counts: InventoryStatusCounts;
  items: InventoryInsightItem[];
  has_sufficient_data: boolean;
}

export interface AiInsightCard {
  id: string;
  type: 'critical' | 'warning' | 'positive' | 'info';
  category: 'sales' | 'inventory' | 'action';
  title: string;
  message: string;
  metric: string | null;
  grounded_data_points: string[];
  suggested_action: string | null;
}

export interface AiInsightsData {
  insights: AiInsightCard[];
  overall_business_health: string;
  has_sufficient_data: boolean;
  note: string | null;
}

export type ForecastTier =
  | 'TIER_1_SUFFICIENT'
  | 'TIER_2_SPARSE'
  | 'TIER_3_COLD_START';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type ForecastStatus =
  | 'ACTIVE'
  | 'OUT_OF_STOCK'
  | 'LOW_STOCK'
  | 'SPARSE_HISTORY'
  | 'NEW_PRODUCT_NO_SALES_HISTORY'
  | 'UNIT_REVIEW_REQUIRED'
  | 'INSUFFICIENT_HISTORY';

export interface ProductDemandForecast {
  product_id: string;
  product_name: string;
  current_stock: number;
  normalized_unit: string;
  total_valid_sales: number;
  observable_days: number;
  daily_demand_rate: number | null;
  expected_seven_day_demand: number | null;
  days_to_stockout: number | null;
  recommended_reorder_quantity: number | null;
  confidence_level: ConfidenceLevel;
  forecast_tier: ForecastTier;
  forecast_status: ForecastStatus;
  is_reorder_provisional: boolean;
  assumptions: string[];
  warnings: string[];
}

export interface ShopForecastSummary {
  shop_id: string;
  generated_at: string;
  total_products_analyzed: number;
  tier_1_count: number;
  tier_2_count: number;
  tier_3_count: number;
  out_of_stock_count: number;
  at_risk_stockout_7d_count: number;
  forecasts: ProductDemandForecast[];
}

export interface DemandForecastParams {
  product_id?: string;
  forecast_tier?: ForecastTier;
  forecast_status?: ForecastStatus;
  confidence_level?: ConfidenceLevel;
  lead_time_days?: number;
  alpha?: number;
  include_zero_price?: boolean;
  no_cache?: boolean;
}

// ---------------------------------------------------------------- Stage 7.5: actionable insights

export type InsightPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type InsightCategory =
  | 'INVENTORY_RISK'
  | 'LOW_STOCK'
  | 'SALES_TREND'
  | 'FAST_MOVING'
  | 'SLOW_MOVING'
  | 'INVENTORY_OPPORTUNITY'
  | 'DATA_QUALITY';
export type EvidenceSource = 'OBSERVED' | 'FORECAST' | 'CONFIGURED';
export type InsightDataQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface InsightEvidence {
  label: string;
  value: string;
  source: EvidenceSource;
}

export interface ActionableInsight {
  id: string;
  type: string;
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  description: string;
  evidence: InsightEvidence[];
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  current_value: number | null;
  threshold_value: number | null;
  observation_start: string | null;
  observation_end: string | null;
  data_quality: InsightDataQuality;
  suggested_action: string | null;
  is_actionable: boolean;
}

export interface DailyBusinessSummary {
  period_start: string;
  period_end: string;
  today_sales: number;
  today_transactions: number;
  products_sold_today: number;
  same_time_yesterday_sales: number;
  same_time_yesterday_transactions: number;
  out_of_stock_count: number;
  below_minimum_count: number;
  forecast_stockout_risk_count: number | null;
  highlights: string[];
  data_notes: string[];
  has_sales_history: boolean;
}

export interface ActionableInsightsData {
  generated_at: string;
  counts_by_priority: Record<InsightPriority, number>;
  counts_by_category: Record<InsightCategory, number>;
  total: number;
  insights: ActionableInsight[];
  summary: DailyBusinessSummary;
  thresholds: Record<string, number>;
}

export interface ActionableInsightsParams {
  priority?: InsightPriority;
  category?: InsightCategory;
  type?: string;
  limit?: number;
  offset?: number;
}

export const insightsApi = {
  getSalesInsights: async (
    period: 'today' | '7d' | '30d' | '90d' | 'custom' = '7d',
    startDate?: string,
    endDate?: string
  ): Promise<SalesInsightsData> => {
    let url = `/api/v1/insights/sales?period=${period}`;
    if (period === 'custom' && startDate && endDate) {
      url += `&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    }
    return apiClient.get<SalesInsightsData>(url);
  },

  getInventoryInsights: async (): Promise<InventoryInsightsData> => {
    return apiClient.get<InventoryInsightsData>('/api/v1/insights/inventory');
  },

  getAiInsights: async (): Promise<AiInsightsData> => {
    return apiClient.get<AiInsightsData>('/api/v1/insights/ai-summary');
  },

  getActionableInsights: async (params?: ActionableInsightsParams): Promise<ActionableInsightsData> => {
    return apiClient.get<ActionableInsightsData>('/api/v1/insights/actionable', {
      params: params as Record<string, string | number | boolean | undefined | null>,
    });
  },

  getDemandForecast: async (
    params?: DemandForecastParams
  ): Promise<ShopForecastSummary> => {
    return apiClient.get<ShopForecastSummary>('/api/v1/insights/demand-forecast', {
      params: params as Record<string, string | number | boolean | undefined | null>,
    });
  },

};
