import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Package,
  RefreshCw,
  ArrowUpRight,
  Check,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Product, PageRoute } from '../../types';
import type { ProductForecast } from '../../types/forecast';

interface AttentionCardProps {
  forecastItems?: ProductForecast[];
  lowStockItems?: Product[]; // Backward compatibility fallback
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => Promise<void> | void;
  onRestock: (productId: string, quantity: number) => Promise<void> | void;
  setActivePage: (page: PageRoute) => void;
}

export const AttentionCard: React.FC<AttentionCardProps> = ({
  forecastItems,
  lowStockItems = [],
  loading = false,
  error = null,
  onRefresh,
  onRestock,
  setActivePage,
}) => {
  const { t } = useLanguage();
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [recentlyRestocked, setRecentlyRestocked] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshClick = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRestockClick = async (productId: string, quantity: number) => {
    try {
      setRestockingId(productId);
      await onRestock(productId, quantity);
      setRecentlyRestocked((prev) => ({ ...prev, [productId]: true }));
      setTimeout(() => {
        setRecentlyRestocked((prev) => ({ ...prev, [productId]: false }));
      }, 2500);
    } catch (err) {
      console.error('Failed to restock item:', err);
    } finally {
      setRestockingId(null);
    }
  };

  // Filter items that genuinely need attention
  // Priority: OUT_OF_STOCK, HIGH risk, Stage 0 below reorder level, MEDIUM risk
  const attentionItems: ProductForecast[] = (forecastItems || []).filter((item) => {
    if (item.stockout_risk === 'OUT_OF_STOCK') return true;
    if (item.stockout_risk === 'HIGH') return true;
    if (
      item.confidence_status === 'INSUFFICIENT_DATA' &&
      item.reorder_level !== null &&
      item.current_stock <= item.reorder_level
    ) {
      return true;
    }
    if (item.stockout_risk === 'MEDIUM') return true;
    return false;
  });

  const count = forecastItems ? attentionItems.length : lowStockItems.length;

  // 1. Loading State
  if (loading && !forecastItems) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
              <span>{t('dashboard.needsAttention')}</span>
            </h2>
            <span className="text-[11px] font-extrabold text-slate-500 bg-slate-50 px-2.5 py-0.5 rounded-full border border-slate-200">
              Evaluating...
            </span>
          </div>

          <div className="py-8 text-center flex flex-col items-center justify-center">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 animate-pulse">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <p className="font-black text-slate-900 text-sm">Evaluating inventory demand...</p>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Calculating statistical sales velocity & stockout horizons
            </p>
          </div>
        </div>

        <button
          onClick={() => setActivePage('inventory')}
          className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 font-extrabold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
        >
          <span>{t('nav.stockCatalog')}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // 2. Error State
  if (error && (!forecastItems || forecastItems.length === 0)) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-rose-200 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-rose-100">
            <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              <span>{t('dashboard.needsAttention')}</span>
            </h2>
            <span className="text-[11px] font-extrabold text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
              Sync Error
            </span>
          </div>

          <div className="py-6 text-center flex flex-col items-center">
            <p className="text-xs text-slate-600 font-semibold max-w-xs">{error}</p>
            {onRefresh && (
              <button
                onClick={handleRefreshClick}
                disabled={isRefreshing}
                className="mt-3 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Retry Forecast</span>
              </button>
            )}
          </div>
        </div>

        <button
          onClick={() => setActivePage('inventory')}
          className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 font-extrabold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
        >
          <span>{t('nav.stockCatalog')}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // 3. Optimal State (Zero items needing urgent attention)
  if (count === 0) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>{t('dashboard.needsAttention')}</span>
            </h2>
            <div className="flex items-center gap-2">
              {onRefresh && (
                <button
                  onClick={handleRefreshClick}
                  disabled={isRefreshing}
                  title="Refresh AI demand forecasts"
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
              )}
              <span className="text-[11px] font-extrabold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Optimal
              </span>
            </div>
          </div>

          <div className="py-6 sm:py-8 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-black text-slate-900 text-sm sm:text-base">
              {t('dashboard.optimalStock')}
            </h3>
            <p className="text-xs text-slate-500 font-medium max-w-xs mt-1">
              All inventory items are adequately stocked based on recent customer demand.
            </p>
          </div>
        </div>

        <button
          onClick={() => setActivePage('inventory')}
          className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 font-extrabold text-xs rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1 cursor-pointer"
        >
          <span>{t('nav.stockCatalog')}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // 4. Attention Needed State
  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-amber-300/80 shadow-xs flex flex-col justify-between p-4 sm:p-5 h-full relative overflow-hidden">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-amber-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="font-black text-slate-900 text-sm sm:text-base leading-tight">
                {t('dashboard.needsAttention')}
              </h2>
              <p className="text-[11px] text-amber-900 font-bold">
                {count === 1 ? '1 item requires attention' : `${count} items require attention`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onRefresh && (
              <button
                onClick={handleRefreshClick}
                disabled={isRefreshing}
                title="Refresh forecasts"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-amber-50 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
              </button>
            )}
            <span className="text-xs font-black text-amber-900 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-300/80 shrink-0">
              {count} {t('dashboard.left')}
            </span>
          </div>
        </div>

        {/* Item Cards (Top 3) */}
        <div className="divide-y divide-slate-100 mt-2 space-y-2">
          {forecastItems && forecastItems.length > 0
            ? attentionItems.slice(0, 3).map((item) => {
                const isBusy = restockingId === item.product_id;
                const isDone = recentlyRestocked[item.product_id];
                const isStage0 =
                  item.confidence_status === 'INSUFFICIENT_DATA' ||
                  item.forecast_method === 'INSUFFICIENT_HISTORY';

                // Reorder quantity: strictly use backend data when supported
                // Under Stage 0, default to transparent reorder_level or 10 if user explicitly restocks
                const restockQty =
                  item.recommended_reorder_quantity && item.recommended_reorder_quantity > 0
                    ? item.recommended_reorder_quantity
                    : item.reorder_level && item.reorder_level > 0
                    ? item.reorder_level
                    : 10;

                return (
                  <div
                    key={item.product_id}
                    className="pt-2 first:pt-0 flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                          {item.product_name}
                        </p>

                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {isStage0 ? (
                            <>
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-200">
                                <Clock className="w-2.5 h-2.5 text-blue-600" />
                                Building History ({item.valid_history_days}/7d)
                              </span>
                              <span className="text-[10px] font-bold text-slate-700">
                                {item.current_stock} {item.unit} in stock
                              </span>
                              {item.reorder_level !== null && (
                                <span className="text-[10px] text-slate-400 font-semibold hidden xs:inline">
                                  Min Ref: {item.reorder_level}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {item.stockout_risk === 'OUT_OF_STOCK' ? (
                                <span className="inline-block text-[10px] font-black text-rose-800 bg-rose-50 px-1.5 py-0.5 rounded-md border border-rose-200">
                                  Out of Stock
                                </span>
                              ) : (
                                <span className="inline-block text-[10px] font-black text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200">
                                  {item.current_stock} {item.unit} left
                                </span>
                              )}

                              {item.days_until_stockout !== null && (
                                <span className="text-[10px] font-extrabold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  ~{item.days_until_stockout < 1 ? '<1' : item.days_until_stockout.toFixed(1)}d left
                                </span>
                              )}

                              <span className="text-[9px] font-black uppercase px-1 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                                {item.forecast_method === 'MOVING_AVERAGE_7' ? 'MA-7' : 'Weekday'}
                              </span>

                              {item.recommended_reorder_quantity !== null &&
                                item.recommended_reorder_quantity > 0 && (
                                  <span className="text-[10px] font-bold text-emerald-700 hidden sm:inline">
                                    Rec: +{item.recommended_reorder_quantity}
                                  </span>
                                )}

                              {item.has_stockout_censoring && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-800 bg-amber-100/70 px-1 py-0.5 rounded border border-amber-300"
                                  title="Zero-sales days during stockouts were censored from demand calculations"
                                >
                                  <AlertCircle className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                  Censored
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Restock Button requiring explicit user interaction */}
                    <button
                      onClick={() => handleRestockClick(item.product_id, restockQty)}
                      disabled={isBusy || isDone}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95 select-none ${
                        isDone
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : isBusy
                          ? 'bg-emerald-100 text-emerald-800 opacity-80 cursor-wait'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 hover:border-emerald-400'
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>...</span>
                        </>
                      ) : isDone ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('dashboard.restockedSuccess')}</span>
                        </>
                      ) : (
                        <span>
                          {item.recommended_reorder_quantity
                            ? `+${item.recommended_reorder_quantity}`
                            : `+${restockQty}`}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })
            : lowStockItems.slice(0, 3).map((item) => {
                const isBusy = restockingId === item.id;
                const isDone = recentlyRestocked[item.id];

                return (
                  <div
                    key={item.id}
                    className="pt-2 first:pt-0 flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                          {item.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="inline-block text-[11px] font-black text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            {item.stock} {item.unit || 'pkts'} {t('dashboard.left')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold hidden xs:inline">
                            Min: {item.reorderLevel ?? item.minStock ?? 10}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRestockClick(item.id, 10)}
                      disabled={isBusy || isDone}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95 select-none ${
                        isDone
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : isBusy
                          ? 'bg-emerald-100 text-emerald-800 opacity-80 cursor-wait'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 hover:border-emerald-400'
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>...</span>
                        </>
                      ) : isDone ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('dashboard.restockedSuccess')}</span>
                        </>
                      ) : (
                        <span>{t('dashboard.restock')}</span>
                      )}
                    </button>
                  </div>
                );
              })}
        </div>
      </div>

      {/* Footer link to manage full inventory */}
      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-medium">
          Priority restock checklist
        </span>
        <button
          onClick={() => setActivePage('inventory')}
          className="text-xs font-black text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
        >
          <span>{t('dashboard.restockAll')}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
