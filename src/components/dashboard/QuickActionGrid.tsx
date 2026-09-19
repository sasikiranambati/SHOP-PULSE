import React from 'react';
import { 
  ShoppingCart, 
  PackagePlus, 
  ArrowUpCircle, 
  ScanLine 
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
      bg: 'bg-emerald-50',
      iconColor: 'text-emerald-700',
      borderHover: 'hover:border-emerald-500',
      badge: 'POS',
    },
    {
      id: 'add-product',
      label: t('dashboard.addProduct'),
      desc: t('dashboard.addProductDesc'),
      icon: PackagePlus,
      onClick: onAddProduct,
      bg: 'bg-blue-50',
      iconColor: 'text-blue-700',
      borderHover: 'hover:border-blue-500',
      badge: 'Catalog',
    },
    {
      id: 'add-stock',
      label: t('dashboard.addStock'),
      desc: t('dashboard.addStockDesc'),
      icon: ArrowUpCircle,
      onClick: onAddStock,
      bg: 'bg-amber-50',
      iconColor: 'text-amber-700',
      borderHover: 'hover:border-amber-500',
      badge: 'Inventory',
    },
    {
      id: 'scan-bill',
      label: t('dashboard.scanBill'),
      desc: t('dashboard.scanBillDesc'),
      icon: ScanLine,
      onClick: onScanBill,
      bg: 'bg-purple-50',
      iconColor: 'text-purple-700',
      borderHover: 'hover:border-purple-500',
      badge: 'OCR',
    },
  ];

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
          <span className="text-amber-500">⚡</span>
          <span>{t('dashboard.quickActions')}</span>
        </h2>
        <span className="text-[11px] font-extrabold text-slate-400">
          4 Fast Shortcuts
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 flex-1">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <button
              key={act.id}
              onClick={act.onClick}
              className={`p-3 sm:p-4 rounded-2xl border border-slate-200/90 text-left flex flex-col justify-between transition-all cursor-pointer group active:scale-95 bg-white ${act.borderHover} hover:shadow-xs`}
            >
              <div className="flex items-center justify-between w-full">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${act.bg} ${act.iconColor} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-extrabold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 hidden sm:inline-block">
                  {act.badge}
                </span>
              </div>

              <div className="mt-2.5">
                <p className="font-black text-xs sm:text-sm text-slate-900 leading-tight group-hover:text-emerald-700 transition-colors">
                  {act.label}
                </p>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5 hidden xs:block line-clamp-1">
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
