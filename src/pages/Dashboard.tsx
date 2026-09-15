import React from 'react';
import { 
  IndianRupee, 
  Package, 
  AlertTriangle, 
  Receipt, 
  ScanLine, 
  TrendingUp, 
  ArrowUpRight,
  Flame,
  Plus
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import type { PageRoute, Product } from '../types';
import { MOCK_RECENT_SALES } from '../data/mockData';

interface DashboardProps {
  setActivePage: (page: PageRoute) => void;
  products: Product[];
  shopName: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  setActivePage,
  products,
  shopName,
}) => {
  const lowStockCount = products.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock').length;

  const topSellers = [
    { name: 'Toned Milk (500ml)', category: 'Dairy', sold: '42 sold today', price: '₹28' },
    { name: 'Fresh White Bread (400g)', category: 'Bakery', sold: '31 sold today', price: '₹45' },
    { name: 'Marie Gold Biscuits', category: 'Snacks', sold: '26 sold today', price: '₹25' },
    { name: 'Refined Sugar (1kg)', category: 'Staples', sold: '19 sold today', price: '₹48' },
  ];

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      
      {/* 1. Header Greeting & Store Badge */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-block">
            {shopName}
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
            Good morning 👋
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            Your store pulse at a glance today.
          </p>
        </div>

        <div className="hidden sm:block">
          <Button
            variant="primary"
            size="md"
            onClick={() => setActivePage('sales')}
            icon={<Plus className="w-5 h-5" />}
          >
            New Sale
          </Button>
        </div>
      </div>

      {/* 2. Today's Sales Main Metric Card */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-3xl p-6 text-white shadow-lg shadow-emerald-700/20 relative overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-100">
              Today's Sales
            </p>
            <div className="text-4xl sm:text-5xl font-black mt-1 tracking-tight">
              ₹8,450
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white px-3 py-1 rounded-full text-xs font-bold">
              <span>↑ 12% from yesterday</span>
            </div>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-white shrink-0">
            <IndianRupee className="w-8 h-8" />
          </div>
        </div>
      </div>

      {/* 3. ⚠️ NEEDS ATTENTION Low Stock Banner */}
      <div className="bg-amber-50 rounded-3xl border border-amber-200 p-4 sm:p-5 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
              ⚠️ Needs Attention
            </div>
            <p className="font-extrabold text-slate-900 text-sm sm:text-base mt-0.5">
              {lowStockCount} items are running low
            </p>
          </div>
        </div>

        <button
          onClick={() => setActivePage('inventory')}
          className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-colors cursor-pointer shrink-0"
        >
          View Stock
        </button>
      </div>

      {/* 4. ⚡ QUICK ACTIONS (Large Touch Targets) */}
      <div>
        <h2 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-2.5 px-1">
          ⚡ Quick Actions
        </h2>
        
        {/* Primary Action Full Width on Mobile */}
        <button
          onClick={() => setActivePage('sales')}
          className="w-full mb-3 p-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-md shadow-emerald-600/20 active:scale-[0.99] transition-all cursor-pointer"
        >
          <Plus className="w-6 h-6" />
          <span>+ Create New Sale</span>
        </button>

        {/* Secondary Quick Action Grid */}
        <div className="grid grid-cols-3 gap-2.5">
          <button
            onClick={() => setActivePage('inventory')}
            className="flex flex-col items-center justify-center p-3.5 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-slate-900 font-bold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-1.5">
              <Package className="w-5 h-5" />
            </div>
            <span className="text-xs font-extrabold">Stock</span>
          </button>

          <button
            onClick={() => setActivePage('scanner')}
            className="flex flex-col items-center justify-center p-3.5 bg-white border border-slate-200 rounded-2xl hover:border-purple-500 transition-all text-slate-900 font-bold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center mb-1.5">
              <ScanLine className="w-5 h-5" />
            </div>
            <span className="text-xs font-extrabold">Scan Bill</span>
          </button>

          <button
            onClick={() => setActivePage('insights')}
            className="flex flex-col items-center justify-center p-3.5 bg-white border border-slate-200 rounded-2xl hover:border-amber-500 transition-all text-slate-900 font-bold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-1.5">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-xs font-extrabold">Insights</span>
          </button>
        </div>
      </div>

      {/* 5. 🔥 TOP SELLERS (Single Column Mobile List) */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <span>🔥 Top Sellers Today</span>
          </h3>
          <button
            onClick={() => setActivePage('insights')}
            className="text-xs font-extrabold text-emerald-700 hover:underline flex items-center gap-0.5"
          >
            Details <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 mt-1">
          {topSellers.map((item, idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                  #{idx + 1}
                </span>
                <div>
                  <p className="font-extrabold text-slate-900 text-sm leading-tight">{item.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.category}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 inline-block">
                  {item.sold}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 6. TODAY'S RECENT ACTIVITY */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span>Today's Activity</span>
          </h3>
          <button
            onClick={() => setActivePage('sales')}
            className="text-xs font-extrabold text-emerald-700 hover:underline flex items-center gap-0.5"
          >
            New Sale <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 mt-1">
          {MOCK_RECENT_SALES.map((sale) => (
            <div key={sale.id} className="py-2.5 flex items-center justify-between gap-2">
              <div>
                <p className="font-bold text-slate-900 text-sm leading-tight">{sale.items}</p>
                <p className="text-xs text-slate-500 mt-0.5">{sale.time}</p>
              </div>
              <div className="text-right font-black text-emerald-700 text-base">
                ₹{sale.total}
              </div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
};
