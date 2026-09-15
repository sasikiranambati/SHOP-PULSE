import React from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  BarChart2, 
  Info, 
  Award,
  Calendar
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';

export const Insights: React.FC = () => {
  const topProducts = [
    { rank: 1, name: 'Toned Milk (500ml)', sold: '140 pkts', revenue: '₹3,920' },
    { rank: 2, name: 'Marie Gold Biscuits', sold: '85 packs', revenue: '₹2,125' },
    { rank: 3, name: 'Coca Cola (750ml)', sold: '60 bottles', revenue: '₹2,400' },
    { rank: 4, name: 'White Bread (400g)', sold: '42 loaves', revenue: '₹1,890' },
  ];

  return (
    <div className="space-y-6">
      
      <PageHeader
        title="Shop Insights & Analytics"
        description="Understand sales trends and future product demand"
      />

      {/* Phase 0 Information Notice */}
      <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4 text-emerald-900 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-bold">Phase 0 Intelligence Preview</p>
          <p className="mt-0.5 text-emerald-800">
            Real-time sales patterns and AI demand forecasting will be connected in Phase 2.
          </p>
        </div>
      </div>

      {/* Sales Overview Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Weekly Revenue"
          value="₹34,200"
          subtitle="Past 7 days"
          icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
          badgeText="+18% growth"
          badgeColor="emerald"
        />
        <StatCard
          title="Avg. Daily Customers"
          value="68"
          subtitle="Walk-in sales"
          icon={<Calendar className="w-6 h-6 text-blue-600" />}
          badgeText="Steady"
          badgeColor="blue"
        />
        <StatCard
          title="Top Category"
          value="Dairy"
          subtitle="42% of total sales"
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
              <span>Top Selling Products This Week</span>
            </h3>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
              Top 4
            </span>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {topProducts.map((item) => (
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
            <div className="flex items-center gap-2 text-slate-800 font-extrabold text-lg pb-3 border-b border-slate-200">
              <BarChart2 className="w-5 h-5 text-emerald-600" />
              <span>Demand Outlook & Forecasting</span>
            </div>

            <div className="py-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
                <Sparkles className="w-7 h-7" />
              </div>
              <h4 className="text-lg font-bold text-slate-900">
                "Demand forecasting will appear here."
              </h4>
              <p className="text-sm text-slate-600 max-w-xs mx-auto">
                In Phase 2, ShopPulse AI will predict next week's demand for every product to prevent out-of-stock losses.
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
