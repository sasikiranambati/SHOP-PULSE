/**
 * Response formatting for the business assistant.
 *
 * Every figure comes from a checked API response. Missing values are left out (never shown as 0),
 * "today" is labelled as the UTC day so far, rolling windows are labelled with their exact range,
 * forecasts always carry their confidence and history tier, and reorder quantities are presented
 * as advisory suggestions.
 */
import type {
  AiInsightCard,
  InventoryInsightItem,
  InventoryInsightsData,
  ProductDemandForecast,
  SalesInsightsData,
  ShopForecastSummary,
} from '../../api/insights';
import {
  getConfidenceMetadata,
  getForecastStatusLabel,
  getForecastTierMetadata,
  getStockoutSeverity,
} from '../demandForecast';
import { formatCurrency } from '../formatCurrency';
import { ASSISTANT_LEAD_TIME_DAYS, type AssistantData, type AssistantDataError, type Checked } from './data';
import type {
  AnswerItem,
  AnswerTone,
  AssistantAnswer,
  AssistantIntent,
  AssistantSalesPeriod,
  AssistantSuggestion,
} from './types';

const LIST_LIMIT = 8;

// ------------------------------------------------------------------------------ suggestions

const s = (id: string, label: string, intent: AssistantIntent): AssistantSuggestion => ({ id, label, intent });
const sales = (topic: Extract<AssistantIntent, { category: 'SALES' }>['topic'], period: AssistantSalesPeriod): AssistantIntent => ({
  category: 'SALES', topic, period, periodExplicit: true,
});

export const SUGGESTIONS = {
  salesToday: s('sales-today', 'How are my sales today?', sales('overview', 'today')),
  salesWeek: s('sales-week', 'Sales in the last 7 days', sales('overview', '7d')),
  salesMonth: s('sales-month', 'Sales in the last 30 days', sales('overview', '30d')),
  salesYesterday: s('sales-yesterday', "Yesterday's sales", sales('yesterday', 'today')),
  topSellers: s('top-sellers', 'Top sellers this week', sales('top_sellers', '7d')),
  slowMovers: s('slow-movers', 'What did not sell this week?', sales('slow_movers', '7d')),
  trend: s('trend', 'Daily sales trend (7 days)', sales('trend', '7d')),
  compareWeek: s('compare-week', 'Compare with the previous 7 days', sales('comparison', '7d')),
  compareToday: s('compare-today', 'Today vs yesterday', sales('comparison', 'today')),
  inventorySummary: s('inventory-summary', 'Inventory summary', { category: 'INVENTORY', topic: 'summary' }),
  outOfStock: s('out-of-stock', 'What is out of stock?', { category: 'INVENTORY', topic: 'out_of_stock' }),
  lowStock: s('low-stock', 'Which products are running low?', { category: 'INVENTORY', topic: 'low_stock' }),
  stockAttention: s('stock-attention', 'Which products need attention?', { category: 'INVENTORY', topic: 'attention' }),
  runout: s('runout', 'What may run out in the next 7 days?', { category: 'FORECAST', topic: 'runout_7d' }),
  reorder: s('reorder', 'What should I reorder?', { category: 'FORECAST', topic: 'reorder' }),
  highRisk: s('high-risk', 'Which products have high stockout risk?', { category: 'FORECAST', topic: 'high_risk' }),
  lowConfidence: s('low-confidence', 'Which forecasts have low confidence?', { category: 'FORECAST', topic: 'low_confidence' }),
  noHistory: s('no-history', 'Which products lack sales history?', { category: 'FORECAST', topic: 'insufficient_history' }),
  forecastOverview: s('forecast-overview', 'Forecast overview', { category: 'FORECAST', topic: 'overview' }),
  summary: s('summary', 'Give me a business summary', { category: 'BUSINESS_SUMMARY', topic: 'summary' }),
  attention: s('attention', 'What needs my attention?', { category: 'BUSINESS_SUMMARY', topic: 'attention' }),
  actions: s('actions', 'What should I do today?', { category: 'BUSINESS_SUMMARY', topic: 'actions' }),
} as const;

/** Suggested questions grouped by category, for roles with analytics access. */
export const SUGGESTION_GROUPS: { category: string; items: AssistantSuggestion[] }[] = [
  { category: 'Sales', items: [SUGGESTIONS.salesToday, SUGGESTIONS.salesWeek, SUGGESTIONS.topSellers, SUGGESTIONS.compareWeek] },
  { category: 'Inventory', items: [SUGGESTIONS.outOfStock, SUGGESTIONS.lowStock, SUGGESTIONS.inventorySummary] },
  { category: 'Forecast', items: [SUGGESTIONS.runout, SUGGESTIONS.reorder, SUGGESTIONS.lowConfidence] },
  { category: 'Business', items: [SUGGESTIONS.summary, SUGGESTIONS.attention, SUGGESTIONS.actions] },
];

// ------------------------------------------------------------------------------ value formatting

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ₹ amount, or null when the value is missing (never shown as ₹0.00). */
export function money(v: number | null | undefined): string | null {
  return finite(v) ? formatCurrency(v) : null;
}

