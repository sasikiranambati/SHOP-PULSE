/**
 * Data retrieval for the business assistant.
 *
 * Reads only through the existing authenticated Insights API client (insightsApi): the backend
 * resolves the active shop from the signed-in user, enforces OWNER/MANAGER access (403 otherwise)
 * and scopes every query to that shop. Nothing here adds headers, picks a shop or caches data.
 *
 * Responses are checked before use. A response missing its core fields is reported as malformed
 * (an error the user can retry), never patched with made-up values. Optional lists that are missing
 * are treated as empty and reported as a data-completeness warning.
 */
import { ApiError } from '../../api/client';
import {
  insightsApi,
  type AiInsightsData,
  type DemandForecastParams,
  type InventoryInsightItem,
  type InventoryInsightsData,
  type ProductDemandForecast,
  type SalesInsightsData,
  type ShopForecastSummary,
} from '../../api/insights';
import type { AssistantIntent, AssistantSalesPeriod } from './types';

/** Supplier lead time sent with every forecast request, so answers can state it exactly. */
export const ASSISTANT_LEAD_TIME_DAYS = 3;

export type InsightsSource = Pick<
  typeof insightsApi,
  'getSalesInsights' | 'getInventoryInsights' | 'getAiInsights' | 'getDemandForecast'
>;

export type DataSourceName = 'sales' | 'inventory' | 'forecast' | 'summary';

export type AssistantErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'no_shop'
  | 'not_found'
  | 'validation'
  | 'offline'
  | 'server'
  | 'malformed';

export class AssistantDataError extends Error {
  kind: AssistantErrorKind;
  status: number | null;
  retryable: boolean;
  source: DataSourceName;

  constructor(kind: AssistantErrorKind, message: string, source: DataSourceName, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'AssistantDataError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.source = source;
  }
}

/** Map an API/network failure to an assistant error. Never returns data. */
export function classifyAssistantError(err: unknown, source: DataSourceName): AssistantDataError {
  if (err instanceof AssistantDataError) return err;
  const status = err instanceof ApiError || (err && typeof err === 'object' && 'status' in err)
    ? Number((err as { status: unknown }).status)
    : null;
  const message = err instanceof Error ? err.message : '';

  if (status === 401) {
    return new AssistantDataError('unauthorized', 'Your session has expired. Please sign in again to see your shop data.', source, 401, false);
  }
  if (status === 403) {
    return new AssistantDataError('forbidden', 'Your role does not have access to this business data. Sales, inventory analytics and forecasts are available to shop owners and managers.', source, 403, false);
  }
  if (status === 400 && /shop/i.test(message)) {
    return new AssistantDataError('no_shop', 'No active shop was found for your account. Create or join a shop first.', source, 400, false);
  }
  if (status === 404) {
    return new AssistantDataError('not_found', 'The requested record was not found in your active shop.', source, 404, false);
  }
  if (status === 400 || status === 422) {
    return new AssistantDataError('validation', 'The request was rejected by the server.', source, status, false);
  }
  if (status === 0) {
    return new AssistantDataError('offline', 'Could not reach the ShopPulse server. Check your connection and try again.', source, 0, true);
  }
  if (status === null || Number.isNaN(status)) {
    return new AssistantDataError('server', 'Something went wrong while preparing this answer.', source, null, true);
  }
  return new AssistantDataError('server', 'The server could not load this data right now.', source, status, true);
}

// ------------------------------------------------------------------------------ validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function malformed(source: DataSourceName): AssistantDataError {
  return new AssistantDataError('malformed', 'The server returned data in an unexpected format, so no answer was produced from it.', source, null, true);
}

export interface Checked<T> {
  data: T;
  /** Parts of the response that were missing or unusable (reported as warnings, never filled in). */
  gaps: string[];
}

