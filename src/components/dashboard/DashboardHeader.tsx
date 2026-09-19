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
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/80">
            <Store className="w-3.5 h-3.5 text-emerald-600" />
            <span className="truncate max-w-[200px] sm:max-w-none">{shopName}</span>
          </span>
          <span className="hidden xs:inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 bg-slate-50 px-2.5 py-0.5 rounded-full border border-slate-200/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            {t('dashboard.updatedAgo')}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
          {t('dashboard.goodMorning')}
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-semibold mt-0.5">
          {t('dashboard.happeningToday')}
        </p>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <Button
          variant="primary"
          size="md"
          onClick={() => setActivePage('sales')}
          icon={<Plus className="w-5 h-5" />}
          className="w-full sm:w-auto font-black shadow-md shadow-emerald-600/20"
        >
          {t('dashboard.newSale')}
        </Button>
      </div>
    </div>
  );
};
