import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  ScanLine, 
  Sparkles,
  Settings as SettingsIcon,
  PhoneCall
} from 'lucide-react';
import type { PageRoute } from '../types';

interface SidebarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage }) => {
  const navItems = [
    { id: 'dashboard' as PageRoute, label: 'Dashboard', icon: Home },
    { id: 'sales' as PageRoute, label: 'Quick Sales POS', icon: Receipt },
    { id: 'inventory' as PageRoute, label: 'Stock Catalog', icon: Package },
    { id: 'scanner' as PageRoute, label: 'Scan Invoice', icon: ScanLine },
    { id: 'insights' as PageRoute, label: 'Shop Insights', icon: Sparkles },
    { id: 'settings' as PageRoute, label: 'Settings & More', icon: SettingsIcon },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200/90 shrink-0 hidden md:flex flex-col justify-between p-4 min-h-[calc(100vh-4rem)] sticky top-16 select-none">
      <div className="space-y-1.5">
        <p className="px-3 text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
          Navigation Menu
        </p>
        
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl font-extrabold text-sm transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Support Info Banner */}
      <div className="pt-4 border-t border-slate-200/80 space-y-2">
        <div className="bg-emerald-50/70 rounded-2xl p-3.5 border border-emerald-200/80 text-xs">
          <div className="flex items-center gap-2 text-emerald-800 font-black mb-1">
            <PhoneCall className="w-4 h-4 text-emerald-600" />
            <span>Kirana Support Line</span>
          </div>
          <p className="text-slate-600 text-[11px]">Help available 24/7</p>
          <p className="font-extrabold text-emerald-700 mt-1">1800-SHOP-PULSE</p>
        </div>
      </div>
    </aside>
  );
};
