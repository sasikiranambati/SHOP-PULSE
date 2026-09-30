/**
 * @file products.ts
 * @description Product catalog and inventory API calls for ShopPulse.
 * Belongs in `src/api/products.ts`.
 */

import { apiClient } from './client';

export interface ProductBackend {
  id: string;
  shop_id: string;
  name: string;
  category?: string | null;
  selling_price: number;
  purchase_price?: number | null;
  current_stock: number;
  reorder_level?: number | null;
  unit?: string | null;
  supplier_id?: string | null;
  sku?: string | null;
  stock_status: 'In Stock' | 'Low Stock' | 'Critical';
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaginatedProducts {
  items: ProductBackend[];
  total: number;
  skip: number;
  limit: number;
}

export interface ProductCreateInput {
  name: string;
  category?: string | null;
  selling_price: number;
  purchase_price?: number | null;
  current_stock: number;
  reorder_level?: number | null;
  unit?: string | null;
  supplier_id?: string | null;
  sku?: string | null;
}

export interface ProductUpdateInput {
  name?: string;
  category?: string | null;
  selling_price?: number;
  purchase_price?: number | null;
  current_stock?: number;
  reorder_level?: number | null;
  unit?: string | null;
  supplier_id?: string | null;
  sku?: string | null;
}

export interface ProductQueryParams {
  search?: string;
  category?: string;
  skip?: number;
  limit?: number;
}

export const productsApi = {
  /**
   * Get paginated products for the user's shop with search and category filtering.
   */
  getProducts: async (params?: ProductQueryParams): Promise<PaginatedProducts> => {
    return apiClient.get<PaginatedProducts>('/api/v1/products', {
      params: {
        search: params?.search,
        category: params?.category && params.category !== 'All' ? params.category : undefined,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      }
    });
  },

  /**
   * Get products with low stock.
   */
  getLowStockProducts: async (params?: { skip?: number; limit?: number }): Promise<PaginatedProducts> => {
    return apiClient.get<PaginatedProducts>('/api/v1/products/low-stock', {
      params: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      }
    });
  },

  /**
   * Get single product by ID.
   */
  getProduct: async (id: string): Promise<ProductBackend> => {
    return apiClient.get<ProductBackend>(`/api/v1/products/${id}`);
  },

  /**
   * Create a new product.
   */
  createProduct: async (input: ProductCreateInput): Promise<ProductBackend> => {
    return apiClient.post<ProductBackend>('/api/v1/products', input);
  },

  /**
   * Update an existing product.
   */
  updateProduct: async (id: string, input: ProductUpdateInput): Promise<ProductBackend> => {
    return apiClient.put<ProductBackend>(`/api/v1/products/${id}`, input);
  },

  /**
   * Delete a product by ID.
   */
  deleteProduct: async (id: string): Promise<void> => {
    return apiClient.delete<void>(`/api/v1/products/${id}`);
  },
};
