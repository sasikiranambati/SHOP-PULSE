/**
 * @file forecastFoundation.test.ts
 * @description Automated unit and integration tests for Phase 3 frontend forecasting foundation:
 * types, forecastApi, and useForecast hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forecastApi } from '../api/forecast';
import { apiClient } from '../api/client';
import type { ForecastSummary, ProductForecast } from '../types/forecast';

describe('forecastApi client service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches forecast from /api/v1/forecast without shop_id', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      shop_id: 'shop_123',
      generated_at: '2026-11-03T12:00:00Z',
      total_products_analyzed: 0,
      products_with_forecast: 0,
      products_with_insufficient_history: 0,
      high_risk_products_count: 0,
      out_of_stock_products_count: 0,
      items: [],
    } as ForecastSummary);

    const result = await forecastApi.getForecast();

    expect(getSpy).toHaveBeenCalledWith('/api/v1/forecast', {
      params: {
        product_id: undefined,
        standardized_category: undefined,
      },
    });
    expect(result.shop_id).toBe('shop_123');
    expect(result.items).toHaveLength(0);
  });

  it('passes product_id and standardized_category query parameters', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      shop_id: 'shop_123',
      generated_at: '2026-11-03T12:00:00Z',
      total_products_analyzed: 1,
      products_with_forecast: 1,
      products_with_insufficient_history: 0,
      high_risk_products_count: 0,
      out_of_stock_products_count: 0,
      items: [],
    } as ForecastSummary);

    await forecastApi.getForecast({
      product_id: 'prod_abc',
      standardized_category: 'Dairy',
    });

    expect(getSpy).toHaveBeenCalledWith('/api/v1/forecast', {
      params: {
        product_id: 'prod_abc',
        standardized_category: 'Dairy',
      },
    });
  });

  it('omits standardized_category when category filter is "All"', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      shop_id: 'shop_123',
      generated_at: '2026-11-03T12:00:00Z',
      total_products_analyzed: 0,
      products_with_forecast: 0,
      products_with_insufficient_history: 0,
      high_risk_products_count: 0,
      out_of_stock_products_count: 0,
      items: [],
    } as ForecastSummary);

    await forecastApi.getForecast({
      standardized_category: 'All',
    });

    expect(getSpy).toHaveBeenCalledWith('/api/v1/forecast', {
      params: {
        product_id: undefined,
        standardized_category: undefined,
      },
    });
  });
});

describe('Forecast Data Models & Null Value Preservation', () => {
  it('preserves null values under Stage 0 (INSUFFICIENT_HISTORY)', () => {
    const stage0Item: ProductForecast = {
      product_id: 'p_milk',
      product_name: 'Amul Taaza 500ml',
      standardized_category: 'Dairy',
      current_stock: 12,
      reorder_level: 10,
      unit: 'pkts',
      valid_history_days: 3,
      average_daily_demand: null,
      estimated_weekly_demand: null,
      days_until_stockout: null,
      stockout_risk: 'UNKNOWN',
      forecast_method: 'INSUFFICIENT_HISTORY',
      confidence_status: 'INSUFFICIENT_DATA',
      recommended_reorder_quantity: null,
      has_stockout_censoring: false,
      insights: 'Insufficient sales history (3 of 7 days). Inventory reference level: 10 pkts.',
      warnings: ['Requires at least 7 valid open selling days for statistical forecast.'],
    };

    expect(stage0Item.average_daily_demand).toBeNull();
    expect(stage0Item.estimated_weekly_demand).toBeNull();
    expect(stage0Item.days_until_stockout).toBeNull();
    expect(stage0Item.recommended_reorder_quantity).toBeNull();
    expect(stage0Item.stockout_risk).toBe('UNKNOWN');
    expect(stage0Item.forecast_method).toBe('INSUFFICIENT_HISTORY');
    expect(stage0Item.confidence_status).toBe('INSUFFICIENT_DATA');
    expect(stage0Item.reorder_level).toBe(10);
  });

  it('accurately models Stage 1 (MOVING_AVERAGE_7) and Stage 2 (WEEKDAY_SEASONAL)', () => {
    const stage1Item: ProductForecast = {
      product_id: 'p_bread',
      product_name: 'Modern Bread 400g',
      standardized_category: 'Bakery',
      current_stock: 4,
      reorder_level: 15,
      unit: 'loaves',
      valid_history_days: 12,
      average_daily_demand: 3.5,
      estimated_weekly_demand: 24.5,
      days_until_stockout: 1.1,
      stockout_risk: 'HIGH',
      forecast_method: 'MOVING_AVERAGE_7',
      confidence_status: 'STAGE_1_MOVING_AVERAGE',
      recommended_reorder_quantity: 21,
      has_stockout_censoring: false,
      insights: 'Modern Bread 400g may run out in approx 1 days. Current stock: 4 loaves. Method: MOVING_AVERAGE_7.',
      warnings: [],
    };

    expect(stage1Item.average_daily_demand).toBe(3.5);
    expect(stage1Item.estimated_weekly_demand).toBe(24.5);
    expect(stage1Item.days_until_stockout).toBe(1.1);
    expect(stage1Item.recommended_reorder_quantity).toBe(21);
    expect(stage1Item.stockout_risk).toBe('HIGH');
    expect(stage1Item.forecast_method).toBe('MOVING_AVERAGE_7');
    expect(stage1Item.confidence_status).toBe('STAGE_1_MOVING_AVERAGE');

    const stage2Item: ProductForecast = {
      product_id: 'p_eggs',
      product_name: 'Eggs Tray of 30',
      standardized_category: 'Dairy',
      current_stock: 25,
      reorder_level: 10,
      unit: 'trays',
      valid_history_days: 28,
      average_daily_demand: 4.2,
      estimated_weekly_demand: 29.4,
      days_until_stockout: 6.0,
      stockout_risk: 'LOW',
      forecast_method: 'WEEKDAY_SEASONAL',
      confidence_status: 'STAGE_2_WEEKDAY_SEASONAL',
      recommended_reorder_quantity: 5,
      has_stockout_censoring: true,
      insights: 'Eggs Tray of 30 inventory is adequate for approx 6 days.',
      warnings: ['Stockout-censored periods detected in sales history; true demand may be higher.'],
    };

    expect(stage2Item.has_stockout_censoring).toBe(true);
    expect(stage2Item.forecast_method).toBe('WEEKDAY_SEASONAL');
    expect(stage2Item.confidence_status).toBe('STAGE_2_WEEKDAY_SEASONAL');
  });

  it('handles empty response with zero analyzed products', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      shop_id: 'shop_empty',
      generated_at: '2026-11-03T12:00:00Z',
      total_products_analyzed: 0,
      products_with_forecast: 0,
      products_with_insufficient_history: 0,
      high_risk_products_count: 0,
      out_of_stock_products_count: 0,
      items: [],
    } as ForecastSummary);

    const res = await forecastApi.getForecast();
    expect(res.total_products_analyzed).toBe(0);
    expect(res.items).toHaveLength(0);
    expect(res.high_risk_products_count).toBe(0);
  });

  it('handles API error rejection gracefully without crashing', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce(
      new Error('Unable to connect to ShopPulse backend server.')
    );

    await expect(forecastApi.getForecast()).rejects.toThrow(
      'Unable to connect to ShopPulse backend server.'
    );
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttentionCard } from '../components/dashboard/AttentionCard';

vi.mock('../i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string, _params?: any) => {
      const map: Record<string, string> = {
        'dashboard.optimalStock': 'Optimal Stock',
        'dashboard.needsAttention': 'Needs Attention',
        'dashboard.restockedSuccess': 'Restocked!',
        'nav.stockCatalog': 'View Catalog',
        'dashboard.left': 'left',
        'dashboard.restock': 'Restock',
        'dashboard.restockAll': 'Restock All',
        'insights.title': 'Shop Insights & Analytics',
        'insights.description': 'Understand sales trends, top sellers, and future demand',
        'insights.weeklyRevenue': 'Weekly Revenue',
        'insights.past7Days': 'Past 7 days total sales',
        'insights.dailyCustomerCount': 'Daily Customer Count',
        'insights.walkInCheckout': 'Walk-in checkout transactions',
        'insights.topCategory': 'Top Sales Category',
        'insights.highestTurnover': 'Highest daily turnover',
        'insights.topSellingProducts': 'Top Selling Products This Week',
        'insights.stockAlertHighlights': 'Stock Alert Highlights',
        'insights.actionNeeded': 'Action Needed',
        'insights.aiForecasting': 'AI Demand Forecasting & Reorder Assistant',
      };
      return map[key] || key;
    },
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'user_shop_test', email: 'owner@example.com' },
    firebaseUser: null,
    userProfile: null,
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));

export const mockUseForecastState = {
  summary: null as any,
  items: [] as ProductForecast[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  selectedCategory: null as string | null,
  setCategory: vi.fn(),
  forecastForProduct: vi.fn(),
};

vi.mock('../hooks/useForecast', () => ({
  useForecast: () => mockUseForecastState,
}));

describe('AttentionCard Dashboard Integration Component Tests', () => {
  it('renders Stage 1 and Stage 2 forecasts with days until stockout, method, rec reorder and censoring', () => {
    const items: ProductForecast[] = [
      {
        product_id: 'p_bread',
        product_name: 'Modern Bread 400g',
        standardized_category: 'Bakery',
        current_stock: 4,
        reorder_level: 15,
        unit: 'loaves',
        valid_history_days: 12,
        average_daily_demand: 3.5,
        estimated_weekly_demand: 24.5,
        days_until_stockout: 1.1,
        stockout_risk: 'HIGH',
        forecast_method: 'MOVING_AVERAGE_7',
        confidence_status: 'STAGE_1_MOVING_AVERAGE',
        recommended_reorder_quantity: 21,
        has_stockout_censoring: true,
        insights: 'Modern Bread 400g may run out in approx 1 days.',
        warnings: [],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(AttentionCard, {
        forecastItems: items,
        onRestock: () => {},
        setActivePage: () => {},
      })
    );

    expect(html).toContain('Modern Bread 400g');
    expect(html).toContain('4 loaves left');
    expect(html).toContain('~1.1d left');
    expect(html).toContain('MA-7');
    expect(html).toContain('Rec: +21');
    expect(html).toContain('+21');
    expect(html).toContain('Censored');
  });

  it('renders Stage 0 products with "Building History" and transparent reorder reference without fake numbers', () => {
    const items: ProductForecast[] = [
      {
        product_id: 'p_milk',
        product_name: 'Amul Taaza 500ml',
        standardized_category: 'Dairy',
        current_stock: 5,
        reorder_level: 10,
        unit: 'pkts',
        valid_history_days: 3,
        average_daily_demand: null,
        estimated_weekly_demand: null,
        days_until_stockout: null,
        stockout_risk: 'UNKNOWN',
        forecast_method: 'INSUFFICIENT_HISTORY',
        confidence_status: 'INSUFFICIENT_DATA',
        recommended_reorder_quantity: null,
        has_stockout_censoring: false,
        insights: 'Insufficient history (3 of 7 days). Reference: 10 pkts.',
        warnings: [],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(AttentionCard, {
        forecastItems: items,
        onRestock: () => {},
        setActivePage: () => {},
      })
    );

    expect(html).toContain('Amul Taaza 500ml');
    expect(html).toContain('Building History (3/7d)');
    expect(html).toContain('5 pkts in stock');
    expect(html).toContain('Min Ref: 10');
    // Verify no fabricated days until stockout or recommended order text
    expect(html).not.toContain('~0d left');
    expect(html).not.toContain('Rec: +');
  });

  it('renders Optimal Stock state when all items are adequately stocked', () => {
    const html = renderToStaticMarkup(
      React.createElement(AttentionCard, {
        forecastItems: [],
        onRestock: () => {},
        setActivePage: () => {},
      })
    );

    expect(html).toContain('Optimal');
    expect(html).toContain('All inventory items are adequately stocked');
  });

  it('renders Loading state when forecasting is actively calculating', () => {
    const html = renderToStaticMarkup(
      React.createElement(AttentionCard, {
        loading: true,
        onRestock: () => {},
        setActivePage: () => {},
      })
    );

    expect(html).toContain('Evaluating inventory demand...');
    expect(html).toContain('Evaluating...');
  });

  it('renders Error state with Retry button when forecast request fails', () => {
    const html = renderToStaticMarkup(
      React.createElement(AttentionCard, {
        error: 'Backend forecasting server is unavailable (502).',
        onRefresh: () => {},
        onRestock: () => {},
        setActivePage: () => {},
      })
    );

    expect(html).toContain('Backend forecasting server is unavailable (502).');
    expect(html).toContain('Retry Forecast');
  });
});

import { StockoutRiskBadge } from '../components/StockoutRiskBadge';
import { Inventory } from '../pages/Inventory';
import type { Product } from '../types';

describe('StockoutRiskBadge Component Tests', () => {
  it('renders all 5 risk tiers accurately', () => {
    // 1. OUT_OF_STOCK
    const outHtml = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, { risk: 'OUT_OF_STOCK' })
    );
    expect(outHtml).toContain('Out of Stock');
    expect(outHtml).toContain('text-rose-800');

    // 2. HIGH
    const highHtml = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, { risk: 'HIGH' })
    );
    expect(highHtml).toContain('High Risk (≤3d)');
    expect(highHtml).toContain('text-amber-900');

    // 3. MEDIUM
    const medHtml = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, { risk: 'MEDIUM' })
    );
    expect(medHtml).toContain('Medium Risk (4–7d)');
    expect(medHtml).toContain('text-blue-800');

    // 4. LOW
    const lowHtml = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, { risk: 'LOW' })
    );
    expect(lowHtml).toContain('Adequate Stock');
    expect(lowHtml).toContain('text-emerald-800');

    // 5. UNKNOWN - Never display UNKNOWN as LOW
    const unkHtml = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, { risk: 'UNKNOWN', validHistoryDays: 4 })
    );
    expect(unkHtml).toContain('Building History (4/7d)');
    expect(unkHtml).toContain('text-slate-700');
    expect(unkHtml).not.toContain('Adequate Stock');
    expect(unkHtml).not.toContain('High Risk');
  });

  it('renders Building History when confidenceStatus is INSUFFICIENT_DATA', () => {
    const stage0Html = renderToStaticMarkup(
      React.createElement(StockoutRiskBadge, {
        risk: 'UNKNOWN',
        confidenceStatus: 'INSUFFICIENT_DATA',
        validHistoryDays: 2,
      })
    );
    expect(stage0Html).toContain('Building History (2/7d)');
  });
});

describe('Inventory Page Forecasting Integration Component Tests', () => {
  const sampleProducts: Product[] = [
    {
      id: 'prod_bread',
      name: 'Modern Bread 400g',
      category: 'Bakery',
      stock: 4,
      reorderLevel: 15,
      minStock: 15,
      unit: 'loaves',
      price: 45,
      sellingPrice: 45,
      purchasePrice: 35,
      status: 'Low Stock',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'prod_milk',
      name: 'Amul Milk 500ml',
      category: 'Dairy',
      stock: 6,
      reorderLevel: 10,
      minStock: 10,
      unit: 'pkts',
      price: 28,
      sellingPrice: 28,
      purchasePrice: 22,
      status: 'In Stock',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
  ];

  it('renders desktop table with AI Demand Risk column and product details', () => {
    const html = renderToStaticMarkup(
      React.createElement(Inventory, {
        products: sampleProducts,
        onAddProduct: () => {},
      })
    );

    expect(html).toContain('Modern Bread 400g');
    expect(html).toContain('Amul Milk 500ml');
    expect(html).toContain('AI Demand Risk');
    expect(html).toContain('tableProduct');
  });
});

import { Insights } from '../pages/Insights';

describe('Insights Page Forecasting Integration Component Tests', () => {
  beforeEach(() => {
    mockUseForecastState.summary = null;
    mockUseForecastState.items = [];
    mockUseForecastState.loading = false;
    mockUseForecastState.error = null;
    mockUseForecastState.selectedCategory = null;
  });

  const sampleForecastItems: ProductForecast[] = [
    {
      product_id: 'prod_stockout',
      product_name: 'Amul Butter 100g',
      standardized_category: 'Dairy',
      current_stock: 0,
      reorder_level: 20,
      unit: 'packs',
      valid_history_days: 14,
      average_daily_demand: 4.5,
      estimated_weekly_demand: 31.5,
      days_until_stockout: 0,
      stockout_risk: 'OUT_OF_STOCK',
      forecast_method: 'MOVING_AVERAGE_7',
      confidence_status: 'STAGE_1_MOVING_AVERAGE',
      recommended_reorder_quantity: 35,
      has_stockout_censoring: false,
      insights: 'Amul Butter 100g is completely out of stock.',
      warnings: [],
    },
    {
      product_id: 'prod_high',
      product_name: 'Modern Bread 400g',
      standardized_category: 'Bakery',
      current_stock: 3,
      reorder_level: 15,
      unit: 'loaves',
      valid_history_days: 10,
      average_daily_demand: 3.0,
      estimated_weekly_demand: 21.0,
      days_until_stockout: 1.0,
      stockout_risk: 'HIGH',
      forecast_method: 'MOVING_AVERAGE_7',
      confidence_status: 'STAGE_1_MOVING_AVERAGE',
      recommended_reorder_quantity: 20,
      has_stockout_censoring: false,
      insights: 'Modern Bread 400g may run out in approx 1 days.',
      warnings: [],
    },
    {
      product_id: 'prod_medium',
      product_name: 'Parle-G Biscuits',
      standardized_category: 'Snacks',
      current_stock: 25,
      reorder_level: 15,
      unit: 'packs',
      valid_history_days: 14,
      average_daily_demand: 5.0,
      estimated_weekly_demand: 35.0,
      days_until_stockout: 5.0,
      stockout_risk: 'MEDIUM',
      forecast_method: 'WEEKDAY_SEASONAL',
      confidence_status: 'STAGE_2_WEEKDAY_SEASONAL',
      recommended_reorder_quantity: 10,
      has_stockout_censoring: false,
      insights: 'Parle-G Biscuits will last approx 5 days.',
      warnings: [],
    },
    {
      product_id: 'prod_censored',
      product_name: 'Tata Salt 1kg',
      standardized_category: 'Groceries',
      current_stock: 50,
      reorder_level: 10,
      unit: 'packets',
      valid_history_days: 21,
      average_daily_demand: 3.0,
      estimated_weekly_demand: 21.0,
      days_until_stockout: 16.6,
      stockout_risk: 'LOW',
      forecast_method: 'WEEKDAY_SEASONAL',
      confidence_status: 'STAGE_2_WEEKDAY_SEASONAL',
      recommended_reorder_quantity: null,
      has_stockout_censoring: true,
      insights: 'Tata Salt 1kg has adequate stock.',
      warnings: ['Stockout-censored periods detected in sales history.'],
    },
    {
      product_id: 'prod_low',
      product_name: 'Fortune Sunlite Oil 1L',
      standardized_category: 'Groceries',
      current_stock: 40,
      reorder_level: 10,
      unit: 'pouches',
      valid_history_days: 15,
      average_daily_demand: 2.0,
      estimated_weekly_demand: 14.0,
      days_until_stockout: 20.0,
      stockout_risk: 'LOW',
      forecast_method: 'MOVING_AVERAGE_7',
      confidence_status: 'STAGE_1_MOVING_AVERAGE',
      recommended_reorder_quantity: null,
      has_stockout_censoring: false,
      insights: 'Fortune Sunlite Oil 1L has adequate stock.',
      warnings: [],
    },
    {
      product_id: 'prod_stage0',
      product_name: 'Epigamia Yogurt 100g',
      standardized_category: 'Dairy',
      current_stock: 8,
      reorder_level: 12,
      unit: 'cups',
      valid_history_days: 4,
      average_daily_demand: null,
      estimated_weekly_demand: null,
      days_until_stockout: null,
      stockout_risk: 'UNKNOWN',
      forecast_method: 'INSUFFICIENT_HISTORY',
      confidence_status: 'INSUFFICIENT_DATA',
      recommended_reorder_quantity: null,
      has_stockout_censoring: false,
      insights: 'Insufficient sales history (4 of 7 days). Inventory reference level: 12 cups.',
      warnings: ['Requires at least 7 valid open selling days for statistical forecast.'],
    },
    {
      product_id: 'prod_stage0_high',
      product_name: 'Nandini GoodLife Milk 500ml',
      standardized_category: 'Dairy',
      current_stock: 4,
      reorder_level: 10,
      unit: 'pkts',
      valid_history_days: 3,
      average_daily_demand: null,
      estimated_weekly_demand: null,
      days_until_stockout: null,
      stockout_risk: 'HIGH',
      forecast_method: 'INSUFFICIENT_HISTORY',
      confidence_status: 'INSUFFICIENT_DATA',
      recommended_reorder_quantity: null,
      has_stockout_censoring: false,
      insights: 'Insufficient sales history (3 of 7 days). Inventory reference level: 10 pkts.',
      warnings: ['Requires at least 7 valid open selling days for statistical forecast.'],
    },
  ];

  it('accurately computes and displays mutually exclusive risk summary counts summing to total products', () => {
    mockUseForecastState.items = sampleForecastItems;
    mockUseForecastState.summary = {
      shop_id: 'shop_test',
      generated_at: '2026-11-03T12:00:00Z',
      total_products_analyzed: 7,
      products_with_forecast: 5,
      products_with_insufficient_history: 2,
      high_risk_products_count: 2,
      out_of_stock_products_count: 1,
      items: sampleForecastItems,
    };

    const html = renderToStaticMarkup(React.createElement(Insights));

    // Summary strip checks
    expect(html).toContain('data-testid="forecast-summary-total"');
    expect(html).toContain('data-testid="forecast-summary-critical"');
    expect(html).toContain('data-testid="forecast-summary-medium"');
    expect(html).toContain('data-testid="forecast-summary-low"');
    expect(html).toContain('data-testid="forecast-summary-building"');

    // Counts: Total = 7, Critical (OUT_OF_STOCK + HIGH, including Stage 0 HIGH) = 3, Medium = 1, Low = 2, Building History (only UNKNOWN) = 1
    // Sum check: 3 + 1 + 2 + 1 = 7
    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>7<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>3<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>2<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>1<\/span>/);
  });

  it('Scenario 1: normal HIGH-risk product is counted as Critical Risk', () => {
    mockUseForecastState.items = [sampleForecastItems[1]]; // Modern Bread 400g (Stage 1 HIGH)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);
  });

  it('Scenario 2: OUT_OF_STOCK product is counted as Critical Risk', () => {
    mockUseForecastState.items = [sampleForecastItems[0]]; // Amul Butter 100g (OUT_OF_STOCK)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);
  });

  it('Scenario 3: MEDIUM product is counted only as Medium Risk', () => {
    mockUseForecastState.items = [sampleForecastItems[2]]; // Parle-G Biscuits (MEDIUM)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);
  });

  it('Scenario 4: LOW product is counted only as Adequate Stock', () => {
    mockUseForecastState.items = [sampleForecastItems[4]]; // Fortune Sunlite Oil 1L (LOW)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);
  });

  it('Scenario 5: Stage 0 UNKNOWN product is counted only as Building History', () => {
    mockUseForecastState.items = [sampleForecastItems[5]]; // Epigamia Yogurt 100g (Stage 0 UNKNOWN)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>1<\/span>/);
  });

  it('Scenario 6: Stage 0 HIGH-risk product is counted only as Critical Risk, not Building History, and remains visible in Needs Your Attention', () => {
    mockUseForecastState.items = [sampleForecastItems[6]]; // Nandini GoodLife Milk (Stage 0 HIGH)

    const html = renderToStaticMarkup(React.createElement(Insights));

    // Verified counted ONLY in Critical Risk
    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);

    // Verified still visible and prioritized in Needs Your Attention
    expect(html).toContain('Needs Your Attention');
    expect(html).toContain('Nandini GoodLife Milk 500ml');
    expect(html).toContain('Current Stock: <span class="text-slate-900 font-extrabold">4 pkts</span>');
  });

  it('Scenario 7: all four risk-category counts sum exactly to the total analyzed products in mixed dataset', () => {
    mockUseForecastState.items = sampleForecastItems;

    const html = renderToStaticMarkup(React.createElement(Insights));

    // Total = 7, Critical = 3, Medium = 1, Low = 2, Building = 1 -> 3 + 1 + 2 + 1 = 7
    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>7<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>3<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>1<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>2<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>1<\/span>/);
  });

  it('Scenario 8: empty forecast results produce zero for every category', () => {
    mockUseForecastState.items = [];

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toMatch(/data-testid="forecast-summary-total"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-critical"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-medium"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-low"[\s\S]*?>0<\/span>/);
    expect(html).toMatch(/data-testid="forecast-summary-building"[\s\S]*?>0<\/span>/);
    expect(html).toContain('data-testid="forecast-empty"');
  });

  it('prioritizes OUT_OF_STOCK > HIGH > MEDIUM > Censored in Needs Your Attention section and includes Stage 0 HIGH items', () => {
    mockUseForecastState.items = sampleForecastItems;

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toContain('Needs Your Attention');
    expect(html).toContain('5 items need review');

    // Check ordering: OUT_OF_STOCK (Amul Butter) -> HIGH (Modern Bread, Nandini Milk) -> MEDIUM (Parle-G) -> Censored (Tata Salt)
    const butterPos = html.indexOf('Amul Butter 100g');
    const breadPos = html.indexOf('Modern Bread 400g');
    const nandiniPos = html.indexOf('Nandini GoodLife Milk 500ml');
    const parlePos = html.indexOf('Parle-G Biscuits');
    const saltPos = html.indexOf('Tata Salt 1kg');

    expect(butterPos).toBeGreaterThan(-1);
    expect(breadPos).toBeGreaterThan(-1);
    expect(nandiniPos).toBeGreaterThan(-1);
    expect(parlePos).toBeGreaterThan(-1);
    expect(saltPos).toBeGreaterThan(-1);

    expect(butterPos).toBeLessThan(breadPos);
    expect(butterPos).toBeLessThan(nandiniPos);
    expect(breadPos).toBeLessThan(parlePos);
    expect(nandiniPos).toBeLessThan(parlePos);
    expect(parlePos).toBeLessThan(saltPos);
  });

  it('handles Stage 0 products without fabricating demand, countdowns, or recommendations', () => {
    mockUseForecastState.items = [sampleForecastItems[5]]; // Epigamia Yogurt

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toContain('Epigamia Yogurt 100g');
    expect(html).toContain('Building History (4/7d)');
    expect(html).toContain('4/7 days');
    expect(html).toContain('Stage 0');
    expect(html).toContain('Ref: 12 cups');

    // Must NOT contain fabricated predictions
    expect(html).not.toContain('~0.0d');
    expect(html).not.toContain('~0d');
    expect(html).not.toContain('+12 cups');
  });

  it('renders stockout-censoring warning badge and description', () => {
    mockUseForecastState.items = [sampleForecastItems[3]]; // Tata Salt (censored)

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toContain('Tata Salt 1kg');
    expect(html).toContain('Censored');
    expect(html).toContain('Stockout-Censored Demand');
    expect(html).toContain('Past zero-stock days detected in sales history');
  });

  it('handles missing/null forecast values cleanly with fallback dashes', () => {
    const nullableItem: ProductForecast = {
      product_id: 'prod_nulls',
      product_name: 'Fresh Mint Leaves',
      standardized_category: null,
      current_stock: 5,
      reorder_level: null,
      unit: 'bunches',
      valid_history_days: 2,
      average_daily_demand: null,
      estimated_weekly_demand: null,
      days_until_stockout: null,
      stockout_risk: 'UNKNOWN',
      forecast_method: 'INSUFFICIENT_HISTORY',
      confidence_status: 'INSUFFICIENT_DATA',
      recommended_reorder_quantity: null,
      has_stockout_censoring: false,
      insights: '',
      warnings: [],
    };

    mockUseForecastState.items = [nullableItem];

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toContain('Fresh Mint Leaves');
    expect(html).toContain('General');
    expect(html).toContain('5 bunches');
    expect(html).toContain('—');
  });

  it('renders loading state when forecast is being calculated', () => {
    mockUseForecastState.loading = true;
    mockUseForecastState.items = [];

    const html = renderToStaticMarkup(React.createElement(Insights));

    expect(html).toContain('data-testid="forecast-loading"');
    expect(html).toContain('Evaluating inventory demand velocity...');
  });

  it('renders error state with Retry action without breaking existing analytics', () => {
    mockUseForecastState.error = 'FastAPI forecasting service timeout (504)';
    mockUseForecastState.items = [];

    const html = renderToStaticMarkup(React.createElement(Insights));

    // Forecasting error banner
    expect(html).toContain('data-testid="forecast-error"');
    expect(html).toContain('FastAPI forecasting service timeout (504)');
    expect(html).toContain('data-testid="forecast-retry-button"');
    expect(html).toContain('Retry Forecast');

    // Existing analytics still rendered seamlessly
    expect(html).toContain('Weekly Revenue');
    expect(html).toContain('Daily Customer Count');
    expect(html).toContain('Top Sales Category');
    expect(html).toContain('Top Selling Products This Week');
    expect(html).toContain('Stock Alert Highlights');
  });
});

