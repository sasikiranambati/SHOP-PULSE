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

const DEFAULT_TOP_SELLERS: TopSellerItem[] = [
  { name: 'Milk (500ml)', category: 'Dairy', soldCount: 42, price: '₹28' },
  { name: 'Bread (400g)', category: 'Bakery', soldCount: 31, price: '₹45' },
  { name: 'Biscuits', category: 'Snacks', soldCount: 27, price: '₹25' },
  { name: 'Refined Sugar (1kg)', category: 'Staples', soldCount: 19, price: '₹48' },
];

export const TopSellers: React.FC<TopSellersProps> = ({
  items = DEFAULT_TOP_SELLERS,
  setActivePage,
}) => {
  const { t } = useLanguage();

  const getRankBadgeStyle = (index: number) => {
    switch (index) {
      case 0:
        return 'bg-amber-100 text-amber-900 border-amber-300 font-black';
      case 1:
        return 'bg-slate-200 text-slate-800 border-slate-300 font-bold';
      case 2:
        return 'bg-amber-50 text-amber-800 border-amber-200 font-bold';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200 font-semibold';
    }
  };

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <span>{t('dashboard.topSellers')}</span>
          </h2>
          <button
            onClick={() => setActivePage('insights')}
            className="text-xs font-black text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>{t('dashboard.viewAll')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Compact List */}
        <div className="divide-y divide-slate-100 mt-1">
          {items.slice(0, 4).map((item, idx) => (
            <div
              key={idx}
              className="py-2.5 sm:py-3 flex items-center justify-between gap-3 group transition-colors"
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <span
                  className={`w-6 h-6 rounded-full border text-xs flex items-center justify-center shrink-0 ${getRankBadgeStyle(
                    idx
                  )}`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {item.category}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-lg">
                  {item.soldCount} {t('dashboard.sold')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-3 mt-1 border-t border-slate-100">
        <button
          onClick={() => setActivePage('insights')}
          className="w-full text-center text-xs font-black text-slate-600 hover:text-emerald-700 transition-colors cursor-pointer py-1"
        >
          {t('insights.topSellingProducts')} →
        </button>
      </div>
    </div>
  );
};
