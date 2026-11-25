/**
 * Dashboard: the most urgent actionable insights (Stage 7.5), from the same endpoint and in the same
 * priority order as the Insights page Action Center. Shown to owners and managers only.
 */
import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ClipboardList, RefreshCw } from 'lucide-react';
import { Card } from '../Card';
import { insightsApi, type ActionableInsight } from '../../api/insights';
import { useLanguage } from '../../i18n/LanguageContext';
import { PRIORITY_META, topPriorityActions } from '../../utils/actionableInsights';
import type { PageRoute } from '../../types';
import { requestInsightsTab } from '../../utils/insightsTab';

interface ListProps {
  items: ActionableInsight[] | null;
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
  onViewAll: () => void;
}

/** Presentational part (exported for tests). */
export const PriorityActionsList: React.FC<ListProps> = ({ items, failed, loading, onRetry, onViewAll }) => {
  const { t } = useLanguage();
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#DDE9DF]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#153D32] flex items-center justify-center shrink-0">
            <ClipboardList className="w-4 h-4 text-[#B9E5D0]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="font-extrabold text-[#153D32] text-sm sm:text-base truncate">{t('dashboard.priorityActions')}</h3>
            <p className="text-[11px] text-[#5E6C64] truncate">{t('dashboard.priorityActionsNote')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-bold text-[#23866A] hover:text-[#153D32] flex items-center gap-1 shrink-0 cursor-pointer min-h-[36px]"
        >
          <span className="hidden sm:inline">{t('dashboard.viewAllActions')}</span>
          <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only sm:hidden">{t('dashboard.viewAllActions')}</span>
        </button>
      </div>

      <div className="pt-3" data-testid="priority-actions">
        {loading && !items ? (
          <p className="text-xs text-[#5E6C64] flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />…
          </p>
        ) : failed && !items ? (
          <div className="flex items-center justify-between gap-2 text-xs text-[#B93838] font-semibold" role="alert">
            <span>{t('dashboard.priorityActionsError')}</span>
            <button type="button" onClick={onRetry} className="px-2.5 py-1 rounded-lg bg-[#B93838] text-white font-bold cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">Retry</span>
            </button>
          </div>
        ) : items && items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((i) => {
              const meta = PRIORITY_META[i.priority];
              return (
                <li key={i.id} className="flex items-start gap-2.5 min-w-0" data-priority={i.priority}>
                  <span className={`mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase shrink-0 ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-[#153D32] break-words">{i.title}</p>
                    {i.evidence[0] && (
                      <p className="text-[11px] text-[#5E6C64] break-words">
                        {i.evidence[0].label}: {i.evidence[0].value}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-[#5E6C64]">{t('dashboard.priorityActionsEmpty')}</p>
        )}
      </div>
    </Card>
  );
};

export const PriorityActionsCard: React.FC<{ setActivePage: (page: PageRoute) => void }> = ({ setActivePage }) => {
  const [items, setItems] = useState<ActionableInsight[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    insightsApi
      .getActionableInsights({ limit: 200 })
      .then((res) => {
        if (!active) return;
        if (!res || !Array.isArray(res.insights)) throw new Error('Unexpected response');
        setItems(topPriorityActions(res.insights, 4));
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <PriorityActionsList
      items={items}
      failed={failed}
      loading={loading}
      onRetry={() => {
        setLoading(true);
        setReloadKey((k) => k + 1);
      }}
      onViewAll={() => {
        requestInsightsTab('actions');
        setActivePage('insights');
      }}
    />
  );
};
