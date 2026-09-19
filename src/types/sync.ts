/**
 * @file sync.ts
 * @description Data models and interfaces for Offline Queueing, Synchronization,
 * Conflict Resolution, and Network Status in ShopPulse.
 * Belongs in `src/types/sync.ts`.
 */

import type { Sale } from './sale';
import type { Product } from './product';

export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed';

/**
 * Queued sale recorded while offline or when Firestore is unreachable.
 */
export interface QueuedSale {
  id: string; // Deterministic unique ID (e.g. sale_...)
  sale: Sale;
  enqueuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: SyncStatus;
}

export type InventoryMutationType = 'CREATE' | 'UPDATE' | 'DELETE' | 'STOCK_DELTA';

/**
 * Queued inventory change recorded while offline.
 */
export interface QueuedInventoryMutation {
  id: string;
  mutationType: InventoryMutationType;
  productId: string;
  productData?: Partial<Product>;
  stockDelta?: number; // Delta for safe conflict resolution without overwriting
  enqueuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: SyncStatus;
}

/**
 * Consolidated synchronization telemetry and queue metrics.
 */
export interface SyncStats {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSalesCount: number;
  pendingInventoryCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  totalSyncedSales: number;
  totalSyncedInventory: number;
}

/**
 * Result returned after a sync cycle completes.
 */
export interface SyncResult {
  syncedSales: number;
  failedSales: number;
  syncedInventory: number;
  failedInventory: number;
  errors: string[];
}