/** Quantity with at most 3 decimals and its unit: 2.5 kg, 12 pcs. */
export function qty(v: number | null | undefined, unit?: string | null): string | null {
  if (!finite(v)) return null;
  const n = (Math.round(v * 1000) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return unit ? `${n} ${unit}` : n;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** Backend timestamps are UTC; a timestamp without an offset is read as UTC. */
export function parseUtc(iso: string): Date | null {
  if (!iso) return null;
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const DATE_ONLY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

export function formatUtc(d: Date, withTime = true): string {
  return (withTime ? DATE_TIME : DATE_ONLY).format(d).replace(',', '');
}

export function formatRange(startIso: string, endIso: string): string | null {
  const a = parseUtc(startIso);
  const b = parseUtc(endIso);
  if (!a || !b) return null;
  return `${formatUtc(a)} – ${formatUtc(b)} UTC`;
}

const PERIOD_LABEL: Record<AssistantSalesPeriod, string> = {
  today: 'today (UTC day so far)',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
};
const PERIOD_TITLE: Record<AssistantSalesPeriod, string> = {
  today: 'today',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};
const PREVIOUS_LABEL: Record<AssistantSalesPeriod, string> = {
  today: 'yesterday (full UTC day)',
  '7d': 'the previous 7 days',
  '30d': 'the previous 30 days',
  '90d': 'the previous 90 days',
};

function pct(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}%`;
}

function gapWarnings(gaps: string[]): string[] {
  return gaps.length ? [`Incomplete response from the server: ${gaps.join('; ')}. Only the data received is shown.`] : [];
}

function base(kind: AssistantAnswer['kind'], title: string, extra: Partial<AssistantAnswer> = {}): AssistantAnswer {
  return { kind, title, lines: [], items: [], warnings: [], followUps: [], ...extra };
}

function more(total: number, shown: number, where: string): string[] {
  return total > shown ? [`…and ${total - shown} more. See the ${where} page for the full list.`] : [];
}

// ------------------------------------------------------------------------------ sales

function salesSource(d: SalesInsightsData): string {
  const range = formatRange(d.overview.start_date, d.overview.end_date);
  return range ? `Sales records · ${range}` : 'Sales records';
}

function salesWarnings(c: Checked<SalesInsightsData>): string[] {
  const w = gapWarnings(c.gaps);
  if (!c.data.has_sufficient_data && c.data.data_summary_note) w.push(c.data.data_summary_note);
  return w;
}

function formatSales(intent: Extract<AssistantIntent, { category: 'SALES' }>, c: Checked<SalesInsightsData>): AssistantAnswer {
  const d = c.data;
  const o = d.overview;
  const p = intent.period;
  const warnings = salesWarnings(c);
  const source = salesSource(d);
  const total = money(o.total_sales)!;
  const tx = plural(o.transaction_count, 'transaction');

  switch (intent.topic) {
    case 'overview': {
      const a = base(o.transaction_count === 0 ? 'empty' : 'answer', `Sales · ${PERIOD_TITLE[p]}`, { warnings, source });
      if (o.transaction_count === 0) {
        a.lines.push(`No sales were recorded in ${PERIOD_LABEL[p]}.`);
      } else {
        a.lines.push(`Total sales: ${total} from ${tx}.`);
        const avg = money(o.average_transaction_value);
        if (avg) a.lines.push(`Average bill: ${avg}.`);
      }
      const prev = money(o.previous_period_sales);
      if (p === 'today') {
        if (prev) a.lines.push(`Yesterday (full UTC day): ${prev}${finite(o.previous_period_transactions) ? ` from ${plural(o.previous_period_transactions, 'transaction')}` : ''}.`);
        a.lines.push('Today is still in progress, so no growth figure is given.');
      } else if (prev) {
        a.lines.push(`Previous period (${PREVIOUS_LABEL[p]}): ${prev}.`);
        if (finite(o.sales_growth_rate)) a.lines.push(`Change: ${pct(o.sales_growth_rate)}.`);
      }
      a.followUps = p === 'today'
        ? [SUGGESTIONS.compareToday, SUGGESTIONS.salesWeek, SUGGESTIONS.topSellers]
        : [SUGGESTIONS.topSellers, SUGGESTIONS.trend, SUGGESTIONS.compareWeek];
      return a;
    }
    case 'yesterday': {
      const start = parseUtc(o.start_date);
      const yStart = start ? new Date(start.getTime() - 86_400_000) : null;
      const a = base('answer', 'Sales · yesterday', {
        warnings,
        source: start && yStart ? `Sales records · ${formatUtc(yStart, false)} (full UTC day)` : 'Sales records',
      });
      const prev = money(o.previous_period_sales);
      if (!prev) {
        a.kind = 'empty';
        a.lines.push("Yesterday's total was not included in the server response.");
      } else if (o.previous_period_transactions === 0) {
        a.kind = 'empty';
        a.lines.push('No sales were recorded yesterday.');
      } else {
        a.lines.push(`Total sales yesterday: ${prev}${finite(o.previous_period_transactions) ? ` from ${plural(o.previous_period_transactions, 'transaction')}` : ''}.`);
      }
      a.followUps = [SUGGESTIONS.salesToday, SUGGESTIONS.compareToday, SUGGESTIONS.salesWeek];
      return a;
    }
    case 'comparison': {
      const a = base('answer', `Sales comparison · ${PERIOD_TITLE[p]} vs ${p === 'today' ? 'yesterday' : 'previous period'}`, { warnings, source });
      const prev = money(o.previous_period_sales);
      a.lines.push(`${p === 'today' ? 'Today so far' : `Current period (${PERIOD_LABEL[p]})`}: ${total} from ${tx}.`);
      if (!prev) {
        a.warnings.push('The previous period total was not included in the server response, so no comparison can be made.');
        return a;
      }
      a.lines.push(`${p === 'today' ? 'Yesterday (full UTC day)' : `Previous period (${PREVIOUS_LABEL[p]})`}: ${prev}${finite(o.previous_period_transactions) ? ` from ${plural(o.previous_period_transactions, 'transaction')}` : ''}.`);
      if (p === 'today') {
        a.lines.push('Today is not over yet, so this is not a like-for-like comparison and no growth figure is given.');
      } else {
        const diff = Math.round((o.total_sales - o.previous_period_sales) * 100) / 100;
        a.lines.push(`Difference: ${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}${finite(o.sales_growth_rate) ? ` (${pct(o.sales_growth_rate)})` : ''}.`);
        if (!finite(o.sales_growth_rate)) a.lines.push('No growth percentage: there were no sales in the previous period to compare against.');
      }
      a.followUps = [SUGGESTIONS.topSellers, SUGGESTIONS.trend, SUGGESTIONS.salesMonth];
      return a;
    }
    case 'top_sellers': {
      const list = d.performance.best_selling;
      const a = base(list.length ? 'answer' : 'empty', `Top sellers · ${PERIOD_TITLE[p]}`, { warnings, source });
      if (!list.length) {
        a.lines.push(`No product sales were recorded in ${PERIOD_LABEL[p]}.`);
      } else {
        a.lines.push(`Ranked by quantity sold in ${PERIOD_LABEL[p]}:`);
        list.slice(0, LIST_LIMIT).forEach((i, idx) => {
          a.items.push({
            primary: `${idx + 1}. ${i.product_name}`,
            secondary: [`${qty(i.quantity_sold, i.unit)} sold`, money(i.revenue) && `${money(i.revenue)} revenue`].filter(Boolean).join(' · '),
            tone: 'positive',
          });
        });
      }
      a.followUps = [SUGGESTIONS.slowMovers, SUGGESTIONS.runout, SUGGESTIONS.compareWeek];
      return a;
    }
    case 'slow_movers': {
      const list = d.performance.slow_moving;
      const a = base(list.length ? 'answer' : 'empty', `Products with no sales · ${PERIOD_TITLE[p]}`, { warnings, source });
      if (!list.length) {
        a.lines.push(`Every active product recorded at least one sale in ${PERIOD_LABEL[p]}.`);
      } else {
        a.lines.push(`Active products with no recorded sales in ${PERIOD_LABEL[p]} (up to 10 are returned):`);
        list.slice(0, LIST_LIMIT).forEach((i) => a.items.push({ primary: i.product_name, secondary: i.category || undefined, tone: 'neutral' }));
      }
      a.followUps = [SUGGESTIONS.topSellers, SUGGESTIONS.inventorySummary];
      return a;
    }
    case 'trend': {
      const pts = d.trends.points;
      const a = base(pts.length ? 'answer' : 'empty', `Sales trend · ${PERIOD_TITLE[p]}`, { warnings, source });
      if (!pts.length || o.transaction_count === 0) {
        a.kind = 'empty';
        a.lines.push(`No sales were recorded in ${PERIOD_LABEL[p]}, so there is no trend to show.`);
      } else {
        const shown = pts.slice(-10);
        a.lines.push(`${d.trends.interval === 'weekly' ? 'Weekly' : 'Daily'} revenue (UTC dates)${shown.length < pts.length ? `, latest ${shown.length} of ${pts.length}` : ''}:`);
        shown.forEach((pt) => a.items.push({
          primary: pt.label,
          secondary: [money(pt.revenue), finite(pt.transaction_count) && plural(pt.transaction_count, 'transaction')].filter(Boolean).join(' · '),
          tone: 'neutral',
        }));
        if (d.trends.peak_day && finite(d.trends.peak_revenue) && d.trends.peak_revenue > 0) {
          a.lines.push(`Best day: ${d.trends.peak_day} with ${money(d.trends.peak_revenue)}.`);
        }
      }
      a.followUps = [SUGGESTIONS.compareWeek, SUGGESTIONS.topSellers, SUGGESTIONS.salesMonth];
      return a;
    }
  }
}

// ------------------------------------------------------------------------------ inventory

function stockItem(i: InventoryInsightItem): AnswerItem {
  const stock = qty(i.current_stock, i.unit);
  const threshold = i.is_threshold_configured ? qty(i.minimum_stock_threshold, i.unit) : null;
  const tone: AnswerTone = i.status === 'OUT OF STOCK' ? 'critical' : i.status === 'LOW STOCK' ? 'warning' : 'neutral';
  return {
    primary: i.product_name,
    secondary: [stock && `${stock} in stock`, threshold && `minimum ${threshold}`, i.status !== 'IN STOCK' && i.status.toLowerCase()]
      .filter(Boolean)
      .join(' · '),
    tone,
  };
}

function formatInventory(intent: Extract<AssistantIntent, { category: 'INVENTORY' }>, c: Checked<InventoryInsightsData>): AssistantAnswer {
  const d = c.data;
  const warnings = gapWarnings(c.gaps);
  const source = 'Current inventory records';
  const noThreshold = d.items.filter((i) => !i.is_threshold_configured && i.current_stock > 0).length;
  const thresholdNote = noThreshold
    ? `${plural(noThreshold, 'product')} ${noThreshold === 1 ? 'has' : 'have'} no minimum stock level set, so ${noThreshold === 1 ? 'it' : 'they'} can only be flagged once out of stock.`
    : null;

  if (d.counts.total_products === 0) {
    return base('empty', 'Inventory', { lines: ['There are no active products in this shop yet.'], warnings, source, followUps: [] });
  }

  const pick = (statuses: InventoryInsightItem['status'][]) => d.items.filter((i) => statuses.includes(i.status));
  const listAnswer = (title: string, statuses: InventoryInsightItem['status'][], emptyLine: string, intro: (n: number) => string) => {
    const rows = pick(statuses);
    const a = base(rows.length ? 'answer' : 'empty', title, { warnings, source });
    if (!rows.length) a.lines.push(emptyLine);
    else {
      a.lines.push(intro(rows.length));
      rows.slice(0, LIST_LIMIT).forEach((i) => a.items.push(stockItem(i)));
      a.lines.push(...more(rows.length, LIST_LIMIT, 'Inventory'));
    }
    return a;
  };

  switch (intent.topic) {
    case 'out_of_stock': {
      const a = listAnswer('Out of stock', ['OUT OF STOCK'], 'No products are out of stock right now.', (n) => `${plural(n, 'product')} ${n === 1 ? 'is' : 'are'} out of stock:`);
      a.followUps = [SUGGESTIONS.lowStock, SUGGESTIONS.reorder, SUGGESTIONS.runout];
      return a;
    }
    case 'low_stock': {
      const a = listAnswer('Low stock', ['LOW STOCK'], 'No products are below their minimum stock level.', (n) => `${plural(n, 'product')} ${n === 1 ? 'is' : 'are'} at or below the minimum stock level:`);
      if (thresholdNote) a.warnings.push(thresholdNote);
      a.followUps = [SUGGESTIONS.outOfStock, SUGGESTIONS.reorder, SUGGESTIONS.runout];
      return a;
    }
    case 'attention': {
      const a = listAnswer('Products needing attention', ['OUT OF STOCK', 'LOW STOCK'], 'No products are out of stock or below their minimum level.', (n) => `${plural(n, 'product')} need${n === 1 ? 's' : ''} attention (out of stock or low stock):`);
      if (thresholdNote) a.warnings.push(thresholdNote);
      a.followUps = [SUGGESTIONS.reorder, SUGGESTIONS.runout];
      return a;
    }
    case 'summary': {
      const k = d.counts;
      const a = base('answer', 'Inventory summary', { warnings, source });
      a.lines.push(`${plural(k.total_products, 'active product')}: ${k.in_stock} in stock, ${k.low_stock} low stock, ${k.out_of_stock} out of stock, ${k.overstocked} overstocked.`);
      a.lines.push(k.needs_attention > 0 ? `${plural(k.needs_attention, 'product')} need${k.needs_attention === 1 ? 's' : ''} attention.` : 'No products need attention right now.');
      pick(['OUT OF STOCK', 'LOW STOCK']).slice(0, 5).forEach((i) => a.items.push(stockItem(i)));
      if (thresholdNote) a.warnings.push(thresholdNote);
      a.followUps = [SUGGESTIONS.outOfStock, SUGGESTIONS.lowStock, SUGGESTIONS.runout];
      return a;
    }
  }
}

// ------------------------------------------------------------------------------ forecast

const isLowConfidence = (f: ProductDemandForecast) => f.confidence_level === 'LOW' || f.confidence_level === 'NONE';

function confidenceText(f: ProductDemandForecast): string {
  return `${getConfidenceMetadata(f.confidence_level).label.toLowerCase()} confidence · ${getForecastTierMetadata(f.forecast_tier).shortLabel}`;
}

/** Product-specific server warnings worth repeating (intermittent demand, sparse history, unit review). */
function notableWarnings(f: ProductDemandForecast): string[] {
  return f.warnings.filter((w) => !/^Stockout risk within 7 days|^Product is currently out of stock|^No safety stock configured/.test(w));
}

function forecastItem(f: ProductDemandForecast, main: string): AnswerItem {
  const sev = getStockoutSeverity(f);
  const tone: AnswerTone = sev.severity === 'OUT OF STOCK' || sev.severity === 'CRITICAL' ? 'critical' : sev.severity === 'WARNING' || isLowConfidence(f) ? 'warning' : 'neutral';
  const parts = [main, confidenceText(f), ...notableWarnings(f)];
  return { primary: f.product_name, secondary: parts.filter(Boolean).join(' · '), tone };
}

function daysLeft(f: ProductDemandForecast): string | null {
  if (!finite(f.days_to_stockout)) return null;
  return `about ${qty(f.days_to_stockout)} day${f.days_to_stockout === 1 ? '' : 's'} of stock left`;
}

function forecastSource(d: ShopForecastSummary): string {
  const at = parseUtc(d.generated_at);
  return `Demand forecast from recorded sales${at ? ` · generated ${formatUtc(at)} UTC` : ''}`;
}

function lowConfidenceWarning(rows: ProductDemandForecast[]): string[] {
  const n = rows.filter(isLowConfidence).length;
  return n ? [`${plural(n, 'estimate')} ${n === 1 ? 'is' : 'are'} low confidence (limited sales history). Treat ${n === 1 ? 'it' : 'them'} as rough guidance, not certainty.`] : [];
}

function findProduct(rows: ProductDemandForecast[], query: string): ProductDemandForecast[] {
  const q = query.trim().toLowerCase();
  const exact = rows.filter((f) => f.product_name.trim().toLowerCase() === q);
  if (exact.length) return exact;
  const contains = rows.filter((f) => f.product_name.toLowerCase().includes(q));
  if (contains.length) return contains;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  return tokens.length ? rows.filter((f) => tokens.every((t) => f.product_name.toLowerCase().includes(t))) : [];
}

function formatProductForecast(f: ProductDemandForecast, d: ShopForecastSummary, warnings: string[]): AssistantAnswer {
  const conf = getConfidenceMetadata(f.confidence_level);
  const tier = getForecastTierMetadata(f.forecast_tier);
  const unit = f.normalized_unit;
  const a = base('answer', `Forecast · ${f.product_name}`, { source: forecastSource(d) });
  a.lines.push(`Current stock: ${qty(f.current_stock, unit)}. Status: ${getForecastStatusLabel(f.forecast_status)}.`);
  a.lines.push(`Confidence: ${conf.label} — ${conf.explanation}`);
  a.lines.push(`Method: ${tier.label} — ${tier.description}`);
  a.lines.push(`Sales history: ${plural(f.total_valid_sales, 'recorded sale')} over ${plural(f.observable_days, 'day')}.`);
  if (finite(f.daily_demand_rate)) a.lines.push(`Estimated demand: ${qty(f.daily_demand_rate, unit)} per day (${qty(f.expected_seven_day_demand, unit) ?? '—'} over 7 days).`);
  else a.lines.push('No demand estimate: there is not enough sales history for this product.');
  if (f.current_stock <= 0) a.lines.push('It is already out of stock.');
  else if (daysLeft(f)) a.lines.push(`Projected: ${daysLeft(f)} at the current rate.`);
  else a.lines.push('No run-out date is projected (no measurable demand from recorded sales).');
  if (finite(f.recommended_reorder_quantity) && f.recommended_reorder_quantity > 0) {
    a.lines.push(`Suggested reorder (advisory${f.is_reorder_provisional ? ', provisional' : ''}): ${qty(f.recommended_reorder_quantity, unit)}, assuming a ${ASSISTANT_LEAD_TIME_DAYS}-day supplier lead time.`);
  }
  f.assumptions.forEach((x) => a.items.push({ primary: 'Basis', secondary: x, tone: 'neutral' }));
  a.warnings = [...warnings, ...f.warnings];
  if (isLowConfidence(f)) a.warnings.push('This is a low-confidence estimate; actual demand may differ considerably.');
  a.followUps = [SUGGESTIONS.runout, SUGGESTIONS.reorder];
  return a;
}

function formatForecast(intent: Extract<AssistantIntent, { category: 'FORECAST' }>, c: Checked<ShopForecastSummary>): AssistantAnswer {
  const d = c.data;
  const rows = d.forecasts;
  const warnings = gapWarnings(c.gaps);
  const source = forecastSource(d);

  if (rows.length === 0) {
    return base('empty', 'Demand forecast', {
      lines: ['There are no products to forecast in this shop yet.'], warnings, source, followUps: [SUGGESTIONS.inventorySummary],
    });
  }

  const unknownCount = rows.filter((f) => f.current_stock > 0 && !finite(f.days_to_stockout)).length;
  const unknownNote = unknownCount
    ? `${plural(unknownCount, 'product')} in stock ${unknownCount === 1 ? 'has' : 'have'} no run-out projection (no measurable demand or too little sales history).`
    : null;

  const listAnswer = (title: string, list: ProductDemandForecast[], emptyLine: string, intro: string, main: (f: ProductDemandForecast) => string) => {
    const a = base(list.length ? 'answer' : 'empty', title, { warnings: [...warnings], source });
    if (!list.length) a.lines.push(emptyLine);
    else {
      a.lines.push(intro);
      list.slice(0, LIST_LIMIT).forEach((f) => a.items.push(forecastItem(f, main(f))));
      a.lines.push(...more(list.length, LIST_LIMIT, 'Insights'));
      a.warnings.push(...lowConfidenceWarning(list.slice(0, LIST_LIMIT)));
    }
    return a;
  };
  const byDays = (x: ProductDemandForecast, y: ProductDemandForecast) =>
    (x.days_to_stockout ?? Infinity) - (y.days_to_stockout ?? Infinity) || x.product_name.localeCompare(y.product_name);

  switch (intent.topic) {
    case 'overview': {
      const a = base('answer', 'Demand forecast overview', { warnings, source });
      const n = (v: number) => (finite(v) ? v.toLocaleString('en-IN') : '—');
      a.lines.push(`${plural(rows.length, 'product')} analysed from recorded sales.`);
      a.lines.push(`History: ${n(d.tier_1_count)} with sufficient history (Tier 1), ${n(d.tier_2_count)} sparse (Tier 2), ${n(d.tier_3_count)} with no sales (Tier 3).`);
      a.lines.push(`Projected to run out within 7 days: ${n(d.at_risk_stockout_7d_count)}. Already out of stock: ${n(d.out_of_stock_count)}.`);
      if (unknownNote) a.warnings.push(unknownNote);
      a.warnings.push(...lowConfidenceWarning(rows));
      a.followUps = [SUGGESTIONS.runout, SUGGESTIONS.reorder, SUGGESTIONS.lowConfidence];
      return a;
    }
    case 'runout_7d': {
      const list = rows.filter((f) => f.current_stock > 0 && finite(f.days_to_stockout) && f.days_to_stockout <= 7).sort(byDays);
      const a = listAnswer(
        'May run out in the next 7 days',
        list,
        'No product in stock is projected to run out within 7 days at current sales rates.',
        'Projected from recorded sales at the current rate (estimates, not certainties):',
        (f) => [daysLeft(f), `${qty(f.current_stock, f.normalized_unit)} in stock`, finite(f.expected_seven_day_demand) && `~${qty(f.expected_seven_day_demand, f.normalized_unit)} expected over 7 days`].filter(Boolean).join(' · ')
      );
      const out = rows.filter((f) => f.current_stock <= 0).length;
      if (out) a.lines.push(`${plural(out, 'product')} ${out === 1 ? 'is' : 'are'} already out of stock (not included above).`);
      if (unknownNote) a.warnings.push(unknownNote);
      a.followUps = [SUGGESTIONS.reorder, SUGGESTIONS.outOfStock, SUGGESTIONS.lowConfidence];
      return a;
    }
    case 'reorder': {
      const list = rows
        .filter((f) => finite(f.recommended_reorder_quantity) && f.recommended_reorder_quantity > 0)
        .sort((x, y) => (x.current_stock <= 0 ? -1 : 0) - (y.current_stock <= 0 ? -1 : 0) || byDays(x, y));
      const a = listAnswer(
        'Reorder suggestions',
        list,
        'No reorder is suggested from current stock and recorded sales.',
        `Suggested quantities to cover a ${ASSISTANT_LEAD_TIME_DAYS}-day supplier lead time plus safety stock:`,
        (f) => [`suggested ${qty(f.recommended_reorder_quantity, f.normalized_unit)}`, `${qty(f.current_stock, f.normalized_unit)} in stock`, f.current_stock <= 0 ? 'out of stock' : daysLeft(f), f.is_reorder_provisional && 'provisional'].filter(Boolean).join(' · ')
      );
      if (list.length) {
        a.warnings.unshift(`These quantities are advisory, not orders. They assume a ${ASSISTANT_LEAD_TIME_DAYS}-day lead time; check them against your supplier, budget and shelf space.`);
        const prov = list.filter((f) => f.is_reorder_provisional).length;
        if (prov) a.warnings.push(`${plural(prov, 'suggestion')} ${prov === 1 ? 'is' : 'are'} provisional because no safety stock is configured for ${prov === 1 ? 'that product' : 'those products'}.`);
      }
      a.followUps = [SUGGESTIONS.runout, SUGGESTIONS.lowStock, SUGGESTIONS.lowConfidence];
      return a;
    }
    case 'high_risk': {
      const list = rows
        .filter((f) => ['OUT OF STOCK', 'CRITICAL'].includes(getStockoutSeverity(f).severity))
        .sort((x, y) => getStockoutSeverity(x).priorityOrder - getStockoutSeverity(y).priorityOrder || byDays(x, y));
      const a = listAnswer(
        'High stockout risk',
        list,
        'No product is out of stock or projected to run out within 3 days.',
        'Out of stock, or projected to run out within 3 days:',
        (f) => (f.current_stock <= 0 ? 'out of stock' : [daysLeft(f), `${qty(f.current_stock, f.normalized_unit)} in stock`].filter(Boolean).join(' · '))
      );
      if (unknownNote) a.warnings.push(unknownNote);
      a.followUps = [SUGGESTIONS.reorder, SUGGESTIONS.runout];
      return a;
    }
    case 'low_confidence': {
      const list = rows.filter(isLowConfidence).sort((x, y) => x.product_name.localeCompare(y.product_name));
      const a = listAnswer(
        'Low-confidence forecasts',
        list,
        'All forecasts have medium or high confidence.',
        'These estimates rest on little or no sales history:',
        (f) => `${plural(f.total_valid_sales, 'sale')} over ${plural(f.observable_days, 'day')}`
      );
      a.followUps = [SUGGESTIONS.noHistory, SUGGESTIONS.runout];
      return a;
    }
    case 'insufficient_history': {
      const list = rows
        .filter((f) => f.forecast_tier !== 'TIER_1_SUFFICIENT' || ['INSUFFICIENT_HISTORY', 'NEW_PRODUCT_NO_SALES_HISTORY'].includes(f.forecast_status))
        .sort((x, y) => x.forecast_tier.localeCompare(y.forecast_tier) || x.product_name.localeCompare(y.product_name));
      const a = listAnswer(
        'Limited sales history',
        list,
        'Every product has enough sales history for a Tier 1 forecast.',
        'Products whose forecast uses sparse history (Tier 2) or has no sales yet (Tier 3):',
        (f) => getForecastStatusLabel(f.forecast_status)
      );
      a.followUps = [SUGGESTIONS.lowConfidence, SUGGESTIONS.forecastOverview];
      return a;
    }
    case 'product': {
      const query = intent.productQuery?.trim() ?? '';
      if (!query) {
        return base('clarify', 'Which product?', { lines: ['Name the product, for example: "explain the forecast for sugar".'], followUps: [SUGGESTIONS.runout] });
      }
      const matches = findProduct(rows, query);
      if (matches.length === 0) {
        return base('empty', 'Product not found', {
          lines: [`No product matching "${query}" was found in this shop's forecast.`],
          warnings, source, followUps: [SUGGESTIONS.forecastOverview, SUGGESTIONS.runout],
        });
      }
      if (matches.length > 1) {
        return base('clarify', 'Which product?', {
          lines: [`${plural(matches.length, 'product')} match "${query}". Choose one:`],
          followUps: matches.slice(0, 6).map((f) => s(`product-${f.product_id}`, f.product_name, { category: 'FORECAST', topic: 'product', productQuery: f.product_name })),
        });
      }
      return formatProductForecast(matches[0], d, warnings);
    }
  }
}

