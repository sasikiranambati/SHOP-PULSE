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
  /** Agreed price per unit for this line (spoken in Voice-to-Bill or corrected by the user). When absent the
   * catalogue selling price applies. A spoken price is never replaced by the catalogue price. */
  unitPrice?: number;
  priceSource?: 'spoken' | 'edited';
  /** What was said when it differs from the stock quantity (e.g. "500 g" sold as 0.5 kg). */
  spokenQuantity?: string;
  /** The requested (spoken / corrected) price differs from the catalogue: it is a customer request that only a
   * Manager or Owner can approve at checkout (Stage 4C.1). Never applied silently. */
  needsApproval?: boolean;
  /** Catalogue price of this line, shown next to a requested price. */
  catalogueLineTotal?: number;
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
  wasOfflineSynced?: boolean;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed';
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
    total?: number;
    /** Customer-requested line price (needs Manager / Owner approval when it differs from the catalogue). */
    requestedLineTotal?: number;
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
  topProducts?: Array<{
    id: string;
    name: string;
    category: string;
    soldCount: number;
    price?: string;
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
