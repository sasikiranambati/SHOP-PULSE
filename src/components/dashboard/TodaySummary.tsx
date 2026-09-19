import React from 'react';
import { IndianRupee, ShoppingBag, Package, TrendingUp, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { PageRoute } from '../../types';

interface TodaySummaryProps {
  revenue: number;
  itemsSold: number;
  productsCount: number;
  billsCount?: number;
  growthPercent?: string;
  setActivePage: (page: PageRoute) => void;
}

export const TodaySummary: React.FC<TodaySummaryProps> = ({
  revenue,
  itemsSold,
  productsCount,
  billsCount = 18,
  growthPercent = '+12%',
  setActivePage,
}) => {
  const { t } = useLanguage();

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden transition-all hover:shadow-sm">
      {/* Top Banner Bar */}
      <div className="bg-slate-50/80 px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
            {t('nav.home')} • {t('dashboard.todaysSales')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{growthPercent} {t('dashboard.vsYesterday')}</span>
          </span>
        </div>
      </div>

      {/* Main Unified Metrics Row */}
      <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 gap-4 sm:gap-0">
        
        {/* Metric 1: Sales (Hero Metric) */}
        <div className="sm:pr-6 flex items-center justify-between sm:block">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              {t('dashboard.todaysSales')}
            </p>
            <div className="text-3xl sm:text-4xl font-black text-slate-900 mt-1 tracking-tight">
              ₹{revenue.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-emerald-700 font-bold mt-1 hidden sm:block">
              {growthPercent} vs Yesterday
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center shrink-0">
            <IndianRupee className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2: Items Sold */}
        <div className="pt-3 sm:pt-0 sm:px-6 flex items-center justify-between sm:block">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              {t('dashboard.itemsSoldToday')}
            </p>
            <div className="text-2xl sm:text-4xl font-black text-slate-900 mt-1 tracking-tight">
              {itemsSold}
            </div>
            <p className="text-[11px] text-slate-500 font-semibold mt-1 hidden sm:block">
              Across customer receipts
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3: Products */}
        <div className="pt-3 sm:pt-0 sm:pl-6 flex items-center justify-between sm:block">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              {t('dashboard.productsCount')}
            </p>
            <div className="text-2xl sm:text-4xl font-black text-slate-900 mt-1 tracking-tight">
              {productsCount}
            </div>
            <p className="text-[11px] text-slate-500 font-semibold mt-1 hidden sm:block">
              Active in catalog
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center justify-center shrink-0">
            <Package className="w-6 h-6" />
          </div>
        </div>

      </div>

      {/* Cohesive Bottom Footer Bar */}
      <div className="bg-slate-50/50 px-4 sm:px-6 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="font-semibold">
          {t('dashboard.acrossBills')} • {billsCount} bills
        </span>
        <button
          onClick={() => setActivePage('sales')}
          className="font-black text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>{t('dashboard.viewSales')}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
