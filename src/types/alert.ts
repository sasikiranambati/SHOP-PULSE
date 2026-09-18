/**
 * @file alert.ts
 * @description System alerts, inventory reorder notifications, and action recommendations.
 * Belongs in `src/types/alert.ts`.
 */

export type CanonicalAlertType = 
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'REORDER_RECOMMENDED'
  | 'DEVICE_OFFLINE'
  | 'SALE_COMPLETED';

export type LegacyAlertType = 
  | 'low_stock'
  | 'out_of_stock'
  | 'sales_spike'
  | 'system';

export type AlertType = CanonicalAlertType | LegacyAlertType;

export type AlertPriority = 'low' | 'medium' | 'high' | 'critical';
export type AlertSeverity = 'info' | 'warning' | 'urgent' | 'critical' | AlertPriority;

/**
 * Production-ready Alert model for ShopPulse.
 */
export interface Alert {
  id: string;
  productId?: string;
  productName?: string;
  type: AlertType;
  message: string;
  priority: AlertPriority;
  isRead: boolean;
  createdAt: string;
  resolvedAt?: string;
  shopId?: string;

  // Backward compatibility fields
  title?: string;
  severity?: AlertSeverity;
  recommendedOrderQuantity?: number;
}

/**
 * Payload interface for creating new alerts.
 */
export interface CreateAlertInput {
  productId?: string;
  productName?: string;
  type: AlertType;
  message: string;
  priority: AlertPriority;
  shopId?: string;
  isRead?: boolean;
  title?: string;
  recommendedOrderQuantity?: number;
}

/**
 * Options for querying alerts.
 */
export interface AlertFilterOptions {
  priority?: AlertPriority;
  type?: AlertType;
  isRead?: boolean;
  isResolved?: boolean;
  limit?: number;
  shopId?: string;
}

/**
 * Reusable dashboard alert summary metrics.
 */
export interface DashboardAlertStats {
  totalUnread: number;
  criticalAlerts: Alert[];
  lowStockCount: number;
  recentlyResolved: Alert[];
}

/**
 * Structured product reorder suggestion model.
 */
export interface ReorderSuggestion {
  productId: string;
  productName: string;
  currentStock: number;
  reorderLevel: number;
  suggestedRestock: number;
  unit: string;
  urgency: 'critical' | 'high' | 'medium';
  category?: string;
  price?: number;
}

/**
 * Legacy SystemAlert alias for backward compatibility.
 */
export type SystemAlert = Alert;

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
