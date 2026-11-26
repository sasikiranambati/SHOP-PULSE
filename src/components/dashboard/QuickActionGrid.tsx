import React from 'react';
import { 
  ShoppingCart, 
  PackagePlus, 
  ScanLine, 
  Sparkles,
  Zap
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';

interface QuickActionGridProps {
  onNewSale: () => void;
  onAddProduct: () => void;
  onAddStock: () => void;
  onViewInsights: () => void;
  onScanInvoice?: () => void;
}

export const QuickActionGrid: React.FC<QuickActionGridProps> = ({
  onNewSale,
  onAddProduct,
  onAddStock,
  onViewInsights,
  onScanInvoice,
}) => {
  const { t } = useLanguage();

  const actions = [
    {
      id: 'new-sale',
      label: t('dashboard.createSale'),
      desc: t('dashboard.newSaleDesc'),
      icon: ShoppingCart,
      onClick: onNewSale,
      bg: 'bg-[#E7F3EE]',
      iconColor: 'text-[#153D32]',
      borderColor: 'border-[#23866A]/25',
      badge: 'POS',
    },
    {
      id: 'scan-invoice',
      label: 'Scan Invoice',
      desc: 'Import supplier bill via OCR',
      icon: ScanLine,
      onClick: onScanInvoice || onAddStock,
      bg: 'bg-[#FBF4E7]',
      iconColor: 'text-[#A07828]',
      borderColor: 'border-[#D6AE62]/40',
      badge: 'AI Engine',
    },
    {
      id: 'add-product',
      label: t('dashboard.addProduct'),
      desc: t('dashboard.addProductDesc'),
      icon: PackagePlus,
      onClick: onAddProduct,
      bg: 'bg-[#FAF8F2]',
      iconColor: 'text-[#23866A]',
      borderColor: 'border-[#DDE9DF]',
      badge: 'Catalog',
    },
    {
      id: 'insights',
      label: t('insights.title'),
      desc: t('insights.description'),
      icon: Sparkles,
      onClick: onViewInsights,
      bg: 'bg-[#F0F6FB]',
      iconColor: 'text-[#83B8DD]',
      borderColor: 'border-[#83B8DD]/30',
      badge: 'Intelligence',
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-[#DDE9DF] p-5 sm:p-6 shadow-card flex flex-col justify-between h-full transition-all min-w-0">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDE9DF] mb-3 flex-wrap">
        <h2 className="font-extrabold text-[#153D32] text-base flex items-center gap-2">
          <span className="w-7 h-7 rounded-xl bg-[#FBF4E7] text-[#D6AE62] flex items-center justify-center shrink-0 border border-[#D6AE62]/30">
            <Zap className="w-4 h-4 text-[#A07828]" />
          </span>
          <span>{t('dashboard.quickActions')}</span>
        </h2>
        <span className="text-xs font-semibold text-[#5E6C64]">
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
              className="min-w-0 p-3 sm:p-4 rounded-xl border border-[#DDE9DF] text-left flex flex-col justify-between transition-all cursor-pointer group active:scale-[0.98] bg-white hover:border-[#153D32]/50 hover:shadow-card"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${act.bg} ${act.iconColor} border ${act.borderColor} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-bold text-[#5E6C64] bg-[#FAF8F2] px-2 py-0.5 rounded-md border border-[#DDE9DF] hidden xl:inline-block shrink-0">
                  {act.badge}
                </span>
              </div>

              <div className="mt-3">
                <p className="font-bold text-[#252D29] text-xs sm:text-sm group-hover:text-[#153D32] transition-colors leading-tight">
                  {act.label}
                </p>
                <p className="text-[11px] text-[#5E6C64] mt-0.5 line-clamp-1">
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
