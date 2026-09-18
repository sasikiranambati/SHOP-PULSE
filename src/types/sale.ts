/**
 * @file sale.ts
 * @description Sale transaction and checkout line item models for ShopPulse POS.
 * Belongs in `src/types/sale.ts`.
 */

import type { Product } from './product';

export type PaymentMethod = 
  | 'Cash' 
  | 'UPI' 
  | 'Card' 
  | 'cash' 
  | 'upi' 
  | 'card' 
  | 'credit'
  | 'Credit';

/**
 * Item contained within a sale transaction.
 * Supports both Phase 5 schema and legacy field naming for seamless compatibility.
 */
export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
  // Backward compatibility aliases
  productName?: string;
  unitPrice?: number;
  totalPrice?: number;
}

// Alias for existing codebase references to SaleLineItem
export type SaleLineItem = SaleItem;

/**
 * Shopping cart item in UI.
 */
export interface CartItem {
  product: Product;
  quantity: number;
}

/**
 * Completed Sale record stored in Firestore.
 */
export interface Sale {
  id: string;
  billNumber: string;
  customerName?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashierId: string;
  createdAt: string;
  // Compatibility & metadata fields
  totalAmount: number; // Alias for total
  shopId?: string;
  createdBy?: string;
  notes?: string;
}

/**
 * Input format for recording a new sale.
 */
export interface CreateSaleInput {
  items: Array<{
    productId: string;
    productName?: string;
    name?: string;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    price?: number;
  }>;
  paymentMethod: PaymentMethod;
  customerName?: string;
  discount?: number;
  tax?: number;
  cashierId?: string;
  notes?: string;
}

/**
 * Receipt data structure for print / share / preview.
 */
export interface ReceiptData {
  shopName: string;
  billNumber: string;
  date: string;
  time: string;
  customerName?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: string;
  cashierId: string;
}

/**
 * Daily sales summary interface.
 */
export interface DailySalesSummary {
  todaySales: number;
  itemsSoldToday: number;
  salesCount: number;
  averageBill: number;
  date: string;
}

/**
 * Dashboard live sales statistics.
 */
export interface DashboardSalesStats {
  todayRevenue: number;
  itemsSoldToday: number;
  totalTransactionsToday: number;
  averageBillValue: number;
  recentSales: Array<{
    id: string;
    items: string;
    total: number;
    time: string;
    billNumber?: string;
  }>;
}

/**
 * Result from parsing natural language voice sale input (e.g. "2 milk 1 bread").
 */
export interface ParsedVoiceSaleItem {
  product: Product;
  quantity: number;
  price: number;
  total: number;
  unit: string;
}

export interface VoiceSaleParseResult {
  items: ParsedVoiceSaleItem[];
  unmatchedPhrases: string[];
  rawText: string;
  confidence: number;
}
