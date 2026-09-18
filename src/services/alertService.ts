/**
 * @file alertService.ts
 * @description System notifications and low-stock alert service for ShopPulse using shared helpers.
 * Belongs in `src/services/alertService.ts`.
 */

import { where } from 'firebase/firestore';
import { getCollection, updateDocument } from './firestoreHelpers';
import type { SystemAlert, ActionRecommendation } from '../types/alert';
import { getLowStockProducts } from './inventoryService';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const ALERTS_COLLECTION = 'alerts';

/**
 * Fetch all unread system alerts for a given shop.
 */
export async function getAlerts(shopId: string = 'default'): Promise<SystemAlert[]> {
  try {
    return await getCollection<Omit<SystemAlert, 'id'>>(ALERTS_COLLECTION, [
      where('shopId', '==', shopId)
    ]);
  } catch (err) {
    console.warn('Error fetching alerts from Firestore, returning empty list:', getFirebaseErrorMessage(err));
    return [];
  }
}

/**
 * Mark a specific alert as read.
 */
export async function markAlertAsRead(alertId: string): Promise<void> {
  try {
    await updateDocument(ALERTS_COLLECTION, alertId, { isRead: true });
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
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
