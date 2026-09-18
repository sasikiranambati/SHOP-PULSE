import React from 'react';
import { 
  IndianRupee, 
  Package, 
  AlertTriangle, 
  ScanLine, 
  TrendingUp, 
  Flame,
  Plus,
  ShoppingBag,
  Store,
  ArrowRight
} from 'lucide-react';
import { SalesChart } from '../components/SalesChart';
import { SmartCounterWidget } from '../components/SmartCounterWidget';
import type { PageRoute, Product } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { t } = useLanguage();
  
  // Filter low stock items
  const lowStockItems = products.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock');
  const lowStockCount = lowStockItems.length;

  const displayShopName = shopName || 'Kiran General Store';

  const topSellers = [
    { name: 'Toned Milk (500ml)', sold: 42, unit: 'packets' },
    { name: 'Fresh White Bread (400g)', sold: 31, unit: 'packets' },
    { name: 'Marie Gold Biscuits', sold: 27, unit: 'packs' },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-6">
      
      {/* 1. Header: Greeting, Store Name & Profile Avatar */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-2xs flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <span>{t('dashboard.goodMorning')}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-flex items-center gap-1">
              <Store className="w-3.5 h-3.5 text-emerald-600" />
              {displayShopName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center justify-center font-black text-sm shadow-2xs">
            KG
          </div>
        </div>
      </div>

      {/* 2. Today's Performance Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <span className="text-xs font-black uppercase tracking-wider text-slate-400">
            TODAY
          </span>
          <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
            Live Updates
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4">
          <div className="bg-[#F8FAF8] rounded-2xl p-4 border border-emerald-100 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                Sales
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <IndianRupee className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
              ₹8,450
            </div>
          </div>

          <div className="bg-[#F8FAF8] rounded-2xl p-4 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                Items Sold
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
              42
            </div>
          </div>
        </div>
      </div>

      {/* 3. ⚠️ Needs Your Attention */}
      <div className="bg-amber-50/90 rounded-3xl border border-amber-200 p-4 sm:p-5 shadow-2xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <h2 className="text-xs sm:text-sm font-black uppercase tracking-wider text-amber-900">
              ⚠️ NEEDS YOUR ATTENTION
            </h2>
          </div>
          <span className="text-xs font-extrabold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full">
            {lowStockCount} items
          </span>
        </div>

        <p className="text-xs sm:text-sm font-extrabold text-slate-700 mb-3">
          {t('dashboard.itemsRunningLow', { count: lowStockCount })}
        </p>

        <div className="space-y-2">
          {lowStockItems.slice(0, 3).map((item) => (
            <div key={item.id} className="bg-white rounded-2xl p-3 border border-amber-200/80 flex items-center justify-between gap-3 shadow-2xs">
              <div className="min-w-0">
                <p className="font-black text-slate-900 text-xs sm:text-sm truncate">{item.name}</p>
                <p className="text-[11px] text-amber-800 font-bold mt-0.5">{item.stock} {item.unit} left</p>
              </div>
              <button
                onClick={() => setActivePage('inventory')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-xs rounded-xl transition-all cursor-pointer shrink-0 shadow-2xs"
              >
                {t('dashboard.restock')}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Quick Actions */}
      <div>
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2.5 px-1">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setActivePage('sales')}
            className="flex items-center gap-3 p-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-black shadow-sm cursor-pointer active:scale-[0.98] text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Plus className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-sm block font-black leading-tight">+ Sale</span>
              <span className="text-[10px] font-bold text-emerald-100">Create Bill</span>
            </div>
          </button>

          <button
            onClick={() => setActivePage('inventory')}
            className="flex items-center gap-3 p-4 bg-white border border-slate-200/90 rounded-2xl hover:border-emerald-500 transition-all text-slate-900 font-black shadow-2xs cursor-pointer active:scale-[0.98] text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm block font-black leading-tight">+ Product</span>
              <span className="text-[10px] font-bold text-slate-400">Add Item</span>
            </div>
          </button>

          <button
            onClick={() => setActivePage('inventory')}
            className="flex items-center gap-3 p-4 bg-white border border-slate-200/90 rounded-2xl hover:border-emerald-500 transition-all text-slate-900 font-black shadow-2xs cursor-pointer active:scale-[0.98] text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm block font-black leading-tight">+ Stock</span>
              <span className="text-[10px] font-bold text-slate-400">Restock</span>
            </div>
          </button>

          <button
            onClick={() => setActivePage('scanner')}
            className="flex items-center gap-3 p-4 bg-white border border-slate-200/90 rounded-2xl hover:border-purple-500 transition-all text-slate-900 font-black shadow-2xs cursor-pointer active:scale-[0.98] text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm block font-black leading-tight">📷 Scan Bill</span>
              <span className="text-[10px] font-bold text-slate-400">Supplier Bill</span>
            </div>
          </button>
        </div>
      </div>

      {/* 5. Smart Counter IoT Hardware Widget */}
      <SmartCounterWidget />

      {/* 6. Top Sellers */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-2xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h2 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <span>🔥 Top Sellers</span>
          </h2>
          <button
            onClick={() => setActivePage('insights')}
            className="text-xs font-black text-emerald-700 hover:underline cursor-pointer flex items-center gap-1"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 mt-2">
          {topSellers.map((item, idx) => (
            <div key={idx} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-7 h-7 rounded-xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                  #{idx + 1}
                </span>
                <p className="font-black text-slate-900 text-xs sm:text-sm truncate">{item.name}</p>
              </div>
              <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200 shrink-0">
                {item.sold} sold
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Sales Overview Chart */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-2xs">
        <h2 className="font-black text-slate-900 text-sm sm:text-base mb-4">
          Sales Overview
        </h2>
        <SalesChart />
      </div>

    </div>
  );
};
