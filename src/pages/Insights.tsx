import React from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  BarChart2, 
  Info, 
  Award,
  Calendar,
  Clock
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { StoreProfile } from '../types';

interface InsightsProps {
  profile: StoreProfile;
  topSelling: Array<{ rank: number; name: string; sold: string; revenue: string }>;
}

export const Insights: React.FC<InsightsProps> = ({ profile, topSelling }) => {
  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === profile.businessTypeId) || BUSINESS_TYPE_OPTIONS[0];

  return (
    <div className="space-y-6 font-sans">
      
      <PageHeader
        title={`Shop Insights & Analytics (${activeOption.name})`}
        description={`Sales trends and product intelligence for ${profile.shopName}`}
      />

      {/* Clear Phase 3 Banner */}
      <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-300 p-4 text-emerald-950 flex items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="font-extrabold text-sm uppercase tracking-wide text-emerald-900">
              AI Demand Forecasting — Coming in Phase 3
            </p>
            <p className="mt-0.5 text-xs text-emerald-800 font-semibold">
              Machine learning forecasting and automatic stockout prediction for {activeOption.name} will activate in Phase 3.
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-black bg-emerald-800 text-white px-3 py-1 rounded-lg">
          Phase 3 Preview
        </span>
      </div>

      {/* Sales Overview Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Weekly Sales Trend"
          value="₹34,200"
          subtitle="Past 7 days revenue"
          icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
          badgeText="+18% growth"
          badgeColor="emerald"
        />
        <StatCard
          title="Customer Footfall"
          value="68 / day"
          subtitle="Daily sales average"
          icon={<Calendar className="w-6 h-6 text-blue-600" />}
          badgeText="Steady"
          badgeColor="blue"
        />
        <StatCard
          title="Top Category"
          value={activeOption.categoryList[0] || 'General'}
          subtitle="Highest margin category"
          icon={<Award className="w-6 h-6 text-amber-600" />}
          badgeText="High Demand"
          badgeColor="amber"
        />
      </div>

      {/* Main Grid: Top Selling & Demand Outlook */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top Selling Products List */}
        <Card>
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-600" />
              <span>Top Selling Products ({activeOption.name})</span>
            </h3>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
              Top Rankings
            </span>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {topSelling.map((item) => (
              <div key={item.rank} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-black text-xs flex items-center justify-center">
                    #{item.rank}
                  </span>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.sold} sold</p>
                  </div>
                </div>
                <div className="text-right font-extrabold text-slate-900 text-sm">
                  {item.revenue}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Demand Outlook Card */}
        <Card className="flex flex-col justify-between border-2 border-dashed border-slate-300 bg-slate-50/50">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-slate-800 font-extrabold text-lg">
                <BarChart2 className="w-5 h-5 text-emerald-600" />
                <span>Demand Insights</span>
              </div>
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-600" /> Coming in Phase 3
              </span>
            </div>

            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
                <Sparkles className="w-7 h-7" />
              </div>
              <h4 className="text-lg font-bold text-slate-900">
                "AI Demand Forecasting — Coming in Phase 3"
              </h4>
              <p className="text-sm text-slate-600 max-w-xs mx-auto font-medium leading-relaxed">
                ShopPulse AI will analyze historical sales to predict next week's demand for {profile.shopName} to prevent stockouts.
              </p>
            </div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>ML model predictions currently disabled for Phase 0 UI preview.</span>
          </div>
        </Card>

      </div>

    </div>
  );
};
