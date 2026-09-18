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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 px-1.5 py-1 shadow-lg select-none">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`flex flex-col items-center justify-center min-w-[60px] py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'text-emerald-700 font-extrabold bg-emerald-50'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'text-emerald-600 scale-110' : ''}`} />
              <span className="text-[10px] sm:text-[11px] mt-0.5 leading-tight font-extrabold truncate max-w-[68px]">
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
