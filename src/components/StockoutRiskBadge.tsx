import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { StockoutRisk, ConfidenceStatus } from '../types/forecast';

interface StockoutRiskBadgeProps {
  risk?: StockoutRisk | null;
  confidenceStatus?: ConfidenceStatus | null;
  validHistoryDays?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export const StockoutRiskBadge: React.FC<StockoutRiskBadgeProps> = ({
  risk,
  confidenceStatus,
  validHistoryDays,
  size = 'md',
  className = '',
}) => {
  const isSm = size === 'sm';
  const iconSize = isSm ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const baseClasses = `inline-flex items-center gap-1 font-extrabold rounded-full border whitespace-nowrap ${
    isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  } ${className}`;

  // If in Stage 0 (INSUFFICIENT_DATA), render Building History badge
  if (confidenceStatus === 'INSUFFICIENT_DATA' || risk === 'UNKNOWN') {
    return (
      <span
        className={`${baseClasses} bg-slate-100 text-slate-700 border-slate-300/80`}
        title={
          validHistoryDays !== undefined
            ? `Observed ${validHistoryDays} of 7 required open selling days.`
            : 'Fewer than 7 open selling days observed. Building statistical history.'
        }
      >
        <Clock className={`${iconSize} text-slate-500`} />
        <span>
          {validHistoryDays !== undefined
            ? `Building History (${validHistoryDays}/7d)`
            : 'Building History'}
        </span>
      </span>
    );
  }

  switch (risk) {
    case 'OUT_OF_STOCK':
      return (
        <span
          className={`${baseClasses} bg-rose-50 text-rose-800 border-rose-200`}
          title="Inventory is completely depleted."
        >
          <XCircle className={`${iconSize} text-rose-600`} />
          <span>Out of Stock</span>
        </span>
      );

    case 'HIGH':
      return (
        <span
          className={`${baseClasses} bg-amber-50 text-amber-900 border-amber-300 font-black`}
          title="High stockout risk: estimated to run out within 3 days."
        >
          <AlertTriangle className={`${iconSize} text-amber-600`} />
          <span>High Risk (≤3d)</span>
        </span>
      );

    case 'MEDIUM':
      return (
        <span
          className={`${baseClasses} bg-blue-50 text-blue-800 border-blue-200`}
          title="Medium stockout risk: estimated to run out in 4 to 7 days."
        >
          <Clock className={`${iconSize} text-blue-600`} />
          <span>Medium Risk (4–7d)</span>
        </span>
      );

    case 'LOW':
      return (
        <span
          className={`${baseClasses} bg-emerald-50 text-emerald-800 border-emerald-200`}
          title="Adequate inventory: more than 7 days of estimated supply."
        >
          <CheckCircle2 className={`${iconSize} text-emerald-600`} />
          <span>Adequate Stock</span>
        </span>
      );

    default:
      return null;
  }
};
