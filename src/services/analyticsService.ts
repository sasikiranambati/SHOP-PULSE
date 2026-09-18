/**
 * @file analyticsService.ts
 * @description Business intelligence and demand analytics calculation service.
 * Belongs in `src/services/analyticsService.ts`.
 */

import { getProducts } from './inventoryService';
import { getSales, getTodaySalesSummary } from './salesService';
import type { Product } from '../types/product';

export interface TopProductAnalytics {
  product: Product;
  totalQuantitySold: number;
  totalRevenue: number;
}

export interface DashboardMetrics {
  todaySales: number;
  itemsSoldToday: number;
  totalProductsCount: number;
  lowStockCount: number;
  topProducts: TopProductAnalytics[];
}

/**
 * Calculate top-selling products by quantity sold.
 */
export async function getTopProducts(limitCount: number = 5): Promise<TopProductAnalytics[]> {
  const [products, sales] = await Promise.all([
    getProducts(),
    getSales(100)
  ]);

  const salesMap = new Map<string, { qty: number; rev: number }>();

  sales.forEach(sale => {
    sale.items.forEach(item => {
      const existing = salesMap.get(item.productId) || { qty: 0, rev: 0 };
      salesMap.set(item.productId, {
        qty: existing.qty + item.quantity,
        rev: existing.rev + item.totalPrice
      });
    });
  });

  const ranked: TopProductAnalytics[] = products.map(product => {
    const stats = salesMap.get(product.id) || { qty: 0, rev: 0 };
    return {
      product,
      totalQuantitySold: stats.qty,
      totalRevenue: stats.rev
    };
  });

  return ranked
    .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)
    .slice(0, limitCount);
}

/**
 * Fetch consolidated dashboard metrics for the shop owner.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [todaySummary, products, topProducts] = await Promise.all([
    getTodaySalesSummary(),
    getProducts(),
    getTopProducts(5)
  ]);

  const lowStockCount = products.filter(p => p.stock <= p.minStock).length;

  return {
    todaySales: todaySummary.todaySales,
    itemsSoldToday: todaySummary.itemsSoldToday,
    totalProductsCount: products.length,
    lowStockCount,
    topProducts
  };
}
