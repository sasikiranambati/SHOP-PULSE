import React from 'react';
import { 
  Store, 
  ScanLine, 
  Sliders, 
  Info, 
  ChevronRight, 
  LogOut, 
  PhoneCall, 
  IndianRupee,
  Bell
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import type { PageRoute } from '../types';

interface SettingsProps {
  shopName: string;
  setActivePage: (page: PageRoute) => void;
  onLogout: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  shopName,
  setActivePage,
  onLogout,
}) => {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        title="Settings & Shop Profile"
        description="Manage store preferences, quick tools, and account settings"
      />

      {/* 1. Shop Profile Card */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-emerald-600/20 shrink-0">
          <Store className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
            Kirana & General Store
          </span>
          <h2 className="text-xl font-black text-slate-900 truncate mt-1">
            {shopName}
          </h2>
          <p className="text-xs text-slate-500 font-bold truncate">
            Retail Partner ID: #KP-88421 • Bangalore
          </p>
        </div>
      </div>

      {/* 2. Quick Tools List */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          Quick Tools
        </div>

        <button
          onClick={() => setActivePage('scanner')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">Scan Supplier Invoice</p>
              <p className="text-xs text-slate-500 font-medium">Snap paper bills to auto-fill stock</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>

        <button
          onClick={() => setActivePage('insights')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">Shop Analytics & Trends</p>
              <p className="text-xs text-slate-500 font-medium">View weekly sales and top categories</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 3. Preferences */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          Preferences & Configuration
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">Currency Format</p>
              <p className="text-xs text-slate-500 font-medium">Indian Rupee (₹ INR)</p>
            </div>
          </div>
          <span className="text-xs font-black bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200">
            Active
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">Low Stock Alerts</p>
              <p className="text-xs text-slate-500 font-medium">Highlight items below minimum threshold</p>
            </div>
          </div>
          <span className="text-xs font-black bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-200">
            Enabled
          </span>
        </div>
      </div>

      {/* 4. Help & About */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          Help & Info
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">ShopPulse Support Line</p>
              <p className="text-xs text-slate-500 font-medium">Toll Free: 1800-SHOP-PULSE</p>
            </div>
          </div>
          <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
            24/7 Support
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">App Version</p>
              <p className="text-xs text-slate-500 font-medium">ShopPulse Mobile Assistant v1.0 (Production UI)</p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
            v1.0.0
          </span>
        </div>
      </div>

      {/* Logout Action */}
      <button
        onClick={onLogout}
        className="w-full py-4 px-6 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-black text-base flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
      >
        <LogOut className="w-5 h-5 text-rose-600" />
        <span>Log Out of ShopPulse</span>
      </button>

    </div>
  );
};
