/**
 * @file alertService.ts
 * @description Production-grade Smart Alerts & Notification backend service for ShopPulse.
 * Belongs in `src/services/alertService.ts`.
 */

import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit as firestoreLimit, 
  onSnapshot,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { 
  Alert, 
  CreateAlertInput, 
  AlertFilterOptions, 
  DashboardAlertStats,
  AlertType,
  AlertPriority
} from '../types/alert';
import type { Product } from '../types/product';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';
import { sendLowStockNotification, sendCriticalAlert } from './pushNotificationService';

const ALERTS_COLLECTION = 'alerts';
const LOCAL_ALERTS_KEY = 'shoppulse_alerts_cache';

/**
 * Check if Firebase is running in offline / local development mode.
 */
function isDemoMode(): boolean {
  const key = auth.app.options.apiKey || '';
  return !key || key.includes('DemoKey') || key.includes('YourFirebaseApiKey') || key === 'AIzaSyDemoKeyForShopPulseDevelopmentOnly';
}

/**
 * Normalize Firestore document data into strongly-typed Alert object.
 */
export function normalizeAlert(id: string, data: any): Alert {
  const priority: AlertPriority = (data.priority || data.severity || 'medium') as AlertPriority;
  let canonicalType: AlertType = (data.type || 'LOW_STOCK') as AlertType;

  // Map legacy lowercase alert types to canonical uppercase
  if (canonicalType === 'low_stock') canonicalType = 'LOW_STOCK';
  if (canonicalType === 'out_of_stock') canonicalType = 'OUT_OF_STOCK';

  return {
    id,
    productId: data.productId || undefined,
    productName: data.productName || undefined,
    type: canonicalType,
    message: data.message || 'System Notification',
    priority,
    isRead: Boolean(data.isRead),
    createdAt: data.createdAt || new Date().toISOString(),
    resolvedAt: data.resolvedAt || undefined,
    shopId: data.shopId || undefined,
    title: data.title || (data.productName ? `${canonicalType.replace(/_/g, ' ')}: ${data.productName}` : 'Alert'),
    severity: priority,
    recommendedOrderQuantity: data.recommendedOrderQuantity ? Number(data.recommendedOrderQuantity) : undefined
  };
}

// ---------------------------------------------------------------------------
// Local / Offline Storage Helpers
// ---------------------------------------------------------------------------

function getLocalAlerts(): Alert[] {
  try {
    const raw = localStorage.getItem(LOCAL_ALERTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const seen = new Set<string>();
        const deduplicated: Alert[] = [];
        for (const item of parsed) {
          const a = normalizeAlert(item.id, item);
          if (!seen.has(a.id)) {
            seen.add(a.id);
            deduplicated.push(a);
          }
        }
        return deduplicated;
      }
    }
  } catch (err) {
    console.warn('Could not read local alerts:', err);
  }

  // Realistic sample seed alerts for day 1 kirana store experience
  const now = new Date();
  const seedAlerts: Alert[] = [
    {
      id: 'alert_seed_1',
      productId: 'p11',
      productName: 'Amul Butter (100g)',
      type: 'OUT_OF_STOCK',
      message: 'Amul Butter (100g) is completely out of stock!',
      priority: 'critical',
      isRead: false,
      createdAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      shopId: 'default'
    },
    {
      id: 'alert_seed_2',
      productId: 'p5',
      productName: 'Farm Fresh Eggs (Tray of 6)',
      type: 'LOW_STOCK',
      message: 'Only 4 trays of Farm Fresh Eggs remaining (reorder level: 10).',
      priority: 'high',
      isRead: false,
      createdAt: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
      shopId: 'default'
    },
    {
      id: 'alert_seed_3',
      productId: 'p10',
      productName: 'Maggi 2-Min Noodles (70g)',
      type: 'LOW_STOCK',
      message: 'Only 2 packs of Maggi Noodles remaining (reorder level: 15).',
      priority: 'high',
      isRead: false,
      createdAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
      shopId: 'default'
    }
  ];

  try {
    localStorage.setItem(LOCAL_ALERTS_KEY, JSON.stringify(seedAlerts));
  } catch {
    // Ignore
  }

  return seedAlerts;
}

