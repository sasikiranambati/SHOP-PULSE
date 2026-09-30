/**
 * @file auth.ts
 * @description Authentication API calls for ShopPulse.
 * Belongs in `src/api/auth.ts`.
 */

import { apiClient, setAccessToken, getAccessToken } from './client';

export interface UserResponse {
  id: string;
  email: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface HealthResponse {
  status: string;
  message: string;
}

export const authApi = {
  /**
   * Register a new user with email and password.
   */
  register: async (email: string, password: string): Promise<UserResponse> => {
    return apiClient.post<UserResponse>('/api/v1/auth/register', { email, password });
  },

  /**
   * Login user and store the returned access token.
   */
  login: async (email: string, password: string): Promise<TokenResponse> => {
    const res = await apiClient.post<TokenResponse>('/api/v1/auth/login', { email, password });
    if (res?.access_token) {
      setAccessToken(res.access_token);
    }
    return res;
  },

  /**
   * Fetch current authenticated user's profile.
   */
  getProfile: async (): Promise<UserResponse> => {
    return apiClient.get<UserResponse>('/api/v1/auth/profile');
  },

  /**
   * Check backend health status.
   */
  checkHealth: async (): Promise<HealthResponse> => {
    return apiClient.get<HealthResponse>('/api/v1/health');
  },

  /**
   * Logout user by clearing stored token.
   */
  logout: (): void => {
    setAccessToken(null);
  },

  /**
   * Check if token is present locally.
   */
  isAuthenticated: (): boolean => {
    return Boolean(getAccessToken());
  }
};
