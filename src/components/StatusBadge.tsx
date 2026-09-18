import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { StockStatus } from '../types';

interface StatusBadgeProps {
  status: StockStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const isSm = size === 'sm';

  switch (status) {
    case 'In Stock':
      return (
        <span
          className={`inline-flex items-center gap-1 font-extrabold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3 text-emerald-600' : 'w-3.5 h-3.5 text-emerald-600'} />
          In Stock
        </span>
      );
    case 'Low Stock':
      return (
        <span
          className={`inline-flex items-center gap-1 font-extrabold rounded-full bg-amber-50 text-amber-800 border border-amber-300 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <AlertTriangle className={isSm ? 'w-3 h-3 text-amber-600' : 'w-3.5 h-3.5 text-amber-600'} />
          Low Stock
        </span>
      );
    case 'Out of Stock':
      return (
        <span
          className={`inline-flex items-center gap-1 font-extrabold rounded-full bg-rose-50 text-rose-700 border border-rose-200 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <XCircle className={isSm ? 'w-3 h-3 text-rose-600' : 'w-3.5 h-3.5 text-rose-600'} />
          Out of Stock
        </span>
      );
    default:
      return null;
  }
};