function saveLocalAlerts(alerts: Alert[]): void {
  try {
    const seen = new Set<string>();
    const deduplicated: Alert[] = [];
    for (const a of alerts) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        deduplicated.push(a);
      }
    }
    localStorage.setItem(LOCAL_ALERTS_KEY, JSON.stringify(deduplicated));
    window.dispatchEvent(new CustomEvent('shoppulse_alerts_changed'));
  } catch (err) {
    console.warn('Could not save local alerts:', err);
  }
}

// ---------------------------------------------------------------------------
// Core Alert Service Methods
// ---------------------------------------------------------------------------

/**
 * Persist a new alert to Firestore (or local storage in demo mode).
 */
export async function createAlert(input: CreateAlertInput): Promise<Alert> {
  const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();

  const alertData: Alert = {
    id: alertId,
    productId: input.productId,
    productName: input.productName,
    type: input.type,
    message: input.message,
    priority: input.priority,
    isRead: Boolean(input.isRead),
    createdAt: nowIso,
    shopId: input.shopId || 'default',
    title: input.title,
    severity: input.priority,
    recommendedOrderQuantity: input.recommendedOrderQuantity
  };

  if (isDemoMode()) {
    const existing = getLocalAlerts();
    saveLocalAlerts([alertData, ...existing]);
    return alertData;
  }

  try {
    const { id: _, ...payload } = alertData;
    await addDoc(collection(db, ALERTS_COLLECTION), payload);
    return alertData;
  } catch (err) {
    console.warn('Failed to save alert in Firestore, saving locally:', err);
    const existing = getLocalAlerts();
    saveLocalAlerts([alertData, ...existing]);
    return alertData;
  }
}

/**
 * Fetch all alerts, with support for priority, type, read status, and pagination.
 */
export async function getAlerts(options?: AlertFilterOptions): Promise<Alert[]> {
  if (isDemoMode()) {
    let list = getLocalAlerts();

    if (options?.priority) {
      list = list.filter(a => a.priority === options.priority);
    }
    if (options?.type) {
      list = list.filter(a => a.type === options.type);
    }
    if (options?.isRead !== undefined) {
      list = list.filter(a => a.isRead === options.isRead);
    }
    if (options?.isResolved !== undefined) {
      list = list.filter(a => options.isResolved ? Boolean(a.resolvedAt) : !a.resolvedAt);
    }
    if (options?.limit && options.limit > 0) {
      list = list.slice(0, options.limit);
    }

    return list;
  }

  try {
    const constraints: any[] = [orderBy('createdAt', 'desc')];

    if (options?.priority) {
      constraints.push(where('priority', '==', options.priority));
    }
    if (options?.type) {
      constraints.push(where('type', '==', options.type));
    }
    if (options?.isRead !== undefined) {
      constraints.push(where('isRead', '==', options.isRead));
    }
    if (options?.limit && options.limit > 0) {
      constraints.push(firestoreLimit(options.limit));
    }

    const q = query(collection(db, ALERTS_COLLECTION), ...constraints);
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return getLocalAlerts();
    }

    let alerts = snapshot.docs.map(d => normalizeAlert(d.id, d.data()));
    if (options?.isResolved !== undefined) {
      alerts = alerts.filter(a => options.isResolved ? Boolean(a.resolvedAt) : !a.resolvedAt);
    }

    return alerts;
  } catch (err) {
    console.warn('Error fetching alerts from Firestore, returning local alerts:', getFirebaseErrorMessage(err));
    return getLocalAlerts();
  }
}

/**
 * Fetch all unread, unresolved alerts.
 */
export async function getUnreadAlerts(shopId?: string): Promise<Alert[]> {
  const alerts = await getAlerts({ isRead: false, isResolved: false, shopId });
  return alerts;
}

/**
 * Mark a specific alert as read.
 */
export async function markAsRead(alertId: string): Promise<void> {
  if (isDemoMode()) {
    const list = getLocalAlerts().map(a => a.id === alertId ? { ...a, isRead: true } : a);
    saveLocalAlerts(list);
    return;
  }

  try {
    const docRef = doc(db, ALERTS_COLLECTION, alertId);
    await updateDoc(docRef, { isRead: true });
  } catch (err) {
    console.warn('Failed to mark alert read in Firestore, updating locally:', err);
    const list = getLocalAlerts().map(a => a.id === alertId ? { ...a, isRead: true } : a);
    saveLocalAlerts(list);
  }
}

/**
 * Mark all unread alerts as read in a single batch operation.
 */
