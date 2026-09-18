/**
 * @file useSales.ts
 * @description Custom React hook for live sales checkout, history, and dashboard performance metrics.
 * Belongs in `src/hooks/useSales.ts`.
 */

import { useState, useEffect, useCallback } from 'react';
import type { 
  Sale, 
  CreateSaleInput, 
  DailySalesSummary, 
  DashboardSalesStats,
  ReceiptData 
} from '../types/sale';
import * as salesService from '../services/salesService';
import { generateReceipt } from '../utils/receiptGenerator';

export interface UseSalesResult {
  sales: Sale[];
  todaySummary: DailySalesSummary | null;
  dashboardStats: DashboardSalesStats | null;
  loading: boolean;
  error: string | null;
  recordSale: (input: CreateSaleInput, cashierId?: string, shopName?: string) => Promise<{ sale: Sale; receipt: ReceiptData }>;
  createSale: (input: CreateSaleInput, cashierId?: string, shopName?: string) => Promise<{ sale: Sale; receipt: ReceiptData }>;
  deleteSale: (saleId: string, restoreInventory?: boolean) => Promise<void>;
  getSalesByPeriod: (period: 'today' | '7days' | '30days') => Promise<Sale[]>;
  searchSales: (billNumber: string) => Promise<Sale[]>;
  refreshSales: () => Promise<void>;
}

/**
 * Hook for sales checkout management, daily revenue metrics, and receipt generation.
 */
export function useSales(initialLimit: number = 50): UseSalesResult {
  const [sales, setSales] = useState<Sale[]>([]);
  const [todaySummary, setTodaySummary] = useState<DailySalesSummary | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardSalesStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Compute live dashboard metrics from sales list
  const updateMetrics = useCallback(async () => {
    try {
      const stats = await salesService.getDashboardSalesStats();
      setDashboardStats(stats);
      setTodaySummary({
        todaySales: stats.todayRevenue,
        itemsSoldToday: stats.itemsSoldToday,
        salesCount: stats.totalTransactionsToday,
        averageBill: stats.averageBillValue,
        date: new Date().toISOString().split('T')[0]
      });
    } catch (err: any) {
      console.warn('Could not compute daily sales stats:', err);
    }
  }, []);

  // Real-time onSnapshot subscription with automatic unsubscribe cleanup
  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = salesService.subscribeToSales((liveSales) => {
      // Deduplicate by ID and Bill Number
      const seen = new Set<string>();
      const deduplicated: Sale[] = [];
      for (const s of liveSales) {
        const key = s.id || s.billNumber;
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated.push(s);
        }
      }
      setSales(deduplicated);
      setLoading(false);
      updateMetrics();
    }, initialLimit);

    return () => {
      unsubscribe();
    };
  }, [initialLimit, updateMetrics]);

  const refreshSales = useCallback(async () => {
    setLoading(true);
    try {
      const data = await salesService.getSales({ limit: initialLimit });
      const seen = new Set<string>();
      const deduplicated: Sale[] = [];
      for (const s of data) {
        const key = s.id || s.billNumber;
        if (!seen.has(key)) {
          seen.add(key);
          deduplicated.push(s);
        }
      }
      setSales(deduplicated);
      await updateMetrics();
    } catch (err: any) {
      setError(err.message || 'Failed to refresh sales data.');
    } finally {
      setLoading(false);
    }
  }, [initialLimit, updateMetrics]);

  const recordSale = useCallback(async (
    input: CreateSaleInput, 
    cashierId?: string,
    shopName: string = 'Kiran General Store'
  ): Promise<{ sale: Sale; receipt: ReceiptData }> => {
    setError(null);
    try {
      const createdSale = await salesService.createSale(input, cashierId, shopName);
      const receipt = generateReceipt(createdSale, shopName);

      // Safely update list without duplicate entries
      setSales(prev => {
        if (prev.some(s => s.id === createdSale.id || (s.billNumber && s.billNumber === createdSale.billNumber))) {
          return prev;
        }
        return [createdSale, ...prev];
      });
      await updateMetrics();

      return { sale: createdSale, receipt };
    } catch (err: any) {
      setError(err.message || 'Transaction failed.');
      throw err;
    }
  }, [updateMetrics]);

  const deleteSale = useCallback(async (saleId: string, restoreInventory?: boolean): Promise<void> => {
    setError(null);
    try {
      await salesService.deleteSale(saleId, restoreInventory);
      setSales(prev => prev.filter(s => s.id !== saleId));
      await updateMetrics();
    } catch (err: any) {
      setError(err.message || 'Failed to delete sale.');
      throw err;
    }
  }, [updateMetrics]);

  const getSalesByPeriod = useCallback(async (period: 'today' | '7days' | '30days'): Promise<Sale[]> => {
    try {
      return await salesService.getSales({ period });
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sales for period.');
      return [];
    }
  }, []);

  const searchSales = useCallback(async (billNumber: string): Promise<Sale[]> => {
    try {
      return await salesService.searchSalesByBillNumber(billNumber);
    } catch (err: any) {
      setError(err.message || 'Search failed.');
      return [];
    }
  }, []);

  return {
    sales,
    todaySummary,
    dashboardStats,
    loading,
    error,
    recordSale,
    createSale: recordSale,
    deleteSale,
    getSalesByPeriod,
    searchSales,
    refreshSales
  };
}
