import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  ScanLine, 
  TrendingUp
} from 'lucide-react';
import type { PageRoute } from '../types';

interface SidebarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage }) => {
  const navItems = [
    { id: 'dashboard' as PageRoute, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sales' as PageRoute, label: 'Sales', icon: ShoppingCart },
    { id: 'inventory' as PageRoute, label: 'Inventory', icon: Package },
    { id: 'scanner' as PageRoute, label: 'Scan Invoice', icon: ScanLine },
    { id: 'insights' as PageRoute, label: 'Insights', icon: TrendingUp },
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

      {/* Footer Support Info */}
      <div className="pt-4 border-t border-slate-200 space-y-2">
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs">
          <p className="font-bold text-slate-800">Need Help?</p>
          <p className="text-slate-500 mt-0.5">Call ShopPulse Retail Support</p>
          <p className="font-semibold text-emerald-700 mt-1">1800-SHOP-PULSE</p>
        </div>
      </div>
    </aside>
  );
};
