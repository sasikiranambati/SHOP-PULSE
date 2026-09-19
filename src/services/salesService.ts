/**
 * @file salesService.ts
 * @description Production-grade Sales & POS Transaction Service for ShopPulse.
 * Features:
 * - Atomic inventory deduction via Firestore transactions with negative stock prevention
 * - Date-based sequential bill numbering (SP-YYYYMMDD-001)
 * - Multi-item checkout with running totals, tax, and discount
 * - Payment methods (Cash, UPI, Card)
 * - Sales history queries (today, 7 days, 30 days, bill search)
 * - Dashboard live metrics and aggregation
 * - Real-time onSnapshot synchronization
 * - Local offline fallback for dev mode with demo keys
 */

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit as firestoreLimit,
  onSnapshot,
  runTransaction,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { 
  Sale, 
  CreateSaleInput, 
  SaleItem, 
  DailySalesSummary, 
  DashboardSalesStats,
  PaymentMethod 
} from '../types/sale';
import { 
  generateTransactionalBillNumber, 
  generateLocalBillNumber, 
  getFormattedDateKey 
} from '../utils/billNumberGenerator';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';
import { checkAndSyncProductAlerts } from './alertService';
import { networkService } from './networkService';
import { enqueueSale } from './offlineQueue';
import { dashboardCacheService } from './dashboardCacheService';
import { getActiveUserId, requireActiveUserId } from './authService';

function getSalesCol(userId?: string) {
  const uid = userId || requireActiveUserId();
  return collection(db, 'users', uid, 'sales');
}

function getSaleDoc(saleId: string, userId?: string) {
  const uid = userId || requireActiveUserId();
  return doc(db, 'users', uid, 'sales', saleId);
}

function getInventoryDoc(productId: string, userId?: string) {
  const uid = userId || requireActiveUserId();
  return doc(db, 'users', uid, 'inventory', productId);
}

function getLocalSalesKey(userId?: string): string | null {
  const uid = userId || getActiveUserId();
  return uid ? `shoppulse_sales_history_${uid}` : null;
}

function getLocalInventoryKey(userId?: string): string | null {
  const uid = userId || getActiveUserId();
  return uid ? `shoppulse_inventory_products_${uid}` : null;
}

/**
 * Check if app is running in development / demo mode.
 */
function isDemoMode(): boolean {
  const key = auth.app.options.apiKey || '';
  return !key || key.includes('DemoKey') || key.includes('YourFirebaseApiKey') || key === 'AIzaSyDemoKeyForShopPulseDevelopmentOnly';
}

/**
 * Pure function: Calculate bill financial breakdown.
 */
export function calculateBill(
  items: Array<{ price: number; quantity: number }>,
  discount: number = 0,
  taxRate: number = 0 // e.g. 0.05 for 5% GST
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cleanDiscount = Math.max(0, Math.min(discount, subtotal));
  const taxableAmount = Math.max(0, subtotal - cleanDiscount);
  const tax = Math.round(taxableAmount * taxRate * 100) / 100;
  const total = Math.round((taxableAmount + tax) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: cleanDiscount,
    tax,
    total
  };
}

/**
 * Normalize and ensure all Sale fields exist with proper types.
 */
export function normalizeSale(id: string, data: any): Sale {
  const items: SaleItem[] = (data.items || []).map((item: any) => {
    const price = Number(item.price ?? item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 1);
    const total = Number(item.total ?? item.totalPrice ?? (price * quantity));
    const name = item.name || item.productName || 'Unnamed Item';
    const unit = item.unit || 'units';

    return {
      productId: item.productId,
      name,
      productName: name,
      quantity,
      unit,
      price,
      unitPrice: price,
      total,
      totalPrice: total
    };
  });

  const subtotal = Number(data.subtotal ?? items.reduce((s, i) => s + i.total, 0));
  const discount = Number(data.discount ?? 0);
  const tax = Number(data.tax ?? 0);
  const total = Number(data.total ?? data.totalAmount ?? Math.max(0, subtotal - discount + tax));
  const billNumber = data.billNumber || `SP-${id.slice(0, 8).toUpperCase()}`;

  return {
    id,
    billNumber,
    customerName: data.customerName || undefined,
    items,
    subtotal,
    discount,
    tax,
    total,
    totalAmount: total,
    paymentMethod: (data.paymentMethod || 'Cash') as PaymentMethod,
    cashierId: data.cashierId || 'cashier_1',
    createdAt: data.createdAt || new Date().toISOString(),
    shopId: data.shopId || undefined,
    createdBy: data.createdBy || undefined,
    notes: data.notes || undefined
  };
}

