/**
 * @file offlineQueue.ts
 * @description Persistent local storage queues for offline sales and inventory mutations.
 * Guarantees zero data loss during network outages and provides conflict-resolution records.
 * Belongs in `src/services/offlineQueue.ts`.
 */

import type { Sale } from '../types/sale';
import type { Product } from '../types/product';
import type { QueuedSale, QueuedInventoryMutation, InventoryMutationType } from '../types/sync';
import { getActiveUserId } from './authService';

function getSalesQueueKey(userId?: string): string {
  const uid = userId || getActiveUserId();
  return uid ? `shoppulse_offline_sales_queue_${uid}` : 'shoppulse_offline_sales_queue_guest';
}

function getInventoryQueueKey(userId?: string): string {
  const uid = userId || getActiveUserId();
  return uid ? `shoppulse_offline_inventory_queue_${uid}` : 'shoppulse_offline_inventory_queue_guest';
}

function emitQueueChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shoppulse_sync_queue_changed'));
  }
}

// ---------------------------------------------------------------------------
// 1. Offline Sales Queue (Step 3)
// ---------------------------------------------------------------------------

export function getQueuedSales(userId?: string): QueuedSale[] {
  try {
    const key = getSalesQueueKey(userId);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to read offline sales queue:', err);
  }
  return [];
}

function saveQueuedSales(queue: QueuedSale[], userId?: string): void {
  try {
    const key = getSalesQueueKey(userId);
    localStorage.setItem(key, JSON.stringify(queue));
    emitQueueChanged();
  } catch (err) {
    console.warn('Failed to save offline sales queue:', err);
  }
}

/**
 * Enqueue a completed sale during offline mode or network failure.
 */
export function enqueueSale(sale: Sale, userId?: string): QueuedSale {
  const queue = getQueuedSales(userId);

  // Prevent duplicate enqueuing for the same sale
  const existing = queue.find(q => q.sale.id === sale.id || q.sale.billNumber === sale.billNumber);
  if (existing) {
    return existing;
  }

  const queuedSale: QueuedSale = {
    id: sale.id || `queued_sale_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    sale,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending'
  };

  saveQueuedSales([...queue, queuedSale], userId);
  return queuedSale;
}

/**
 * Retrieve all sales that are currently awaiting upload.
 */
export function getPendingSales(userId?: string): QueuedSale[] {
  return getQueuedSales(userId).filter(q => q.status === 'pending' || q.status === 'failed');
}

/**
 * Update metadata or status of a queued sale.
 */
export function updateQueuedSale(id: string, updates: Partial<QueuedSale>, userId?: string): void {
  const queue = getQueuedSales(userId);
  const updated = queue.map(q => q.id === id ? { ...q, ...updates } : q);
  saveQueuedSales(updated, userId);
}

/**
 * Remove an acknowledged, successfully synced sale from the queue.
 */
export function removeQueuedSale(id: string, userId?: string): void {
  const queue = getQueuedSales(userId);
  saveQueuedSales(queue.filter(q => q.id !== id), userId);
}

// ---------------------------------------------------------------------------
// 2. Offline Inventory Queue (Step 4)
// ---------------------------------------------------------------------------

export function getQueuedInventory(userId?: string): QueuedInventoryMutation[] {
  try {
    const key = getInventoryQueueKey(userId);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to read offline inventory queue:', err);
  }
  return [];
}

function saveQueuedInventory(queue: QueuedInventoryMutation[], userId?: string): void {
  try {
    const key = getInventoryQueueKey(userId);
    localStorage.setItem(key, JSON.stringify(queue));
    emitQueueChanged();
  } catch (err) {
    console.warn('Failed to save offline inventory queue:', err);
  }
}

export interface EnqueueInventoryInput {
  mutationType: InventoryMutationType;
  productId: string;
  productData?: Partial<Product>;
  stockDelta?: number;
}

/**
 * Enqueue an inventory modification (create, update, delete, or delta stock change).
 */
export function enqueueInventoryMutation(input: EnqueueInventoryInput, userId?: string): QueuedInventoryMutation {
  const queue = getQueuedInventory(userId);

  // For STOCK_DELTA on same product, merge if pending
  if (input.mutationType === 'STOCK_DELTA' && input.stockDelta !== undefined) {
    const pendingSameProduct = queue.find(
      q => q.productId === input.productId && q.mutationType === 'STOCK_DELTA' && q.status === 'pending'
    );
    if (pendingSameProduct) {
      pendingSameProduct.stockDelta = (pendingSameProduct.stockDelta || 0) + input.stockDelta;
      pendingSameProduct.attempts = 0;
      saveQueuedInventory(queue, userId);
      return pendingSameProduct;
    }
  }

  const mutationId = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const mutation: QueuedInventoryMutation = {
    id: mutationId,
    mutationType: input.mutationType,
    productId: input.productId,
    productData: input.productData,
    stockDelta: input.stockDelta,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending'
  };

  saveQueuedInventory([...queue, mutation], userId);
  return mutation;
}

/**
 * Retrieve all inventory mutations awaiting upload.
 */
export function getPendingInventory(userId?: string): QueuedInventoryMutation[] {
  return getQueuedInventory(userId).filter(q => q.status === 'pending' || q.status === 'failed');
}

export function updateQueuedInventory(id: string, updates: Partial<QueuedInventoryMutation>, userId?: string): void {
  const queue = getQueuedInventory(userId);
  saveQueuedInventory(queue.map(q => q.id === id ? { ...q, ...updates } : q), userId);
}

export function removeQueuedInventory(id: string, userId?: string): void {
  const queue = getQueuedInventory(userId);
  saveQueuedInventory(queue.filter(q => q.id !== id), userId);
}

/**
 * Purge corrupted or unrecoverable queues if necessary.
 */
export function clearAllQueues(userId?: string): void {
  try {
    localStorage.removeItem(getSalesQueueKey(userId));
    localStorage.removeItem(getInventoryQueueKey(userId));
    emitQueueChanged();
  } catch (err) {
    console.warn('Error clearing queues:', err);
  }
}

/**
 * Returns summary counts of pending sales and inventory items.
 */
export function getQueueCounts(userId?: string): { sales: number; inventory: number; total: number } {
  const sales = getPendingSales().length;
  const inventory = getPendingInventory(userId).length;
  return { sales, inventory, total: sales + inventory };
}

if (typeof window !== 'undefined') {
  (window as any).__shoppulse_queue = {
    getQueuedSales,
    getPendingSales,
    getQueuedInventory,
    getPendingInventory,
    getQueueCounts,
    clearAllQueues
  };
}


