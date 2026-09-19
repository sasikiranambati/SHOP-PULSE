import React from 'react';
import { TrendingUp, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { PageRoute } from '../../types';

interface DailyPoint {
  day: string;
  amount: number;
  height: string;
  isToday?: boolean;
}

interface SalesOverviewProps {
  totalWeekRevenue?: number;
  weekGrowthPercent?: string;
  data?: DailyPoint[];
  setActivePage?: (page: PageRoute) => void;
}

const DEFAULT_CHART_DATA: DailyPoint[] = [
  { day: 'Mon', amount: 6200, height: '55%' },
  { day: 'Tue', amount: 7400, height: '66%' },
  { day: 'Wed', amount: 5800, height: '52%' },
  { day: 'Thu', amount: 8100, height: '72%' },
  { day: 'Fri', amount: 9500, height: '85%' },
  { day: 'Sat', amount: 11200, height: '100%' },
  { day: 'Sun', amount: 8450, height: '76%', isToday: true },
];

export const SalesOverview: React.FC<SalesOverviewProps> = ({
  totalWeekRevenue = 48320,
  weekGrowthPercent = '+18%',
  data = DEFAULT_CHART_DATA,
  setActivePage,
}) => {
  const { t } = useLanguage();

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
      {/* Header & Stats Banner */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <span>{t('dashboard.salesOverview')}</span>
            </h2>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              {t('dashboard.dailyRevenue7Days')}
            </p>
          </div>

          {setActivePage && (
            <button
              onClick={() => setActivePage('insights')}
              className="text-xs font-black text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <span>{t('dashboard.viewAll')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Weekly Revenue Highlight Section */}
        <div className="mt-3.5 bg-slate-50 rounded-2xl p-3 sm:p-3.5 border border-slate-200/60 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-500">
              {t('dashboard.thisWeek')}
            </p>
            <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 tracking-tight">
              ₹{totalWeekRevenue.toLocaleString('en-IN')}
            </div>
          </div>

          <div className="text-right">
            <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <span>{weekGrowthPercent}</span>
              <span className="hidden xs:inline">{t('dashboard.vsLastWeek')}</span>
            </span>
          </div>
        </div>

        {/* Clean 7-Day Bar Chart */}
        <div className="h-36 sm:h-40 flex items-end justify-between gap-1.5 sm:gap-2.5 pt-4 pb-1 px-1">
          {data.map((item, idx) => (
            <div
              key={idx}
              className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group min-w-0"
            >
              {/* Tooltip Amount */}
              <span
                className={`text-[10px] font-extrabold transition-opacity truncate max-w-full ${
                  item.isToday
                    ? 'text-emerald-700 font-black opacity-100'
                    : 'text-slate-400 group-hover:text-slate-700'
                }`}
              >
                ₹{(item.amount / 1000).toFixed(1)}k
              </span>

              {/* Bar track and fill */}
              <div className="w-full max-w-[24px] sm:max-w-[32px] bg-slate-100 rounded-t-lg relative flex items-end overflow-hidden h-full">
                <div
                  style={{ height: item.height }}
                  className={`w-full rounded-t-lg transition-all duration-300 ${
                    item.isToday
                      ? 'bg-gradient-to-t from-emerald-700 to-emerald-500 shadow-xs'
                      : 'bg-emerald-500/70 group-hover:bg-emerald-600'
                  }`}
                />
              </div>

              {/* Day Label */}
              <span
                className={`text-[10px] sm:text-xs font-bold truncate max-w-full ${
                  item.isToday ? 'text-emerald-700 font-black' : 'text-slate-500'
                }`}
              >
                {item.day.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
