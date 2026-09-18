/**
 * @file useAlerts.ts
 * @description Custom React hook for live inventory alerts, notification center, and reorder intelligence.
 * Belongs in `src/hooks/useAlerts.ts`.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { 
  Alert, 
  CreateAlertInput, 
  AlertFilterOptions, 
  DashboardAlertStats,
  ReorderSuggestion 
} from '../types/alert';
import type { Product } from '../types/product';
import * as alertService from '../services/alertService';
import { calculateReorderSuggestions } from '../utils/reorderEngine';

export interface UseAlertsResult {
  alerts: Alert[];
  unreadAlerts: Alert[];
  unreadCount: number;
  criticalAlerts: Alert[];
  lowStockAlerts: Alert[];
  dashboardAlertStats: DashboardAlertStats | null;
  reorderSuggestions: ReorderSuggestion[];
  loading: boolean;
  error: string | null;
  markAsRead: (alertId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  resolveAlert: (alertId: string) => Promise<void>;
  deleteAlert: (alertId: string) => Promise<void>;
  createAlert: (input: CreateAlertInput) => Promise<Alert>;
  refreshAlerts: () => Promise<void>;
}

/**
 * Reactive hook for real-time notification badge, alerts list, and dashboard stats.
 * 
 * @param products - Optional live product catalog to compute reorder suggestions
 * @param options - Query filters (priority, type, limit)
 */
export function useAlerts(
  products: Product[] = [],
  options?: AlertFilterOptions
): UseAlertsResult {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dashboardAlertStats, setDashboardAlertStats] = useState<DashboardAlertStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Compute live dashboard metrics from alert state
  const updateStats = useCallback(async () => {
    try {
      const stats = await alertService.getDashboardAlertStats(options?.shopId);
      setDashboardAlertStats(stats);
    } catch (err: any) {
      console.warn('Failed to compute dashboard alert stats:', err);
    }
  }, [options?.shopId]);

  // Real-time onSnapshot subscription with automatic unsubscribe cleanup
  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = alertService.subscribeToAlerts((liveAlerts) => {
      // Deduplicate by ID
      const seen = new Set<string>();
      const deduplicated: Alert[] = [];
      for (const a of liveAlerts) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          deduplicated.push(a);
        }
      }

      setAlerts(deduplicated);
      setLoading(false);
      updateStats();
    }, options);

    return () => {
      unsubscribe();
    };
  }, [options?.limit, options?.priority, options?.type, updateStats]);

  const refreshAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await alertService.getAlerts(options);
      const seen = new Set<string>();
      const deduplicated: Alert[] = [];
      for (const a of data) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          deduplicated.push(a);
        }
      }
      setAlerts(deduplicated);
      await updateStats();
    } catch (err: any) {
      setError(err.message || 'Failed to refresh alerts.');
    } finally {
      setLoading(false);
    }
  }, [options, updateStats]);

  const markAsRead = useCallback(async (alertId: string): Promise<void> => {
    try {
      // Optimistic update
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, isRead: true } : a));
      await alertService.markAsRead(alertId);
      await updateStats();
    } catch (err: any) {
      setError(err.message || 'Failed to mark alert as read.');
      throw err;
    }
  }, [updateStats]);

  const markAllAsRead = useCallback(async (): Promise<void> => {
    try {
      // Optimistic update
      setAlerts(prev => prev.map(a => ({ ...a, isRead: true })));
      await alertService.markAllAsRead(options?.shopId);
      await updateStats();
    } catch (err: any) {
      setError(err.message || 'Failed to mark all alerts as read.');
      throw err;
    }
  }, [options?.shopId, updateStats]);

  const resolveAlert = useCallback(async (alertId: string): Promise<void> => {
    try {
      const nowIso = new Date().toISOString();
      // Optimistic update
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, resolvedAt: nowIso, isRead: true } : a));
      await alertService.resolveAlert(alertId);
      await updateStats();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve alert.');
      throw err;
    }
  }, [updateStats]);

  const deleteAlert = useCallback(async (alertId: string): Promise<void> => {
    try {
      // Optimistic update
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      await alertService.deleteAlert(alertId);
      await updateStats();
    } catch (err: any) {
      setError(err.message || 'Failed to delete alert.');
      throw err;
    }
  }, [updateStats]);

  const createAlert = useCallback(async (input: CreateAlertInput): Promise<Alert> => {
    try {
      const newAlert = await alertService.createAlert(input);
      setAlerts(prev => {
        if (prev.some(a => a.id === newAlert.id)) return prev;
        return [newAlert, ...prev];
      });
      await updateStats();
      return newAlert;
    } catch (err: any) {
      setError(err.message || 'Failed to create alert.');
      throw err;
    }
  }, [updateStats]);

  // Derived filtered subsets
  const unreadAlerts = useMemo(() => {
    return alerts.filter(a => !a.isRead && !a.resolvedAt);
  }, [alerts]);

  const unreadCount = unreadAlerts.length;

  const criticalAlerts = useMemo(() => {
    return alerts.filter(a => a.priority === 'critical' && !a.resolvedAt);
  }, [alerts]);

  const lowStockAlerts = useMemo(() => {
    return alerts.filter(a => (a.type === 'LOW_STOCK' || a.type === 'OUT_OF_STOCK') && !a.resolvedAt);
  }, [alerts]);

  // Reorder suggestions calculated from live inventory
  const reorderSuggestions = useMemo(() => {
    if (products && products.length > 0) {
      return calculateReorderSuggestions(products);
    }
    return [];
  }, [products]);

  return {
    alerts,
    unreadAlerts,
    unreadCount,
    criticalAlerts,
    lowStockAlerts,
    dashboardAlertStats,
    reorderSuggestions,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    resolveAlert,
    deleteAlert,
    createAlert,
    refreshAlerts
  };
}
