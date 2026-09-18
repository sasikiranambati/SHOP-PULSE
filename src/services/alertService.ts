/**
 * @file alertService.ts
 * @description System notifications and low-stock alert service for ShopPulse.
 * Belongs in `src/services/alertService.ts`.
 */

import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { SystemAlert, ActionRecommendation } from '../types/alert';
import { getLowStockProducts } from './inventoryService';

const ALERTS_COLLECTION = 'alerts';

/**
 * Fetch all unread system alerts for a given shop.
 */
export async function getAlerts(shopId: string = 'default'): Promise<SystemAlert[]> {
  try {
    const colRef = collection(db, ALERTS_COLLECTION);
    const q = query(colRef, where('shopId', '==', shopId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<SystemAlert, 'id'>)
    }));
  } catch (err) {
    console.warn('Error fetching alerts from Firestore, returning empty list:', err);
    return [];
  }
}

/**
 * Mark a specific alert as read.
 */
export async function markAlertAsRead(alertId: string): Promise<void> {
  const docRef = doc(db, ALERTS_COLLECTION, alertId);
  await updateDoc(docRef, { isRead: true });
}

/**
 * Automatically scan low stock products and generate alerts/recommendations.
 */
export async function generateLowStockAlerts(_shopId: string = 'default'): Promise<ActionRecommendation[]> {
  const lowStockItems = await getLowStockProducts();

  return lowStockItems.map(item => {
    const isUrgent = item.stock <= 0 || item.stock <= Math.floor(item.minStock / 2);
    const recommendedQty = Math.max(20, item.minStock * 2 - item.stock);

    return {
      id: `alert-${item.id}`,
      type: isUrgent ? 'urgent' : 'warning',
      productName: item.name,
      message: item.stock <= 0 
        ? `${item.name} is completely out of stock!` 
        : `Only ${item.stock} ${item.unit} remaining (Reorder level: ${item.minStock}).`,
      recommendedOrder: `Order +${recommendedQty} ${item.unit}`
    };
  });
}
