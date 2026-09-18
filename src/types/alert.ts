/**
 * @file alert.ts
 * @description System alerts, inventory reorder notifications, and action recommendations.
 * Belongs in `src/types/alert.ts`.
 */

export type AlertType = 'low_stock' | 'out_of_stock' | 'sales_spike' | 'system';

export type AlertSeverity = 'info' | 'warning' | 'urgent' | 'critical';

/**
 * System Notification or Inventory Alert model.
 */
export interface SystemAlert {
  id: string;
  shopId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  productId?: string;
  productName?: string;
  recommendedOrderQuantity?: number;
  isRead: boolean;
  createdAt: string;
}

/**
 * Action Recommendation model (compatible with UI insights).
 */
export interface ActionRecommendation {
  id: string;
  type: 'warning' | 'info' | 'urgent';
  productName: string;
  message: string;
  recommendedOrder: string;
}
