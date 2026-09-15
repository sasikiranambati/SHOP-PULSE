import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  Sparkles, 
  MoreHorizontal
} from 'lucide-react';
import type { PageRoute } from '../types';

interface BottomNavProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activePage, setActivePage }) => {
  const navItems = [
    { id: 'dashboard' as PageRoute, label: 'Home', icon: Home },
    { id: 'sales' as PageRoute, label: 'Sales', icon: Receipt },
    { id: 'inventory' as PageRoute, label: 'Stock', icon: Package },
    { id: 'insights' as PageRoute, label: 'Insights', icon: Sparkles },
    { id: 'settings' as PageRoute, label: 'More', icon: MoreHorizontal },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 shadow-lg select-none">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`flex flex-col items-center justify-center min-w-[64px] py-1.5 px-2 rounded-2xl transition-all cursor-pointer ${
                isActive
                  ? 'text-emerald-700 font-extrabold bg-emerald-50'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'text-emerald-600 scale-110' : ''}`} />
              <span className="text-[11px] mt-1 leading-tight">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