export async function markAllAsRead(shopId?: string): Promise<void> {
  if (isDemoMode()) {
    const list = getLocalAlerts().map(a => ({ ...a, isRead: true }));
    saveLocalAlerts(list);
    return;
  }

  try {
    const unread = await getUnreadAlerts(shopId);
    if (unread.length === 0) return;

    const batch = writeBatch(db);
    for (const a of unread) {
      const docRef = doc(db, ALERTS_COLLECTION, a.id);
      batch.update(docRef, { isRead: true });
    }
    await batch.commit();
  } catch (err) {
    console.warn('Failed to mark all alerts read in Firestore, updating locally:', err);
    const list = getLocalAlerts().map(a => ({ ...a, isRead: true }));
    saveLocalAlerts(list);
  }
}

/**
 * Mark an alert as resolved (e.g. when product is restocked).
 */
export async function resolveAlert(alertId: string): Promise<void> {
  const nowIso = new Date().toISOString();

  if (isDemoMode()) {
    const list = getLocalAlerts().map(a => a.id === alertId ? { ...a, resolvedAt: nowIso, isRead: true } : a);
    saveLocalAlerts(list);
    return;
  }

  try {
    const docRef = doc(db, ALERTS_COLLECTION, alertId);
    await updateDoc(docRef, { resolvedAt: nowIso, isRead: true });
  } catch (err) {
    console.warn('Failed to resolve alert in Firestore, updating locally:', err);
    const list = getLocalAlerts().map(a => a.id === alertId ? { ...a, resolvedAt: nowIso, isRead: true } : a);
    saveLocalAlerts(list);
  }
}

/**
 * Permanently delete an alert document.
 */
export async function deleteAlert(alertId: string): Promise<void> {
  if (isDemoMode()) {
    const list = getLocalAlerts().filter(a => a.id !== alertId);
    saveLocalAlerts(list);
    return;
  }

  try {
    const docRef = doc(db, ALERTS_COLLECTION, alertId);
    await deleteDoc(docRef);
  } catch (err) {
    console.warn('Failed to delete alert in Firestore, removing locally:', err);
    const list = getLocalAlerts().filter(a => a.id !== alertId);
    saveLocalAlerts(list);
  }
}

/**
 * Real-time listener for alerts with deduplication and clean unsubscribe.
 */
export function subscribeToAlerts(
  callback: (alerts: Alert[]) => void,
  options?: AlertFilterOptions
): () => void {
  const limitCount = options?.limit || 50;

  if (isDemoMode()) {
    // Deliver initial alerts
    callback(getLocalAlerts().slice(0, limitCount));

    const handler = () => {
      callback(getLocalAlerts().slice(0, limitCount));
    };

    window.addEventListener('shoppulse_alerts_changed', handler);
    return () => {
      window.removeEventListener('shoppulse_alerts_changed', handler);
    };
  }

  try {
    const q = query(
      collection(db, ALERTS_COLLECTION),
      orderBy('createdAt', 'desc'),
      firestoreLimit(limitCount)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alerts = snapshot.docs.map(d => normalizeAlert(d.id, d.data()));
      if (alerts.length > 0) {
        // Deduplicate
        const seen = new Set<string>();
        const unique = alerts.filter(a => {
          if (seen.has(a.id)) return false;
          seen.add(a.id);
          return true;
        });
        callback(unique);
      } else {
        callback(getLocalAlerts().slice(0, limitCount));
      }
    }, (err) => {
      console.error('Alerts onSnapshot error, falling back to local alerts:', err);
      callback(getLocalAlerts().slice(0, limitCount));
    });

    return unsubscribe;
  } catch (err) {
    console.warn('Could not establish alerts snapshot listener, using local fallback:', err);
    callback(getLocalAlerts().slice(0, limitCount));
    return () => {};
  }
}

/**
 * Aggregated alert statistics for the dashboard.
 */
export async function getDashboardAlertStats(shopId?: string): Promise<DashboardAlertStats> {
  const allAlerts = await getAlerts({ limit: 100, shopId });

  const unresolved = allAlerts.filter(a => !a.resolvedAt);
  const totalUnread = unresolved.filter(a => !a.isRead).length;
  const criticalAlerts = unresolved.filter(a => a.priority === 'critical');
  const lowStockCount = unresolved.filter(a => a.type === 'LOW_STOCK' || a.type === 'OUT_OF_STOCK').length;
  const recentlyResolved = allAlerts
    .filter(a => Boolean(a.resolvedAt))
    .slice(0, 5);

  return {
    totalUnread,
    criticalAlerts,
    lowStockCount,
    recentlyResolved
  };
}