// ---------------------------------------------------------------------------
// Local Offline / Development Mode Store Helpers
// ---------------------------------------------------------------------------

function getLocalSales(userId?: string): Sale[] {
  const key = getLocalSalesKey(userId);
  if (!key) return [];

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const seen = new Set<string>();
        const deduplicated: Sale[] = [];
        for (const item of parsed) {
          const s = normalizeSale(item.id, item);
          const itemKey = s.id || s.billNumber;
          if (!seen.has(itemKey)) {
            seen.add(itemKey);
            deduplicated.push(s);
          }
        }
        return deduplicated;
      }
    }
  } catch (err) {
    console.warn('Could not read local sales:', err);
  }

  // Brand-new users start with empty sales history
  return [];
}

function saveLocalSales(sales: Sale[], userId?: string): void {
  const key = getLocalSalesKey(userId);
  if (!key) return;

  try {
    const seen = new Set<string>();
    const deduplicated: Sale[] = [];
    for (const s of sales) {
      const itemKey = s.id || s.billNumber;
      if (!seen.has(itemKey)) {
        seen.add(itemKey);
        deduplicated.push(s);
      }
    }
    localStorage.setItem(key, JSON.stringify(deduplicated));
    window.dispatchEvent(new CustomEvent('shoppulse_sales_changed'));
  } catch (err) {
    console.warn('Could not save local sales:', err);
  }
}

/**
 * Deduct inventory in local storage when running in demo/offline mode.
 */
