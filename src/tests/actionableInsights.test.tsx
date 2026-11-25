/**
 * Stage 7.5: proactive insights UI (Action Center + dashboard Priority actions).
 * Priorities and figures come only from the API response; the UI never re-ranks or invents values.
 * Generic test values only.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
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

import type { ActionableInsight, ActionableInsightsData } from '../api/insights';
import { ActionableInsightsView, InsightCard } from '../components/ActionableInsightsSection';
import { PriorityActionsList } from '../components/dashboard/PriorityActionsCard';
import { Insights } from '../pages/Insights';
import { clearRequestedInsightsTab, requestInsightsTab } from '../utils/insightsTab';
import { AuthContext } from '../context/authContextDef';
import type { AuthContextType } from '../context/AuthContext';
import type { UserRole } from '../types/user';
import { LanguageProvider } from '../i18n/LanguageContext';
import { filterInsights, PRIORITY_ORDER, topPriorityActions } from '../utils/actionableInsights';

const insight = (over: Partial<ActionableInsight>): ActionableInsight => ({
  id: 'x', type: 'below_minimum_stock', category: 'LOW_STOCK', priority: 'MEDIUM', title: 'T', description: 'D',
  evidence: [], product_id: null, product_name: null, unit: null, current_value: null, threshold_value: null,
  observation_start: null, observation_end: null, data_quality: 'HIGH', suggested_action: null, is_actionable: true, ...over,
});

const INSIGHTS: ActionableInsight[] = [
  insight({
    id: 'out_of_stock_with_demand:r', type: 'out_of_stock_with_demand', category: 'INVENTORY_RISK', priority: 'CRITICAL',
    title: 'Rice is out of stock', description: 'Rice has no stock left and sold 2 kg in the last 30 days.', product_name: 'Rice',
    evidence: [
      { label: 'Current stock', value: '0 kg', source: 'OBSERVED' },
      { label: 'Minimum stock level', value: '5 kg', source: 'CONFIGURED' },
    ],
    observation_start: '26 Oct 2026 10:00 UTC', observation_end: '25 Nov 2026 10:00 UTC', data_quality: 'LOW',
    suggested_action: 'Restock Rice.',
  }),
  insight({
    id: 'stockout_within_7_days:m', type: 'stockout_within_7_days', category: 'INVENTORY_RISK', priority: 'HIGH',
    title: 'Milk may run out within 7 days', product_name: 'Milk',
    evidence: [{ label: 'Projected stock cover', value: '5.7 days', source: 'FORECAST' }], data_quality: 'MEDIUM',
  }),
  insight({ id: 'below_minimum_stock:j', title: 'Jam is below its minimum stock level', product_name: 'Jam' }),
  insight({ id: 'sales_increase:shop', type: 'sales_increase', category: 'SALES_TREND', priority: 'LOW', title: 'Sales are up 30%', is_actionable: false }),
  insight({ id: 'too_new_to_assess:shop', type: 'too_new_to_assess', category: 'DATA_QUALITY', priority: 'INFO', title: '1 product too new', is_actionable: false, data_quality: 'INSUFFICIENT' }),
];

const DATA: ActionableInsightsData = {
  generated_at: '2026-11-25T10:00:00+00:00',
  counts_by_priority: { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1, INFO: 1 },
  counts_by_category: { INVENTORY_RISK: 2, LOW_STOCK: 1, SALES_TREND: 1, FAST_MOVING: 0, SLOW_MOVING: 0, INVENTORY_OPPORTUNITY: 0, DATA_QUALITY: 1 },
  total: 5,
  insights: INSIGHTS,
  summary: {
    period_start: '2026-11-25T00:00:00+00:00', period_end: '2026-11-25T10:00:00+00:00',
    today_sales: 1250.5, today_transactions: 4, products_sold_today: 3,
    same_time_yesterday_sales: 900, same_time_yesterday_transactions: 3,
    out_of_stock_count: 1, below_minimum_count: 1, forecast_stockout_risk_count: null,
    highlights: ['Rice is out of stock'], data_notes: ['Sales trend not assessed: each 7-day period needs at least 5 transactions.'],
    has_sales_history: true,
  },
  thresholds: { lead_time_days: 3 },
};

const view = (props: Partial<React.ComponentProps<typeof ActionableInsightsView>> = {}) =>
  renderToStaticMarkup(<ActionableInsightsView data={DATA} loading={false} error={null} onRetry={vi.fn()} {...props} />);

describe('1. helpers keep backend priority order', () => {
  it('filters without re-ranking', () => {
    expect(filterInsights(INSIGHTS).map((i) => i.priority)).toEqual(PRIORITY_ORDER);
    expect(filterInsights(INSIGHTS, 'ALL', 'INVENTORY_RISK').map((i) => i.id)).toEqual(['out_of_stock_with_demand:r', 'stockout_within_7_days:m']);
    expect(filterInsights(INSIGHTS, 'LOW').map((i) => i.id)).toEqual(['sales_increase:shop']);
  });
  it('dashboard shows only actionable CRITICAL/HIGH/MEDIUM, capped', () => {
    expect(topPriorityActions(INSIGHTS).map((i) => i.priority)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM']);
    expect(topPriorityActions(INSIGHTS, 1)).toHaveLength(1);
  });
});

describe('2. Action Center view', () => {
  it('renders the summary from API values, missing forecast shown as unavailable', () => {
    const html = view();
    expect(html).toContain('Today at a glance');
    expect(html).toContain('₹1,250.50');
    expect(html).toContain('4 transactions · 3 products');
    expect(html).toContain('₹900.00');
    expect(html).toContain('Forecast unavailable');
    expect(html).toContain('Sales trend not assessed');
    expect(html).toContain('25 Nov 2026 00:00 UTC');
  });

  it('renders priority filters with backend counts and every insight in order', () => {
    const html = view();
    expect(html).toContain('All (5)');
    expect(html).toContain('Critical (1)');
    const order = [...html.matchAll(/data-priority="([A-Z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
    expect(html).toContain('Stockout risk (2)'); // categories with insights only
    expect(html).not.toContain('Fast-moving (0)');
  });

  it('insight card shows evidence with its source, period, quality and advisory action', () => {
    const html = renderToStaticMarkup(<InsightCard insight={INSIGHTS[0]} />);
    expect(html).toContain('Critical');
    expect(html).toContain('Current stock');
    expect(html).toContain('Recorded');
    expect(html).toContain('Your setting');
    expect(html).toContain('Period: 26 Oct 2026 10:00 UTC – 25 Nov 2026 10:00 UTC');
    expect(html).toContain('Limited evidence');
    expect(html).toContain('Suggested action (advisory)');
    expect(renderToStaticMarkup(<InsightCard insight={INSIGHTS[1]} />)).toContain('Forecast');
    expect(renderToStaticMarkup(<InsightCard insight={INSIGHTS[3]} />)).not.toContain('Suggested action');
  });

  it('error state: message and retry, no figures', () => {
    const html = view({ data: null, error: { title: 'Could not load insights', message: 'Server error.', retryable: true } });
    expect(html).toContain('data-testid="actions-error"');
    expect(html).toContain('Try again');
    expect(html).not.toMatch(/₹\s?\d/);
    expect(view({ data: null, error: { title: 'Access restricted', message: 'No access.', retryable: false } })).not.toContain('Try again');
  });

  it('loading and empty states', () => {
    expect(view({ data: null, loading: true })).toContain('data-testid="actions-loading"');
    const empty = { ...DATA, insights: [], total: 0, counts_by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } };
    expect(view({ data: empty })).toContain('No insights yet.');
  });

  it('says when the list is truncated', () => {
    expect(view({ data: { ...DATA, total: 250 } })).toContain('Showing the 5 highest-priority of 250 insights.');
  });
});

function auth(role: UserRole): AuthContextType {
  const profile: any = { uid: 'u', email: 'u@example.com', displayName: 'U', shopName: 'S', role, theme: 'light', language: 'en', createdAt: '', lastLogin: '' };
  return { firebaseUser: { uid: 'u' } as any, userProfile: profile, user: profile, loading: false, error: null } as unknown as AuthContextType;
}

describe('3. page integration', () => {
  const tabsOf = (html: string) =>
    [...html.matchAll(/role="tab" aria-selected="(true|false)"[^>]*>.*?<span>([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
  const renderInsights = () =>
    renderToStaticMarkup(<LanguageProvider><AuthContext.Provider value={auth('owner')}><Insights /></AuthContext.Provider></LanguageProvider>);

  it('Insights page: Action Center is the first tab; Sales stays the default; other tabs kept', () => {
    const tabs = tabsOf(renderInsights());
    expect(tabs.map((t) => t[0])).toEqual(['Action Center', 'Sales Insights', 'Inventory Insights', 'Demand Forecast', 'AI Intelligence']);
    expect(tabs.find((t) => t[1] === 'true')?.[0]).toBe('Sales Insights');
  });

  it('the dashboard link opens the Action Center; the request is cleared after the visit', () => {
    requestInsightsTab('actions');
    expect(tabsOf(renderInsights()).find((t) => t[1] === 'true')?.[0]).toBe('Action Center');
    clearRequestedInsightsTab(); // what the page does after mounting (effects do not run in SSR)
    expect(tabsOf(renderInsights()).find((t) => t[1] === 'true')?.[0]).toBe('Sales Insights');
  });

  it('cashier still sees the restricted Insights page, without the Action Center', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider><AuthContext.Provider value={auth('cashier')}><Insights /></AuthContext.Provider></LanguageProvider>
    );
    expect(html).toContain('Access Restricted');
    expect(html).not.toContain('Action Center');
  });

  it('dashboard Priority actions card: items, empty, error with retry', () => {
    const render = (p: Partial<React.ComponentProps<typeof PriorityActionsList>>) =>
      renderToStaticMarkup(
        <LanguageProvider>
          <PriorityActionsList items={null} failed={false} loading={false} onRetry={vi.fn()} onViewAll={vi.fn()} {...p} />
        </LanguageProvider>
      );
    const html = render({ items: topPriorityActions(INSIGHTS) });
    expect(html).toContain('Priority actions');
    expect(html).toContain('Rice is out of stock');
    expect(html).toContain('Current stock: 0 kg');
    expect(html).toContain('View all in Action Center');
    expect(render({ items: [] })).toContain('No urgent actions right now.');
    const err = render({ failed: true });
    expect(err).toContain('Could not load priority actions.');
    expect(err).toContain('Retry');
  });

  it('dashboard shows the card only for analytics roles; no hardcoded insight figures in the UI', () => {
    const dash = readFileSync(resolve(__dirname, '../pages/Dashboard.tsx'), 'utf8');
    expect(dash).toMatch(/\{canAccessAnalytics && <PriorityActionsCard/);
    const ui = ['../components/ActionableInsightsSection.tsx', '../components/dashboard/PriorityActionsCard.tsx', '../utils/actionableInsights.ts']
      .map((f) => readFileSync(resolve(__dirname, f), 'utf8'))
      .join('\n');
    expect(ui).not.toMatch(/₹\s?\d|Math\.random|setTimeout/);
    expect(ui).toMatch(/getActionableInsights\(\{ limit: 200 \}\)/);
  });
});
