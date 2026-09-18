/**
 * @file sale.ts
 * @description Sale transaction and checkout line item models for ShopPulse.
 * Belongs in `src/types/sale.ts`.
 */

import type { Product } from './product';

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'credit';

/**
 * Line item in a sale transaction.
 */
export interface SaleLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/**
 * Shopping cart item in UI.
 */
export interface CartItem {
  product: Product;
  quantity: number;
}

/**
 * Completed Sale record stored in database.
 */
export interface Sale {
  id: string;
  shopId?: string;
  items: SaleLineItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  createdBy?: string;
}

/**
 * Input format for recording a new sale.
 */
export interface CreateSaleInput {
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
  paymentMethod: PaymentMethod;
}

/**
 * Daily sales summary interface.
 */
export interface DailySalesSummary {
  todaySales: number;
  itemsSoldToday: number;
  salesCount: number;
  date: string;
}
