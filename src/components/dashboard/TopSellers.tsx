import React from 'react';
import { Flame, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { PageRoute } from '../../types';

interface TopSellerItem {
  name: string;
  category: string;
  soldCount: number;
  price?: string;
}

interface TopSellersProps {
  items?: TopSellerItem[];
  setActivePage: (page: PageRoute) => void;
}

export const TopSellers: React.FC<TopSellersProps> = ({
  items = [],
  setActivePage,
}) => {
  const { t } = useLanguage();

  const getRankBadgeStyle = (index: number) => {
    switch (index) {
      case 0:
        return 'bg-[#FEF9EB] text-[#A66A16] border-[#FDE68A] font-extrabold';
      case 1:
        return 'bg-[#E5EEE6] text-[#234B3A] border-[#52745D]/30 font-bold';
      case 2:
        return 'bg-[#F2EFE9] text-[#52745D] border-[#E3E5DE] font-bold';
      default:
        return 'bg-[#F7F5EF] text-[#69736C] border-[#E3E5DE] font-medium';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#E3E5DE] p-5 sm:p-6 shadow-xs flex flex-col justify-between h-full transition-all">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
          <h2 className="font-extrabold text-[#202923] text-base flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#FEF9EB] text-[#A66A16] flex items-center justify-center shrink-0 border border-[#FDE68A]">
              <Flame className="w-4 h-4 text-[#A66A16]" />
            </span>
            <span>{t('dashboard.topSellers')}</span>
          </h2>
          <button
            onClick={() => setActivePage('insights')}
            className="text-xs font-bold text-[#234B3A] hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>{t('dashboard.viewAll')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Compact List */}
        <div className="divide-y divide-[#E3E5DE] mt-1">
          {items.length === 0 ? (
            <div className="py-8 text-center text-[#69736C] text-xs font-semibold">
              No sales recorded yet. Completed sales will rank top items here.
            </div>
          ) : (
            items.slice(0, 4).map((item, idx) => (
              <div
                key={idx}
                className="py-3 flex items-center justify-between gap-3 group transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-md border text-xs flex items-center justify-center shrink-0 ${getRankBadgeStyle(
                      idx
                    )}`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-[#202923] text-sm truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-[#69736C] font-medium">
                      {item.category}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-[#202923] bg-[#F7F5EF] border border-[#E3E5DE] px-2.5 py-1 rounded-md">
                    {item.soldCount} {t('dashboard.sold')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="pt-3 mt-1 border-t border-[#E3E5DE]">
        <button
          onClick={() => setActivePage('insights')}
          className="w-full text-center text-xs font-bold text-[#234B3A] hover:underline transition-colors cursor-pointer py-1"
        >
          {t('insights.topSellingProducts')} →
        </button>
      </div>
    </div>
  );
};
