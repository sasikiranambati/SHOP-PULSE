/**
 * @file useAnalytics.ts
 * @description React hook for live business intelligence, revenue trends, top products,
 * profit estimates, and AI insights.
 * Belongs in `src/hooks/useAnalytics.ts`.
 */

import { useState, useEffect, useCallback } from 'react';
import type { 
  BusinessAnalytics, 
  DashboardStats, 
  TrendDataset, 
  TopProductItem, 
  SlowMovingProductItem, 
  LowStockInsightItem, 
  ProfitSummary, 
  BusinessInsight 
} from '../types/analytics';
import * as analyticsService from '../services/analyticsService';

export interface UseAnalyticsResult {
  analytics: BusinessAnalytics | null;
  stats: DashboardStats | null;
  weeklyTrend: TrendDataset | null;
  topProducts: TopProductItem[];
  slowMoving: SlowMovingProductItem[];
  lowStockInsights: LowStockInsightItem[];
  profit: ProfitSummary | null;
  aiInsights: BusinessInsight[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAnalytics(shopId: string = 'default'): UseAnalyticsResult {
  const [analytics, setAnalytics] = useState<BusinessAnalytics | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weeklyTrend, setWeeklyTrend] = useState<TrendDataset | null>(null);
  const [topProducts, setTopProducts] = useState<TopProductItem[]>([]);
  const [slowMoving, setSlowMoving] = useState<SlowMovingProductItem[]>([]);
  const [lowStockInsights, setLowStockInsights] = useState<LowStockInsightItem[]>([]);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [aiInsights, setAiInsights] = useState<BusinessInsight[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (bustCache: boolean = false) => {
    if (bustCache) {
      analyticsService.clearAnalyticsCache();
    }
    setLoading(true);
    setError(null);

    try {
      const [
        consolidated,
        dashStats,
        weekly,
        top,
        slow,
        lowStock,
        profitSummary,
        insights
      ] = await Promise.all([
        analyticsService.getConsolidatedAnalytics(shopId),
        analyticsService.getDashboardStats(shopId),
        analyticsService.getWeeklyRevenue(shopId),
        analyticsService.getTopSellingProducts(5, shopId),
        analyticsService.getSlowMovingProducts(30, shopId),
        analyticsService.getLowStockInsights(shopId),
        analyticsService.getEstimatedProfit(shopId),
        analyticsService.generateBusinessInsights(shopId)
      ]);

      setAnalytics(consolidated);
      setStats(dashStats);
      setWeeklyTrend(weekly);
      setTopProducts(top);
      setSlowMoving(slow);
      setLowStockInsights(lowStock);
      setProfit(profitSummary);
      setAiInsights(insights);
    } catch (err: any) {
      console.warn('Error computing analytics:', err);
      setError(err?.message || 'Failed to calculate analytics');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    fetchAnalytics(false);

    // Refresh analytics when sales change
    const onSalesChanged = () => fetchAnalytics(true);
    window.addEventListener('shoppulse_sales_changed', onSalesChanged);
    window.addEventListener('shoppulse_inventory_changed', onSalesChanged);

    return () => {
      window.removeEventListener('shoppulse_sales_changed', onSalesChanged);
      window.removeEventListener('shoppulse_inventory_changed', onSalesChanged);
    };
  }, [fetchAnalytics]);

  const refresh = useCallback(async () => {
    await fetchAnalytics(true);
  }, [fetchAnalytics]);

  return {
    analytics,
    stats,
    weeklyTrend,
    topProducts,
    slowMoving,
    lowStockInsights,
    profit,
    aiInsights,
    loading,
    error,
    refresh
  };
}