// ---------------------------------------------------------------------------
// Step 3: Automatic Inventory Monitoring & Deduplication
// ---------------------------------------------------------------------------

/**
 * Inspect a product's stock levels, create alerts when necessary (with duplicate prevention),
 * and automatically resolve active alerts when stock is restored.
 * 
 * @param product - The product whose stock was modified
 * @param previousStock - Optional previous stock level to detect restock transition
 */
export async function checkAndSyncProductAlerts(
  product: Product,
  _previousStock?: number
): Promise<{ created?: Alert; resolved?: Alert[] }> {
  const stock = Number(product.stock ?? 0);
  const reorderLevel = Number(product.reorderLevel ?? product.minStock ?? 10);
  const existingAlerts = await getAlerts({ limit: 100 });

  // Filter active (unresolved) alerts specifically for this product
  const activeAlertsForProduct = existingAlerts.filter(
    a => a.productId === product.id && !a.resolvedAt
  );

  // CASE 1: PRODUCT IS COMPLETELY OUT OF STOCK (stock <= 0)
  if (stock <= 0) {
    // Check if an OUT_OF_STOCK alert already exists for this product (DUPLICATE PREVENTION)
    const existingOutOfStockAlert = activeAlertsForProduct.find(a => a.type === 'OUT_OF_STOCK');
    
    // Auto-resolve any previous LOW_STOCK alert since it is now OUT_OF_STOCK
    const lowStockAlertsToResolve = activeAlertsForProduct.filter(a => a.type === 'LOW_STOCK');
    for (const a of lowStockAlertsToResolve) {
      await resolveAlert(a.id);
    }

    if (!existingOutOfStockAlert) {
      const newAlert = await createAlert({
        productId: product.id,
        productName: product.name,
        type: 'OUT_OF_STOCK',
        message: `${product.name} is completely out of stock! Immediate restock required.`,
        priority: 'critical',
        shopId: 'default'
      });

      // Prepare future push notification
      await sendCriticalAlert(newAlert);

      return { created: newAlert, resolved: lowStockAlertsToResolve };
    }

    return { resolved: lowStockAlertsToResolve };
  }

  // CASE 2: PRODUCT IS LOW STOCK (0 < stock <= reorderLevel)
  if (stock > 0 && stock <= reorderLevel) {
    // Check if an OUT_OF_STOCK alert was active and resolve it since stock is now > 0
    const outOfStockAlertsToResolve = activeAlertsForProduct.filter(a => a.type === 'OUT_OF_STOCK');
    for (const a of outOfStockAlertsToResolve) {
      await resolveAlert(a.id);
    }

    // Check if a LOW_STOCK alert already exists (DUPLICATE PREVENTION)
    const existingLowStockAlert = activeAlertsForProduct.find(a => a.type === 'LOW_STOCK');

    if (!existingLowStockAlert) {
      const newAlert = await createAlert({
        productId: product.id,
        productName: product.name,
        type: 'LOW_STOCK',
        message: `Only ${stock} ${product.unit} of ${product.name} remaining (reorder level: ${reorderLevel}).`,
        priority: stock <= Math.floor(reorderLevel / 2) ? 'high' : 'medium',
        shopId: 'default'
      });

      // Prepare future push notification
      await sendLowStockNotification(product, newAlert);

      return { created: newAlert, resolved: outOfStockAlertsToResolve };
    }

    return { resolved: outOfStockAlertsToResolve };
  }

  // CASE 3: STOCK IS HEALTHY / RESTOCKED (stock > reorderLevel)
  // Automatically resolve all existing active alerts for this product!
  if (stock > reorderLevel && activeAlertsForProduct.length > 0) {
    for (const a of activeAlertsForProduct) {
      await resolveAlert(a.id);
    }
    return { resolved: activeAlertsForProduct };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Backward Compatibility Helpers for existing code
// ---------------------------------------------------------------------------

/**
 * Legacy method alias for markAsRead.
 */
export const markAlertAsRead = markAsRead;

/**
 * Legacy method alias for generating mock recommendations.
 */
export async function generateLowStockAlerts(): Promise<any[]> {
  const alerts = await getAlerts({ isResolved: false });
  return alerts.map(a => ({
    id: a.id,
    type: a.priority === 'critical' ? 'urgent' : 'warning',
    productName: a.productName || 'Product',
    message: a.message,
    recommendedOrder: `Restock recommended`
  }));
}
