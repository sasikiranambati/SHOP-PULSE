/**
 * @file search.ts
 * @description Global search across the shop's products, purchase invoices and sales.
 * The server does the matching and returns a few rows per group, so whole tables are never loaded.
 */

import { apiClient } from './client';

export interface ProductSearchHit {
  id: string;
  name: string;
  category?: string | null;
  sku?: string | null;
  unit?: string | null;
  current_stock: number;
  selling_price: number;
}

export interface PurchaseSearchHit {
  id: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  supplier_name?: string | null;
  total_amount: number;
  item_count: number;
  created_at?: string | null;
  matched_product?: string | null;
}

export interface SaleSearchHit {
  id: string;
  bill_number: string;
  total_amount: number;
  payment_method: string;
  item_count: number;
  created_at?: string | null;
  matched_product?: string | null;
}

export interface SearchResults {
  query: string;
  products: ProductSearchHit[];
  purchases: PurchaseSearchHit[];
  sales: SaleSearchHit[];
  totals: { products: number; purchases: number; sales: number };
}

export const SEARCH_MIN_LENGTH = 2;

export const searchApi = {
  search: (query: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResults> =>
    apiClient.get<SearchResults>('/api/v1/search', {
      params: { q: query, limit: options.limit ?? 5 },
      signal: options.signal,
    }),
};
