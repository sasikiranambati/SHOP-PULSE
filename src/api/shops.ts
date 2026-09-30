/**
 * @file shops.ts
 * @description Shop management API calls for ShopPulse.
 * Belongs in `src/api/shops.ts`.
 */

import { apiClient } from './client';

export interface ShopResponse {
  id: string;
  owner_id: string;
  shop_name: string;
  owner_name: string;
  business_type: string;
  location?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ShopCreateInput {
  shop_name: string;
  owner_name: string;
  business_type: string;
  location?: string | null;
}

export interface ShopUpdateInput {
  shop_name?: string;
  owner_name?: string;
  business_type?: string;
  location?: string | null;
}

export const shopsApi = {
  /**
   * Create a new shop profile for the authenticated user.
   */
  createShop: async (input: ShopCreateInput): Promise<ShopResponse> => {
    return apiClient.post<ShopResponse>('/api/v1/shops', input);
  },

  /**
   * Get the authenticated user's shop profile.
   */
  getMyShop: async (): Promise<ShopResponse> => {
    return apiClient.get<ShopResponse>('/api/v1/shops/me');
  },

  /**
   * Update shop profile by ID.
   */
  updateShop: async (id: string, input: ShopUpdateInput): Promise<ShopResponse> => {
    return apiClient.put<ShopResponse>(`/api/v1/shops/${id}`, input);
  },
};
