import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  ScanLine, 
  TrendingUp 
} from 'lucide-react';
import type { PageRoute } from '../types';

interface BottomNavProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activePage, setActivePage }) => {
  const navItems = [
    { id: 'dashboard' as PageRoute, label: 'Home', icon: LayoutDashboard },
    { id: 'sales' as PageRoute, label: 'Sales', icon: ShoppingCart },
    { id: 'inventory' as PageRoute, label: 'Stock', icon: Package },
    { id: 'scanner' as PageRoute, label: 'Scan', icon: ScanLine },
    { id: 'insights' as PageRoute, label: 'Insights', icon: TrendingUp },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-2 py-2 shadow-lg">
      <div className="flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'text-emerald-700 font-bold bg-emerald-50'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-600 scale-110' : ''}`} />
              <span className="text-[11px] mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