function deductLocalInventory(items: Array<{ productId: string; quantity: number }>, userId?: string): void {
  const key = getLocalInventoryKey(userId);
  if (!key) return;

  const raw = localStorage.getItem(key);
  if (!raw) return;

  const products = JSON.parse(raw);
  if (!Array.isArray(products)) return;

  for (const item of items) {
    const prod = products.find((p: any) => p.id === item.productId);
    if (prod) {
      if (prod.stock < item.quantity) {
        throw new Error(`Insufficient stock for "${prod.name}". Available: ${prod.stock}, Requested: ${item.quantity}`);
      }
      prod.stock = Math.max(0, prod.stock - item.quantity);
      if (prod.stock === 0) {
        prod.status = 'Out of Stock';
      } else if (prod.stock <= (prod.reorderLevel || prod.minStock || 10)) {
        prod.status = 'Low Stock';
      } else {
        prod.status = 'In Stock';
      }
      prod.updatedAt = new Date().toISOString();
      checkAndSyncProductAlerts(prod).catch(() => {});
    }
  }

  localStorage.setItem(key, JSON.stringify(products));
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

// ---------------------------------------------------------------------------
// Primary Sales Service Operations
// ---------------------------------------------------------------------------

/**
 * Record a new multi-item sale with atomic stock deduction and bill number generation.
 * Uses Firestore transaction to guarantee consistency and prevent overselling / negative stock.
 */
export async function createSale(
  input: CreateSaleInput, 
  cashierId: string = 'cashier_1',
  shopName: string = 'Kiran General Store'
): Promise<Sale> {
  const uid = requireActiveUserId();

  if (!input.items || input.items.length === 0) {
    throw new Error('Cannot complete sale with an empty basket.');
  }

  // Normalize line items
  const lineItems: SaleItem[] = input.items.map(item => {
    const price = Number(item.price ?? item.unitPrice ?? 0);
    const quantity = Number(item.quantity ?? 1);
    const total = Math.round(price * quantity * 100) / 100;
    const name = item.name || item.productName || 'Product';
    const unit = item.unit || 'units';

    if (quantity <= 0) {
      throw new Error(`Invalid quantity for ${name}. Must be at least 1.`);
    }

    return {
      productId: item.productId,
      name,
      productName: name,
      quantity,
      unit,
      price,
      unitPrice: price,
      total,
      totalPrice: total
    };
  });

  const { subtotal, discount, tax, total } = calculateBill(
    lineItems.map(i => ({ price: i.price, quantity: i.quantity })),
    input.discount || 0,
    input.tax || 0
  );

  const now = new Date();
  const nowIso = now.toISOString();

  const recordLocalSale = (): Sale => {
    // 1. Transactionally check and deduct local inventory
    deductLocalInventory(lineItems.map(i => ({ productId: i.productId, quantity: i.quantity })), uid);

    // 2. Generate local sequential bill number
    const existingSales = getLocalSales(uid);
    const existingBillNumbers = existingSales.map(s => s.billNumber);
    const billNumber = generateLocalBillNumber(now, existingBillNumbers);

    const isOffline = !networkService.isOnline();
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newSale: Sale = {
      id: saleId,
      billNumber,
      customerName: input.customerName || undefined,
      items: lineItems,
      subtotal,
      discount,
      tax,
      total,
      totalAmount: total,
      paymentMethod: input.paymentMethod || 'Cash',
      cashierId,
      createdAt: nowIso,
      shopId: shopName,
      notes: input.notes,
      syncStatus: isOffline ? 'pending' : 'synced'
    };

    saveLocalSales([newSale, ...existingSales], uid);

    // If offline, enqueue for background synchronization
    if (isOffline) {
      enqueueSale(newSale);
    }

    // Update instant dashboard cache snapshot
    try {
      const snap = dashboardCacheService.getSnapshot(uid);
      dashboardCacheService.updateSnapshot({
        todayRevenue: (snap.todayRevenue || 0) + total,
        itemsSoldToday: (snap.itemsSoldToday || 0) + lineItems.reduce((s, i) => s + i.quantity, 0),
        totalOrdersToday: (snap.totalOrdersToday || 0) + 1
      }, uid);
    } catch {
      // Ignore cache update errors
    }

    return newSale;
  };

  // Local / Demo Mode Execution or Network Offline
  if (isDemoMode() || !networkService.isOnline()) {
    try {
      return recordLocalSale();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to record sale in offline mode.');
    }
  }

  // Firestore Production Mode Execution with Atomic Transactions
  try {
    const saleDocRef = doc(getSalesCol(uid));

    const productDocsToUpdate: Array<{
      ref: any;
      data: any;
      newStock: number;
      newStatus: string;
      productId: string;
    }> = [];

    const resultSale = await runTransaction(db, async (transaction) => {
      // 1. Read all product documents to verify stock
      productDocsToUpdate.length = 0;

      for (const item of lineItems) {
        const productRef = getInventoryDoc(item.productId, uid);
        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists()) {
          throw new Error(`Product "${item.name}" (ID: ${item.productId}) was not found in catalog.`);
        }

        const productData = productSnapshot.data();
        const currentStock = Number(productData.stock ?? 0);

        // Negative stock prevention guard
        if (currentStock < item.quantity) {
          throw new Error(
            `Insufficient stock for "${item.name}". Only ${currentStock} available, but ${item.quantity} requested.`
          );
        }

        const newStock = currentStock - item.quantity;
        const reorderLevel = Number(productData.reorderLevel ?? productData.minStock ?? 10);

        let newStatus = 'In Stock';
        if (newStock === 0) newStatus = 'Out of Stock';
        else if (newStock <= reorderLevel) newStatus = 'Low Stock';

        productDocsToUpdate.push({
          ref: productRef,
          data: productData,
          newStock,
          newStatus,
          productId: item.productId
        });
      }

      // 2. Generate unique sequential bill number atomically
      const { billNumber } = await generateTransactionalBillNumber(transaction, now);

      // 3. Atomically deduct inventory for every product
      for (const update of productDocsToUpdate) {
        transaction.update(update.ref, {
          stock: update.newStock,
          status: update.newStatus,
          updatedAt: nowIso
        });
      }

      // 4. Atomically persist sale record
      const salePayload: Omit<Sale, 'id'> = {
        billNumber,
        customerName: input.customerName || undefined,
        items: lineItems,
        subtotal,
        discount,
        tax,
        total,
        totalAmount: total,
        paymentMethod: input.paymentMethod || 'Cash',
        cashierId,
        createdAt: nowIso,
        shopId: shopName,
        notes: input.notes
      };

      transaction.set(saleDocRef, salePayload);

      return {
        id: saleDocRef.id,
        ...salePayload
      };
    });

    // 5. Automatically check and sync inventory alerts for depleted items
    for (const update of productDocsToUpdate) {
      checkAndSyncProductAlerts({
        id: update.productId,
        ...update.data,
        stock: update.newStock,
        status: update.newStatus
      } as any).catch(() => {});
    }

    // Update dashboard cache
    try {
      const snap = dashboardCacheService.getSnapshot(uid);
      dashboardCacheService.updateSnapshot({
        todayRevenue: (snap.todayRevenue || 0) + total,
        itemsSoldToday: (snap.itemsSoldToday || 0) + lineItems.reduce((s, i) => s + i.quantity, 0),
        totalOrdersToday: (snap.totalOrdersToday || 0) + 1
      }, uid);
    } catch {
      // Ignore
    }

    return normalizeSale(resultSale.id, resultSale);
  } catch (err: any) {
    const errorMsg = getFirebaseErrorMessage(err);
    const isNetworkOrOffline = 
      !networkService.isOnline() || 
      errorMsg.includes('offline') || 
      errorMsg.includes('network') || 
      errorMsg.includes('unavailable') || 
      errorMsg.includes('client is offline');

    if (isNetworkOrOffline) {
      console.warn('Network unavailable during Firestore transaction, executing optimistic offline sale and queuing:', errorMsg);
      try {
        return recordLocalSale();
      } catch (fallbackErr: any) {
        throw new Error(fallbackErr.message || 'Failed to record sale offline.');
      }
    }

    throw new Error(errorMsg);
  }
}

