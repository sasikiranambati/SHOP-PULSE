import React from 'react';
import { 
  ShoppingCart, 
  PackagePlus, 
  ArrowUpCircle, 
  ScanLine,
  Zap
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';

interface QuickActionGridProps {
  onNewSale: () => void;
  onAddProduct: () => void;
  onAddStock: () => void;
  onScanBill: () => void;
}

export const QuickActionGrid: React.FC<QuickActionGridProps> = ({
  onNewSale,
  onAddProduct,
  onAddStock,
  onScanBill,
}) => {
  const { t } = useLanguage();

  const actions = [
    {
      id: 'new-sale',
      label: t('dashboard.createSale'),
      desc: t('dashboard.newSaleDesc'),
      icon: ShoppingCart,
      onClick: onNewSale,
      bg: 'bg-[#E5EEE6]',
      iconColor: 'text-[#234B3A]',
      borderColor: 'border-[#52745D]/25',
      badge: 'POS',
    },
    {
      id: 'add-product',
      label: t('dashboard.addProduct'),
      desc: t('dashboard.addProductDesc'),
      icon: PackagePlus,
      onClick: onAddProduct,
      bg: 'bg-[#E5EEE6]',
      iconColor: 'text-[#234B3A]',
      borderColor: 'border-[#52745D]/25',
      badge: 'Catalog',
    },
    {
      id: 'add-stock',
      label: t('dashboard.addStock'),
      desc: t('dashboard.addStockDesc'),
      icon: ArrowUpCircle,
      onClick: onAddStock,
      bg: 'bg-[#FEF9EB]',
      iconColor: 'text-[#A66A16]',
      borderColor: 'border-[#FDE68A]',
      badge: 'Inventory',
    },
    {
      id: 'scan-bill',
      label: t('dashboard.scanBill'),
      desc: t('dashboard.scanBillDesc'),
      icon: ScanLine,
      onClick: onScanBill,
      bg: 'bg-[#EEF4FC]',
      iconColor: 'text-[#3567A8]',
      borderColor: 'border-[#3567A8]/20',
      badge: 'OCR',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-[#E3E5DE] p-5 sm:p-6 shadow-xs flex flex-col justify-between h-full transition-all">
      <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE] mb-3">
        <h2 className="font-extrabold text-[#202923] text-base flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#FEF9EB] text-[#A66A16] flex items-center justify-center shrink-0 border border-[#FDE68A]">
            <Zap className="w-4 h-4 text-[#A66A16]" />
          </span>
          <span>{t('dashboard.quickActions')}</span>
        </h2>
        <span className="text-xs font-semibold text-[#69736C]">
          Fast Shortcuts
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 flex-1">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <button
              key={act.id}
              onClick={act.onClick}
              className="p-3.5 sm:p-4 rounded-xl border border-[#E3E5DE] text-left flex flex-col justify-between transition-all cursor-pointer group active:scale-[0.98] bg-white hover:border-[#234B3A]/60 hover:shadow-xs"
            >
              <div className="flex items-center justify-between w-full">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg ${act.bg} ${act.iconColor} border ${act.borderColor} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold text-[#69736C] bg-[#F7F5EF] px-2 py-0.5 rounded-md border border-[#E3E5DE] hidden sm:inline-block">
                  {act.badge}
                </span>
              </div>

              <div className="mt-3">
                <p className="font-bold text-xs sm:text-sm text-[#202923] leading-tight group-hover:text-[#234B3A] transition-colors">
                  {act.label}
                </p>
                <p className="text-[11px] text-[#69736C] font-medium mt-0.5 hidden xs:block line-clamp-1">
                  {act.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
