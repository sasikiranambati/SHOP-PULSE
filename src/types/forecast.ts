/**
 * @file forecast.ts
 * @description Statistical AI demand forecasting and inventory intelligence models for ShopPulse.
 * Belongs in `src/types/forecast.ts`.
 */

export type StockoutRisk = 'OUT_OF_STOCK' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type ForecastMethod = 'INSUFFICIENT_HISTORY' | 'MOVING_AVERAGE_7' | 'WEEKDAY_SEASONAL';

export type ConfidenceStatus = 'INSUFFICIENT_DATA' | 'STAGE_1_MOVING_AVERAGE' | 'STAGE_2_WEEKDAY_SEASONAL';

/**
 * Product-level statistical demand forecast and inventory intelligence.
 * Directly maps to backend `ProductForecastResponse` Pydantic model.
 */
export interface ProductForecast {
  product_id: string;
  product_name: string;
  standardized_category: string | null;
  current_stock: number;
  reorder_level: number | null;
  unit: string;
  valid_history_days: number;
  average_daily_demand: number | null;
  estimated_weekly_demand: number | null;
  days_until_stockout: number | null;
  stockout_risk: StockoutRisk;
  forecast_method: ForecastMethod;
  confidence_status: ConfidenceStatus;
  recommended_reorder_quantity: number | null;
  has_stockout_censoring: boolean;
  insights: string;
  warnings: string[];
}

export type ProductForecastResponse = ProductForecast;

/**
 * Shop-level consolidated forecast summary and inventory risk breakdown.
 * Directly maps to backend `ForecastSummaryResponse` Pydantic model.
 */
export interface ForecastSummary {
  shop_id: string;
  generated_at: string;
  total_products_analyzed: number;
  products_with_forecast: number;
  products_with_insufficient_history: number;
  high_risk_products_count: number;
  out_of_stock_products_count: number;
  items: ProductForecast[];
}

export type ForecastSummaryResponse = ForecastSummary;

/**
 * Query filter parameters supported by `GET /api/v1/forecast`.
 */
export interface ForecastQueryParams {
  product_id?: string;
  standardized_category?: string;
}
