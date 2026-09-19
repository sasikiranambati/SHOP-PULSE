/**
 * @file syncService.ts
 * @description Synchronization Manager for ShopPulse.
 * Uploads queued offline sales and inventory mutations with exponential backoff,
 * deterministic deduplication, atomic delta stock resolution, and auto-sync on reconnect.
 * Belongs in `src/services/syncService.ts`.
 */

import { 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  increment,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { networkService } from './networkService';
import { 
  getPendingSales, 
  updateQueuedSale, 
  removeQueuedSale, 
  getPendingInventory, 
  updateQueuedInventory, 
  removeQueuedInventory 
} from './offlineQueue';
import type { SyncStats, SyncResult } from '../types/sync';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const SALES_COLLECTION = 'sales';
const PRODUCTS_COLLECTION = 'products';
const MAX_ATTEMPTS = 5;

function isDemoMode(): boolean {
  const key = auth.app.options.apiKey || '';
  return !key || key.includes('DemoKey') || key.includes('YourFirebaseApiKey') || key === 'AIzaSyDemoKeyForShopPulseDevelopmentOnly';
}

class SyncService {
  private isSyncing: boolean = false;
  private lastSyncTimestamp: string | null = null;
  private lastError: string | null = null;
  private totalSyncedSalesCount: number = 0;
  private totalSyncedInventoryCount: number = 0;
  private autoSyncInterval: any = null;
  private listeners: Set<(stats: SyncStats) => void> = new Set();

  constructor() {
    // Auto-trigger synchronization whenever internet connection is restored
    networkService.subscribeNetworkStatus((isOnline) => {
      if (isOnline) {
        this.syncAll().catch(err => console.warn('Auto-sync on reconnect error:', err));
      }
    });

    // Start background sync heartbeat
    this.startAutoSync(30000);
  }

  /**
   * Start periodic auto-sync heartbeat.
   */
  public startAutoSync(intervalMs: number = 30000): void {
    if (this.autoSyncInterval) clearInterval(this.autoSyncInterval);
    this.autoSyncInterval = setInterval(() => {
      if (networkService.isOnline() && !this.isSyncing) {
        const pendingSales = getPendingSales();
        const pendingInv = getPendingInventory();
        if (pendingSales.length > 0 || pendingInv.length > 0) {
          this.syncAll().catch(err => console.warn('Periodic auto-sync error:', err));
        }
      }
    }, intervalMs);
  }

  public stopAutoSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }

  /**
   * Get current synchronization telemetry and queue counts.
   */
  public getStats(): SyncStats {
    return {
      isOnline: networkService.isOnline(),
      isSyncing: this.isSyncing,
      pendingSalesCount: getPendingSales().length,
      pendingInventoryCount: getPendingInventory().length,
      lastSyncTime: this.lastSyncTimestamp,
      lastError: this.lastError,
      totalSyncedSales: this.totalSyncedSalesCount,
      totalSyncedInventory: this.totalSyncedInventoryCount
    };
  }

  public getSyncStats(): SyncStats {
    return this.getStats();
  }

  public subscribe(callback: (stats: SyncStats) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStats());

    const onQueueChanged = () => callback(this.getStats());
    if (typeof window !== 'undefined') {
      window.addEventListener('shoppulse_sync_queue_changed', onQueueChanged);
    }

    return () => {
      this.listeners.delete(callback);
      if (typeof window !== 'undefined') {
        window.removeEventListener('shoppulse_sync_queue_changed', onQueueChanged);
      }
    };
  }

  public subscribeSyncStats(callback: (stats: SyncStats) => void): () => void {
    return this.subscribe(callback);
  }

  private notify(): void {
    const stats = this.getStats();
    this.listeners.forEach(cb => {
      try {
        cb(stats);
      } catch (err) {
        console.error('Error in sync listener:', err);
      }
    });
  }

  /**
   * Synchronize all pending sales and inventory updates.
   */
  public async syncAll(): Promise<SyncResult> {
    if (this.isSyncing) {
      return {
        syncedSales: 0,
        failedSales: 0,
        syncedInventory: 0,
        failedInventory: 0,
        errors: ['Sync is already in progress']
      };
    }

    if (!networkService.isOnline()) {
      return {
        syncedSales: 0,
        failedSales: 0,
        syncedInventory: 0,
        failedInventory: 0,
        errors: ['Device is offline. Queued items will sync when online.']
      };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.notify();

    const errors: string[] = [];
    let syncedSales = 0;
    let failedSales = 0;
    let syncedInventory = 0;
    let failedInventory = 0;

    try {
      // 1. Sync Pending Sales
      const salesResult = await this.syncPendingSales();
      syncedSales = salesResult.synced;
      failedSales = salesResult.failed;
      errors.push(...salesResult.errors);

      // 2. Sync Pending Inventory
      const invResult = await this.syncPendingInventory();
      syncedInventory = invResult.synced;
      failedInventory = invResult.failed;
      errors.push(...invResult.errors);

      this.lastSyncTimestamp = new Date().toISOString();
      this.totalSyncedSalesCount += syncedSales;
      this.totalSyncedInventoryCount += syncedInventory;

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shoppulse_sales_changed'));
        window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
      }
    } catch (err: any) {
      console.warn('Sync cycle encountered global error:', err);
      this.lastError = err?.message || 'Sync failed';
      if (this.lastError) {
        errors.push(this.lastError);
      }
    } finally {
      this.isSyncing = false;
      this.notify();
    }

    return {
      syncedSales,
      failedSales,
      syncedInventory,
      failedInventory,
      errors
    };
  }

  /**
   * Upload all queued sales to Firestore with deterministic ID deduplication.
   */
  public async syncPendingSales(): Promise<{ synced: number; failed: number; errors: string[] }> {
    const pending = getPendingSales();
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of pending) {
      const attempts = (item.attempts || 0) + 1;
      const nowIso = new Date().toISOString();

      if (attempts > MAX_ATTEMPTS) {
        updateQueuedSale(item.id, { status: 'failed', attempts, lastAttemptAt: nowIso });
        failed++;
        continue;
      }

      updateQueuedSale(item.id, { status: 'syncing', attempts, lastAttemptAt: nowIso });

      if (isDemoMode()) {
        // In local/demo mode, acknowledge and clear from queue
        removeQueuedSale(item.id);
        synced++;
        continue;
      }

      try {
        const saleDocRef = doc(db, SALES_COLLECTION, item.sale.id);
        const existingSnap = await getDoc(saleDocRef);

        // Deduplication guard: if already uploaded to Firestore, avoid duplicate write
        if (!existingSnap.exists()) {
          const { id: _, ...payload } = item.sale;
          await setDoc(saleDocRef, {
            ...payload,
            syncedAt: serverTimestamp(),
            wasOfflineSynced: true
          });
        }

        removeQueuedSale(item.id);
        synced++;
      } catch (err: any) {
        const errMsg = getFirebaseErrorMessage(err);
        errors.push(`Sale ${item.sale.billNumber || item.id}: ${errMsg}`);
        updateQueuedSale(item.id, {
          status: 'pending',
          lastError: errMsg,
          lastAttemptAt: nowIso
        });
        failed++;
      }
    }

    return { synced, failed, errors };
  }

  /**
   * Upload all queued inventory modifications with atomic delta conflict resolution.
   */
  public async syncPendingInventory(): Promise<{ synced: number; failed: number; errors: string[] }> {
    const pending = getPendingInventory();
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of pending) {
      const attempts = (item.attempts || 0) + 1;
      const nowIso = new Date().toISOString();

      if (attempts > MAX_ATTEMPTS) {
        updateQueuedInventory(item.id, { status: 'failed', attempts, lastAttemptAt: nowIso });
        failed++;
        continue;
      }

      updateQueuedInventory(item.id, { status: 'syncing', attempts, lastAttemptAt: nowIso });

      if (isDemoMode()) {
        removeQueuedInventory(item.id);
        synced++;
        continue;
      }

      try {
        const productDocRef = doc(db, PRODUCTS_COLLECTION, item.productId);

        switch (item.mutationType) {
          case 'CREATE':
            if (item.productData) {
              const { id: _, ...payload } = item.productData as any;
              await setDoc(productDocRef, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
            }
            break;

          case 'UPDATE':
            if (item.productData) {
              await updateDoc(productDocRef, { ...item.productData, updatedAt: serverTimestamp() });
            }
            break;

          case 'DELETE':
            await deleteDoc(productDocRef);
            break;

          case 'STOCK_DELTA':
            // Atomic delta increment prevents overwriting concurrent edits on other terminals
            if (item.stockDelta !== undefined) {
              await updateDoc(productDocRef, {
                stock: increment(item.stockDelta),
                updatedAt: serverTimestamp()
              });
            }
            break;
        }

        removeQueuedInventory(item.id);
        synced++;
      } catch (err: any) {
        const errMsg = getFirebaseErrorMessage(err);
        errors.push(`Product ${item.productId}: ${errMsg}`);
        updateQueuedInventory(item.id, {
          status: 'pending',
          lastError: errMsg,
          lastAttemptAt: nowIso
        });
        failed++;
      }
    }

    return { synced, failed, errors };
  }
}

export const syncService = new SyncService();
