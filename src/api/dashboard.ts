/**
 * @file dashboard.ts
 * @description Dashboard metrics and statistics API calls for ShopPulse.
 * Belongs in `src/api/dashboard.ts`.
 */

import { apiClient } from './client';
import type { ProductBackend } from './products';
import type { SaleBackend } from './sales';

export interface TopProductBackend extends ProductBackend {
  total_sold: number;
}

export interface DashboardBackendData {
  today_sales: number;
  products_count: number;
  low_stock_count: number;
  items_sold_today: number;
  top_products: TopProductBackend[];
  low_stock_products: ProductBackend[];
  recent_sales: SaleBackend[];
}

export const dashboardApi = {
  /**
   * Fetch comprehensive dashboard data for the authenticated shop owner.
   */
  getDashboard: async (): Promise<DashboardBackendData> => {
    return apiClient.get<DashboardBackendData>('/api/v1/dashboard');
  },
};