// ------------------------------------------------------------------------------ business summary

const CARD_TONE: Record<AiInsightCard['type'], AnswerTone> = { critical: 'critical', warning: 'warning', positive: 'positive', info: 'neutral' };
const CARD_ORDER: Record<AiInsightCard['type'], number> = { critical: 0, warning: 1, info: 2, positive: 3 };
const SOURCE_NAME: Record<string, string> = { summary: 'shop insights', sales: "today's sales", forecast: 'demand forecast', inventory: 'inventory' };

function formatSummary(intent: Extract<AssistantIntent, { category: 'BUSINESS_SUMMARY' }>, d: Extract<AssistantData, { kind: 'summary' }>): AssistantAnswer {
  const warnings: string[] = [];
  for (const f of d.failures) warnings.push(`Could not load ${SOURCE_NAME[f.source] ?? f.source}: ${f.message} This answer is partial.`);
  for (const part of [d.aiSummary, d.salesToday, d.forecast]) if (part) warnings.push(...gapWarnings(part.gaps));
  if (d.aiSummary && !d.aiSummary.data.has_sufficient_data && d.aiSummary.data.note) warnings.push(d.aiSummary.data.note);

  const cards = [...(d.aiSummary?.data.insights ?? [])].sort((a, b) => CARD_ORDER[a.type] - CARD_ORDER[b.type]);
  const forecasts = d.forecast?.data.forecasts ?? [];
  const runout = forecasts
    .filter((f) => f.current_stock > 0 && finite(f.days_to_stockout) && f.days_to_stockout <= 7)
    .sort((x, y) => (x.days_to_stockout ?? 0) - (y.days_to_stockout ?? 0));
  const sources = [
    d.aiSummary && 'shop insights (sales over the last 7 days and current stock)',
    d.salesToday && "today's sales",
    d.forecast && 'demand forecast',
  ].filter(Boolean);
  const source = `Based on ${sources.join(', ')}`;

  if (intent.topic === 'summary') {
    const a = base('answer', 'Business summary', { warnings, source });
    if (d.aiSummary?.data.overall_business_health) a.lines.push(`Overall: ${d.aiSummary.data.overall_business_health}.`);
    if (d.salesToday) {
      const o = d.salesToday.data.overview;
      a.lines.push(o.transaction_count === 0
        ? 'Today (UTC day so far): no sales recorded yet.'
        : `Today (UTC day so far): ${money(o.total_sales)} from ${plural(o.transaction_count, 'transaction')}.`);
    }
    if (d.forecast) {
      const f = d.forecast.data;
      const n = (v: number) => (finite(v) ? v.toLocaleString('en-IN') : '—');
      a.lines.push(`Forecast: ${n(f.at_risk_stockout_7d_count)} product(s) may run out within 7 days; ${n(f.out_of_stock_count)} already out of stock.`);
    }
    cards.slice(0, 5).forEach((c) => a.items.push({ primary: c.title, secondary: c.message, tone: CARD_TONE[c.type] }));
    a.followUps = [SUGGESTIONS.attention, SUGGESTIONS.actions, SUGGESTIONS.salesWeek];
    return a;
  }

  if (intent.topic === 'attention') {
    const urgent = cards.filter((c) => c.type === 'critical' || c.type === 'warning');
    const a = base('answer', 'Needs your attention', { warnings, source });
    urgent.forEach((c) => a.items.push({ primary: c.title, secondary: c.message, tone: CARD_TONE[c.type] }));
    runout.slice(0, 5).forEach((f) => a.items.push(forecastItem(f, daysLeft(f) ?? '')));
    if (!a.items.length) {
      a.kind = 'empty';
      a.lines.push('Nothing needs urgent attention based on the data that loaded.');
    } else {
      a.warnings.push(...lowConfidenceWarning(runout.slice(0, 5)));
    }
    a.followUps = [SUGGESTIONS.actions, SUGGESTIONS.reorder, SUGGESTIONS.outOfStock];
    return a;
  }

  // actions
  const a = base('answer', 'Suggested actions for today', { warnings, source });
  cards
    .filter((c) => c.suggested_action && c.type !== 'positive')
    .forEach((c) => a.items.push({ primary: c.suggested_action as string, secondary: c.title, tone: CARD_TONE[c.type] }));
  runout.slice(0, 5).forEach((f) =>
    a.items.push(forecastItem(f, `check stock: ${daysLeft(f)}${finite(f.recommended_reorder_quantity) && f.recommended_reorder_quantity > 0 ? ` · suggested reorder ${qty(f.recommended_reorder_quantity, f.normalized_unit)}` : ''}`))
  );
  if (!a.items.length) {
    a.kind = 'empty';
    a.lines.push('No actions are suggested from the current data.');
  } else {
    a.lines.push('Suggestions drawn from your records; they are advisory, so use your judgement.');
    a.warnings.push(...lowConfidenceWarning(runout.slice(0, 5)));
  }
  a.followUps = [SUGGESTIONS.reorder, SUGGESTIONS.attention, SUGGESTIONS.salesToday];
  return a;
}

