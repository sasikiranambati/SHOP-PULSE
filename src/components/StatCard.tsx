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
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-100 text-amber-900 border-amber-200 font-bold',
    rose: 'bg-rose-100 text-rose-800 border-rose-200 font-bold',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
  };

  const iconBgStyles = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-blue-600',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200 p-5 shadow-xs transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-emerald-300' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
          {title}
        </span>
        <div className={`p-2.5 rounded-xl ${iconBgStyles[badgeColor]}`}>
          {icon}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
          {value}
        </div>
        {badgeText && (
          <span className={`text-xs px-2.5 py-1 rounded-full border ${badgeStyles[badgeColor]}`}>
            {badgeText}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-2 text-xs font-medium text-slate-500">
          {subtitle}
        </p>
      )}
    </div>
  );
};
