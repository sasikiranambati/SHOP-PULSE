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

  // Only real figures are shown: "…" while loading, "—" when there is no data yet.
  const placeholder = loading ? '…' : '—';

  const weeklyRevenueValue = weeklyTrend 
    ? `₹${weeklyTrend.totalRevenue.toLocaleString('en-IN')}`
    : placeholder;

  const customerCountValue = stats 
    ? `${stats.todayOrders} shoppers`
    : placeholder;

  const topCategoryValue = stats?.topCategory?.name && stats.topCategory.name !== 'None'
    ? `${stats.topCategory.name} (${stats.topCategory.sharePercentage}%)`
    : placeholder;

  const growth = weeklyTrend?.growthRatePercentage;
  const growthBadge = typeof growth === 'number' && Number.isFinite(growth)
    ? `${growth >= 0 ? '+' : ''}${Math.round(growth)}% growth`
    : undefined;

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto min-w-0">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={t('insights.title')}
          description={t('insights.description')}
        />
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E3E5DE] hover:bg-[#F7F5EF] text-[#202923] rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#234B3A] ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Refreshing...' : 'Refresh Analytics'}</span>
        </button>
      </div>

      {/* 1. Business Overview Stat Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title={t('insights.weeklyRevenue')}
          value={weeklyRevenueValue}
          subtitle={t('insights.past7Days')}
          icon={<TrendingUp className="w-5 h-5 text-[#234B3A]" />}
          badgeText={growthBadge}
          badgeColor="emerald"
        />
        <StatCard
          title={t('insights.dailyCustomerCount')}
          value={customerCountValue}
          subtitle={t('insights.walkInCheckout')}
          icon={<Calendar className="w-5 h-5 text-[#234B3A]" />}
          badgeText={stats ? 'Live Data' : undefined}
          badgeColor="emerald"
        />
        <StatCard
          title={t('insights.topCategory')}
          value={topCategoryValue}
          subtitle={t('insights.highestTurnover')}
          icon={<Award className="w-5 h-5 text-[#A66A16]" />}
          badgeText={topCategoryValue !== '—' && topCategoryValue !== '…' ? 'High Demand' : undefined}
          badgeColor="amber"
        />
      </div>

      {/* 2. Sales Trend Chart */}
      <SalesChart 
        data={weeklyTrend?.points} 
        peakText={weeklyTrend?.peakDay && weeklyTrend.peakDay.amount > 0 ? `Peak: ${weeklyTrend.peakDay.day} (₹${(weeklyTrend.peakDay.amount / 1000).toFixed(1)}k)` : undefined}
      />

      {/* 3. Best Sellers & Stock Alerts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Top Selling Products List */}
        <Card>
          <div className="flex items-center justify-between pb-4 border-b border-[#E3E5DE]">
            <h3 className="font-bold text-[#202923] text-base sm:text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-[#A66A16]" />
              <span>{t('insights.topSellingProducts')}</span>
            </h3>
            {topProducts.length > 0 && (
              <span className="text-xs font-semibold text-[#69736C] bg-[#F7F5EF] px-2.5 py-1 rounded-md">
                Top {topProducts.length}
              </span>
            )}
          </div>

          <div className="divide-y divide-[#E3E5DE] mt-2">
            {loading && topProducts.length === 0 && (
              <p role="status" className="py-6 text-center text-xs font-medium text-[#69736C]">Loading top sellers…</p>
            )}
            {!loading && topProducts.length === 0 && (
              <p className="py-8 text-center text-[#69736C] text-xs font-normal">No sales recorded yet. Top performing products will appear here.</p>
            )}
            {topProducts.map((item) => (
              <div key={item.rank} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-[#234B3A] text-white font-bold text-xs flex items-center justify-center shrink-0">
                    #{item.rank}
                  </span>
                  <div>
                    <p className="font-bold text-[#202923] text-sm leading-tight">{item.productName}</p>
                    <p className="text-xs text-[#69736C] font-medium">
                      {item.category} • {item.quantitySold} {item.unit || 'units'} sold
                    </p>
                  </div>
                </div>
                <div className="text-right font-extrabold text-[#202923] text-sm">
                  ₹{item.revenue.toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Stock Alerts Summary */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
              <h3 className="font-bold text-[#202923] text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[#A66A16]" />
                <span>{t('insights.stockAlertHighlights')}</span>
              </h3>
              {lowStockInsights.length > 0 && (
                <span className="text-xs font-semibold text-[#A66A16] bg-[#FEF9EB] px-2.5 py-0.5 rounded-full border border-[#A66A16]/30">
                  {t('insights.actionNeeded')}
                </span>
              )}
            </div>

            <div className="mt-3 space-y-2.5">
              {loading && lowStockInsights.length === 0 && (
                <p role="status" className="py-6 text-center text-xs font-medium text-[#69736C]">Checking stock levels…</p>
              )}
              {!loading && lowStockInsights.length === 0 && (
                <p className="py-8 text-center text-[#69736C] text-xs font-normal">All inventory levels are healthy. No items require urgent restocking.</p>
              )}
              {lowStockInsights.slice(0, 3).map((it, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-lg border text-xs ${
                    it.urgency === 'critical'
                      ? 'bg-[#FDF2F2] border-[#B93838]/25 text-[#B93838]'
                      : it.urgency === 'high'
                        ? 'bg-[#FEF9EB] border-[#A66A16]/25 text-[#A66A16]'
                        : 'bg-[#E5EEE6] border-[#52745D]/25 text-[#234B3A]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-bold">
                      {it.urgency === 'critical' ? 'Critical Stock' : 'Low Stock'}: {it.productName} ({it.currentStock} {it.unit} left)
                    </p>
                    <span className="font-semibold text-[10px] px-1.5 py-0.5 rounded bg-white/80">
                      {it.estimatedDaysUntilStockout === 0 ? 'Depleted' : `~${it.estimatedDaysUntilStockout}d left`}
                    </span>
                  </div>
                  <p className="mt-0.5 font-normal opacity-90">
                    Velocity pace indicates restock of {it.recommendedRestockQuantity} {it.unit} recommended.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>

      </div>

      {/* 4. AI Demand Forecasting & Smart Recommendations */}
      <Card className="border border-[#E3E5DE] bg-white shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
          <div className="flex items-center gap-2 text-[#202923] font-bold text-base sm:text-lg">
            <BarChart2 className="w-5 h-5 text-[#234B3A]" />
            <span>{t('insights.aiForecasting')}</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#234B3A] bg-[#E5EEE6] px-2.5 py-0.5 rounded-full border border-[#52745D]/30">
            <Sparkles className="w-3 h-3 text-[#234B3A]" />
            AI Active
          </span>
        </div>

        {aiInsights.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiInsights.map((insight) => (
              <div 
                key={insight.id} 
                className="bg-white rounded-lg p-3.5 border border-[#E3E5DE] shadow-xs flex items-start gap-3"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  insight.type === 'urgent'
                    ? 'bg-[#FDF2F2] text-[#B93838] border border-[#B93838]/20'
                    : insight.type === 'warning'
                      ? 'bg-[#FEF9EB] text-[#A66A16] border border-[#A66A16]/20'
                      : insight.type === 'success'
                        ? 'bg-[#E5EEE6] text-[#234B3A] border border-[#52745D]/20'
                        : 'bg-[#E5EEE6] text-[#234B3A] border border-[#52745D]/20'
                }`}>
                  {insight.type === 'urgent' ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : insight.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-[#202923] truncate">
                      {insight.title}
                    </h4>
                    {insight.metric && (
                      <span className="text-[10px] font-bold text-[#234B3A] bg-[#E5EEE6] px-2 py-0.5 rounded-full border border-[#52745D]/25 shrink-0">
                        {insight.metric}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#69736C] mt-1 font-normal leading-relaxed">
                    {insight.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-[#234B3A] text-white mx-auto flex items-center justify-center shadow-xs">
              <Sparkles className="w-6 h-6" />
            </div>
            <h4 className="text-lg font-bold text-[#202923]">
              "{t('insights.knowWhatToOrder')}"
            </h4>
            <p className="text-xs sm:text-sm text-[#69736C] max-w-md mx-auto font-normal leading-relaxed">
              {t('insights.aiDescription')}
            </p>
          </div>
        )}
      </Card>

    </div>
  );
};