export function checkSales(raw: unknown): Checked<SalesInsightsData> {
  if (!isObj(raw) || !isObj(raw.overview)) throw malformed('sales');
  const o = raw.overview;
  if (!isNum(o.total_sales) || !isNum(o.transaction_count) || !isStr(o.start_date) || !isStr(o.end_date)) throw malformed('sales');
  const gaps: string[] = [];
  const perf = isObj(raw.performance) ? raw.performance : null;
  if (!perf) gaps.push('product performance');
  const list = (key: string) => {
    const v = perf?.[key];
    if (!Array.isArray(v)) return [];
    return v.filter((i) => isObj(i) && isStr(i.product_name) && isNum(i.quantity_sold) && isNum(i.revenue));
  };
  const trends = isObj(raw.trends) ? raw.trends : null;
  if (!trends) gaps.push('daily trend');
  const points = Array.isArray(trends?.points)
    ? (trends!.points as unknown[]).filter((p) => isObj(p) && isStr(p.label) && isNum(p.revenue))
    : [];
  const data: SalesInsightsData = {
    overview: {
      total_sales: o.total_sales,
      transaction_count: o.transaction_count,
      average_transaction_value: isNum(o.average_transaction_value) ? o.average_transaction_value : NaN,
      previous_period_sales: isNum(o.previous_period_sales) ? o.previous_period_sales : NaN,
      previous_period_transactions: isNum(o.previous_period_transactions) ? o.previous_period_transactions : NaN,
      sales_growth_rate: isNum(o.sales_growth_rate) ? o.sales_growth_rate : null,
      period: isStr(o.period) ? o.period : '',
      start_date: o.start_date,
      end_date: o.end_date,
    },
    performance: {
      best_selling: list('best_selling') as SalesInsightsData['performance']['best_selling'],
      slow_moving: list('slow_moving') as SalesInsightsData['performance']['slow_moving'],
      increasing_sales: list('increasing_sales') as SalesInsightsData['performance']['increasing_sales'],
      declining_sales: list('declining_sales') as SalesInsightsData['performance']['declining_sales'],
    },
    trends: {
      interval: isStr(trends?.interval) ? (trends!.interval as string) : '',
      points: points as SalesInsightsData['trends']['points'],
      peak_day: isStr(trends?.peak_day) ? (trends!.peak_day as string) : null,
      peak_revenue: isNum(trends?.peak_revenue) ? (trends!.peak_revenue as number) : 0,
    },
    has_sufficient_data: raw.has_sufficient_data === true,
    data_summary_note: isStr(raw.data_summary_note) ? raw.data_summary_note : null,
  };
  return { data, gaps };
}

export function checkInventory(raw: unknown): Checked<InventoryInsightsData> {
  if (!isObj(raw) || !isObj(raw.counts) || !Array.isArray(raw.items)) throw malformed('inventory');
  const c = raw.counts;
  const keys = ['in_stock', 'low_stock', 'out_of_stock', 'overstocked', 'needs_attention', 'total_products'] as const;
  if (!keys.every((k) => isNum(c[k]))) throw malformed('inventory');
  const items = raw.items.filter(
    (i): i is InventoryInsightItem => isObj(i) && isStr(i.product_name) && isNum(i.current_stock) && isStr(i.status)
  );
  const gaps = items.length < raw.items.length ? [`${raw.items.length - items.length} incomplete product row(s) skipped`] : [];
  return {
    data: { counts: c as unknown as InventoryInsightsData['counts'], items, has_sufficient_data: raw.has_sufficient_data === true },
    gaps,
  };
}

export function checkAiSummary(raw: unknown): Checked<AiInsightsData> {
  if (!isObj(raw) || !Array.isArray(raw.insights)) throw malformed('summary');
  const insights = raw.insights.filter((c) => isObj(c) && isStr(c.title) && isStr(c.message)) as AiInsightsData['insights'];
  const gaps = insights.length < raw.insights.length ? [`${raw.insights.length - insights.length} incomplete insight(s) skipped`] : [];
  return {
    data: {
      insights,
      overall_business_health: isStr(raw.overall_business_health) ? raw.overall_business_health : '',
      has_sufficient_data: raw.has_sufficient_data === true,
      note: isStr(raw.note) ? raw.note : null,
    },
    gaps,
  };
}

const TIERS = new Set(['TIER_1_SUFFICIENT', 'TIER_2_SPARSE', 'TIER_3_COLD_START']);
const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW', 'NONE']);

function isForecastRow(f: unknown): f is ProductDemandForecast {
  return (
    isObj(f) &&
    isStr(f.product_name) &&
    isNum(f.current_stock) &&
    isStr(f.forecast_tier) && TIERS.has(f.forecast_tier) &&
    isStr(f.confidence_level) && CONFIDENCE.has(f.confidence_level) &&
    isStr(f.forecast_status)
  );
}

