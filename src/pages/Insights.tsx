import React from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  BarChart2, 
  Award,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { SalesChart } from '../components/SalesChart';
import { useLanguage } from '../i18n/LanguageContext';

export const Insights: React.FC = () => {
  const { t } = useLanguage();

  const topProducts = [
    { rank: 1, name: 'Toned Milk (500ml)', sold: '140 pkts', revenue: '₹3,920', category: 'Dairy' },
    { rank: 2, name: 'Marie Gold Biscuits', sold: '85 packs', revenue: '₹2,125', category: 'Snacks' },
    { rank: 3, name: 'Coca Cola (750ml)', sold: '60 bottles', revenue: '₹2,400', category: 'Beverages' },
    { rank: 4, name: 'White Bread (400g)', sold: '42 loaves', revenue: '₹1,890', category: 'Bakery' },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      <PageHeader
        title={t('insights.title')}
        description={t('insights.description')}
      />

      {/* 1. 💰 Business Overview Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title={t('insights.weeklyRevenue')}
          value="₹34,200"
          subtitle={t('insights.past7Days')}
          icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
          badgeText="+18% growth"
          badgeColor="emerald"
        />
        <StatCard
          title={t('insights.dailyCustomerCount')}
          value="68 shoppers"
          subtitle={t('insights.walkInCheckout')}
          icon={<Calendar className="w-6 h-6 text-blue-600" />}
          badgeText="Steady"
          badgeColor="blue"
        />
        <StatCard
          title={t('insights.topCategory')}
          value="Dairy (42%)"
          subtitle={t('insights.highestTurnover')}
          icon={<Award className="w-6 h-6 text-amber-600" />}
          badgeText="High Demand"
          badgeColor="amber"
        />
      </div>

      {/* 2. 📈 Sales Trend Chart */}
      <SalesChart />

      {/* 3. 🔥 Best Sellers & ⚠️ Stock Alerts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top Selling Products List */}
        <Card>
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-black text-slate-900 text-base sm:text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-600" />
              <span>{t('insights.topSellingProducts')}</span>
            </h3>
            <span className="text-xs font-extrabold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
              Top 4
            </span>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {topProducts.map((item) => (
              <div key={item.rank} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                    #{item.rank}
                  </span>
                  <div>
                    <p className="font-extrabold text-slate-900 text-sm leading-tight">{item.name}</p>
                    <p className="text-xs text-slate-500 font-semibold">{item.category} • {item.sold}</p>
                  </div>
                </div>
                <div className="text-right font-black text-emerald-700 text-sm">
                  {item.revenue}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ⚠️ Stock Alerts Summary */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span>{t('insights.stockAlertHighlights')}</span>
              </h3>
              <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {t('insights.actionNeeded')}
              </span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs">
                <p className="font-black text-rose-900">Critical Stock: Maggi Noodles (2 left)</p>
                <p className="text-rose-700 mt-0.5 font-medium">Stock expected to run out today before evening shift.</p>
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs">
                <p className="font-black text-amber-900">Low Stock: Fresh White Bread (12 left)</p>
                <p className="text-amber-800 mt-0.5 font-medium">Reorder 20 loaves from local baker.</p>
              </div>

              <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs">
                <p className="font-black text-blue-900">Restock Reminder: Toned Milk 500ml</p>
                <p className="text-blue-800 mt-0.5 font-medium">Morning delivery scheduled at 6:00 AM tomorrow.</p>
              </div>
            </div>
          </div>
        </Card>

      </div>

      {/* 4. 🤖 AI Demand Forecasting */}
      <Card className="border-2 border-dashed border-emerald-300 bg-emerald-50/30">
        <div className="flex items-center gap-2 text-slate-900 font-black text-base sm:text-lg pb-3 border-b border-emerald-200">
          <BarChart2 className="w-5 h-5 text-emerald-600" />
          <span>{t('insights.aiForecasting')}</span>
        </div>

        <div className="py-8 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white mx-auto flex items-center justify-center shadow-md shadow-emerald-600/20">
            <Sparkles className="w-7 h-7" />
          </div>
          <h4 className="text-lg font-black text-slate-900">
            "{t('insights.knowWhatToOrder')}"
          </h4>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto font-semibold leading-relaxed">
            {t('insights.aiDescription')}
          </p>
          <div className="inline-block px-3 py-1 bg-amber-100 text-amber-900 font-extrabold text-xs rounded-full border border-amber-300">
            {t('insights.phaseNotice')}
          </div>
        </div>
      </Card>

    </div>
  );
};
