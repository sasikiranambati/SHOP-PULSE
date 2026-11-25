/**
 * Stage 7.4: grounded business assistant.
 *
 * - Intent detection is deterministic, handles wording variations and asks when a question is ambiguous.
 * - Data comes only from the existing Insights APIs (mocked here at the API boundary); failures, 401/403,
 *   empty shops and malformed responses never produce figures.
 * - Forecast answers keep confidence, tiers, intermittent-demand warnings, provisional and advisory notes.
 * - Formatting uses only API values (UTC ranges, no growth for a partial day, thresholds only when set).
 * - The chat UI renders role-appropriate suggestions, data-source notes, warnings and retry.
 * Generic test values only.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class MemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length() { return Object.keys(this.store).length; }
  clear() { this.store = {}; }
  getItem(k: string) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  key(i: number) { return Object.keys(this.store)[i] ?? null; }
  removeItem(k: string) { delete this.store[k]; }
  setItem(k: string, v: string) { this.store[k] = String(v); }
}
if (typeof globalThis.localStorage === 'undefined') vi.stubGlobal('localStorage', new MemoryStorage());
if (typeof globalThis.sessionStorage === 'undefined') vi.stubGlobal('sessionStorage', new MemoryStorage());
if (typeof globalThis.window === 'undefined') {
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage });
}

import { ApiError } from '../api/client';
import type {
  AiInsightsData,
  InventoryInsightItem,
  InventoryInsightsData,
  ProductDemandForecast,
  SalesInsightsData,
  ShopForecastSummary,
} from '../api/insights';
import { detectIntent, extractProductQuery, normalizeQuestion } from '../utils/assistant/intents';
import { answerIntent, answerQuestion } from '../utils/assistant/engine';
import { fetchForIntent, type InsightsSource } from '../utils/assistant/data';
import { formatRange, money, qty, SUGGESTIONS } from '../utils/assistant/format';
import type { AssistantAnswer, AssistantIntent } from '../utils/assistant/types';
import { AiChatBox, AssistantAnswerView } from '../components/AiChatBox';
import { AuthContext } from '../context/authContextDef';
import type { AuthContextType } from '../context/AuthContext';
import type { UserRole } from '../types/user';
import { LanguageProvider } from '../i18n/LanguageContext';

// ------------------------------------------------------------------------------ fixtures

function salesData(over: Partial<SalesInsightsData['overview']> = {}, extra: Partial<SalesInsightsData> = {}): SalesInsightsData {
  return {
    overview: {
      total_sales: 1250.5,
      transaction_count: 4,
      average_transaction_value: 312.63,
      previous_period_sales: 1000,
      previous_period_transactions: 3,
      sales_growth_rate: 25.05,
      period: 'last 7 days',
      start_date: '2026-11-18T10:00:00+00:00',
      end_date: '2026-11-25T10:00:00+00:00',
      ...over,
    },
    performance: {
      best_selling: [
        { product_id: 'p1', product_name: 'Sugar', category: 'Grocery', quantity_sold: 12.5, revenue: 550, unit: 'kg', previous_quantity_sold: 10, growth_rate: 25 },
        { product_id: 'p2', product_name: 'Tea', category: 'Beverages', quantity_sold: 6, revenue: 240, unit: 'packet', previous_quantity_sold: 6, growth_rate: 0 },
      ],
      slow_moving: [{ product_id: 'p3', product_name: 'Soap', category: 'Personal Care', quantity_sold: 0, revenue: 0, unit: 'pcs', previous_quantity_sold: 0, growth_rate: null }],
      increasing_sales: [],
      declining_sales: [],
    },
    trends: {
      interval: 'daily',
      points: [
        { date: '2026-11-24', label: '24 Nov', revenue: 800, transaction_count: 2 },
        { date: '2026-11-25', label: '25 Nov', revenue: 450.5, transaction_count: 2 },
      ],
      peak_day: '24 Nov',
      peak_revenue: 800,
    },
    has_sufficient_data: true,
    data_summary_note: null,
    ...extra,
  };
}

function invItem(over: Partial<InventoryInsightItem>): InventoryInsightItem {
  return {
    product_id: 'x', product_name: 'Item', category: 'Other', current_stock: 10, minimum_stock_threshold: 0, unit: 'pcs',
    status: 'IN STOCK', recommended_action: '', urgency: 'low', selling_price: 10, purchase_price: null, last_updated: null,
    is_threshold_configured: false, ...over,
  };
}

function inventoryData(items: InventoryInsightItem[] = [
  invItem({ product_id: 'a', product_name: 'Rice', current_stock: 0, unit: 'kg', status: 'OUT OF STOCK', urgency: 'critical', minimum_stock_threshold: 5, is_threshold_configured: true }),
  invItem({ product_id: 'b', product_name: 'Sugar', current_stock: 2.5, unit: 'kg', status: 'LOW STOCK', urgency: 'high', minimum_stock_threshold: 5, is_threshold_configured: true }),
  invItem({ product_id: 'c', product_name: 'Tea', current_stock: 3, unit: 'packet', status: 'IN STOCK' }),
]): InventoryInsightsData {
  const count = (s: string) => items.filter((i) => i.status === s).length;
  return {
    counts: {
      in_stock: count('IN STOCK'), low_stock: count('LOW STOCK'), out_of_stock: count('OUT OF STOCK'), overstocked: count('OVERSTOCKED'),
      needs_attention: count('LOW STOCK') + count('OUT OF STOCK'), total_products: items.length,
    },
    items,
    has_sufficient_data: items.length > 0,
  };
}

function fc(over: Partial<ProductDemandForecast>): ProductDemandForecast {
  return {
    product_id: 'f', product_name: 'Item', current_stock: 10, normalized_unit: 'pcs', total_valid_sales: 20, observable_days: 30,
    daily_demand_rate: 1, expected_seven_day_demand: 7, days_to_stockout: 10, recommended_reorder_quantity: null,
    confidence_level: 'HIGH', forecast_tier: 'TIER_1_SUFFICIENT', forecast_status: 'ACTIVE', is_reorder_provisional: false,
    assumptions: ['Calculated using calendar-day EWMA (alpha=0.3) over 30 observable days.'], warnings: [], ...over,
  };
}

function forecastData(rows: ProductDemandForecast[] = [
  fc({ product_id: 'm', product_name: 'Milk', current_stock: 4, normalized_unit: 'L', daily_demand_rate: 2, expected_seven_day_demand: 14, days_to_stockout: 2, recommended_reorder_quantity: 6, is_reorder_provisional: true, forecast_status: 'LOW_STOCK', warnings: ['Stockout risk within 7 days (2.0 days remaining).', 'No safety stock configured; reorder recommendation is provisional.'] }),
  fc({ product_id: 'b', product_name: 'Bread', current_stock: 5, daily_demand_rate: 1, expected_seven_day_demand: 7, days_to_stockout: 5, confidence_level: 'LOW', forecast_tier: 'TIER_2_SPARSE', forecast_status: 'LOW_STOCK', total_valid_sales: 3, observable_days: 9, recommended_reorder_quantity: 2, warnings: ['Sparse sales history. Forecast has high uncertainty and is advisory only.'] }),
  fc({ product_id: 'e', product_name: 'Eggs', current_stock: 30, daily_demand_rate: 1.5, expected_seven_day_demand: 10.5, days_to_stockout: 6.5, confidence_level: 'MEDIUM', warnings: ['Intermittent demand pattern: 20 of 30 days (66.7%) had zero sales.'] }),
  fc({ product_id: 'r', product_name: 'Rice', current_stock: 0, normalized_unit: 'kg', days_to_stockout: 0, forecast_status: 'OUT_OF_STOCK', recommended_reorder_quantity: 3, warnings: ['Product is currently out of stock.'] }),
  fc({ product_id: 'n', product_name: 'New Jam', current_stock: 8, total_valid_sales: 0, observable_days: 0, daily_demand_rate: null, expected_seven_day_demand: null, days_to_stockout: null, confidence_level: 'NONE', forecast_tier: 'TIER_3_COLD_START', forecast_status: 'NEW_PRODUCT_NO_SALES_HISTORY', warnings: ['No sales history recorded for this product.'] }),
  fc({ product_id: 's', product_name: 'Salt', current_stock: 50, days_to_stockout: 50 }),
]): ShopForecastSummary {
  return {
    shop_id: 'shop-1', generated_at: '2026-11-25T09:30:00+00:00', total_products_analyzed: rows.length,
    tier_1_count: rows.filter((r) => r.forecast_tier === 'TIER_1_SUFFICIENT').length,
    tier_2_count: rows.filter((r) => r.forecast_tier === 'TIER_2_SPARSE').length,
    tier_3_count: rows.filter((r) => r.forecast_tier === 'TIER_3_COLD_START').length,
    out_of_stock_count: rows.filter((r) => r.current_stock <= 0).length,
    at_risk_stockout_7d_count: rows.filter((r) => r.current_stock > 0 && r.days_to_stockout !== null && r.days_to_stockout <= 7).length,
    forecasts: rows,
  };
}

const aiData = (): AiInsightsData => ({
  insights: [
    { id: 'ai-top-seller', type: 'positive', category: 'sales', title: 'Top Revenue Driver: Sugar', message: 'Sugar generated ₹550.00.', metric: '₹550', grounded_data_points: [], suggested_action: 'Verify supplier lead time.' },
    { id: 'ai-stockout-critical', type: 'critical', category: 'inventory', title: 'Critical Stockout: 1 items unavailable', message: 'Products currently depleted: Rice.', metric: '1 stockouts', grounded_data_points: [], suggested_action: 'Create supplier restock purchase order immediately.' },
  ],
  overall_business_health: 'Needs Attention',
  has_sufficient_data: true,
  note: null,
});

function mockApi(over: Partial<Record<keyof InsightsSource, unknown>> = {}) {
  const ok = <T,>(v: T) => vi.fn().mockResolvedValue(v);
  return {
    getSalesInsights: (over.getSalesInsights as any) ?? ok(salesData()),
    getInventoryInsights: (over.getInventoryInsights as any) ?? ok(inventoryData()),
    getAiInsights: (over.getAiInsights as any) ?? ok(aiData()),
    getDemandForecast: (over.getDemandForecast as any) ?? ok(forecastData()),
  } as InsightsSource & Record<keyof InsightsSource, ReturnType<typeof vi.fn>>;
}

const text = (a: AssistantAnswer) => [a.title, ...a.lines, ...a.items.flatMap((i) => [i.primary, i.secondary ?? '']), ...a.warnings, a.source ?? ''].join('\n');
const ask = (q: string, api: InsightsSource, canAccessAnalytics = true) => answerQuestion(q, { canAccessAnalytics, api }).then((r) => r.answer);
const run = (intent: AssistantIntent, api: InsightsSource) => answerIntent(intent, { canAccessAnalytics: true, api });

// ------------------------------------------------------------------------------ 1. intent detection

describe('1. Intent detection', () => {
  const cases: Array<[string, string, string?, string?]> = [
    // SALES
    ['How are my sales today?', 'SALES', 'overview', 'today'],
    ["What's today's revenue", 'SALES', 'overview', 'today'],
    ['how much did i earn this week', 'SALES', 'overview', '7d'],
    ['Sales this month', 'SALES', 'overview', '30d'],
    ['revenue in the last 90 days', 'SALES', 'overview', '90d'],
    ['Which products are selling fastest?', 'SALES', 'top_sellers', '7d'],
    ['best sellers this month', 'SALES', 'top_sellers', '30d'],
    ['top selling items today', 'SALES', 'top_sellers', 'today'],
    ['what is not selling', 'SALES', 'slow_movers', '7d'],
    ['show me the sales trend', 'SALES', 'trend', '7d'],
    ['compare sales with last week', 'SALES', 'comparison', '7d'],
    ['sales today vs yesterday', 'SALES', 'comparison', 'today'],
    ["yesterday's sales", 'SALES', 'yesterday', 'today'],
    ['how much money did I make today', 'SALES', 'overview', 'today'],
    ['total collection this week', 'SALES', 'overview', '7d'],
    ['आज की बिक्री कैसी रही', 'SALES', 'overview', 'today'],
    // INVENTORY
    ['What is out of stock?', 'INVENTORY', 'out_of_stock'],
    ['which items have run out', 'INVENTORY', 'out_of_stock'],
    ['Which products are running low?', 'INVENTORY', 'low_stock'],
    ['anything below minimum stock', 'INVENTORY', 'low_stock'],
    ['which products are low', 'INVENTORY', 'low_stock'],
    ['स्टॉक कम है', 'INVENTORY', 'low_stock'],
    ['overstocked items', 'INVENTORY', 'summary'],
    ['which products need attention', 'INVENTORY', 'attention'],
    ['inventory summary', 'INVENTORY', 'summary'],
    ['how is my stock', 'INVENTORY', 'summary'],
    // FORECAST
    ['What will run out in the next 7 days?', 'FORECAST', 'runout_7d'],
    ['what is running out of stock soon', 'FORECAST', 'runout_7d'],
    ['how long will my stock last', 'FORECAST', 'runout_7d'],
    ['What should I restock today?', 'FORECAST', 'reorder'],
    ['what should i reorder', 'FORECAST', 'reorder'],
    ['what do I need to buy', 'FORECAST', 'reorder'],
    ['मुझे क्या रीस्टॉक करना चाहिए', 'FORECAST', 'reorder'],
    ['is anything going to run out', 'FORECAST', 'runout_7d'],
    ['is milk going to run out this week', 'FORECAST', 'product'],
    ['which products have high stockout risk', 'FORECAST', 'high_risk'],
    ['which forecasts have low confidence', 'FORECAST', 'low_confidence'],
    ['products with not enough sales history', 'FORECAST', 'insufficient_history'],
    ['explain the forecast for basmati rice', 'FORECAST', 'product'],
    ['when will sugar run out', 'FORECAST', 'product'],
    ['demand forecast', 'FORECAST', 'overview'],
    // BUSINESS_SUMMARY
    ['Give me a business summary', 'BUSINESS_SUMMARY', 'summary'],
    ['how is my business doing', 'BUSINESS_SUMMARY', 'summary'],
    ['any concerns?', 'BUSINESS_SUMMARY', 'attention'],
    ['what needs my attention today', 'BUSINESS_SUMMARY', 'attention'],
    ['What should I do today?', 'BUSINESS_SUMMARY', 'actions'],
  ];

  it.each(cases)('%s -> %s %s %s', (q, category, topic, period) => {
    const intent = detectIntent(q) as any;
    expect(intent.category).toBe(category);
    if (topic) expect(intent.topic).toBe(topic);
    if (period) expect(intent.period).toBe(period);
  });

  it('extracts the product named in a product question', () => {
    expect(extractProductQuery(normalizeQuestion('Explain the forecast for Basmati Rice?'))).toBe('basmati rice');
    expect(extractProductQuery(normalizeQuestion('how long will toor dal last'))).toBe('toor dal');
    expect(extractProductQuery(normalizeQuestion('when will tea run out'))).toBe('tea');
    expect(extractProductQuery(normalizeQuestion('is milk going to run out this week'))).toBe('milk');
    expect(extractProductQuery(normalizeQuestion('tell me about low stock'))).toBeNull();
    expect(extractProductQuery(normalizeQuestion('how long will my stock last'))).toBeNull();
  });

  it('avoids over-broad keywords', () => {
    expect(detectIntent('what is my top priority').category).not.toBe('SALES');
    expect(detectIntent('items below reorder level')).toMatchObject({ category: 'INVENTORY', topic: 'low_stock' });
    expect(detectIntent('stockout risk')).toMatchObject({ category: 'FORECAST', topic: 'high_risk' });
    expect(detectIntent('what is the weather')).toEqual({ category: 'UNKNOWN', reason: 'unrecognized' });
    expect(detectIntent('   ')).toEqual({ category: 'UNKNOWN', reason: 'empty' });
  });

  it('asks for clarification when two categories match equally', () => {
    const intent = detectIntent('top selling products running low');
    expect(intent).toMatchObject({ category: 'UNKNOWN', reason: 'ambiguous' });
    const cats = (intent as any).options.map((o: AssistantIntent) => o.category).sort();
    expect(cats).toEqual(['INVENTORY', 'SALES']);
  });
});

// ------------------------------------------------------------------------------ 2. API integration

describe('2. API integration and data safety', () => {
  let api: ReturnType<typeof mockApi>;
  beforeEach(() => { api = mockApi(); });

  it('calls only the API an intent needs, with no client-chosen shop', async () => {
    await ask('How are my sales today?', api);
    expect(api.getSalesInsights).toHaveBeenCalledWith('today');
    expect(api.getInventoryInsights).not.toHaveBeenCalled();
    expect(api.getDemandForecast).not.toHaveBeenCalled();

    await ask('what should i reorder', api);
    expect(api.getDemandForecast).toHaveBeenCalledWith({ lead_time_days: 3 });

    await ask('what is out of stock', api);
    expect(api.getInventoryInsights).toHaveBeenCalledWith();
  });

  it('unknown and ambiguous questions fetch nothing', async () => {
    const a1 = await ask('what is the weather', api);
    const a2 = await ask('top selling products running low', api);
    expect(a1.kind).toBe('help');
    expect(a2.kind).toBe('clarify');
    expect(a2.followUps.length).toBe(2);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('cashier: restricted answer and no request at all', async () => {
    const a = await ask('How are my sales today?', api, false);
    expect(a.kind).toBe('restricted');
    expect(text(a)).not.toMatch(/₹/);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('403 from the backend (authoritative) becomes a restricted answer without figures', async () => {
    api = mockApi({ getSalesInsights: vi.fn().mockRejectedValue(new ApiError('Forbidden', 403)) });
    const a = await ask('sales today', api);
    expect(a.kind).toBe('restricted');
    expect(a.retryable).toBe(false);
    expect(text(a)).not.toMatch(/₹\s?\d/);
  });

  it('401 asks the user to sign in; not retryable', async () => {
    api = mockApi({ getInventoryInsights: vi.fn().mockRejectedValue(new ApiError('Not authenticated', 401)) });
    const a = await ask('what is out of stock', api);
    expect(a).toMatchObject({ kind: 'error', title: 'Sign-in required', retryable: false });
  });

  it('400 without a shop is reported as no active shop', async () => {
    api = mockApi({ getSalesInsights: vi.fn().mockRejectedValue(new ApiError('User must create a shop profile or join an existing shop first.', 400)) });
    expect((await ask('sales today', api)).title).toBe('No active shop');
  });

  it('server and network failures are retryable errors with no figures', async () => {
    for (const err of [new ApiError('Internal Server Error', 500), new ApiError('Network error', 0), new TypeError('boom')]) {
      api = mockApi({ getDemandForecast: vi.fn().mockRejectedValue(err) });
      const a = await ask('what will run out in the next 7 days', api);
      expect(a.kind).toBe('error');
      expect(a.retryable).toBe(true);
      expect(a.items).toEqual([]);
      expect(text(a)).not.toMatch(/\d+(\.\d+)? (days|pcs|kg|L)\b/);
    }
  });

  it('malformed responses are rejected, never patched', async () => {
    for (const bad of [null, 'oops', { overview: {} }, { overview: { total_sales: '100', transaction_count: 1, start_date: 'x', end_date: 'y' } }]) {
      api = mockApi({ getSalesInsights: vi.fn().mockResolvedValue(bad) });
      const a = await ask('sales today', api);
      expect(a).toMatchObject({ kind: 'error', title: 'Unexpected response', retryable: true });
    }
    api = mockApi({ getInventoryInsights: vi.fn().mockResolvedValue({ counts: { in_stock: 1 }, items: [] }) });
    expect((await ask('inventory summary', api)).title).toBe('Unexpected response');
    api = mockApi({ getDemandForecast: vi.fn().mockResolvedValue({ forecasts: 'none' }) });
    expect((await ask('demand forecast', api)).title).toBe('Unexpected response');
  });

  it('missing optional fields are reported, not invented', async () => {
    const raw: any = salesData();
    delete raw.performance;
    delete raw.overview.previous_period_sales;
    api = mockApi({ getSalesInsights: vi.fn().mockResolvedValue(raw) });
    const top = await run(SUGGESTIONS.topSellers.intent, api);
    expect(top.kind).toBe('empty');
    expect(top.warnings.join(' ')).toMatch(/Incomplete response.*product performance/);
    const cmp = await run(SUGGESTIONS.compareWeek.intent, api);
    expect(text(cmp)).not.toMatch(/Previous period/);
    expect(cmp.warnings.join(' ')).toMatch(/previous period total was not included/);
  });

  it('incomplete forecast rows are skipped and counted', async () => {
    const data: any = forecastData();
    data.forecasts.push({ product_name: 'Broken' });
    api = mockApi({ getDemandForecast: vi.fn().mockResolvedValue(data) });
    const a = await ask('demand forecast', api);
    expect(a.warnings.join(' ')).toMatch(/1 incomplete forecast row\(s\) skipped/);
  });

  it('distinguishes an empty shop from a failure', async () => {
    api = mockApi({
      getSalesInsights: vi.fn().mockResolvedValue(salesData({ total_sales: 0, transaction_count: 0, average_transaction_value: 0, previous_period_sales: 0, previous_period_transactions: 0, sales_growth_rate: null })),
      getInventoryInsights: vi.fn().mockResolvedValue(inventoryData([])),
      getDemandForecast: vi.fn().mockResolvedValue(forecastData([])),
    });
    const s = await ask('sales today', api);
    expect(s.kind).toBe('empty');
    expect(s.lines[0]).toBe('No sales were recorded in today (UTC day so far).');
    expect((await ask('inventory summary', api)).lines).toEqual(['There are no active products in this shop yet.']);
    expect((await ask('demand forecast', api)).kind).toBe('empty');
  });

  it('business summary keeps loaded parts and flags the failed one as partial', async () => {
    api = mockApi({ getDemandForecast: vi.fn().mockRejectedValue(new ApiError('err', 503)) });
    const a = await ask('give me a business summary', api);
    expect(a.kind).toBe('answer');
    expect(a.lines).toContain('Overall: Needs Attention.');
    expect(a.warnings.join(' ')).toMatch(/Could not load demand forecast.*partial/);
    expect(text(a)).not.toMatch(/Forecast:/);
  });

  it('business summary with every source failing is one error', async () => {
    const fail = vi.fn().mockRejectedValue(new ApiError('Forbidden', 403));
    api = mockApi({ getAiInsights: fail, getSalesInsights: fail, getDemandForecast: fail });
    expect((await ask('business summary', api)).kind).toBe('restricted');
  });

  it('fetchForIntent refuses UNKNOWN intents', async () => {
    await expect(fetchForIntent({ category: 'UNKNOWN', reason: 'unrecognized' }, api)).rejects.toThrow();
  });
});

// ------------------------------------------------------------------------------ 3. forecasting answers

describe('3. Forecast answers', () => {
  const api = mockApi();

  it('runout in 7 days: sorted by days, confidence and tier on every row, out-of-stock excluded', async () => {
    const a = await run(SUGGESTIONS.runout.intent, api);
    expect(a.items.map((i) => i.primary)).toEqual(['Milk', 'Bread', 'Eggs']);
    expect(a.items[0].secondary).toMatch(/about 2 days of stock left · 4 L in stock · ~14 L expected over 7 days · high confidence · Tier 1/);
    expect(a.items[1].secondary).toMatch(/low confidence · Tier 2 • Sparse · Sparse sales history/);
    expect(a.items[2].secondary).toMatch(/Intermittent demand pattern/);
    expect(a.lines.join(' ')).toMatch(/1 product is already out of stock/);
    expect(a.warnings.join(' ')).toMatch(/1 estimate is low confidence.*not certainty/);
    expect(a.warnings.join(' ')).toMatch(/1 product in stock has no run-out projection/);
    expect(text(a)).not.toMatch(/New Jam|Salt/);
  });

  it('reorder: advisory, lead time stated, provisional flagged, out of stock first', async () => {
    const a = await run(SUGGESTIONS.reorder.intent, api);
    expect(a.items.map((i) => i.primary)).toEqual(['Rice', 'Milk', 'Bread']);
    expect(a.items[1].secondary).toMatch(/suggested 6 L.*provisional/);
    expect(a.warnings[0]).toMatch(/advisory, not orders.*3-day lead time/);
    expect(a.warnings.join(' ')).toMatch(/1 suggestion is provisional because no safety stock/);
  });

  it('high stockout risk uses the shared severity rules (out of stock or <= 3 days)', async () => {
    const a = await run(SUGGESTIONS.highRisk.intent, api);
    expect(a.items.map((i) => i.primary)).toEqual(['Rice', 'Milk']);
    expect(a.items.every((i) => i.tone === 'critical')).toBe(true);
  });

  it('low confidence and insufficient history lists', async () => {
    const low = await run(SUGGESTIONS.lowConfidence.intent, api);
    expect(low.items.map((i) => i.primary)).toEqual(['Bread', 'New Jam']);
    expect(low.items[0].secondary).toMatch(/3 sales over 9 days/);
    const hist = await run(SUGGESTIONS.noHistory.intent, api);
    expect(hist.items.map((i) => i.primary)).toEqual(['Bread', 'New Jam']);
    expect(hist.items[1].secondary).toMatch(/No Sales History.*Tier 3/);
  });

  it('explains one product with its confidence, method, assumptions and warnings', async () => {
    const a = await ask('explain the forecast for bread', api);
    expect(a.title).toBe('Forecast · Bread');
    expect(a.lines.join('\n')).toMatch(/Confidence: LOW — Initial estimate based on limited sales history/);
    expect(a.lines.join('\n')).toMatch(/Sparse Sales History \(Tier 2\)/);
    expect(a.lines.join('\n')).toMatch(/Suggested reorder \(advisory\): 2 pcs, assuming a 3-day supplier lead time/);
    expect(a.warnings.join(' ')).toMatch(/low-confidence estimate/);
  });

  it('a product without history gets no demand estimate or run-out date', async () => {
    const a = await ask('tell me about new jam', api);
    expect(a.lines.join('\n')).toMatch(/No demand estimate/);
    expect(a.lines.join('\n')).toMatch(/No run-out date is projected/);
    expect(a.lines.join('\n')).not.toMatch(/Suggested reorder/);
  });

  it('unknown and multiple product matches never guess', async () => {
    const none = await ask('explain the forecast for cheese', api);
    expect(none).toMatchObject({ kind: 'empty', title: 'Product not found' });
    const multiApi = mockApi({ getDemandForecast: vi.fn().mockResolvedValue(forecastData([fc({ product_id: '1', product_name: 'Tea Gold' }), fc({ product_id: '2', product_name: 'Tea Premium' })])) });
    const many = await ask('when will tea run out', multiApi);
    expect(many.kind).toBe('clarify');
    expect(many.followUps.map((f) => f.label)).toEqual(['Tea Gold', 'Tea Premium']);
  });
});

// ------------------------------------------------------------------------------ 4. formatting

describe('4. Formatting', () => {
  it('values: currency, quantities, missing values stay missing', () => {
    expect(money(1250.5)).toBe('₹1,250.50');
    expect(money(NaN)).toBeNull();
    expect(money(null)).toBeNull();
    expect(qty(2.5, 'kg')).toBe('2.5 kg');
    expect(qty(0.1 + 0.2, 'kg')).toBe('0.3 kg');
    expect(qty(undefined, 'kg')).toBeNull();
  });

  it('dates are labelled UTC; naive timestamps are read as UTC', () => {
    expect(formatRange('2026-11-25T00:00:00+00:00', '2026-11-25T10:05:00')).toBe('25 Nov 2026 00:00 – 25 Nov 2026 10:05 UTC');
    expect(formatRange('bad', 'x')).toBeNull();
  });

  it('today: no growth for a partial day; yesterday shown as context', async () => {
    const api = mockApi({ getSalesInsights: vi.fn().mockResolvedValue(salesData({ period: 'today', start_date: '2026-11-25T00:00:00+00:00', sales_growth_rate: 25 })) });
    const a = await run(SUGGESTIONS.salesToday.intent, api);
    expect(a.lines).toEqual([
      'Total sales: ₹1,250.50 from 4 transactions.',
      'Average bill: ₹312.63.',
      'Yesterday (full UTC day): ₹1,000.00 from 3 transactions.',
      'Today is still in progress, so no growth figure is given.',
    ]);
    expect(text(a)).not.toMatch(/%/);
    expect(a.source).toBe('Sales records · 25 Nov 2026 00:00 – 25 Nov 2026 10:00 UTC');

    const y = await run(SUGGESTIONS.salesYesterday.intent, api);
    expect(y.lines).toEqual(['Total sales yesterday: ₹1,000.00 from 3 transactions.']);
    expect(y.source).toBe('Sales records · 24 Nov 2026 (full UTC day)');
  });

  it('rolling 7 days: previous period, difference and growth from the API', async () => {
    const a = await run(SUGGESTIONS.compareWeek.intent, mockApi());
    expect(a.lines).toContain('Previous period (the previous 7 days): ₹1,000.00 from 3 transactions.');
    expect(a.lines).toContain('Difference: +₹250.50 (+25.1%).');
  });

  it('top sellers list quantities with units and revenue', async () => {
    const a = await run(SUGGESTIONS.topSellers.intent, mockApi());
    expect(a.items[0]).toMatchObject({ primary: '1. Sugar', secondary: '12.5 kg sold · ₹550.00 revenue' });
  });

  it('insufficient sales data note from the API is passed on', async () => {
    const api = mockApi({ getSalesInsights: vi.fn().mockResolvedValue(salesData({}, { has_sufficient_data: false, data_summary_note: 'Only 2 sales recorded.' })) });
    expect((await run(SUGGESTIONS.salesWeek.intent, api)).warnings).toContain('Only 2 sales recorded.');
  });

  it('inventory: thresholds only when configured; unconfigured products are disclosed', async () => {
    const api = mockApi();
    const low = await run(SUGGESTIONS.lowStock.intent, api);
    expect(low.items).toEqual([{ primary: 'Sugar', secondary: '2.5 kg in stock · minimum 5 kg · low stock', tone: 'warning' }]);
    expect(low.warnings.join(' ')).toMatch(/1 product has no minimum stock level set/);
    const att = await run(SUGGESTIONS.stockAttention.intent, api);
    expect(att.items.map((i) => i.primary)).toEqual(['Rice', 'Sugar']);
    const unconfigured = mockApi({ getInventoryInsights: vi.fn().mockResolvedValue(inventoryData([invItem({ product_name: 'Oil', status: 'OUT OF STOCK', current_stock: 0, minimum_stock_threshold: 0 })])) });
    const out = await run(SUGGESTIONS.outOfStock.intent, unconfigured);
    expect(out.items[0].secondary).toBe('0 pcs in stock · out of stock');
  });

  it('long lists are capped with a pointer to the full page', async () => {
    const items = Array.from({ length: 12 }, (_, i) => invItem({ product_id: `o${i}`, product_name: `P${i}`, status: 'OUT OF STOCK', current_stock: 0 }));
    const a = await run(SUGGESTIONS.outOfStock.intent, mockApi({ getInventoryInsights: vi.fn().mockResolvedValue(inventoryData(items)) }));
    expect(a.items).toHaveLength(8);
    expect(a.lines.join(' ')).toMatch(/and 4 more\. See the Inventory page/);
  });

  it('actions are presented as advisory suggestions from the data', async () => {
    const a = await run(SUGGESTIONS.actions.intent, mockApi());
    expect(a.items[0].primary).toBe('Create supplier restock purchase order immediately.');
    expect(a.lines.join(' ')).toMatch(/advisory/);
    expect(a.items.map((i) => i.primary)).toContain('Milk');
  });
});

// ------------------------------------------------------------------------------ 5. UI

function auth(role: UserRole): AuthContextType {
  const profile: any = { uid: 'u', email: 'u@example.com', displayName: 'U', shopName: 'S', role, theme: 'light', language: 'en', createdAt: '', lastLogin: '' };
  return { firebaseUser: { uid: 'u' } as any, userProfile: profile, user: profile, loading: false, error: null } as unknown as AuthContextType;
}

const renderChat = (role: UserRole) =>
  renderToStaticMarkup(
    <LanguageProvider>
      <AuthContext.Provider value={auth(role)}>
        <AiChatBox defaultOpen />
      </AuthContext.Provider>
    </LanguageProvider>
  );

describe('5. Chat UI', () => {
  it('owner/manager: empty state with data-source note and suggested questions', () => {
    for (const role of ['owner', 'manager'] as UserRole[]) {
      const html = renderChat(role);
      expect(html).toContain('data-testid="assistant-empty"');
      expect(html).toContain('Answers use only your shop&#x27;s sales, stock and forecast records.');
      expect(html).toContain('Your shop data');
      expect(html).toContain('How are my sales today?');
      expect(html).toContain('What may run out in the next 7 days?');
      expect(html).toContain('role="log"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('aria-label="Clear conversation"');
      expect(html).not.toContain('assistant-restricted-note');
    }
  });

  it('cashier: restricted note and no analytics suggestions', () => {
    const html = renderChat('cashier');
    expect(html).toContain('data-testid="assistant-restricted-note"');
    expect(html).toContain('Business insights are available to shop owners and managers.');
    expect(html).not.toContain('How are my sales today?');
    expect(html).not.toContain('What should I restock today?');
  });

  it('answer view renders items, warnings, source and follow-ups', async () => {
    const answer = await run(SUGGESTIONS.runout.intent, mockApi());
    const html = renderToStaticMarkup(<AssistantAnswerView answer={answer} retryLabel="Try again" onPick={vi.fn()} />);
    expect(html).toContain('data-testid="assistant-items"');
    expect(html).toContain('data-testid="assistant-warnings"');
    expect(html).toContain('Demand forecast from recorded sales · generated 25 Nov 2026 09:30 UTC');
    expect(html).toContain('What should I reorder?');
    expect(html).not.toContain('Try again');
  });

  it('a retryable error shows a retry button and no figures', async () => {
    const answer = await run(SUGGESTIONS.salesToday.intent, mockApi({ getSalesInsights: vi.fn().mockRejectedValue(new ApiError('x', 500)) }));
    const html = renderToStaticMarkup(<AssistantAnswerView answer={answer} retryLabel="Try again" onPick={vi.fn()} onRetry={vi.fn()} />);
    expect(html).toContain('data-kind="error"');
    expect(html).toContain('Try again');
    expect(html).not.toMatch(/₹\s?\d/);
  });

  it('the component has no canned answers or simulated delays', () => {
    const src = readFileSync(resolve(__dirname, '../components/AiChatBox.tsx'), 'utf8');
    expect(src).not.toMatch(/setTimeout/);
    expect(src).not.toMatch(/₹\s?\d/);
    expect(src).not.toMatch(/\b\d+ (sold|left|transactions)\b/);
    expect(src).toMatch(/answerIntent\(intent, \{ canAccessAnalytics \}\)/);
    const assistantSrc = ['data.ts', 'engine.ts', 'format.ts', 'intents.ts']
      .map((f) => readFileSync(resolve(__dirname, '../utils/assistant', f), 'utf8'))
      .join('\n');
    expect(assistantSrc).not.toMatch(/Math\.random|mock|demo|sample data/i);
    expect(assistantSrc).not.toMatch(/fetch\(|axios|anthropic|openai/i);
  });
});
