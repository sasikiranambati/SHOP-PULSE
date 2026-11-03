import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  ScanLine, 
  Menu
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

export interface BottomNavProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  onOpenMenu?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ 
  activePage, 
  setActivePage,
  onOpenMenu 
}) => {
  const { t } = useLanguage();

  const navItems = [
    { id: 'dashboard' as PageRoute, labelKey: 'nav.home', icon: Home },
    { id: 'sales' as PageRoute, labelKey: 'nav.sales', icon: Receipt },
    { id: 'inventory' as PageRoute, labelKey: 'nav.stock', icon: Package },
    { id: 'scanner' as PageRoute, labelKey: 'nav.scanner', icon: ScanLine },
  ];

  const isMenuSectionActive = activePage === 'settings' || activePage === 'insights';

  return (
    <nav 
      aria-label="Bottom mobile navigation" 
      className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E3E5DE] px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-sm select-none"
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
              aria-label={t(item.labelKey)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 min-w-0 max-w-[74px] flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg transition-all cursor-pointer min-h-[48px] active:scale-95 ${
                isActive
                  ? 'text-[#234B3A] font-bold bg-[#E5EEE6] border border-[#52745D]/30 shadow-2xs'
                  : 'text-[#69736C] hover:text-[#202923] font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'text-[#234B3A] scale-105' : ''}`} />
              <span className={`text-[10px] xs:text-[11px] mt-0.5 leading-tight truncate max-w-full text-center ${
                isActive ? 'font-bold text-[#18382B]' : 'font-medium'
              }`}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}

        {/* 5th Menu Tab: Opens full MobileNavDrawer or navigates to settings */}
        <button
          type="button"
          onClick={() => {
            if (onOpenMenu) {
              onOpenMenu();
            } else {
              setActivePage('settings');
            }
          }}
          aria-label={t('nav.settings')}
          aria-current={isMenuSectionActive ? 'page' : undefined}
          className={`flex-1 min-w-0 max-w-[74px] flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg transition-all cursor-pointer min-h-[48px] active:scale-95 ${
            isMenuSectionActive
              ? 'text-[#234B3A] font-bold bg-[#E5EEE6] border border-[#52745D]/30 shadow-2xs'
              : 'text-[#69736C] hover:text-[#202923] font-medium'
          }`}
        >
          <Menu className={`w-5 h-5 transition-transform ${isMenuSectionActive ? 'text-[#234B3A] scale-105' : ''}`} />
          <span className={`text-[10px] xs:text-[11px] mt-0.5 leading-tight truncate max-w-full text-center ${
            isMenuSectionActive ? 'font-bold text-[#18382B]' : 'font-medium'
          }`}>
            {t('nav.settings')}
          </span>
        </button>
      </div>
    </nav>
  );
};