/**
 * Fetch a single sale by ID or bill number.
 */
export async function getSale(saleIdOrBillNumber: string): Promise<Sale | null> {
  const uid = requireActiveUserId();

  if (isDemoMode()) {
    const sales = getLocalSales(uid);
    const found = sales.find(s => s.id === saleIdOrBillNumber || s.billNumber === saleIdOrBillNumber);
    return found || null;
  }

  try {
    // 1. Try by document ID
    const docRef = getSaleDoc(saleIdOrBillNumber, uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return normalizeSale(snap.id, snap.data());
    }

    // 2. Try by billNumber
    const q = query(
      getSalesCol(uid),
      where('billNumber', '==', saleIdOrBillNumber),
      firestoreLimit(1)
    );
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docData = querySnap.docs[0];
      return normalizeSale(docData.id, docData.data());
    }

    return null;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

export const getSaleById = getSale;

/**
 * Fetch sales with optional filtering (limit, period, billNumber).
 */
export async function getSales(options?: number | {
  limit?: number;
  period?: 'today' | '7days' | '30days';
  billNumber?: string;
}): Promise<Sale[]> {
  const uid = getActiveUserId();
  if (!uid) return [];

  const opts = typeof options === 'number' ? { limit: options } : options;
  const maxCount = opts?.limit ?? 50;

  if (isDemoMode()) {
    let sales = getLocalSales(uid);

    if (opts?.billNumber) {
      const clean = opts.billNumber.toLowerCase();
      sales = sales.filter(s => s.billNumber.toLowerCase().includes(clean));
    }

    if (opts?.period) {
      const now = new Date();
      const todayKey = getFormattedDateKey(now);

      if (opts.period === 'today') {
        sales = sales.filter(s => s.billNumber.includes(todayKey) || s.createdAt.startsWith(now.toISOString().split('T')[0]));
      } else if (opts.period === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        sales = sales.filter(s => s.createdAt >= sevenDaysAgo);
      } else if (opts.period === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        sales = sales.filter(s => s.createdAt >= thirtyDaysAgo);
      }
    }

    return sales.slice(0, maxCount);
  }

  try {
    let constraints: any[] = [orderBy('createdAt', 'desc')];

    if (opts?.period) {
      const now = new Date();
      let thresholdDate: Date;

      if (opts.period === 'today') {
        thresholdDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (opts.period === '7days') {
        thresholdDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        thresholdDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      constraints = [
        where('createdAt', '>=', thresholdDate.toISOString()),
        orderBy('createdAt', 'desc')
      ];
    }

    constraints.push(firestoreLimit(maxCount));

    const q = query(getSalesCol(uid), ...constraints);
    const snap = await getDocs(q);

    let sales = snap.docs.map(d => normalizeSale(d.id, d.data()));

    if (opts?.billNumber) {
      const term = opts.billNumber.toLowerCase();
      sales = sales.filter(s => s.billNumber.toLowerCase().includes(term));
    }

    return sales;
  } catch (err) {
    console.warn('Firestore getSales failed, returning local sales:', err);
    return getLocalSales(uid);
  }
}

/**
 * Fetch sales recorded today.
 */
export async function getTodaySales(): Promise<Sale[]> {
  return getSales({ period: 'today', limit: 100 });
}

/**
 * Fetch sales for a specific calendar date (YYYY-MM-DD).
 */
export async function getSalesByDate(dateString: string): Promise<Sale[]> {
  const uid = getActiveUserId();
  if (!uid) return [];

  if (isDemoMode()) {
    const sales = getLocalSales(uid);
    return sales.filter(s => s.createdAt.startsWith(dateString));
  }

  try {
    const startIso = `${dateString}T00:00:00.000Z`;
    const endIso = `${dateString}T23:59:59.999Z`;

    const q = query(
      getSalesCol(uid),
      where('createdAt', '>=', startIso),
      where('createdAt', '<=', endIso),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => normalizeSale(d.id, d.data()));
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Search sales by bill number.
 */
export async function searchSalesByBillNumber(billNumberQuery: string): Promise<Sale[]> {
  return getSales({ billNumber: billNumberQuery, limit: 20 });
}

/**
 * Delete a sale record (with optional inventory reversal).
 */
export async function deleteSale(saleId: string, restoreInventory: boolean = false): Promise<void> {
  const uid = requireActiveUserId();

  if (isDemoMode()) {
    const sales = getLocalSales(uid);
    const saleToDelete = sales.find(s => s.id === saleId);

    if (restoreInventory && saleToDelete) {
      // Revert stock
      try {
        const key = getLocalInventoryKey(uid);
        const raw = key ? localStorage.getItem(key) : null;
        if (raw && key) {
          const products = JSON.parse(raw);
          for (const item of saleToDelete.items) {
            const p = products.find((x: any) => x.id === item.productId);
            if (p) p.stock += item.quantity;
          }
          localStorage.setItem(key, JSON.stringify(products));
          window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
        }
      } catch (err) {
        console.warn('Could not revert local inventory:', err);
      }
    }

    saveLocalSales(sales.filter(s => s.id !== saleId), uid);
    return;
  }

  try {
    if (restoreInventory) {
      const sale = await getSale(saleId);
      if (sale) {
        await runTransaction(db, async (tx) => {
          for (const item of sale.items) {
            const pRef = getInventoryDoc(item.productId, uid);
            const pSnap = await tx.get(pRef);
            if (pSnap.exists()) {
              const currentStock = Number(pSnap.data().stock ?? 0);
              tx.update(pRef, { stock: currentStock + item.quantity });
            }
          }
          tx.delete(getSaleDoc(saleId, uid));
        });
        return;
      }
    }

    await deleteDoc(getSaleDoc(saleId, uid));
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Real-time listener for sales updates with clean unsubscribe.
 */
export function subscribeToSales(
  callback: (sales: Sale[]) => void,
  limitCount: number = 50
): () => void {
  const uid = getActiveUserId();
  if (!uid) {
    callback([]);
    return () => {};
  }

  if (isDemoMode()) {
    // Deliver initial sales
    callback(getLocalSales(uid).slice(0, limitCount));

    const handler = () => {
      callback(getLocalSales(uid).slice(0, limitCount));
    };

    window.addEventListener('shoppulse_sales_changed', handler);
    return () => {
      window.removeEventListener('shoppulse_sales_changed', handler);
    };
  }

  try {
    const q = query(
      getSalesCol(uid),
      orderBy('createdAt', 'desc'),
      firestoreLimit(limitCount)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sales = snapshot.docs.map(d => normalizeSale(d.id, d.data()));
      if (sales.length > 0) {
        callback(sales);
      } else {
        callback(getLocalSales(uid).slice(0, limitCount));
      }
    }, (err) => {
      console.error('Sales onSnapshot error:', err);
      callback(getLocalSales(uid).slice(0, limitCount));
    });

    return unsubscribe;
  } catch (err) {
    console.warn('Could not establish sales snapshot listener:', err);
    return () => {};
  }
}

/**
 * Calculate high-performance aggregated Dashboard sales statistics.
 */
export async function getDashboardSalesStats(): Promise<DashboardSalesStats> {
  try {
    const todaySalesList = await getTodaySales();

    const todayRevenue = todaySalesList.reduce((sum, s) => sum + s.total, 0);
    const itemsSoldToday = todaySalesList.reduce((sum, s) => {
      return sum + s.items.reduce((itemSum, i) => itemSum + i.quantity, 0);
    }, 0);
    const totalTransactionsToday = todaySalesList.length;
    const averageBillValue = totalTransactionsToday > 0 
      ? Math.round((todayRevenue / totalTransactionsToday) * 100) / 100 
      : 0;

    // Map recent sales for dashboard activity
    const recentSales = todaySalesList.slice(0, 5).map(s => {
      const summaryItems = s.items
        .map(i => `${i.quantity}x ${i.name}`)
        .slice(0, 2)
        .join(', ');

      const moreCount = s.items.length > 2 ? ` +${s.items.length - 2} more` : '';
      const timeAgo = formatTimeAgo(s.createdAt);

      return {
        id: s.id,
        items: `${summaryItems}${moreCount}`,
        total: s.total,
        time: timeAgo,
        billNumber: s.billNumber
      };
    });

    return {
      todayRevenue,
      itemsSoldToday,
      totalTransactionsToday,
      averageBillValue,
      recentSales
    };
  } catch (err) {
    console.warn('Could not compute dashboard sales stats:', err);
    return {
      todayRevenue: 0,
      itemsSoldToday: 0,
      totalTransactionsToday: 0,
      averageBillValue: 0,
      recentSales: []
    };
  }
}

/**
 * Helper to display human-readable time ago ("5 mins ago", "1 hour ago").
 */
function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} mins ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return new Date(isoString).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

/**
 * Backward compatibility helper for daily sales summary.
 */
export async function getTodaySalesSummary(): Promise<DailySalesSummary> {
  const stats = await getDashboardSalesStats();
  const todayStr = new Date().toISOString().split('T')[0];

  return {
    todaySales: stats.todayRevenue,
    itemsSoldToday: stats.itemsSoldToday,
    salesCount: stats.totalTransactionsToday,
    averageBill: stats.averageBillValue,
    date: todayStr
  };
}
