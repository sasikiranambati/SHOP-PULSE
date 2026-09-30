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
}

export interface SaleCreateInput {
  items: SaleItemCreateInput[];
  payment_method?: string;
}

export const salesApi = {
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
