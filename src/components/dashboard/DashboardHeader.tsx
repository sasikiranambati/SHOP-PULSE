import React from 'react';
import { Plus, Store, ScanLine, Sparkles } from 'lucide-react';
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
    <div className="bg-white rounded-2xl border border-[#DDE9DF] p-5 sm:p-6 shadow-card flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all min-w-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#153D32] bg-[#FAF8F2] px-3 py-1 rounded-xl border border-[#DDE9DF] max-w-full">
            <Store className="w-3.5 h-3.5 text-[#23866A] shrink-0" />
            <span className="truncate max-w-[140px] xs:max-w-[200px] sm:max-w-none">{shopName}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#23866A] bg-[#E7F3EE] px-3 py-1 rounded-xl border border-[#23866A]/20 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#23866A] animate-pulse" />
            <span>Shelfora Active</span>
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-xs font-medium text-[#16866A] bg-[#E8F3ED] px-2.5 py-0.5 rounded-lg border border-[#16866A]/30">
            <Sparkles className="w-3 h-3 text-[#16866A]" />
            <span>Smarter Grocery Management.</span>
          </span>
        </div>

        <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-[#153D32] mt-2.5 tracking-tight break-words">
          {t('dashboard.goodMorning')}
        </h1>
        <p className="text-xs sm:text-sm text-[#5E6C64] font-medium mt-1 break-words">
          {t('dashboard.happeningToday')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full lg:w-auto pt-1 lg:pt-0">
        <button
          type="button"
          onClick={() => setActivePage('scanner')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#DDE9DF] bg-[#FAF8F2] hover:bg-[#F3EFE3] text-xs font-bold text-[#153D32] transition-colors cursor-pointer shadow-3xs min-h-[44px]"
        >
          <ScanLine className="w-4 h-4 text-[#23866A]" />
          <span>Scan Invoice</span>
        </button>

        <Button
          variant="primary"
          size="md"
          onClick={() => setActivePage('sales')}
          icon={<Plus className="w-5 h-5" />}
          className="w-full sm:w-auto font-bold shadow-xs min-h-[44px] justify-center bg-[#153D32] hover:bg-[#0F2D25] rounded-xl text-white"
        >
          {t('dashboard.newSale').replace(/^\+\s*/, '')}
        </Button>
      </div>
    </div>
  );
};
