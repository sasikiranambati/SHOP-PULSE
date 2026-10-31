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
    emerald: 'bg-[#E5EEE6] text-[#18382B] border-[#52745D]/30 font-bold',
    amber: 'bg-[#FEF9EB] text-[#A66A16] border-[#A66A16]/30 font-bold',
    rose: 'bg-[#FDF2F2] text-[#B93838] border-[#B93838]/30 font-bold',
    slate: 'bg-[#F2EFE9] text-[#202923] border-[#E3E5DE] font-medium',
    blue: 'bg-[#EEF4FC] text-[#3567A8] border-[#3567A8]/30 font-bold',
  };

  const iconBgStyles = {
    emerald: 'bg-[#E5EEE6] text-[#234B3A] border border-[#52745D]/20',
    amber: 'bg-[#FEF9EB] text-[#A66A16] border border-[#A66A16]/20',
    rose: 'bg-[#FDF2F2] text-[#B93838] border border-[#B93838]/20',
    slate: 'bg-[#F2EFE9] text-[#69736C] border border-[#E3E5DE]',
    blue: 'bg-[#EEF4FC] text-[#3567A8] border border-[#3567A8]/20',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-[#E3E5DE] p-5 shadow-xs transition-all duration-150 ${
        onClick ? 'cursor-pointer hover:shadow-sm hover:border-[#52745D]/50 active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold text-[#69736C] uppercase tracking-wider">
          {title}
        </span>
        <div className={`p-2 rounded-lg ${iconBgStyles[badgeColor]} shrink-0`}>
          {icon}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-2xl sm:text-3xl font-extrabold text-[#202923] tracking-tight tabular-nums">
          {value}
        </div>
        {badgeText && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badgeStyles[badgeColor]}`}>
            {badgeText}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-xs text-[#69736C] font-normal">
          {subtitle}
        </p>
      )}
    </div>
  );
};
