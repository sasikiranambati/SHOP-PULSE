import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Package, RefreshCw, ArrowUpRight, Check } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Product, PageRoute } from '../../types';

interface AttentionCardProps {
  lowStockItems: Product[];
  onRestock: (productId: string, quantity: number) => Promise<void> | void;
  setActivePage: (page: PageRoute) => void;
}

export const AttentionCard: React.FC<AttentionCardProps> = ({
  lowStockItems,
  onRestock,
  setActivePage,
}) => {
  const { t } = useLanguage();
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [recentlyRestocked, setRecentlyRestocked] = useState<Record<string, boolean>>({});

  const handleRestockClick = async (item: Product) => {
    try {
      setRestockingId(item.id);
      await onRestock(item.id, 10);
      setRecentlyRestocked((prev) => ({ ...prev, [item.id]: true }));
      setTimeout(() => {
        setRecentlyRestocked((prev) => ({ ...prev, [item.id]: false }));
      }, 2500);
    } catch (err) {
      console.error('Failed to restock item:', err);
    } finally {
      setRestockingId(null);
    }
  };

  const count = lowStockItems.length;

  if (count === 0) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>{t('dashboard.needsAttention')}</span>
            </h2>
            <span className="text-[11px] font-extrabold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Optimal
            </span>
          </div>

          <div className="py-6 sm:py-8 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-black text-slate-900 text-sm sm:text-base">
              {t('dashboard.optimalStock')}
            </h3>
            <p className="text-xs text-slate-500 font-medium max-w-xs mt-1">
              {t('dashboard.allStocked')}
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

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-amber-300/80 shadow-xs flex flex-col justify-between p-4 sm:p-5 h-full relative overflow-hidden">
      {/* Subtle Amber Header */}
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
                {t('dashboard.itemsRunningLow', { count })}
              </p>
            </div>
          </div>

          <span className="text-xs font-black text-amber-900 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-300/80 shrink-0">
            {count} {t('dashboard.left')}
          </span>
        </div>

        {/* Low Stock Item Cards (Top 3) */}
        <div className="divide-y divide-slate-100 mt-2 space-y-2">
          {lowStockItems.slice(0, 3).map((item) => {
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

                {/* Non-destructive Restock Button with Feedback */}
                <button
                  onClick={() => handleRestockClick(item)}
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
