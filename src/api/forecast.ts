/**
 * @file forecast.ts
 * @description Statistical AI demand forecasting API calls for ShopPulse.
 * Belongs in `src/api/forecast.ts`.
 */

import { apiClient } from './client';
import type { ForecastSummary, ForecastQueryParams } from '../types/forecast';

export const forecastApi = {
  /**
   * Fetch statistical demand forecasts and inventory intelligence for the authenticated shop.
   * Query parameters are optional. Tenant isolation is enforced securely by the backend via JWT.
   */
  getForecast: async (params?: ForecastQueryParams): Promise<ForecastSummary> => {
    return apiClient.get<ForecastSummary>('/api/v1/forecast', {
      params: {
        product_id: params?.product_id,
        standardized_category:
          params?.standardized_category && params.standardized_category !== 'All'
            ? params.standardized_category
            : undefined,
      },
    });
  },
};
