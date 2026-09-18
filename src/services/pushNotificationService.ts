/**
 * @file pushNotificationService.ts
 * @description Future-ready push notification service stub for Firebase Cloud Messaging (FCM).
 * Belongs in `src/services/pushNotificationService.ts`.
 */

import type { Alert } from '../types/alert';
import type { Product } from '../types/product';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, string>;
  priority?: 'normal' | 'high';
}

/**
 * Placeholder for sending low stock push notifications to store owner device.
 * Structured for future Firebase Cloud Messaging (FCM) drop-in integration.
 */
export async function sendLowStockNotification(product: Product, alert: Alert): Promise<void> {
  const payload: PushNotificationPayload = {
    title: `⚠️ Low Stock: ${product.name}`,
    body: alert.message || `Only ${product.stock} ${product.unit} remaining. Restock recommended.`,
    priority: 'normal',
    data: {
      alertId: alert.id,
      productId: product.id,
      type: 'LOW_STOCK',
      currentStock: String(product.stock),
      reorderLevel: String(product.reorderLevel ?? product.minStock ?? 10)
    }
  };

  // Structured logging for audit and readiness
  console.info('[PushNotification] Prepared Low Stock Notification (FCM Ready):', payload);

  // When FCM is enabled, this will call:
  // await sendFcmMessage(deviceToken, payload);
}

/**
 * Placeholder for sending critical alerts (e.g. out of stock or hardware offline).
 * Dispatches high-priority push notification.
 */
export async function sendCriticalAlert(alert: Alert): Promise<void> {
  const payload: PushNotificationPayload = {
    title: `🚨 CRITICAL: ${alert.productName || 'Inventory Alert'}`,
    body: alert.message,
    priority: 'high',
    data: {
      alertId: alert.id,
      productId: alert.productId || '',
      type: alert.type,
      priority: alert.priority
    }
  };

  console.warn('[PushNotification] Prepared Critical Alert (FCM Ready):', payload);

  // When FCM is enabled, this will call:
  // await sendFcmMessage(deviceToken, payload);
}

/**
 * Register a device FCM registration token for push notifications.
 */
export async function registerDeviceToken(userId: string, token: string): Promise<void> {
  console.info(`[PushNotification] Registered device token for user ${userId}:`, token.substring(0, 10) + '...');
  try {
    localStorage.setItem('shoppulse_fcm_token', token);
  } catch {
    // Ignore localStorage write error
  }
}

/**
 * Check if the current browser environment supports Push Notifications.
 */
export function isPushNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}
