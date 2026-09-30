import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  Sparkles, 
  MoreHorizontal
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface BottomNavProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activePage, setActivePage }) => {
  const { t } = useLanguage();

  const navItems = [
    { id: 'dashboard' as PageRoute, labelKey: 'nav.home', icon: Home },
    { id: 'sales' as PageRoute, labelKey: 'nav.sales', icon: Receipt },
    { id: 'inventory' as PageRoute, labelKey: 'nav.stock', icon: Package },
    { id: 'insights' as PageRoute, labelKey: 'nav.insights', icon: Sparkles },
    { id: 'settings' as PageRoute, labelKey: 'nav.settings', icon: MoreHorizontal },
  ];

  return (
    <nav 
      aria-label="Bottom mobile navigation" 
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 px-1 pt-1 pb-[calc(0.4rem+env(safe-area-inset-bottom,0px))] shadow-lg select-none"
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              aria-label={t(item.labelKey)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 min-w-0 max-w-[74px] flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition-all cursor-pointer min-h-[48px] active:scale-95 ${
                isActive
                  ? 'text-emerald-700 font-extrabold bg-emerald-50/90 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800 font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'text-emerald-600 scale-110' : ''}`} />
              <span className={`text-[10px] xs:text-[11px] mt-0.5 leading-tight truncate max-w-full text-center ${
                isActive ? 'font-black text-emerald-800' : 'font-bold'
              }`}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
