import React from 'react';
import { 
  IndianRupee, 
  Package, 
  AlertTriangle, 
  AlertCircle, 
  ShoppingCart, 
  ScanLine, 
  TrendingUp, 
  ArrowUpRight,
  PackageCheck
} from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { PageRoute, Product, ActionRecommendation, RecentSale, StoreProfile } from '../types';

interface DashboardProps {
  setActivePage: (page: PageRoute) => void;
  profile: StoreProfile;
  products: Product[];
  recommendations: ActionRecommendation[];
  recentSales: RecentSale[];
}

export const Dashboard: React.FC<DashboardProps> = ({
  setActivePage,
  profile,
  products,
  recommendations,
  recentSales,
}) => {
  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === profile.businessTypeId) || BUSINESS_TYPE_OPTIONS[0];

  const lowStockCount = products.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock').length;

  return (
    <div className="space-y-6 font-sans">
      
      {/* Header Greeting */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1.5">
              <span>{activeOption.emoji}</span>
              <span>{profile.shopName}</span>
            </span>
            <button
              onClick={() => setActivePage('select-store')}
              className="text-[11px] font-bold text-slate-500 hover:text-emerald-700 underline"
            >
              Switch Store Type
            </button>
          </div>
          
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
            Good Morning 👋
          </h1>
          <p className="text-base text-slate-600 font-medium mt-0.5">
            {activeOption.greetingWording}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => setActivePage('sales')}
            icon={<ShoppingCart className="w-5 h-5" />}
          >
            + New Sale Counter
          </Button>
        </div>
      </div>

      {/* 4 Key Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Sales"
          value="₹4,850"
          subtitle="Updated 10m ago"
          icon={<IndianRupee className="w-6 h-6 text-emerald-600" />}
          badgeText="+14% today"
          badgeColor="emerald"
          onClick={() => setActivePage('sales')}
        />
        <StatCard
          title="Total Products"
          value={products.length}
          subtitle={`In ${activeOption.name} catalog`}
          icon={<Package className="w-6 h-6 text-blue-600" />}
          badgeText="Active Catalog"
          badgeColor="blue"
          onClick={() => setActivePage('inventory')}
        />
        <StatCard
          title="Low Stock Alert"
          value={lowStockCount}
          subtitle="Items needing reorder"
          icon={<AlertTriangle className="w-6 h-6 text-amber-600" />}
          badgeText="Action Required"
          badgeColor="amber"
          onClick={() => setActivePage('inventory')}
        />
        <StatCard
          title="Needs Attention"
          value={recommendations.length}
          subtitle="Daily store priorities"
          icon={<AlertCircle className="w-6 h-6 text-rose-600" />}
          badgeText="Priority"
          badgeColor="rose"
        />
      </div>

      {/* TODAY'S ACTIONS Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-white rounded-3xl border-2 border-amber-300 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-amber-900 font-black text-lg uppercase tracking-wide">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <span>Today's Stock & Reorder Actions ({activeOption.name})</span>
          </div>
          <span className="text-xs font-bold text-slate-500 bg-amber-100/80 px-2.5 py-1 rounded-md">
            Smart Recommendations
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {recommendations.map((rec) => (
            <div 
              key={rec.id}
              className="bg-white rounded-2xl p-4 border border-amber-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2 font-bold text-slate-900 text-base">
                  <span className="text-amber-700">⚠️</span>
                  <span>{rec.productName}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">
                  {rec.message}
                </p>
                <div className="mt-2 text-sm font-extrabold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg inline-block border border-emerald-200">
                  📦 Recommended: {rec.recommendedOrder}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setActivePage('inventory')}
                icon={<PackageCheck className="w-4 h-4" />}
              >
                View Inventory
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* QUICK ACTION BUTTONS */}
      <div>
        <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setActivePage('sales')}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50/50 transition-all text-slate-800 font-bold shadow-xs cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <span className="text-base">Add Sale</span>
          </button>

          <button
            onClick={() => setActivePage('inventory')}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200 rounded-2xl hover:border-blue-500 hover:bg-blue-50/50 transition-all text-slate-800 font-bold shadow-xs cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <Package className="w-6 h-6" />
            </div>
            <span className="text-base">Inventory</span>
          </button>

          <button
            onClick={() => setActivePage('scanner')}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50/50 transition-all text-slate-800 font-bold shadow-xs cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <ScanLine className="w-6 h-6" />
            </div>
            <span className="text-base">Scan Invoice</span>
          </button>

          <button
            onClick={() => setActivePage('insights')}
            className="flex flex-col items-center justify-center p-5 bg-white border border-slate-200 rounded-2xl hover:border-amber-500 hover:bg-amber-50/50 transition-all text-slate-800 font-bold shadow-xs cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <TrendingUp className="w-6 h-6" />
            </div>
            <span className="text-base">Insights</span>
          </button>
        </div>
      </div>

      {/* Grid: Low Stock Alert & Recent Sales Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Low Stock Items List */}
        <Card>
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <span>Low Stock Items ({lowStockCount})</span>
            </h3>
            <button
              onClick={() => setActivePage('inventory')}
              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
            >
              View All <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {products
              .filter((p) => p.status === 'Low Stock' || p.status === 'Out of Stock')
              .map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.category} • Selling: ₹{item.price} | Cost: ₹{item.purchasePrice}</p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        item.status === 'Out of Stock'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {item.stock} {item.unit} ({item.status})
                    </span>
                  </div>
                </div>
              ))}

            {products.filter((p) => p.status === 'Low Stock' || p.status === 'Out of Stock').length === 0 && (
              <div className="py-8 text-center text-slate-500 text-sm">
                ✅ All stock levels healthy for {activeOption.name}!
              </div>
            )}
          </div>
        </Card>

        {/* Recent Sales List */}
        <Card>
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" />
              <span>Recent Sales Stream</span>
            </h3>
            <button
              onClick={() => setActivePage('sales')}
              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
            >
              New Sale <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {recentSales.map((sale) => (
              <div key={sale.id} className="py-3 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900 text-sm">{sale.items}</p>
                  <p className="text-xs text-slate-500">{sale.time}</p>
                </div>
                <div className="text-right font-extrabold text-emerald-700 text-base">
                  ₹{sale.total}
                </div>
              </div>
            ))}
          </div>
        </Card>

      </div>

    </div>
  );
};
