/**
 * @file useSales.ts
 * @description Custom React hook for processing sales transactions and sales history.
 * Belongs in `src/hooks/useSales.ts`.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Sale, CreateSaleInput, DailySalesSummary } from '../types/sale';
import * as salesService from '../services/salesService';

export interface UseSalesResult {
  sales: Sale[];
  todaySummary: DailySalesSummary | null;
  loading: boolean;
  error: string | null;
  recordSale: (input: CreateSaleInput) => Promise<Sale>;
  refreshSales: () => Promise<void>;
}

/**
 * Hook for sales checkout management and daily sales metrics.
 */
export function useSales(): UseSalesResult {
  const [sales, setSales] = useState<Sale[]>([]);
  const [todaySummary, setTodaySummary] = useState<DailySalesSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSalesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [salesList, summary] = await Promise.all([
        salesService.getSales(50),
        salesService.getTodaySalesSummary()
      ]);
      setSales(salesList);
      setTodaySummary(summary);
    } catch (err: any) {
      setError(err.message || 'Failed to load sales data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  const recordSale = async (input: CreateSaleInput): Promise<Sale> => {
    const newSale = await salesService.createSale(input);
    setSales(prev => [newSale, ...prev]);
    await fetchSalesData();
    return newSale;
  };

  return {
    sales,
    todaySummary,
    loading,
    error,
    recordSale,
    refreshSales: fetchSalesData
  };
}
