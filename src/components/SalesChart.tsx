import React from 'react';
import { TrendingUp } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';

interface SalesChartDataPoint {
  day: string;
  amount: number;
  height: string;
  isToday?: boolean;
}

interface SalesChartProps {
  className?: string;
  data?: SalesChartDataPoint[];
  peakText?: string;
}


export const SalesChart: React.FC<SalesChartProps> = ({ 
  className = '', 
  data: propData,
  peakText: propPeakText
}) => {
  const { weeklyTrend } = useAnalytics();

  // No sample bars are drawn: without real sales points the chart shows an empty state.
  const chartData: SalesChartDataPoint[] = propData || weeklyTrend?.points || [];
  const hasData = chartData.length > 0;

  // Derive peak text
  const peak = propPeakText || (weeklyTrend?.peakDay ? `Peak: ${weeklyTrend.peakDay.day} (₹${(weeklyTrend.peakDay.amount / 1000).toFixed(1)}k)` : (() => {
    const highest = chartData.reduce((prev, curr) => (curr.amount > prev.amount ? curr : prev), chartData[0]);
    return highest ? `Peak: ${highest.day.split(' ')[0]} (₹${(highest.amount / 1000).toFixed(1)}k)` : '';
  })());

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
            <span>Weekly Sales Trend</span>
          </h3>
          <p className="text-xs text-slate-500 font-medium">Daily revenue past 7 days</p>
        </div>
        {peak && (
          <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            {peak}
          </span>
        )}
      </div>

      {!hasData && (
        <div className="h-44 sm:h-48 flex items-center justify-center text-center text-xs font-bold text-slate-500 px-4">
          No sales data for the past 7 days yet.
        </div>
      )}

      <div className={`h-44 sm:h-48 flex items-end justify-between gap-2 pt-4 px-1 ${hasData ? '' : 'hidden'}`}>
        {chartData.map((item, idx) => (
          <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
            {/* Amount label on hover or today */}
            <span
              className={`text-[10px] sm:text-xs font-bold transition-opacity ${
                item.isToday
                  ? 'text-emerald-700 font-black opacity-100'
                  : 'text-slate-500 opacity-80 group-hover:opacity-100'
              }`}
            >
              ₹{(item.amount / 1000).toFixed(1)}k
            </span>

            {/* Bar */}
            <div className="w-full max-w-[28px] sm:max-w-[36px] bg-slate-100 rounded-t-lg relative flex items-end overflow-hidden h-full">
              <div
                style={{ height: item.height }}
                className={`w-full rounded-t-lg transition-all duration-500 group-hover:brightness-105 ${
                  item.isToday
                    ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-md'
                    : 'bg-emerald-500/80 group-hover:bg-emerald-600'
                }`}
              />
            </div>

            {/* Day Name */}
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
  );
};
