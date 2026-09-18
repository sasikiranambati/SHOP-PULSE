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
  Plus,
  ShoppingBag
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SalesChart } from '../components/SalesChart';
import { SmartCounterWidget } from '../components/SmartCounterWidget';
import type { PageRoute, Product } from '../types';
import { MOCK_RECENT_SALES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import { useSales } from '../hooks/useSales';

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
  const { todaySummary, dashboardStats } = useSales();

  const todayRevenue = todaySummary ? todaySummary.todaySales : 8450;
  const itemsSoldToday = todaySummary ? todaySummary.itemsSoldToday : 42;
  const recentSalesList = dashboardStats?.recentSales && dashboardStats.recentSales.length > 0
    ? dashboardStats.recentSales
    : MOCK_RECENT_SALES;

  const lowStockItems = products.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock');
  const lowStockCount = lowStockItems.length;

  const topSellers = [
    { name: 'Toned Milk (500ml)', category: 'Dairy', sold: '42 sold today', price: '₹28' },
    { name: 'Fresh White Bread (400g)', category: 'Bakery', sold: '31 sold today', price: '₹45' },
    { name: 'Marie Gold Biscuits', category: 'Snacks', sold: '26 sold today', price: '₹25' },
    { name: 'Refined Sugar (1kg)', category: 'Staples', sold: '19 sold today', price: '₹48' },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      
      {/* 1. Header Greeting & Store Identity */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-block">
            {shopName}
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
            {t('dashboard.goodMorning')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-bold mt-0.5">
            "{t('dashboard.tagline')}"
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => setActivePage('sales')}
            icon={<Plus className="w-5 h-5" />}
            className="w-full sm:w-auto font-black"
          >
            {t('dashboard.newSale')}
          </Button>
        </div>
      </div>

      {/* 2. Today's Core Performance Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Today's Sales Card */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 rounded-3xl p-5 sm:p-6 text-white shadow-lg shadow-emerald-700/20 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-emerald-100">
                {t('dashboard.todaysSales')}
              </p>
              <div className="text-3xl sm:text-4xl font-black mt-1 tracking-tight">
                ₹{todayRevenue.toLocaleString('en-IN')}
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-white shrink-0">
              <IndianRupee className="w-6 h-6" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/20">
            <span className="text-xs font-bold text-emerald-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm">
              {t('dashboard.vsYesterday')}
            </span>
            <span className="text-xs font-semibold text-emerald-200">
              {t('dashboard.updatedAgo')}
            </span>
          </div>
        </div>

        {/* Today's Volume Card */}
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                {t('dashboard.itemsSoldToday')}
              </p>
              <div className="text-3xl sm:text-4xl font-black mt-1 text-slate-900 tracking-tight">
                {itemsSoldToday} units
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-6 h-6" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100">
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
              {t('dashboard.acrossBills')}
            </span>
            <button
              onClick={() => setActivePage('sales')}
              className="text-xs font-extrabold text-emerald-700 hover:underline cursor-pointer"
            >
              {t('dashboard.viewSales')}
            </button>
          </div>
        </div>
      </div>

      {/* 3. ⚠️ NEEDS YOUR ATTENTION Low Stock Banner */}
      <div className="bg-amber-50/90 rounded-3xl border border-amber-300/80 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-amber-900">
                {t('dashboard.needsAttention')}
              </div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base mt-0.5">
                {t('dashboard.itemsRunningLow', { count: lowStockCount })}
              </p>
            </div>
          </div>

          <button
            onClick={() => setActivePage('inventory')}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shrink-0"
          >
            {t('dashboard.restockAll')}
          </button>
        </div>

        {/* Quick horizontal restock list */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-amber-200/80">
          {lowStockItems.slice(0, 3).map((item) => (
            <div key={item.id} className="bg-white rounded-2xl p-3 border border-amber-200 flex items-center justify-between gap-2 shadow-2xs">
              <div className="min-w-0">
                <p className="font-extrabold text-slate-900 text-xs truncate">{item.name}</p>
                <p className="text-[11px] text-amber-800 font-bold mt-0.5">{item.stock} {item.unit} {t('dashboard.left')}</p>
              </div>
              <button
                onClick={() => setActivePage('inventory')}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-lg cursor-pointer shrink-0 active:scale-95 transition-transform"
              >
                {t('dashboard.restock')}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 4. ⚡ QUICK ACTIONS */}
      <div>
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2.5 px-1">
          {t('dashboard.quickActions')}
        </h2>
        
        {/* Mobile-Friendly Quick Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setActivePage('sales')}
            className="flex flex-col items-center justify-center p-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-extrabold shadow-sm cursor-pointer active:scale-95"
          >
            <Plus className="w-6 h-6 mb-1" />
            <span className="text-sm font-black">{t('dashboard.createSale')}</span>
          </button>

          <button
            onClick={() => setActivePage('inventory')}
            className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-slate-900 font-extrabold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-1.5">
              <Package className="w-5 h-5" />
            </div>
            <span className="text-xs font-black">{t('nav.stock')}</span>
          </button>

          <button
            onClick={() => setActivePage('scanner')}
            className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-2xl hover:border-purple-500 transition-all text-slate-900 font-extrabold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center mb-1.5">
              <ScanLine className="w-5 h-5" />
            </div>
            <span className="text-xs font-black">{t('dashboard.scanBill')}</span>
          </button>

          <button
            onClick={() => setActivePage('insights')}
            className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-2xl hover:border-amber-500 transition-all text-slate-900 font-extrabold shadow-xs cursor-pointer active:scale-95"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-1.5">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-xs font-black">{t('nav.insights')}</span>
          </button>
        </div>
      </div>

      {/* 5. Smart Counter IoT Hardware Widget */}
      <SmartCounterWidget />

      {/* 6. 📈 SALES OVERVIEW CHART & 🔥 TOP SELLERS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Sales Chart (2 cols desktop) */}
        <div className="lg:col-span-2">
          <SalesChart />
        </div>

        {/* Top Sellers (1 col desktop) */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500" />
                <span>{t('dashboard.topSellers')}</span>
              </h3>
              <button
                onClick={() => setActivePage('insights')}
                className="text-xs font-extrabold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                {t('dashboard.viewAll')} <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 mt-1">
              {topSellers.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                      #{idx + 1}
                    </span>
                    <div>
                      <p className="font-extrabold text-slate-900 text-xs sm:text-sm leading-tight">{item.name}</p>
                      <p className="text-[11px] text-slate-500 font-semibold">{item.category}</p>
                    </div>
                  </div>
                  <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 shrink-0">
                    {item.sold.split(' ')[0]} sold
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>

      </div>

      {/* 7. TODAY'S RECENT ACTIVITY */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span>{t('dashboard.recentActivity')}</span>
          </h3>
          <button
            onClick={() => setActivePage('sales')}
            className="text-xs font-extrabold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            {t('dashboard.createSale')} <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 mt-1">
          {recentSalesList.map((sale) => (
            <div key={sale.id} className="py-3 flex items-center justify-between gap-2">
              <div>
                <p className="font-extrabold text-slate-900 text-xs sm:text-sm leading-tight">{sale.items}</p>
                <p className="text-xs text-slate-500 font-medium mt-0.5">{sale.time}</p>
              </div>
              <div className="text-right font-black text-emerald-700 text-base shrink-0">
                ₹{sale.total}
              </div>
            </div>
          ))}
        </div>
      </Card>

    </div>
  );
};
