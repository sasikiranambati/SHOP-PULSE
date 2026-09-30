/**
 * @file purchases.ts
 * @description Purchase and restock logging API calls for ShopPulse.
 * Belongs in `src/api/purchases.ts`.
 */

import { apiClient } from './client';

export interface PurchaseItemBackend {
  id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  purchase_price: number;
  created_at?: string | null;
}

export interface PurchaseBackend {
  id: string;
  shop_id: string;
  supplier_id?: string | null;
  total_amount: number;
  items: PurchaseItemBackend[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaginatedPurchases {
  items: PurchaseBackend[];
  total: number;
  skip: number;
  limit: number;
}

export interface PurchaseItemCreateInput {
  product_id: string;
  quantity: number;
  purchase_price: number;
}

export interface PurchaseCreateInput {
  supplier_id?: string | null;
  items: PurchaseItemCreateInput[];
}

export const purchasesApi = {
  createPurchase: async (input: PurchaseCreateInput): Promise<PurchaseBackend> => {
    return apiClient.post<PurchaseBackend>('/api/v1/purchases', input);
  },

  getPurchases: async (params?: { skip?: number; limit?: number }): Promise<PaginatedPurchases> => {
    return apiClient.get<PaginatedPurchases>('/api/v1/purchases', {
      params: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      }
    });
  },

  getPurchase: async (id: string): Promise<PurchaseBackend> => {
    return apiClient.get<PurchaseBackend>(`/api/v1/purchases/${id}`);
  },
};
