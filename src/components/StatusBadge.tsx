import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { StockStatus } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface StatusBadgeProps {
  status: StockStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const { t } = useLanguage();
  const isSm = size === 'sm';

  switch (status) {
    case 'In Stock':
      return (
        <span
          className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#E5EEE6] text-[#18382B] border border-[#52745D]/30 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <CheckCircle2 className={isSm ? 'w-3 h-3 text-[#287A4B]' : 'w-3.5 h-3.5 text-[#287A4B]'} />
          {t('common.inStock')}
        </span>
      );
    case 'Low Stock':
      return (
        <span
          className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#FEF9EB] text-[#A66A16] border border-[#A66A16]/30 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <AlertTriangle className={isSm ? 'w-3 h-3 text-[#A66A16]' : 'w-3.5 h-3.5 text-[#A66A16]'} />
          {t('common.lowStock')}
        </span>
      );
    case 'Out of Stock':
    case 'Critical':
      return (
        <span
          className={`inline-flex items-center gap-1 font-semibold rounded-full bg-[#FDF2F2] text-[#B93838] border border-[#B93838]/30 ${
            isSm ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <XCircle className={isSm ? 'w-3 h-3 text-[#B93838]' : 'w-3.5 h-3.5 text-[#B93838]'} />
          {t('common.outOfStock')}
        </span>
      );
    default:
      return null;
  }
};
