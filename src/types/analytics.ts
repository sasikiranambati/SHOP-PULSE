/**
 * @file analytics.ts
 * @description Business intelligence and sales trend data models for ShopPulse.
 * Belongs in `src/types/analytics.ts`.
 */

import type { Product } from './product';

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
