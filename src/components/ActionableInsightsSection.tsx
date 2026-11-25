/**
 * Action Center (Insights page): prioritized, evidence-backed insights from GET /insights/actionable.
 * Everything shown comes from the response; a failed request shows an error with retry, never figures.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, Database, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card } from './Card';
import {
  insightsApi,
  type ActionableInsight,
  type ActionableInsightsData,
  type InsightCategory,
} from '../api/insights';
import { classifyAssistantError } from '../utils/assistant/data';
import { formatCurrency } from '../utils/formatCurrency';
import {
  CATEGORY_LABEL,
  PRIORITY_META,
  PRIORITY_ORDER,
  QUALITY_LABEL,
  SOURCE_CLASS,
  SOURCE_LABEL,
  filterInsights,
  type CategoryFilter,
  type PriorityFilter,
} from '../utils/actionableInsights';

const UTC_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

function utcLabel(iso: string): string {
  const d = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? '' : `${UTC_TIME.format(d).replace(',', '')} UTC`;
}

export const InsightCard: React.FC<{ insight: ActionableInsight }> = ({ insight }) => {
  const meta = PRIORITY_META[insight.priority];
  return (
    <article
      data-testid="insight-card"
      data-priority={insight.priority}
      className={`p-4 rounded-2xl bg-white border border-[#DDE9DF] border-l-4 ${meta.borderClass} shadow-xs min-w-0`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${meta.badgeClass}`}>
          {meta.label}
        </span>
        <span className="text-[11px] font-bold text-[#5E6C64]">{CATEGORY_LABEL[insight.category]}</span>
        <span className="text-[10px] font-semibold text-[#5E6C64] ml-auto">{QUALITY_LABEL[insight.data_quality]}</span>
      </div>
      <h4 className="font-extrabold text-[#153D32] text-sm break-words">{insight.title}</h4>
      <p className="text-xs text-[#252D29] leading-relaxed mt-1 break-words">{insight.description}</p>

      {insight.evidence.length > 0 && (
        <dl className="mt-3 pt-2.5 border-t border-[#DDE9DF]/70 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5" data-testid="insight-evidence">
          {insight.evidence.map((e, idx) => (
            <div key={idx} className="min-w-0">
              <dt className="text-[10px] font-bold text-[#5E6C64] flex items-center gap-1.5 flex-wrap">
                <span className="break-words">{e.label}</span>
                <span className={`px-1.5 rounded text-[9px] font-extrabold ${SOURCE_CLASS[e.source]}`}>{SOURCE_LABEL[e.source]}</span>
              </dt>
              <dd className="text-xs font-semibold text-[#153D32] break-words">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(insight.observation_start || insight.observation_end) && (
        <p className="mt-2 text-[10px] text-[#5E6C64]">
          Period: {insight.observation_start} – {insight.observation_end}
        </p>
      )}

      {insight.suggested_action && (
        <div className="mt-3 p-2.5 rounded-xl bg-[#FAF8F2] border border-[#DDE9DF]">
          <p className="text-[10px] font-extrabold text-[#5E6C64] uppercase tracking-wider">Suggested action (advisory)</p>
          <p className="text-xs font-semibold text-[#153D32] mt-0.5 break-words">{insight.suggested_action}</p>
        </div>
      )}
    </article>
  );
};

interface ViewProps {
  data: ActionableInsightsData | null;
  loading: boolean;
  error: { title: string; message: string; retryable: boolean } | null;
  onRetry: () => void;
}

/** Presentational view (exported for tests). */
export const ActionableInsightsView: React.FC<ViewProps> = ({ data, loading, error, onRetry }) => {
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [category, setCategory] = useState<CategoryFilter>('ALL');

  if (loading && !data) {
    return (
      <Card>
        <div className="py-10 flex items-center justify-center gap-2 text-xs font-semibold text-[#5E6C64]" data-testid="actions-loading">
          <RefreshCw className="w-4 h-4 animate-spin text-[#23866A]" aria-hidden="true" />
          <span>Checking your shop data…</span>
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <div role="alert" className="p-5 rounded-2xl bg-[#FDF1EF] border border-[#EF806D]/40 text-center space-y-2" data-testid="actions-error">
        <AlertTriangle className="w-6 h-6 text-[#B93838] mx-auto" aria-hidden="true" />
        <h3 className="font-extrabold text-[#B93838] text-sm">{error.title}</h3>
        <p className="text-xs text-[#5E6C64]">{error.message} No insights are shown because the data could not be loaded.</p>
        {error.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#153D32] hover:bg-[#0F2D25] text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const s = data.summary;
  const shown = filterInsights(data.insights, priority, category);
  const totalAll = PRIORITY_ORDER.reduce((n, p) => n + (data.counts_by_priority[p] ?? 0), 0);
  const categories = (Object.keys(CATEGORY_LABEL) as InsightCategory[]).filter((c) => (data.counts_by_category[c] ?? 0) > 0);

  return (
    <div className="space-y-5" data-testid="action-center">
      {/* Daily summary */}
      <Card className="border border-[#23866A]/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#DDE9DF]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#153D32] flex items-center justify-center text-white shrink-0">
              <ClipboardList className="w-4 h-4 text-[#B9E5D0]" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-extrabold text-[#153D32] text-base">Today at a glance</h3>
              <p className="text-xs text-[#5E6C64]">UTC day so far: {utcLabel(s.period_start)} – {utcLabel(s.period_end)}</p>
            </div>
          </div>
          <p className="text-[11px] text-[#5E6C64] flex items-center gap-1">
            <Database className="w-3.5 h-3.5" aria-hidden="true" />
            Generated {utcLabel(data.generated_at)}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3" data-testid="actions-summary">
          <div>
            <p className="text-[10px] font-bold text-[#5E6C64] uppercase">Sales today</p>
            <p className="text-lg font-extrabold text-[#153D32]">{formatCurrency(s.today_sales)}</p>
            <p className="text-[11px] text-[#5E6C64]">
              {s.today_transactions} transaction{s.today_transactions === 1 ? '' : 's'} · {s.products_sold_today} product{s.products_sold_today === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#5E6C64] uppercase">Same time yesterday</p>
            <p className="text-lg font-extrabold text-[#153D32]">{formatCurrency(s.same_time_yesterday_sales)}</p>
            <p className="text-[11px] text-[#5E6C64]">
              {s.same_time_yesterday_transactions} transaction{s.same_time_yesterday_transactions === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#5E6C64] uppercase">Stock</p>
            <p className="text-lg font-extrabold text-[#153D32]">{s.out_of_stock_count} out</p>
            <p className="text-[11px] text-[#5E6C64]">{s.below_minimum_count} below minimum level</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#5E6C64] uppercase">Forecast risk (7 days)</p>
            <p className="text-lg font-extrabold text-[#153D32]">
              {s.forecast_stockout_risk_count === null ? '—' : s.forecast_stockout_risk_count}
            </p>
            <p className="text-[11px] text-[#5E6C64]">
              {s.forecast_stockout_risk_count === null ? 'Forecast unavailable' : 'products may run out'}
            </p>
          </div>
        </div>

        <ul className="mt-3 space-y-1" data-testid="actions-highlights">
          {s.highlights.map((h, i) => (
            <li key={i} className="text-xs font-semibold text-[#153D32] flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#23866A] shrink-0 mt-0.5" aria-hidden="true" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
        {s.data_notes.length > 0 && (
          <div className="mt-3 p-2.5 rounded-xl bg-[#FEF9EB] border border-[#D6AE62]/40 space-y-1" data-testid="actions-data-notes">
            {s.data_notes.map((n, i) => (
              <p key={i} className="text-[11px] text-[#7A5A1C] flex gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{n}</span>
              </p>
            ))}
          </div>
        )}
      </Card>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by priority">
          {(['ALL', ...PRIORITY_ORDER] as PriorityFilter[]).map((p) => {
            const count = p === 'ALL' ? totalAll : data.counts_by_priority[p] ?? 0;
            const active = priority === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => setPriority(p)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold border transition-colors cursor-pointer min-h-[32px] ${
                  active ? 'bg-[#153D32] text-[#FAF8F2] border-[#153D32]' : 'bg-white text-[#153D32] border-[#DDE9DF] hover:bg-[#FAF8F2]'
                }`}
              >
                {p === 'ALL' ? 'All' : PRIORITY_META[p].label} ({count})
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-[#5E6C64]">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            className="px-2 py-1.5 rounded-lg border border-[#DDE9DF] bg-white text-xs text-[#153D32] font-semibold"
          >
            <option value="ALL">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]} ({data.counts_by_category[c]})</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#B93838] font-semibold">
          Refresh failed: {error.message} Showing the last loaded results.
        </p>
      )}

      {/* Insights */}
      {shown.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="actions-list">
          {shown.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      ) : (
        <div className="py-10 text-center text-xs text-[#5E6C64]" data-testid="actions-empty">
          {totalAll === 0 ? 'No insights yet. They appear as products and sales are recorded.' : 'No insights match this filter.'}
        </div>
      )}
      {data.total > data.insights.length && (
        <p className="text-[11px] text-[#5E6C64]">
          Showing the {data.insights.length} highest-priority of {data.total} insights.
        </p>
      )}
      <p className="text-[11px] text-[#5E6C64]">
        Computed from your shop&apos;s sales, stock and demand forecast with fixed rules. &quot;Recorded&quot; values are history,
        &quot;Forecast&quot; values are estimates. Suggestions are advisory; nothing is ordered or changed automatically.
      </p>
    </div>
  );
};

interface SectionProps {
  /** Bumped by the page's refresh button. */
  refreshSignal?: number;
}

export const ActionableInsightsSection: React.FC<SectionProps> = ({ refreshSignal = 0 }) => {
  const [data, setData] = useState<ActionableInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ViewProps['error']>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    insightsApi
      .getActionableInsights({ limit: 200 })
      .then((res) => {
        if (!active) return;
        if (!res || !Array.isArray(res.insights) || !res.summary) throw new Error('Unexpected response');
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const malformed = err instanceof Error && err.message === 'Unexpected response';
        const e = classifyAssistantError(err, 'summary');
        setError({
          title: malformed ? 'Unexpected response' : e.kind === 'forbidden' ? 'Access restricted' : 'Could not load insights',
          message: malformed ? 'The server returned data in an unexpected format.' : e.message,
          retryable: malformed || e.retryable,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshSignal, reloadKey]);

  const retry = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return <ActionableInsightsView data={data} loading={loading} error={error} onRetry={retry} />;
};
