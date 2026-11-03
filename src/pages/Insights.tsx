import React, { useMemo } from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  BarChart2, 
  Award, 
  Calendar, 
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Package,
  Clock,
  Filter,
  ShieldAlert
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { SalesChart } from '../components/SalesChart';
import { StockoutRiskBadge } from '../components/StockoutRiskBadge';
import { useLanguage } from '../i18n/LanguageContext';
import { useAnalytics } from '../hooks/useAnalytics';
import { useForecast } from '../hooks/useForecast';
import type { ProductForecast } from '../types/forecast';

export const Insights: React.FC = () => {
  const { t } = useLanguage();
  const { 
    stats, 
    weeklyTrend, 
    topProducts, 
    lowStockInsights, 
    loading: analyticsLoading, 
    refresh: refreshAnalytics 
  } = useAnalytics();

  const {
    summary: forecastSummary,
    items: forecastItems,
    loading: forecastLoading,
    error: forecastError,
    refresh: refreshForecast,
    selectedCategory,
    setCategory
  } = useForecast();

  const isGlobalLoading = analyticsLoading || forecastLoading;

  const handleGlobalRefresh = async () => {
    await Promise.allSettled([refreshAnalytics(), refreshForecast()]);
  };

  const weeklyRevenueValue = weeklyTrend 
    ? `₹${weeklyTrend.totalRevenue.toLocaleString('en-IN')}`
    : '₹34,200';

  const customerCountValue = stats 
    ? `${stats.todayOrders} shoppers`
    : '68 shoppers';

  const topCategoryValue = stats 
    ? `${stats.topCategory.name} (${stats.topCategory.sharePercentage}%)`
    : 'Dairy (42%)';

  // 1. Forecast Summary Counts (Mutually Exclusive Partition)
  const totalProductsForecast = forecastSummary?.total_products_analyzed ?? forecastItems.length;

  const criticalRiskCount = useMemo(() => {
    return forecastItems.filter(
      (item) => item.stockout_risk === 'OUT_OF_STOCK' || item.stockout_risk === 'HIGH'
    ).length;
  }, [forecastItems]);

  const mediumRiskCount = useMemo(() => {
    return forecastItems.filter((item) => item.stockout_risk === 'MEDIUM').length;
  }, [forecastItems]);

  const lowRiskCount = useMemo(() => {
    return forecastItems.filter((item) => item.stockout_risk === 'LOW').length;
  }, [forecastItems]);

  const buildingHistoryCount = useMemo(() => {
    return forecastItems.filter(
      (item) =>
        (item.confidence_status === 'INSUFFICIENT_DATA' || item.stockout_risk === 'UNKNOWN') &&
        item.stockout_risk !== 'HIGH' &&
        item.stockout_risk !== 'OUT_OF_STOCK'
    ).length;
  }, [forecastItems]);

  // 2. Actionable Insights: "Needs Your Attention" Prioritized Items (Requirement 5)
  // Priority: 1. OUT_OF_STOCK -> 2. HIGH -> 3. MEDIUM -> 4. stockout-censored warnings
  const attentionItems = useMemo(() => {
    const getPriorityRank = (item: ProductForecast): number => {
      if (item.stockout_risk === 'OUT_OF_STOCK') return 1;
      if (item.stockout_risk === 'HIGH') return 2;
      if (item.stockout_risk === 'MEDIUM') return 3;
      if (item.has_stockout_censoring) return 4;
      return 5;
    };

    return forecastItems
      .filter(
        (item) =>
          item.stockout_risk === 'OUT_OF_STOCK' ||
          item.stockout_risk === 'HIGH' ||
          item.stockout_risk === 'MEDIUM' ||
          item.has_stockout_censoring
      )
      .sort((a, b) => {
        const rankDiff = getPriorityRank(a) - getPriorityRank(b);
        if (rankDiff !== 0) return rankDiff;

        // Tie-break: lowest days_until_stockout first
        if (a.days_until_stockout !== null && b.days_until_stockout !== null) {
          return a.days_until_stockout - b.days_until_stockout;
        }
        if (a.days_until_stockout !== null) return -1;
        if (b.days_until_stockout !== null) return 1;
        return a.product_name.localeCompare(b.product_name);
      });
  }, [forecastItems]);

  // Category filter pills
  const categoryFilters = ['All', 'Dairy', 'Groceries', 'Snacks', 'Beverages', 'Bakery', 'Household', 'Personal Care', 'Staples'];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title={t('insights.title')}
          description={t('insights.description')}
        />
        <button
          onClick={handleGlobalRefresh}
          disabled={isGlobalLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto disabled:opacity-50"
          title="Refresh shop analytics and forecasting data"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${isGlobalLoading ? 'animate-spin' : ''}`} />
          <span>{isGlobalLoading ? 'Refreshing...' : 'Refresh Analytics'}</span>
        </button>
      </div>

      {/* 1. Business Overview Stat Row (Preserved) */}
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

      {/* 2. Sales Trend Chart (Preserved) */}
      <SalesChart 
        data={weeklyTrend?.points} 
        peakText={weeklyTrend?.peakDay ? `Peak: ${weeklyTrend.peakDay.day} (₹${(weeklyTrend.peakDay.amount / 1000).toFixed(1)}k)` : undefined}
      />

      {/* 3. Best Sellers & Stock Alerts Grid (Preserved) */}
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

        {/* Stock Alerts Summary */}
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

      {/* 4. Functional Statistical Demand Forecasting & Inventory Intelligence Section */}
      <div className="space-y-4">
        
        {/* Main Section Header Card */}
        <Card className="border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-slate-900 text-lg">
                  {t('insights.aiForecasting')}
                </h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-300">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  Statistical Engine Active
                </span>
              </div>
              <p className="text-xs text-slate-500 font-semibold mt-1">
                7-day Moving Average (MA-7) & Weekday Seasonal models with stockout-censoring detection
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                onClick={() => refreshForecast()}
                disabled={forecastLoading}
                data-testid="forecast-refresh-button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                title="Refresh demand forecast predictions"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 ${forecastLoading ? 'animate-spin' : ''}`} />
                <span>{forecastLoading ? 'Calculating...' : 'Recalculate Forecast'}</span>
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="pt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-400 font-bold flex items-center gap-1 shrink-0 mr-1 text-[11px]">
              <Filter className="w-3.5 h-3.5" />
              Category:
            </span>
            {categoryFilters.map((cat) => {
              const isSelected = (!selectedCategory && cat === 'All') || selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(cat === 'All' ? null : cat)}
                  className={`px-3 py-1 rounded-full text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Error Banner with Retry (Requirement 6) */}
          {forecastError && (
            <div 
              data-testid="forecast-error" 
              className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-rose-900"
            >
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <p className="font-extrabold text-sm">Unable to load forecasting data</p>
                  <p className="text-xs text-rose-700 mt-0.5">{forecastError}</p>
                </div>
              </div>
              <button
                onClick={() => refreshForecast()}
                data-testid="forecast-retry-button"
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer flex items-center justify-center gap-1.5 self-start sm:self-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Forecast</span>
              </button>
            </div>
          )}

          {/* Forecast Summary Stat Strip (Requirement 2) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
            
            {/* Total Products */}
            <div 
              data-testid="forecast-summary-total" 
              className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Catalog</span>
                <Package className="w-4 h-4 text-slate-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-slate-900">{totalProductsForecast}</span>
                <p className="text-[10px] text-slate-500 font-medium">products analyzed</p>
              </div>
            </div>

            {/* High / Out of Stock Risk */}
            <div 
              data-testid="forecast-summary-critical" 
              className={`p-3 rounded-xl border flex flex-col justify-between ${
                criticalRiskCount > 0 
                  ? 'bg-rose-50/70 border-rose-200 text-rose-950' 
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800">Critical Risk</span>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-rose-700">{criticalRiskCount}</span>
                <p className="text-[10px] text-rose-800 font-medium">≤3 days or depleted</p>
              </div>
            </div>

            {/* Medium Risk */}
            <div 
              data-testid="forecast-summary-medium" 
              className={`p-3 rounded-xl border flex flex-col justify-between ${
                mediumRiskCount > 0 
                  ? 'bg-blue-50/70 border-blue-200 text-blue-950' 
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800">Medium Risk</span>
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-blue-700">{mediumRiskCount}</span>
                <p className="text-[10px] text-blue-800 font-medium">4–7 days remaining</p>
              </div>
            </div>

            {/* Low Risk */}
            <div 
              data-testid="forecast-summary-low" 
              className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between text-emerald-950"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Adequate Stock</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-emerald-700">{lowRiskCount}</span>
                <p className="text-[10px] text-emerald-800 font-medium">&gt;7 days supply</p>
              </div>
            </div>

            {/* Building History */}
            <div 
              data-testid="forecast-summary-building" 
              className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 flex flex-col justify-between text-amber-950 col-span-2 sm:col-span-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Building History</span>
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-amber-800">{buildingHistoryCount}</span>
                <p className="text-[10px] text-amber-800 font-medium">&lt;7 open selling days</p>
              </div>
            </div>

          </div>
        </Card>

        {/* Loading State Spinner (Requirement 6) */}
        {forecastLoading && (
          <div data-testid="forecast-loading">
            <Card className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <h4 className="text-sm font-extrabold text-slate-800 mt-3">Evaluating inventory demand velocity...</h4>
              <p className="text-xs text-slate-500 mt-1">Analyzing 7-day sales patterns, weekday variations, and stockout history</p>
            </Card>
          </div>
        )}

        {/* 5. "Needs Your Attention" Section (Requirement 5) */}
        {!forecastLoading && !forecastError && (
          <div data-testid="forecast-attention-section" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <h4 className="font-black text-slate-900 text-base">Needs Your Attention</h4>
                <span className="text-xs font-bold text-slate-500">
                  (Prioritized: Out of Stock &gt; High Risk &gt; Medium Risk &gt; Censored)
                </span>
              </div>
              {attentionItems.length > 0 && (
                <span className="text-xs font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                  {attentionItems.length} {attentionItems.length === 1 ? 'item' : 'items'} need review
                </span>
              )}
            </div>

            {attentionItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {attentionItems.map((item) => (
                  <div
                    key={item.product_id}
                    className={`rounded-2xl p-4 border transition-all ${
                      item.stockout_risk === 'OUT_OF_STOCK'
                        ? 'bg-rose-50/60 border-rose-200'
                        : item.stockout_risk === 'HIGH'
                          ? 'bg-amber-50/60 border-amber-200'
                          : item.has_stockout_censoring
                            ? 'bg-amber-50/40 border-amber-300'
                            : 'bg-blue-50/50 border-blue-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="font-black text-slate-900 text-sm truncate">{item.product_name}</h5>
                          {item.standardized_category && (
                            <span className="text-[10px] font-bold text-slate-600 bg-white/80 border border-slate-200 px-1.5 py-0.5 rounded">
                              {item.standardized_category}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-1 font-semibold">
                          Current Stock: <span className="text-slate-900 font-extrabold">{item.current_stock} {item.unit}</span>
                          {item.reorder_level !== null && (
                            <span className="text-slate-500 font-medium ml-1">
                              (Min Ref: {item.reorder_level} {item.unit})
                            </span>
                          )}
                        </p>
                      </div>

                      <StockoutRiskBadge
                        risk={item.stockout_risk}
                        confidenceStatus={item.confidence_status}
                        validHistoryDays={item.valid_history_days}
                        size="sm"
                      />
                    </div>

                    {/* Stockout Horizon & Recommended Reorder */}
                    <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs flex-wrap gap-2">
                      <div>
                        <span className="text-slate-500 font-medium">Estimated Horizon: </span>
                        {item.stockout_risk === 'OUT_OF_STOCK' || item.current_stock <= 0 ? (
                          <span className="font-extrabold text-rose-700">Depleted (0 days)</span>
                        ) : item.days_until_stockout !== null ? (
                          <span className={`font-extrabold ${item.days_until_stockout <= 3 ? 'text-rose-700' : 'text-blue-700'}`}>
                            ~{item.days_until_stockout.toFixed(1)} days left
                          </span>
                        ) : (
                          <span className="font-medium text-slate-500">Building History</span>
                        )}
                      </div>

                      {item.recommended_reorder_quantity !== null && item.recommended_reorder_quantity > 0 && (
                        <div className="font-black text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-md border border-emerald-300">
                          Reorder Rec: +{item.recommended_reorder_quantity} {item.unit}
                        </div>
                      )}
                    </div>

                    {/* Stockout-Censoring Warning Callout */}
                    {item.has_stockout_censoring && (
                      <div className="mt-2.5 p-2 rounded-lg bg-amber-100/70 border border-amber-300/80 flex items-start gap-1.5 text-[11px] text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-black">Stockout-Censored Demand: </span>
                          <span>Past zero-stock days detected in sales history. True customer demand is likely higher than recorded sales.</span>
                        </div>
                      </div>
                    )}

                    {/* Insights Message */}
                    {item.insights && (
                      <p className="mt-2 text-xs text-slate-600 font-medium leading-relaxed bg-white/70 p-2 rounded-lg border border-slate-200/50">
                        {item.insights}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-extrabold text-sm">Optimal Inventory Health</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    All analyzed products have adequate stock (&gt;7 days) or are currently building sales history. No critical stockout risks detected.
                  </p>
                </div>
              </div>
            )}
            
            <p className="text-[11px] text-slate-500 font-medium italic">
              * Informational demand forecasting and reorder intelligence. Inventory levels and purchase orders are not modified automatically.
            </p>
          </div>
        )}

        {/* 6. Product-Level Forecast Catalog Table / List (Requirement 3 & 4) */}
        {!forecastLoading && !forecastError && (
          <Card className="border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h4 className="font-black text-slate-900 text-base">Product Demand Forecast Catalog</h4>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Detailed breakdown of stockout risks, forecasting models, and reorder signals
                </p>
              </div>
              <span className="text-xs font-extrabold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                {forecastItems.length} {forecastItems.length === 1 ? 'Product' : 'Products'}
              </span>
            </div>

            {forecastItems.length === 0 ? (
              <div data-testid="forecast-empty" className="py-12 text-center space-y-2">
                <Package className="w-10 h-10 text-slate-400 mx-auto" />
                <h5 className="font-bold text-slate-700 text-sm">No products found to forecast</h5>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Add products to your catalog and record sales to enable AI demand forecasting.
                </p>
              </div>
            ) : (
              <div data-testid="forecast-table">
                {/* Desktop View Table */}
                <div className="hidden sm:block overflow-x-auto mt-2">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                        <th className="py-2.5 px-3">Product Name</th>
                        <th className="py-2.5 px-3">Current Stock</th>
                        <th className="py-2.5 px-3">Stockout Risk</th>
                        <th className="py-2.5 px-3">Days Left</th>
                        <th className="py-2.5 px-3">Method</th>
                        <th className="py-2.5 px-3">Reorder Rec</th>
                        <th className="py-2.5 px-3 text-right">Data Quality</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {forecastItems.map((item) => {
                        const isStage0 = item.confidence_status === 'INSUFFICIENT_DATA' || item.forecast_method === 'INSUFFICIENT_HISTORY';

                        return (
                          <tr key={item.product_id} className="hover:bg-slate-50/70 transition-colors">
                            {/* Product Name & Category */}
                            <td className="py-3 px-3">
                              <p className="font-extrabold text-slate-900 text-xs">{item.product_name}</p>
                              <span className="text-[10px] text-slate-500 font-semibold">
                                {item.standardized_category || 'General'}
                              </span>
                            </td>

                            {/* Current Stock */}
                            <td className="py-3 px-3">
                              <span className="font-extrabold text-slate-900 text-xs">
                                {item.current_stock} {item.unit}
                              </span>
                              {item.reorder_level !== null && (
                                <p className="text-[10px] text-slate-400 font-medium">
                                  Ref: {item.reorder_level} {item.unit}
                                </p>
                              )}
                            </td>

                            {/* Stockout Risk Badge */}
                            <td className="py-3 px-3">
                              <StockoutRiskBadge
                                risk={item.stockout_risk}
                                confidenceStatus={item.confidence_status}
                                validHistoryDays={item.valid_history_days}
                                size="sm"
                              />
                            </td>

                            {/* Days Until Stockout (Stage 0 never fabricates countdown) */}
                            <td className="py-3 px-3">
                              {isStage0 || item.days_until_stockout === null ? (
                                <span className="text-slate-400 font-bold" title="Pending 7 days of open sales history">—</span>
                              ) : item.stockout_risk === 'OUT_OF_STOCK' || item.current_stock <= 0 ? (
                                <span className="font-black text-rose-700">0d</span>
                              ) : (
                                <span className={`font-black ${item.days_until_stockout <= 3 ? 'text-amber-800' : 'text-slate-700'}`}>
                                  ~{item.days_until_stockout.toFixed(1)}d
                                </span>
                              )}
                            </td>

                            {/* Forecasting Method */}
                            <td className="py-3 px-3">
                              {item.forecast_method === 'MOVING_AVERAGE_7' ? (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200" title="7-day moving average (Stage 1)">
                                  MA-7
                                </span>
                              ) : item.forecast_method === 'WEEKDAY_SEASONAL' ? (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200" title="Day-of-week seasonal model (Stage 2)">
                                  Weekday
                                </span>
                              ) : (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200" title="Stage 0: Building sales history">
                                  Stage 0
                                </span>
                              )}
                            </td>

                            {/* Recommended Reorder Quantity (Stage 0 never fabricates AI recommendations) */}
                            <td className="py-3 px-3">
                              {isStage0 || item.recommended_reorder_quantity === null ? (
                                <span className="text-slate-400 font-medium" title="Statistical reorder requires active Stage 1+ model">—</span>
                              ) : item.recommended_reorder_quantity > 0 ? (
                                <span className="font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                                  +{item.recommended_reorder_quantity} {item.unit}
                                </span>
                              ) : (
                                <span className="text-slate-400 font-medium">—</span>
                              )}
                            </td>

                            {/* Data Quality & Stockout-Censoring */}
                            <td className="py-3 px-3 text-right">
                              {item.has_stockout_censoring ? (
                                <span 
                                  className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300"
                                  title="Stockout periods detected in sales history; true customer demand is likely higher."
                                >
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  <span>Censored</span>
                                </span>
                              ) : isStage0 ? (
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                  {item.valid_history_days}/7 days
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  Healthy
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View Card List */}
                <div className="sm:hidden divide-y divide-slate-100 mt-2">
                  {forecastItems.map((item) => {
                    const isStage0 = item.confidence_status === 'INSUFFICIENT_DATA' || item.forecast_method === 'INSUFFICIENT_HISTORY';

                    return (
                      <div key={item.product_id} className="py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-extrabold text-slate-900 text-sm leading-tight">{item.product_name}</p>
                            <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                              {item.standardized_category || 'General'} • {item.current_stock} {item.unit} in stock
                            </p>
                          </div>
                          <StockoutRiskBadge
                            risk={item.stockout_risk}
                            confidenceStatus={item.confidence_status}
                            validHistoryDays={item.valid_history_days}
                            size="sm"
                          />
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-slate-500 font-medium">Estimated Runout:</span>
                          {isStage0 || item.days_until_stockout === null ? (
                            <span className="text-slate-400 font-bold">—</span>
                          ) : item.stockout_risk === 'OUT_OF_STOCK' || item.current_stock <= 0 ? (
                            <span className="font-black text-rose-700">0d (Depleted)</span>
                          ) : (
                            <span className="font-black text-slate-800">~{item.days_until_stockout.toFixed(1)}d</span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Model Method:</span>
                          <span className="font-extrabold text-slate-700">
                            {item.forecast_method === 'MOVING_AVERAGE_7' ? 'MA-7' : item.forecast_method === 'WEEKDAY_SEASONAL' ? 'Weekday' : 'Stage 0'}
                          </span>
                        </div>

                        {item.recommended_reorder_quantity !== null && item.recommended_reorder_quantity > 0 && !isStage0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 font-medium">Reorder Recommendation:</span>
                            <span className="font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              +{item.recommended_reorder_quantity} {item.unit}
                            </span>
                          </div>
                        )}

                        {item.has_stockout_censoring && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            <span>Censored: True demand likely higher</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        )}

      </div>

    </div>
  );
};