// ------------------------------------------------------------------------------ entry points

/** Format fetched data for an intent. */
export function formatAnswer(intent: AssistantIntent, data: AssistantData): AssistantAnswer {
  if (intent.category === 'SALES' && data.kind === 'sales') return formatSales(intent, data.sales);
  if (intent.category === 'INVENTORY' && data.kind === 'inventory') return formatInventory(intent, data.inventory);
  if (intent.category === 'FORECAST' && data.kind === 'forecast') return formatForecast(intent, data.forecast);
  if (intent.category === 'BUSINESS_SUMMARY' && data.kind === 'summary') return formatSummary(intent, data);
  throw new Error('Intent and data do not match.');
}

const ERROR_TITLE: Record<AssistantDataError['kind'], string> = {
  unauthorized: 'Sign-in required',
  forbidden: 'Access restricted',
  no_shop: 'No active shop',
  not_found: 'Not found',
  validation: 'Request not accepted',
  offline: 'Server unreachable',
  server: 'Could not load data',
  malformed: 'Unexpected response',
};

export function formatError(err: AssistantDataError): AssistantAnswer {
  return base(err.kind === 'forbidden' ? 'restricted' : 'error', ERROR_TITLE[err.kind], {
    lines: [err.message, ...(err.retryable ? ['No figures are shown because the data could not be loaded.'] : [])],
    retryable: err.retryable,
  });
}

