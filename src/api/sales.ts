/**
 * @file sales.ts
 * @description Sales transactions and history API calls for ShopPulse.
 * Belongs in `src/api/sales.ts`.
 */

import { apiClient } from './client';

export interface SaleItemBackend {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at?: string | null;
}

export interface SaleBackend {
  id: string;
  shop_id: string;
  total_amount: number;
  payment_method: string;
  items: SaleItemBackend[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaginatedSales {
  items: SaleBackend[];
  total: number;
  skip: number;
  limit: number;
}

export interface SaleItemCreateInput {
  product_id: string;
  quantity: number;
  unit_price?: number;
  /** Customer-requested line price; the server applies it only with Manager / Owner approval (audited). */
  requested_line_total?: number;
}

export interface SaleCreateInput {
  items: SaleItemCreateInput[];
  payment_method?: string;
}

/** Server price check of one cart line (POST /sales/quote: nothing is recorded). */
export interface SaleQuoteLine {
  index: number;
  product_id: string;
  ok: boolean;
  code?: 'pricing_status' | 'mrp_exceeded' | 'insufficient_stock' | 'unit' | 'price_mismatch' | 'approval_required' | 'not_found' | 'invalid' | null;
  message?: string | null;
  line_total?: number | null;
  catalogue_line_total?: number | null;
  effective_unit_price?: number | null;
  pricing_basis_quantity?: number | null;
  pricing_basis_unit?: string | null;
  requested_quantity?: number | null;
  requested_unit?: string | null;
  stock_deduction_quantity?: number | null;
  inventory_unit?: string | null;
  line_mrp_total?: number | null;
  requires_approval: boolean;
  pricing_status?: string | null;
}

export interface SaleQuote {
  lines: SaleQuoteLine[];
  total: number;
  all_ok: boolean;
  requires_approval: boolean;
  role?: string | null;
  can_approve_price_overrides: boolean;
}

export const salesApi = {
  /** Price the cart exactly as checkout would, without recording a sale (the server stays authoritative). */
  quoteSale: async (input: SaleCreateInput): Promise<SaleQuote> => {
    return apiClient.post<SaleQuote>('/api/v1/sales/quote', {
      items: input.items,
      payment_method: input.payment_method || 'cash',
    });
  },

  /**
   * Record a new sale transaction.
   * Deducts inventory automatically in the backend.
   */
  createSale: async (input: SaleCreateInput): Promise<SaleBackend> => {
    return apiClient.post<SaleBackend>('/api/v1/sales', {
      items: input.items,
      payment_method: input.payment_method || 'cash',
    });
  },

  /**
   * Get paginated sales history.
   */
  getSales: async (params?: { skip?: number; limit?: number }): Promise<PaginatedSales> => {
    return apiClient.get<PaginatedSales>('/api/v1/sales', {
      params: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      }
    });
  },

  /**
   * Get single sale by ID.
   */
  getSale: async (id: string): Promise<SaleBackend> => {
    return apiClient.get<SaleBackend>(`/api/v1/sales/${id}`);
  },
};