export function checkForecast(raw: unknown): Checked<ShopForecastSummary> {
  if (!isObj(raw) || !Array.isArray(raw.forecasts)) throw malformed('forecast');
  const rows = raw.forecasts.filter(isForecastRow).map((f) => ({
    ...f,
    normalized_unit: isStr(f.normalized_unit) ? f.normalized_unit : '',
    daily_demand_rate: isNum(f.daily_demand_rate) ? f.daily_demand_rate : null,
    expected_seven_day_demand: isNum(f.expected_seven_day_demand) ? f.expected_seven_day_demand : null,
    days_to_stockout: isNum(f.days_to_stockout) ? f.days_to_stockout : null,
    recommended_reorder_quantity: isNum(f.recommended_reorder_quantity) ? f.recommended_reorder_quantity : null,
    is_reorder_provisional: f.is_reorder_provisional !== false,
    assumptions: Array.isArray(f.assumptions) ? f.assumptions.filter(isStr) : [],
    warnings: Array.isArray(f.warnings) ? f.warnings.filter(isStr) : [],
  }));
  const gaps = rows.length < raw.forecasts.length ? [`${raw.forecasts.length - rows.length} incomplete forecast row(s) skipped`] : [];
  const n = (v: unknown) => (isNum(v) ? v : NaN);
  return {
    data: {
      shop_id: isStr(raw.shop_id) ? raw.shop_id : '',
      generated_at: isStr(raw.generated_at) ? raw.generated_at : '',
      total_products_analyzed: n(raw.total_products_analyzed),
      tier_1_count: n(raw.tier_1_count),
      tier_2_count: n(raw.tier_2_count),
      tier_3_count: n(raw.tier_3_count),
      out_of_stock_count: n(raw.out_of_stock_count),
      at_risk_stockout_7d_count: n(raw.at_risk_stockout_7d_count),
      forecasts: rows,
    },
    gaps,
  };
}

// ------------------------------------------------------------------------------ retrieval

export type AssistantData =
  | { kind: 'sales'; sales: Checked<SalesInsightsData>; period: AssistantSalesPeriod }
  | { kind: 'inventory'; inventory: Checked<InventoryInsightsData> }
  | { kind: 'forecast'; forecast: Checked<ShopForecastSummary> }
  | {
      kind: 'summary';
      aiSummary?: Checked<AiInsightsData>;
      salesToday?: Checked<SalesInsightsData>;
      forecast?: Checked<ShopForecastSummary>;
      failures: AssistantDataError[];
    };

async function load<T>(source: DataSourceName, call: () => Promise<unknown>, check: (raw: unknown) => Checked<T>): Promise<Checked<T>> {
  let raw: unknown;
  try {
    raw = await call();
  } catch (err) {
    throw classifyAssistantError(err, source);
  }
  return check(raw);
}

export function forecastParams(): DemandForecastParams {
  return { lead_time_days: ASSISTANT_LEAD_TIME_DAYS };
}

/**
 * Fetch exactly the data an intent needs. Throws AssistantDataError on failure.
 * UNKNOWN intents must not reach here: they never trigger a request.
 */
export async function fetchForIntent(intent: AssistantIntent, api: InsightsSource = insightsApi): Promise<AssistantData> {
  switch (intent.category) {
    case 'SALES':
      return { kind: 'sales', period: intent.period, sales: await load('sales', () => api.getSalesInsights(intent.period), checkSales) };
    case 'INVENTORY':
      return { kind: 'inventory', inventory: await load('inventory', () => api.getInventoryInsights(), checkInventory) };
    case 'FORECAST':
      return { kind: 'forecast', forecast: await load('forecast', () => api.getDemandForecast(forecastParams()), checkForecast) };
    case 'BUSINESS_SUMMARY': {
      const [ai, sales, forecast] = await Promise.allSettled([
        load('summary', () => api.getAiInsights(), checkAiSummary),
        load('sales', () => api.getSalesInsights('today'), checkSales),
        load('forecast', () => api.getDemandForecast(forecastParams()), checkForecast),
      ]);
      const failures: AssistantDataError[] = [];
      const take = <T,>(r: PromiseSettledResult<Checked<T>>, source: DataSourceName) => {
        if (r.status === 'fulfilled') return r.value;
        failures.push(classifyAssistantError(r.reason, source));
        return undefined;
      };
      const result = {
        kind: 'summary' as const,
        aiSummary: take(ai, 'summary'),
        salesToday: take(sales, 'sales'),
        forecast: take(forecast, 'forecast'),
        failures,
      };
      if (!result.aiSummary && !result.salesToday && !result.forecast) {
        // Nothing loaded: report the most specific failure (auth/role first)
        const order: AssistantErrorKind[] = ['unauthorized', 'forbidden', 'no_shop', 'offline', 'malformed', 'server'];
        failures.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        throw failures[0];
      }
      return result;
    }
    default:
      throw new Error('Unknown intents do not fetch data.');
  }
}
