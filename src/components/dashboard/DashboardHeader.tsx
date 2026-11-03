import React from 'react';
import { Plus, Store } from 'lucide-react';
import { Button } from '../Button';
import { useLanguage } from '../../i18n/LanguageContext';
import type { PageRoute } from '../../types';

interface DashboardHeaderProps {
  shopName: string;
  setActivePage: (page: PageRoute) => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  shopName,
  setActivePage,
}) => {
  const { t } = useLanguage();

  return (
    <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4 transition-all min-w-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#234B3A] bg-[#E5EEE6] px-2.5 py-1 rounded-lg border border-[#52745D]/25 max-w-full">
            <Store className="w-3.5 h-3.5 text-[#234B3A] shrink-0" />
            <span className="truncate max-w-[140px] xs:max-w-[200px] sm:max-w-none">{shopName}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#287A4B] bg-[#E5EEE6]/70 px-2.5 py-1 rounded-lg border border-[#52745D]/20 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#287A4B] animate-pulse"></span>
            <span>Live System</span>
          </span>
        </div>

        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#202923] mt-2 sm:mt-2.5 tracking-tight break-words">
          {t('dashboard.goodMorning')}
        </h1>
        <p className="text-xs sm:text-sm text-[#69736C] font-medium mt-0.5 sm:mt-1 break-words">
          {t('dashboard.happeningToday')}
        </p>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto pt-1 sm:pt-0">
        <Button
          variant="primary"
          size="md"
          onClick={() => setActivePage('sales')}
          icon={<Plus className="w-5 h-5" />}
          className="w-full sm:w-auto font-bold shadow-xs min-h-[44px] justify-center"
        >
          {t('dashboard.newSale').replace(/^\+\s*/, '')}
        </Button>
      </div>
    </div>
  );
};
