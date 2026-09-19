import React from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  BarChart2, 
  Award, 
  Calendar, 
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { SalesChart } from '../components/SalesChart';
import { useLanguage } from '../i18n/LanguageContext';
import { useAnalytics } from '../hooks/useAnalytics';

export const Insights: React.FC = () => {
  const { t } = useLanguage();
  const { 
    stats, 
    weeklyTrend, 
    topProducts, 
    lowStockInsights, 
    aiInsights, 
    loading, 
    refresh 
  } = useAnalytics();

  const weeklyRevenueValue = weeklyTrend 
    ? `₹${weeklyTrend.totalRevenue.toLocaleString('en-IN')}`
    : '₹34,200';

  const customerCountValue = stats 
    ? `${stats.todayOrders} shoppers`
    : '68 shoppers';

  const topCategoryValue = stats 
    ? `${stats.topCategory.name} (${stats.topCategory.sharePercentage}%)`
    : 'Dairy (42%)';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={t('insights.title')}
          description={t('insights.description')}
        />
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Refreshing...' : 'Refresh Analytics'}</span>
        </button>
      </div>

      {/* 1. 💰 Business Overview Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title={t('insights.weeklyRevenue')}
          value={weeklyRevenueValue}
          subtitle={t('insights.past7Days')}
          icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
          badgeText={`+${weeklyTrend?.growthRatePercentage || 18}% growth`}
          badgeColor="emerald"
        />
        <StatCard
          title={t('insights.dailyCustomerCount')}
          value={customerCountValue}
          subtitle={t('insights.walkInCheckout')}
          icon={<Calendar className="w-6 h-6 text-blue-600" />}
          badgeText="Live Data"
          badgeColor="blue"
        />
        <StatCard
          title={t('insights.topCategory')}
          value={topCategoryValue}
          subtitle={t('insights.highestTurnover')}
          icon={<Award className="w-6 h-6 text-amber-600" />}
          badgeText="High Demand"
          badgeColor="amber"
        />
      </div>

      {/* 2. 📈 Sales Trend Chart */}
      <SalesChart 
        data={weeklyTrend?.points} 
        peakText={weeklyTrend?.peakDay ? `Peak: ${weeklyTrend.peakDay.day} (₹${(weeklyTrend.peakDay.amount / 1000).toFixed(1)}k)` : undefined}
      />

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
              Top {topProducts.length > 0 ? topProducts.length : 4}
            </span>
          </div>

          <div className="divide-y divide-slate-100 mt-2">
            {(topProducts.length > 0 ? topProducts : [
              { rank: 1, productName: 'Toned Milk (500ml)', quantitySold: 140, revenue: 3920, category: 'Dairy', unit: 'pkts' },
              { rank: 2, productName: 'Marie Gold Biscuits', quantitySold: 85, revenue: 2125, category: 'Snacks', unit: 'packs' },
              { rank: 3, productName: 'Coca Cola (750ml)', quantitySold: 60, revenue: 2400, category: 'Beverages', unit: 'bottles' },
              { rank: 4, productName: 'White Bread (400g)', quantitySold: 42, revenue: 1890, category: 'Bakery', unit: 'loaves' }
            ]).map((item) => (
              <div key={item.rank} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                    #{item.rank}
                  </span>
                  <div>
                    <p className="font-extrabold text-slate-900 text-sm leading-tight">{item.productName}</p>
                    <p className="text-xs text-slate-500 font-semibold">
                      {item.category} • {item.quantitySold} {item.unit || 'units'} sold
                    </p>
                  </div>
                </div>
                <div className="text-right font-black text-emerald-700 text-sm">
                  ₹{item.revenue.toLocaleString('en-IN')}
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
              {(lowStockInsights.length > 0 ? lowStockInsights.slice(0, 3) : [
                {
                  productName: 'Maggi Noodles',
                  currentStock: 2,
                  unit: 'packs',
                  estimatedDaysUntilStockout: 1,
                  recommendedRestockQuantity: 20,
                  urgency: 'critical' as const
                },
                {
                  productName: 'Fresh White Bread',
                  currentStock: 12,
                  unit: 'loaves',
                  estimatedDaysUntilStockout: 2,
                  recommendedRestockQuantity: 25,
                  urgency: 'high' as const
                },
                {
                  productName: 'Toned Milk 500ml',
                  currentStock: 15,
                  unit: 'pkts',
                  estimatedDaysUntilStockout: 3,
                  recommendedRestockQuantity: 40,
                  urgency: 'medium' as const
                }
              ]).map((it, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-xl border text-xs ${
                    it.urgency === 'critical'
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : it.urgency === 'high'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-blue-50 border-blue-200 text-blue-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-black">
                      {it.urgency === 'critical' ? 'Critical Stock' : 'Low Stock'}: {it.productName} ({it.currentStock} {it.unit} left)
                    </p>
                    <span className="font-bold text-[10px] px-1.5 py-0.5 rounded bg-white/70">
                      {it.estimatedDaysUntilStockout === 0 ? 'Depleted' : `~${it.estimatedDaysUntilStockout}d left`}
                    </span>
                  </div>
                  <p className="mt-0.5 font-medium opacity-90">
                    Velocity pace indicates restock of {it.recommendedRestockQuantity} {it.unit} recommended.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>

      </div>

      {/* 4. 🤖 AI Demand Forecasting & Smart Recommendations */}
      <Card className="border-2 border-dashed border-emerald-300 bg-emerald-50/20">
        <div className="flex items-center justify-between pb-3 border-b border-emerald-200">
          <div className="flex items-center gap-2 text-slate-900 font-black text-base sm:text-lg">
            <BarChart2 className="w-5 h-5 text-emerald-600" />
            <span>{t('insights.aiForecasting')}</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
            <Sparkles className="w-3 h-3 text-emerald-600" />
            AI Active
          </span>
        </div>

        {aiInsights.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiInsights.map((insight) => (
              <div 
                key={insight.id}
                className="bg-white rounded-xl p-4 border border-emerald-100 shadow-xs flex items-start gap-3"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  insight.type === 'urgent'
                    ? 'bg-rose-100 text-rose-600'
                    : insight.type === 'warning'
                      ? 'bg-amber-100 text-amber-600'
                      : insight.type === 'success'
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-blue-100 text-blue-600'
                }`}>
                  {insight.type === 'urgent' ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : insight.type === 'success' ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Sparkles className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                      {insight.title}
                    </h4>
                    {insight.metric && (
                      <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                        {insight.metric}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1 font-medium leading-relaxed">
                    {insight.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
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
          </div>
        )}
      </Card>

    </div>
  );
};
