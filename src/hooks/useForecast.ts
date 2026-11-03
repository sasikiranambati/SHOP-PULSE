/**
 * @file useForecast.ts
 * @description React hook for real-time demand forecasting and inventory intelligence.
 * Belongs in `src/hooks/useForecast.ts`.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ForecastSummary, ProductForecast } from '../types/forecast';
import { forecastApi } from '../api/forecast';
import { useAuth } from './useAuth';

export interface UseForecastResult {
  summary: ForecastSummary | null;
  items: ProductForecast[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectedCategory: string | null;
  setCategory: (category: string | null) => void;
  forecastForProduct: (productId: string) => ProductForecast | undefined;
}

/**
 * Hook for managing shop-level demand forecasting and per-product inventory intelligence.
 * Reactively refreshes when local sales or inventory events are dispatched.
 *
 * @param initialCategory Optional initial canonical category filter
 */
export function useForecast(initialCategory?: string | null): UseForecastResult {
  const { user } = useAuth();
  const currentUid = user?.uid;

  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory ?? null);

  const fetchForecast = useCallback(
    async (categoryFilter: string | null) => {
      if (!currentUid) {
        setSummary(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await forecastApi.getForecast({
          standardized_category:
            categoryFilter && categoryFilter !== 'All' ? categoryFilter : undefined,
        });
        setSummary(res);
      } catch (err: any) {
        setError(err?.message || 'Failed to load demand forecasts');
      } finally {
        setLoading(false);
      }
    },
    [currentUid]
  );

  // Fetch forecast whenever user authentication or category filter changes
  useEffect(() => {
    let active = true;

    if (!currentUid) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    forecastApi
      .getForecast({
        standardized_category:
          selectedCategory && selectedCategory !== 'All' ? selectedCategory : undefined,
      })
      .then((res) => {
        if (active) {
          setSummary(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Failed to load demand forecasts');
          setLoading(false);
        }
      });

    // Reactive listeners for local POS transactions and inventory mutations
    const handleDataChange = () => {
      if (active) {
        fetchForecast(selectedCategory);
      }
    };

    window.addEventListener('shoppulse_sales_changed', handleDataChange);
    window.addEventListener('shoppulse_inventory_changed', handleDataChange);
    window.addEventListener('shoppulse_auth_changed', handleDataChange);

    return () => {
      active = false;
      window.removeEventListener('shoppulse_sales_changed', handleDataChange);
      window.removeEventListener('shoppulse_inventory_changed', handleDataChange);
      window.removeEventListener('shoppulse_auth_changed', handleDataChange);
    };
  }, [currentUid, selectedCategory, fetchForecast]);

  const refresh = useCallback(async (): Promise<void> => {
    await fetchForecast(selectedCategory);
  }, [fetchForecast, selectedCategory]);

  const setCategory = useCallback((category: string | null): void => {
    setSelectedCategory(category);
  }, []);

  const items = useMemo(() => summary?.items ?? [], [summary]);

  const forecastForProduct = useCallback(
    (productId: string): ProductForecast | undefined => {
      return items.find((item) => item.product_id === productId);
    },
    [items]
  );

  return {
    summary,
    items,
    loading,
    error,
    refresh,
    selectedCategory,
    setCategory,
    forecastForProduct,
  };
}
