/**
 * @file useSync.ts
 * @description Custom React hook for monitoring offline sync telemetry, pending queue counts,
 * online connectivity, and manually triggering synchronization.
 * Belongs in `src/hooks/useSync.ts`.
 */

import { useState, useEffect, useCallback } from 'react';
import type { SyncStats, SyncResult } from '../types/sync';
import { syncService } from '../services/syncService';
import { networkService } from '../services/networkService';

export interface UseSyncResult {
  stats: SyncStats;
  isOnline: boolean;
  isSyncing: boolean;
  pendingSalesCount: number;
  pendingInventoryCount: number;
  totalPendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  syncNow: () => Promise<SyncResult>;
  toggleSimulatedOffline: (offline?: boolean) => void;
}

export function useSync(): UseSyncResult {
  const [stats, setStats] = useState<SyncStats>(syncService.getStats());

  useEffect(() => {
    const unsubscribe = syncService.subscribe((updatedStats) => {
      setStats(updatedStats);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    return await syncService.syncAll();
  }, []);

  const toggleSimulatedOffline = useCallback((offline?: boolean) => {
    if (offline === undefined) {
      networkService.setSimulatedState(networkService.isOnline() ? false : null);
    } else {
      networkService.setSimulatedState(offline ? false : null);
    }
  }, []);

  const totalPendingCount = stats.pendingSalesCount + stats.pendingInventoryCount;

  return {
    stats,
    isOnline: stats.isOnline,
    isSyncing: stats.isSyncing,
    pendingSalesCount: stats.pendingSalesCount,
    pendingInventoryCount: stats.pendingInventoryCount,
    totalPendingCount,
    lastSyncTime: stats.lastSyncTime,
    lastError: stats.lastError,
    syncNow,
    toggleSimulatedOffline
  };
}
