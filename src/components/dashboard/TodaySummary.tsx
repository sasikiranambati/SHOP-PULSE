import React from 'react';
import { IndianRupee, ShoppingBag, Package, TrendingUp, Receipt, ArrowUpRight } from 'lucide-react';
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
  billsCount = 0,
  growthPercent,
  setActivePage,
}) => {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
      
      {/* Metric 1: Today's Revenue */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 sm:p-5 shadow-xs transition-all hover:border-[#52745D]/40 hover:shadow-sm flex flex-col justify-between min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#69736C] truncate" title={t('dashboard.todaysSales')}>
            {t('dashboard.todaysSales')}
          </span>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0 border border-[#52745D]/20">
            <IndianRupee className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#202923] tracking-tight truncate">
            ₹{revenue.toLocaleString('en-IN')}
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-[#E3E5DE] flex items-center justify-between gap-2 text-xs">
          {growthPercent ? (
            <span className="inline-flex items-center gap-1 font-bold text-[#287A4B] truncate">
              <TrendingUp className="w-3.5 h-3.5 shrink-0" />
              <span>{growthPercent}</span>
            </span>
          ) : (
            <span className="text-[#69736C] font-medium truncate">Recorded today</span>
          )}
          <button
            onClick={() => setActivePage('sales')}
            className="text-[#234B3A] hover:underline font-bold inline-flex items-center gap-1 cursor-pointer ml-auto shrink-0 min-h-[36px]"
          >
            <span>POS</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Metric 2: Items Sold */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 sm:p-5 shadow-xs transition-all hover:border-[#52745D]/40 hover:shadow-sm flex flex-col justify-between min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#69736C] truncate" title={t('dashboard.itemsSoldToday')}>
            {t('dashboard.itemsSoldToday')}
          </span>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0 border border-[#52745D]/20">
            <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#202923] tracking-tight truncate">
            {itemsSold.toLocaleString('en-IN')}
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-[#E3E5DE] flex items-center justify-between gap-2 text-xs text-[#69736C]">
          <span className="font-medium truncate">All orders</span>
          <button
            onClick={() => setActivePage('sales')}
            className="text-[#234B3A] hover:underline font-bold inline-flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
          >
            <span>History</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Metric 3: Total Transactions / Bills */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 sm:p-5 shadow-xs transition-all hover:border-[#52745D]/40 hover:shadow-sm flex flex-col justify-between min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#69736C] truncate" title="Bills Completed">
            Bills Completed
          </span>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#F2EFE9] text-[#52745D] flex items-center justify-center shrink-0 border border-[#E3E5DE]">
            <Receipt className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#202923] tracking-tight truncate">
            {billsCount.toLocaleString('en-IN')}
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-[#E3E5DE] flex items-center justify-between gap-2 text-xs text-[#69736C]">
          <span className="font-medium truncate">Checkouts</span>
          <button
            onClick={() => setActivePage('sales')}
            className="text-[#234B3A] hover:underline font-bold inline-flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
          >
            <span>Bills</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Metric 4: Active Catalog */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 sm:p-5 shadow-xs transition-all hover:border-[#52745D]/40 hover:shadow-sm flex flex-col justify-between min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#69736C] truncate" title={t('dashboard.productsCount')}>
            {t('dashboard.productsCount')}
          </span>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#FEF9EB] text-[#A66A16] flex items-center justify-center shrink-0 border border-[#FDE68A]">
            <Package className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#202923] tracking-tight truncate">
            {productsCount.toLocaleString('en-IN')}
          </div>
        </div>

        <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-[#E3E5DE] flex items-center justify-between gap-2 text-xs text-[#69736C]">
          <span className="font-medium truncate">In store catalog</span>
          <button
            onClick={() => setActivePage('inventory')}
            className="text-[#234B3A] hover:underline font-bold inline-flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
          >
            <span>Stock</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

    </div>
  );
};
