/**
 * @file suppliers.ts
 * @description Supplier management API calls for ShopPulse.
 * Belongs in `src/api/suppliers.ts`.
 */

import { apiClient } from './client';

export interface SupplierBackend {
  id: string;
  shop_id: string;
  supplier_name: string;
  phone?: string | null;
  address?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaginatedSuppliers {
  items: SupplierBackend[];
  total: number;
  skip: number;
  limit: number;
}

export interface SupplierCreateInput {
  supplier_name: string;
  phone?: string | null;
  address?: string | null;
}

export interface SupplierUpdateInput {
  supplier_name?: string;
  phone?: string | null;
  address?: string | null;
}

export const suppliersApi = {
  getSuppliers: async (params?: { search?: string; skip?: number; limit?: number }): Promise<PaginatedSuppliers> => {
    return apiClient.get<PaginatedSuppliers>('/api/v1/suppliers', {
      params: {
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      }
    });
  },

  getSupplier: async (id: string): Promise<SupplierBackend> => {
    return apiClient.get<SupplierBackend>(`/api/v1/suppliers/${id}`);
  },

  createSupplier: async (input: SupplierCreateInput): Promise<SupplierBackend> => {
    return apiClient.post<SupplierBackend>('/api/v1/suppliers', input);
  },

  updateSupplier: async (id: string, input: SupplierUpdateInput): Promise<SupplierBackend> => {
    return apiClient.put<SupplierBackend>(`/api/v1/suppliers/${id}`, input);
  },

  deleteSupplier: async (id: string): Promise<void> => {
    return apiClient.delete<void>(`/api/v1/suppliers/${id}`);
  },
};
