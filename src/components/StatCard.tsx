import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  badgeText?: string;
  badgeColor?: 'emerald' | 'amber' | 'rose' | 'slate' | 'blue';
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  badgeText,
  badgeColor = 'slate',
  onClick,
}) => {
  const badgeStyles = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-extrabold',
    amber: 'bg-amber-50 text-amber-900 border-amber-300 font-extrabold',
    rose: 'bg-rose-50 text-rose-800 border-rose-200 font-extrabold',
    slate: 'bg-slate-100 text-slate-700 border-slate-200 font-bold',
    blue: 'bg-blue-50 text-blue-800 border-blue-200 font-extrabold',
  };

  const iconBgStyles = {
    emerald: 'bg-emerald-50 text-emerald-600 border border-emerald-200/60',
    amber: 'bg-amber-50 text-amber-600 border border-amber-200/60',
    rose: 'bg-rose-50 text-rose-600 border border-rose-200/60',
    slate: 'bg-slate-100 text-slate-700 border border-slate-200',
    blue: 'bg-blue-50 text-blue-600 border border-blue-200/60',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-emerald-400 active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">
          {title}
        </span>
        <div className={`p-2.5 rounded-xl ${iconBgStyles[badgeColor]} shrink-0`}>
          {icon}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          {value}
        </div>
        {badgeText && (
          <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${badgeStyles[badgeColor]}`}>
            {badgeText}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1.5 text-xs font-semibold text-slate-500">
          {subtitle}
        </p>
      )}
    </div>
  );
};