export function restrictedAnswer(): AssistantAnswer {
  return base('restricted', 'Access restricted', {
    lines: [
      'Sales, inventory analytics and forecasts are available to shop owners and managers.',
      'Your role does not include business analytics, so no shop figures are shown here. Billing and stock lookup remain available from the menu.',
    ],
  });
}

export function helpAnswer(): AssistantAnswer {
  return base('help', 'Questions I can answer from your shop data', {
    lines: [
      'Sales: totals for today or the last 7/30/90 days, top sellers, daily trend, comparisons.',
      'Inventory: out of stock, low stock, products needing attention, inventory summary.',
      'Forecast: what may run out in 7 days, reorder suggestions, stockout risk, confidence, one product’s forecast.',
      'Business: a summary, what needs attention, suggested actions for today.',
    ],
    followUps: [SUGGESTIONS.summary, SUGGESTIONS.salesToday, SUGGESTIONS.runout, SUGGESTIONS.outOfStock],
  });
}

const CATEGORY_NAME: Record<string, string> = { SALES: 'sales', INVENTORY: 'current stock', FORECAST: 'forecast', BUSINESS_SUMMARY: 'business summary' };

/** Suggestion chip for an intent, used when asking the user to pick between readings of a question. */
export function suggestionForIntent(intent: AssistantIntent): AssistantSuggestion {
  const all = Object.values(SUGGESTIONS);
  const same = all.find((x) => JSON.stringify(x.intent) === JSON.stringify(intent));
  if (same) return same;
  const sameTopic = all.find((x) => x.intent.category === intent.category && 'topic' in x.intent && 'topic' in intent && x.intent.topic === intent.topic);
  if (sameTopic) return { ...sameTopic, intent };
  return s(`opt-${intent.category}`, `Show ${CATEGORY_NAME[intent.category] ?? 'data'}`, intent);
}

export function clarifyAnswer(options: AssistantIntent[]): AssistantAnswer {
  return base('clarify', 'Which did you mean?', {
    lines: ['Your question could mean more than one thing. Choose one:'],
    followUps: options.map(suggestionForIntent),
  });
}
