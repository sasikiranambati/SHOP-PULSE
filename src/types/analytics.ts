/**
 * @file analytics.ts
 * @description Business intelligence, sales trend, profit estimation, and AI insight data models.
 * Belongs in `src/types/analytics.ts`.
 */

import type { Product } from './product';

/**
 * Top ranked product item based on sales velocity and revenue.
 */
export interface TopProductItem {
  productId: string;
  productName: string;
  category: string;
  quantitySold: number;
  revenue: number;
  unit: string;
  rank: number;
  product?: Product;
}

/**
 * Slow-moving product requiring attention or promotion.
 */
export interface SlowMovingProductItem {
  productId: string;
  productName: string;
  category: string;
  currentStock: number;
  unitsSold: number;
  daysWithoutSale: number;
  estimatedBlockedCapital: number;
  recommendation: string;
  unit: string;
}

/**
 * Inventory item with low stock and projected stockout velocity.
 */
export interface LowStockInsightItem {
  productId: string;
  productName: string;
  currentStock: number;
  reorderLevel: number;
  dailyVelocity: number;
  estimatedDaysUntilStockout: number;
  recommendedRestockQuantity: number;
  urgency: 'critical' | 'high' | 'medium';
  unit: string;
}

/**
 * Metrics for a specific date or window.
 */
export interface RevenuePeriodStat {
  revenue: number;
  ordersCount: number;
  averageOrderValue: number;
  itemsSold: number;
  date: string;
}

/**
 * Individual data point formatted for charts (e.g. SalesChart).
 */
export interface SalesTrendDataPoint {
  day: string; // e.g. "Mon", "Tue", "Sun (Today)"
  date: string; // YYYY-MM-DD
  amount: number; // Revenue in Rupees
  itemsCount: number;
  height: string; // Percentage string e.g. "75%"
  isToday?: boolean;
}

/**
 * Chart-ready trend dataset.
 */
export interface TrendDataset {
  period: '7days' | '30days' | 'custom';
  totalRevenue: number;
  totalOrders: number;
  averageDailyRevenue: number;
  points: SalesTrendDataPoint[];
  peakDay?: {
    day: string;
    date: string;
    amount: number;
  };
  growthRatePercentage?: number;
}

/**
 * Gross profit summary calculated from selling price vs purchase price.
 */
export interface ProfitSummary {
  dailyProfit: number;
  weeklyProfit: number;
  monthlyProfit: number;
  totalProfit: number;
  overallProfitMargin: number; // Percentage e.g. 24.5%
  itemsWithMissingCost: number;
  currency: string;
}

/**
 * Structured AI Business Insight generated from actual store heuristics.
 */
export interface BusinessInsight {
  id: string;
  type: 'success' | 'warning' | 'info' | 'urgent';
  title: string;
  message: string;
  category?: string;
  metric?: string;
  priority: number; // 1 (highest) to 5
}

/**
 * Consolidated Business Analytics Data Model.
 */
export interface BusinessAnalytics {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  itemsSold: number;
  topProducts: TopProductItem[];
  lowStockProducts: LowStockInsightItem[];
  dailySales: RevenuePeriodStat;
  weeklySales: TrendDataset;
  monthlySales: TrendDataset;
  estimatedProfit: ProfitSummary;
  generatedAt: string;
  slowMovingProducts?: SlowMovingProductItem[];
  aiInsights?: BusinessInsight[];
}

/**
 * Dashboard stats summary interface for quick overview widgets.
 */
export interface DashboardStats {
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  itemsSoldToday: number;
  totalProducts: number;
  lowStockAlertCount: number;
  topCategory: {
    name: string;
    sharePercentage: number;
    revenue: number;
  };
  weeklyGrowthPercentage: number;
}

// ---------------------------------------------------------------------------
// Backward-Compatibility Interfaces
// ---------------------------------------------------------------------------

export interface TopProductAnalytics {
  product: Product;
  totalQuantitySold: number;
  totalRevenue: number;
}

export interface SalesTrendPoint {
  date: string;
  totalSales: number;
  itemsCount: number;
}

export interface DashboardMetrics {
  todaySales: number;
  itemsSoldToday: number;
  totalProductsCount: number;
  lowStockCount: number;
  topProducts: TopProductAnalytics[];
  salesTrend?: SalesTrendPoint[];
}
