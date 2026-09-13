import React from 'react';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  ScanLine, 
  TrendingUp,
  User
} from 'lucide-react';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { PageRoute, StoreProfile } from '../types';

interface SidebarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  profile: StoreProfile;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage, profile }) => {
  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === profile.businessTypeId) || BUSINESS_TYPE_OPTIONS[0];

  const navItems = [
    { id: 'dashboard' as PageRoute, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sales' as PageRoute, label: 'Sales', icon: ShoppingCart },
    { id: 'inventory' as PageRoute, label: 'Inventory', icon: Package },
    { id: 'scanner' as PageRoute, label: 'Scan Invoice', icon: ScanLine },
    { id: 'insights' as PageRoute, label: 'Insights', icon: TrendingUp },
    { id: 'profile' as PageRoute, label: 'Store Profile', icon: User },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200 shrink-0 hidden md:flex flex-col justify-between p-4 min-h-[calc(100vh-4rem)] sticky top-16">
      <div className="space-y-1">
        <p className="px-3 text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Main Menu
        </p>
        
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl font-bold text-base transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Business Personalization Card */}
      <div className="pt-4 border-t border-slate-200 space-y-2">
        <div 
          onClick={() => setActivePage('select-store')}
          className="bg-emerald-50 hover:bg-emerald-100/80 rounded-xl p-3 border border-emerald-200 text-xs transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between font-extrabold text-emerald-900">
            <span className="flex items-center gap-1.5">
              <span>{activeOption.emoji}</span>
              <span>Active Store</span>
            </span>
            <span className="text-[10px] text-emerald-700 underline group-hover:text-emerald-900">
              Change
            </span>
          </div>
          <p className="font-extrabold text-slate-900 mt-1.5 text-sm truncate">
            {profile.shopName}
          </p>
          <p className="text-slate-500 text-[11px] mt-0.5 truncate">
            {activeOption.name}
          </p>
        </div>
      </div>
    </aside>
  );
};
