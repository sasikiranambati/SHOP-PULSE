/**
 * @file dashboardCacheService.ts
 * @description Stale-While-Revalidate caching module for instant (< 5ms) Dashboard renders.
 * Persists today's sales, revenue, inventory counts, and alert stats to local storage.
 * Belongs in `src/services/dashboardCacheService.ts`.
 */

import { getActiveUserId } from './authService';

export interface DashboardCacheSnapshot {
  todayRevenue: number;
  itemsSoldToday: number;
  totalOrdersToday: number;
  totalProductsCount: number;
  lowStockCount: number;
  unreadAlertsCount: number;
  cachedAt: string;
}

const DEFAULT_CACHE: DashboardCacheSnapshot = {
  todayRevenue: 0,
  itemsSoldToday: 0,
  totalOrdersToday: 0,
  totalProductsCount: 0,
  lowStockCount: 0,
  unreadAlertsCount: 0,
  cachedAt: new Date().toISOString()
};

function getDashboardCacheKey(userUid?: string): string {
  const uid = userUid || getActiveUserId() || 'global';
  return `shoppulse_dashboard_cache_${uid}`;
}

class DashboardCacheService {
  /**
   * Synchronously fetch the cached dashboard metrics snapshot.
   * Returns immediately in < 5ms without awaiting network/Firestore.
   */
  public getSnapshot(userUid?: string): DashboardCacheSnapshot {
    try {
      const key = getDashboardCacheKey(userUid);
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.todayRevenue === 'number') {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to read dashboard cache snapshot:', err);
    }
    return DEFAULT_CACHE;
  }

  /**
   * Update the cached dashboard snapshot in local storage and notify listeners.
   */
  public updateSnapshot(updates: Partial<DashboardCacheSnapshot>, userUid?: string): void {
    try {
      const key = getDashboardCacheKey(userUid);
      const current = this.getSnapshot(userUid);
      const updated: DashboardCacheSnapshot = {
        ...current,
        ...updates,
        cachedAt: new Date().toISOString()
      };
      localStorage.setItem(key, JSON.stringify(updated));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shoppulse_dashboard_cache_updated', { detail: updated }));
      }
    } catch (err) {
      console.warn('Failed to save dashboard cache snapshot:', err);
    }
  }

  /**
   * Subscribe to cache snapshot updates.
   */
  public subscribe(callback: (snapshot: DashboardCacheSnapshot) => void): () => void {
    callback(this.getSnapshot());

    const handler = (e: any) => {
      callback(e.detail || this.getSnapshot());
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('shoppulse_dashboard_cache_updated', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('shoppulse_dashboard_cache_updated', handler);
      }
    };
  }

  /**
   * Reset or clear the cached snapshot.
   */
  public clearSnapshot(userUid?: string): void {
    try {
      const key = getDashboardCacheKey(userUid);
      localStorage.removeItem(key);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shoppulse_dashboard_cache_updated', { detail: DEFAULT_CACHE }));
      }
    } catch (err) {
      console.warn('Failed to clear dashboard cache snapshot:', err);
    }
  }
}

export const dashboardCacheService = new DashboardCacheService();

if (typeof window !== 'undefined') {
  (window as any).__shoppulse_cache = dashboardCacheService;
}

