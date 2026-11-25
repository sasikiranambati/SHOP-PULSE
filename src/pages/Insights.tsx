import React, { useState, useEffect, useCallback } from 'react';
import { 
  TrendingUp, 
  Sparkles, 
  Award, 
  Calendar, 
  AlertTriangle,
  RefreshCw,
  CheckCircle2, 
  AlertCircle,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  ChevronRight,
  ShoppingBag,
  Activity,
  Lock
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatCard } from '../components/StatCard';
import { SalesChart, type SalesChartDataPoint } from '../components/SalesChart';
import { DemandForecastSection } from '../components/DemandForecastSection';
import { useShopRole } from '../hooks/useShopRole';
import { 
  insightsApi, 
  type SalesInsightsData, 
  type InventoryInsightsData, 
  type AiInsightsData,
  type ShopForecastSummary
} from '../api/insights';
import { notificationsApi } from '../api/notifications';

type InsightsTab = 'sales' | 'inventory' | 'forecast' | 'ai';
type DateFilter = 'today' | '7d' | '30d' | '90d' | 'custom';
type PerformanceTab = 'best' | 'slow' | 'rising' | 'declining';
type InventoryFilter = 'all' | 'low' | 'out' | 'over' | 'healthy';

export const Insights: React.FC = () => {
  const { role, isCashier, canAccessAnalytics } = useShopRole();
  const isInsightsRestricted = isCashier || !canAccessAnalytics;

  const [activeTab, setActiveTab] = useState<InsightsTab>('sales');
  const [dateFilter, setDateFilter] = useState<DateFilter>('7d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [perfTab, setPerfTab] = useState<PerformanceTab>('best');
  const [invFilter, setInvFilter] = useState<InventoryFilter>('all');

  const [salesData, setSalesData] = useState<SalesInsightsData | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryInsightsData | null>(null);
  const [aiData, setAiData] = useState<AiInsightsData | null>(null);
  const [forecastSummary, setForecastSummary] = useState<ShopForecastSummary | null>(null);
  const [forecastRefreshSignal, setForecastRefreshSignal] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(!isInsightsRestricted);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isManualRefresh: boolean = false) => {
    if (isInsightsRestricted) {
      setLoading(false);
      return;
    }

    if (isManualRefresh) {
      setRefreshing(true);
      setForecastRefreshSignal((prev) => prev + 1);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [salesRes, invRes, aiRes] = await Promise.all([
        insightsApi.getSalesInsights(dateFilter, customStart, customEnd),
        insightsApi.getInventoryInsights(),
        insightsApi.getAiInsights()
      ]);

      setSalesData(salesRes);
      setInventoryData(invRes);
      setAiData(aiRes);

      if (isManualRefresh) {
        // Run background event detection for notifications
        await notificationsApi.triggerEvaluation().catch(() => {});
      }
    } catch (err: any) {
      console.warn('Failed to load insights data:', err);
      setError(err?.message || 'Failed to load live store insights.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFilter, customStart, customEnd, isInsightsRestricted]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


  const handleApplyCustomDates = () => {
    if (customStart && customEnd) {
      fetchData();
    }
  };

  // Convert trends to SalesChartDataPoint
  const chartPoints: SalesChartDataPoint[] = (salesData?.trends?.points || []).map((pt, idx, arr) => ({
    day: pt.label,
    amount: pt.revenue,
    date: pt.date,
    itemsCount: pt.transaction_count,
    isToday: idx === arr.length - 1
  }));

  // Filter inventory items
  const filteredInventoryItems = (inventoryData?.items || []).filter((item) => {
    if (invFilter === 'low') return item.status === 'LOW STOCK';
    if (invFilter === 'out') return item.status === 'OUT OF STOCK';
    if (invFilter === 'over') return item.status === 'OVERSTOCKED';
    if (invFilter === 'healthy') return item.status === 'IN STOCK';
    return true;
  });

  const forecastAttentionCount =
    (forecastSummary?.out_of_stock_count ?? 0) +
    (forecastSummary?.at_risk_stockout_7d_count ?? 0);

  if (isInsightsRestricted) {
    return (
      <div className="w-full space-y-6 max-w-6xl mx-auto min-w-0 font-sans pb-12">
        <PageHeader
          title="AI Insights & Analytics"
          description="Real-time sales performance, stock health intelligence, and grounded business explanations."
        />
        <div
          role="alert"
          className="bg-white rounded-2xl border border-[#EF806D]/40 p-6 sm:p-8 text-center max-w-xl mx-auto my-6 shadow-xs"
        >
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#FDF1EF] text-[#B93838] flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-extrabold text-[#153D32]">
            Access Restricted
          </h2>
          <p className="text-xs sm:text-sm text-[#5E6C64] mt-1.5 leading-relaxed">
            Shop analytics, demand forecasting, and business insights are restricted to{' '}
            <strong className="text-[#153D32]">Owner</strong> and{' '}
            <strong className="text-[#153D32]">Manager</strong> roles.
            {role ? ` Current role: ${role}.` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 max-w-6xl mx-auto min-w-0 font-sans pb-12">
      {/* 1. Header with Module Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeader
          title="AI Insights & Analytics"
          description="Real-time sales performance, stock health intelligence, and grounded business explanations."
        />
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => fetchData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#DDE9DF] hover:bg-[#FAF8F2] text-[#153D32] rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#23866A] ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Evaluating Data...' : 'Refresh Analytics'}</span>
          </button>
        </div>
      </div>

      {/* 2. Primary Tabs: Sales Insights | Inventory Insights | Demand Forecast | AI Intelligence */}
      <div
        role="tablist"
        aria-label="Insights sections"
        className="w-full min-w-0 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 border-b border-[#DDE9DF] pb-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sales'}
          onClick={() => setActiveTab('sales')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === 'sales'
              ? 'bg-[#153D32] text-[#FAF8F2] shadow-sm'
              : 'text-[#5E6C64] hover:bg-[#FAF8F2] hover:text-[#153D32]'
          }`}
        >
          <TrendingUp className="w-4 h-4 text-[#23866A]" />
          <span>Sales Insights</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'inventory'}
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === 'inventory'
              ? 'bg-[#153D32] text-[#FAF8F2] shadow-sm'
              : 'text-[#5E6C64] hover:bg-[#FAF8F2] hover:text-[#153D32]'
          }`}
        >
          <Package className="w-4 h-4 text-[#D6AE62]" />
          <span>Inventory Insights</span>
          {inventoryData && inventoryData.counts.needs_attention > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#EF806D] text-white">
              {inventoryData.counts.needs_attention}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'forecast'}
          onClick={() => setActiveTab('forecast')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === 'forecast'
              ? 'bg-[#153D32] text-[#FAF8F2] shadow-sm'
              : 'text-[#5E6C64] hover:bg-[#FAF8F2] hover:text-[#153D32]'
          }`}
        >
          <Activity className="w-4 h-4 text-[#23866A]" />
          <span>Demand Forecast</span>
          {forecastAttentionCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#D6AE62] text-[#153D32]">
              {forecastAttentionCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 ${
            activeTab === 'ai'
              ? 'bg-[#153D32] text-[#FAF8F2] shadow-sm'
              : 'text-[#5E6C64] hover:bg-[#FAF8F2] hover:text-[#153D32]'
          }`}
        >
          <Sparkles className="w-4 h-4 text-[#23866A]" />
          <span>AI Intelligence</span>
          {aiData && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/20">
              {aiData.overall_business_health}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-[#FDF1EF] border border-[#EF806D]/30 text-[#EF806D] text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: SALES INSIGHTS                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          {/* Period Filter Selector */}
          <div className="bg-white p-3.5 rounded-2xl border border-[#DDE9DF] shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="text-xs font-extrabold text-[#153D32] flex items-center gap-1.5 mr-2">
                <Filter className="w-3.5 h-3.5 text-[#23866A]" />
                Period:
              </span>
              {(['today', '7d', '30d', '90d', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDateFilter(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    dateFilter === p
                      ? 'bg-[#153D32] text-[#FAF8F2] shadow-xs'
                      : 'bg-[#FAF8F2] text-[#5E6C64] hover:bg-[#E7F3EE] hover:text-[#153D32]'
                  }`}
                >
                  {p === 'today' ? 'Today' : p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : p === '90d' ? 'Last 90 Days' : 'Custom Range'}
                </button>
              ))}
            </div>

            {dateFilter === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-[#DDE9DF] rounded-lg bg-[#FAF8F2]"
                />
                <span className="text-xs text-[#5E6C64]">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-[#DDE9DF] rounded-lg bg-[#FAF8F2]"
                />
                <button
                  type="button"
                  onClick={handleApplyCustomDates}
                  className="px-3 py-1 bg-[#23866A] text-white text-xs font-bold rounded-lg cursor-pointer hover:bg-[#153D32]"
                >
                  Apply
                </button>
              </div>
            )}
          </div>

          {/* Sales Overview Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Revenue"
              value={salesData ? `₹${salesData.overview.total_sales.toLocaleString('en-IN')}` : '—'}
              subtitle={`Verified across ${salesData?.overview.transaction_count || 0} bills`}
              icon={<TrendingUp className="w-5 h-5 text-[#23866A]" />}
              badgeText={
                salesData?.overview.sales_growth_rate !== null && salesData?.overview.sales_growth_rate !== undefined
                  ? `${salesData.overview.sales_growth_rate >= 0 ? '+' : ''}${salesData.overview.sales_growth_rate}% vs prior`
                  : undefined
              }
              badgeColor={
                (salesData?.overview.sales_growth_rate ?? 0) >= 0 ? 'emerald' : 'amber'
              }
            />

            <StatCard
              title="Transactions"
              value={salesData ? `${salesData.overview.transaction_count}` : '—'}
              subtitle="Customer checkout count"
              icon={<ShoppingBag className="w-5 h-5 text-[#153D32]" />}
              badgeText={salesData?.has_sufficient_data ? 'Active' : 'No Sales'}
              badgeColor="emerald"
            />

            <StatCard
              title="Average Bill Value"
              value={salesData ? `₹${Math.round(salesData.overview.average_transaction_value)}` : '—'}
              subtitle="Revenue per customer checkout"
              icon={<Award className="w-5 h-5 text-[#D6AE62]" />}
              badgeColor="amber"
            />

            <StatCard
              title="Prior Period Sales"
              value={salesData ? `₹${salesData.overview.previous_period_sales.toLocaleString('en-IN')}` : '—'}
              subtitle={`${salesData?.overview.previous_period_transactions || 0} transactions in baseline`}
              icon={<Calendar className="w-5 h-5 text-[#5E6C64]" />}
              badgeColor="slate"
            />
          </div>

          {/* Sales Trend Chart */}
          <SalesChart
            data={chartPoints}
            peakText={
              salesData?.trends?.peak_day && salesData.trends.peak_revenue > 0
                ? `Peak: ${salesData.trends.peak_day} (₹${Math.round(salesData.trends.peak_revenue).toLocaleString('en-IN')})`
                : undefined
            }
            title="Sales Velocity Trend"
            subtitle="Actual daily revenue calculated directly from customer sales"
            isLoading={loading}
          />

          {/* Product Performance Section */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#DDE9DF] gap-3">
              <div>
                <h3 className="font-extrabold text-[#153D32] text-base">Product Performance</h3>
                <p className="text-xs text-[#5E6C64]">Rankings computed directly from item lines sold in this period.</p>
              </div>

              {/* Sub-tabs */}
              <div className="flex flex-wrap items-center gap-1 bg-[#FAF8F2] p-1 rounded-xl border border-[#DDE9DF] text-xs">
                <button
                  type="button"
                  onClick={() => setPerfTab('best')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    perfTab === 'best' ? 'bg-[#153D32] text-[#FAF8F2]' : 'text-[#5E6C64] hover:text-[#153D32]'
                  }`}
                >
                  Best Selling
                </button>
                <button
                  type="button"
                  onClick={() => setPerfTab('slow')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    perfTab === 'slow' ? 'bg-[#153D32] text-[#FAF8F2]' : 'text-[#5E6C64] hover:text-[#153D32]'
                  }`}
                >
                  Slow Moving
                </button>
                <button
                  type="button"
                  onClick={() => setPerfTab('rising')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    perfTab === 'rising' ? 'bg-[#153D32] text-[#FAF8F2]' : 'text-[#5E6C64] hover:text-[#153D32]'
                  }`}
                >
                  Rising Sales
                </button>
                <button
                  type="button"
                  onClick={() => setPerfTab('declining')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    perfTab === 'declining' ? 'bg-[#153D32] text-[#FAF8F2]' : 'text-[#5E6C64] hover:text-[#153D32]'
                  }`}
                >
                  Declining Sales
                </button>
              </div>
            </div>

            {/* Performance Items Table */}
            <div className="overflow-x-auto mt-3">
              {(() => {
                const list =
                  perfTab === 'best'
                    ? salesData?.performance.best_selling || []
                    : perfTab === 'slow'
                    ? salesData?.performance.slow_moving || []
                    : perfTab === 'rising'
                    ? salesData?.performance.increasing_sales || []
                    : salesData?.performance.declining_sales || [];

                if (list.length === 0) {
                  return (
                    <div className="py-12 text-center text-[#5E6C64] text-xs">
                      No products recorded in this performance category for the selected period.
                    </div>
                  );
                }

                return (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#DDE9DF] text-[11px] font-extrabold text-[#5E6C64] uppercase tracking-wider">
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Product Name</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3 text-right">Units Sold</th>
                        <th className="py-2.5 px-3 text-right">Revenue</th>
                        <th className="py-2.5 px-3 text-right">Growth vs Prior</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE9DF]">
                      {list.map((it, idx) => (
                        <tr key={it.product_id} className="hover:bg-[#FAF8F2] transition-colors">
                          <td className="py-3 px-3 font-bold text-[#153D32]">{idx + 1}</td>
                          <td className="py-3 px-3 font-extrabold text-[#153D32]">{it.product_name}</td>
                          <td className="py-3 px-3 text-[#5E6C64]">{it.category}</td>
                          <td className="py-3 px-3 text-right font-bold text-[#252D29]">
                            {it.quantity_sold} {it.unit}
                          </td>
                          <td className="py-3 px-3 text-right font-extrabold text-[#153D32]">
                            ₹{it.revenue.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {it.growth_rate !== null && it.growth_rate !== undefined ? (
                              <span
                                className={`inline-flex items-center gap-0.5 font-bold px-2 py-0.5 rounded-md ${
                                  it.growth_rate > 0
                                    ? 'bg-[#E7F3EE] text-[#23866A]'
                                    : it.growth_rate < 0
                                    ? 'bg-[#FDF1EF] text-[#EF806D]'
                                    : 'bg-[#FAF8F2] text-[#5E6C64]'
                                }`}
                              >
                                {it.growth_rate > 0 ? (
                                  <ArrowUpRight className="w-3 h-3" />
                                ) : it.growth_rate < 0 ? (
                                  <ArrowDownRight className="w-3 h-3" />
                                ) : null}
                                {it.growth_rate > 0 ? `+${it.growth_rate}%` : `${it.growth_rate}%`}
                              </span>
                            ) : (
                              <span className="text-[#5E6C64]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: INVENTORY INSIGHTS                                                */}
      {/* ========================================================================= */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {/* Inventory Overview Health Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-white p-3.5 rounded-2xl border border-[#DDE9DF] shadow-xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#5E6C64]">Total Products</p>
              <p className="text-xl font-extrabold text-[#153D32] mt-1">{inventoryData?.counts.total_products || 0}</p>
              <p className="text-[10px] text-[#5E6C64] mt-0.5">Active SKU count</p>
            </div>

            <div className="bg-white p-3.5 rounded-2xl border border-[#DDE9DF] shadow-xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#23866A]">In Stock</p>
              <p className="text-xl font-extrabold text-[#23866A] mt-1">{inventoryData?.counts.in_stock || 0}</p>
              <p className="text-[10px] text-[#5E6C64] mt-0.5">Healthy buffer</p>
            </div>

            <div className="bg-white p-3.5 rounded-2xl border border-[#D6AE62]/40 shadow-xs bg-[#FEF9EB]/30">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#A07828]">Low Stock</p>
              <p className="text-xl font-extrabold text-[#A07828] mt-1">{inventoryData?.counts.low_stock || 0}</p>
              <p className="text-[10px] text-[#A07828] mt-0.5">Below threshold</p>
            </div>

            <div className="bg-white p-3.5 rounded-2xl border border-[#EF806D]/40 shadow-xs bg-[#FDF1EF]/30">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#EF806D]">Out of Stock</p>
              <p className="text-xl font-extrabold text-[#EF806D] mt-1">{inventoryData?.counts.out_of_stock || 0}</p>
              <p className="text-[10px] text-[#EF806D] mt-0.5">Depleted items</p>
            </div>

            <div className="bg-white p-3.5 rounded-2xl border border-[#DDE9DF] shadow-xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#5E6C64]">Overstocked</p>
              <p className="text-xl font-extrabold text-[#153D32] mt-1">{inventoryData?.counts.overstocked || 0}</p>
              <p className="text-[10px] text-[#5E6C64] mt-0.5">&gt;5x reorder level</p>
            </div>
          </div>

          {/* Actionable Inventory Table */}
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#DDE9DF] gap-3">
              <div>
                <h3 className="font-extrabold text-[#153D32] text-base">Inventory Action Matrix</h3>
                <p className="text-xs text-[#5E6C64]">Item stock levels, configured thresholds, and deterministic recommended actions.</p>
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1 bg-[#FAF8F2] p-1 rounded-xl border border-[#DDE9DF] text-xs">
                {(['all', 'out', 'low', 'over', 'healthy'] as const).map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setInvFilter(filterKey)}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                      invFilter === filterKey
                        ? 'bg-[#153D32] text-[#FAF8F2]'
                        : 'text-[#5E6C64] hover:text-[#153D32]'
                    }`}
                  >
                    {filterKey === 'all'
                      ? 'All'
                      : filterKey === 'out'
                      ? 'Out of Stock'
                      : filterKey === 'low'
                      ? 'Low Stock'
                      : filterKey === 'over'
                      ? 'Overstocked'
                      : 'Healthy'}
                  </button>
                ))}
              </div>
            </div>

            {/* Inventory Table */}
            <div className="overflow-x-auto mt-3">
              {filteredInventoryItems.length === 0 ? (
                <div className="py-12 text-center text-[#5E6C64] text-xs">
                  No inventory items match the selected filter.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#DDE9DF] text-[11px] font-extrabold text-[#5E6C64] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3 text-right">Current Stock</th>
                      <th className="py-2.5 px-3 text-right">Min Threshold</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Recommended Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE9DF]">
                    {filteredInventoryItems.map((item) => (
                      <tr key={item.product_id} className="hover:bg-[#FAF8F2] transition-colors">
                        <td className="py-3 px-3">
                          <p className="font-extrabold text-[#153D32]">{item.product_name}</p>
                          <p className="text-[10px] text-[#5E6C64]">₹{item.selling_price} / {item.unit}</p>
                        </td>
                        <td className="py-3 px-3 text-[#5E6C64]">{item.category}</td>
                        <td className="py-3 px-3 text-right font-extrabold text-[#153D32]">
                          {item.current_stock} {item.unit}
                        </td>
                        <td className="py-3 px-3 text-right text-[#5E6C64]">
                          {item.is_threshold_configured ? `${item.minimum_stock_threshold} ${item.unit}` : 'Not set'}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                              item.status === 'OUT OF STOCK'
                                ? 'bg-[#FDF1EF] text-[#EF806D] border border-[#EF806D]/30'
                                : item.status === 'LOW STOCK'
                                ? 'bg-[#FEF9EB] text-[#A07828] border border-[#D6AE62]/40'
                                : item.status === 'OVERSTOCKED'
                                ? 'bg-[#FAF8F2] text-[#153D32] border border-[#DDE9DF]'
                                : 'bg-[#E7F3EE] text-[#23866A] border border-[#23866A]/20'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#252D29] leading-relaxed max-w-xs">
                          {item.recommended_action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: DEMAND FORECAST                                                    */}
      {/* ========================================================================= */}
      {activeTab === 'forecast' && (
        <DemandForecastSection
          refreshSignal={forecastRefreshSignal}
          onSummaryLoaded={setForecastSummary}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 4: AI INTELLIGENCE & EXPLANATIONS                                     */}
      {/* ========================================================================= */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          <Card className="border border-[#23866A]/20 bg-gradient-to-r from-white to-[#E7F3EE]/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#DDE9DF] gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#153D32] flex items-center justify-center text-white">
                  <Sparkles className="w-4 h-4 text-[#B9E5D0]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-[#153D32] text-base">AI Decision Explanations</h3>
                  <p className="text-xs text-[#5E6C64]">
                    Clear, narrative business interpretations computed directly from real store transactions and inventory levels.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#5E6C64]">Business Health:</span>
                <span className="px-3 py-1 rounded-xl text-xs font-extrabold bg-[#153D32] text-[#FAF8F2]">
                  {aiData?.overall_business_health || 'Analyzing...'}
                </span>
              </div>
            </div>

            {aiData?.insights && aiData.insights.length > 0 ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {aiData.insights.map((insight) => (
                  <div
                    key={insight.id}
                    className="p-4 rounded-2xl bg-white border border-[#DDE9DF] shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                              insight.type === 'critical'
                                ? 'bg-[#FDF1EF] text-[#EF806D]'
                                : insight.type === 'warning'
                                ? 'bg-[#FEF9EB] text-[#A07828]'
                                : 'bg-[#E7F3EE] text-[#23866A]'
                            }`}
                          >
                            {insight.type === 'critical' ? (
                              <AlertCircle className="w-4 h-4" />
                            ) : insight.type === 'warning' ? (
                              <AlertTriangle className="w-4 h-4" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                          </div>
                          <h4 className="font-extrabold text-[#153D32] text-xs sm:text-sm">
                            {insight.title}
                          </h4>
                        </div>
                        {insight.metric && (
                          <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-[#FAF8F2] border border-[#DDE9DF] text-[#153D32]">
                            {insight.metric}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#252D29] leading-relaxed mt-2 font-normal">
                        {insight.message}
                      </p>

                      {insight.grounded_data_points.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-[#DDE9DF]/60 space-y-1">
                          <p className="text-[10px] font-extrabold text-[#5E6C64] uppercase tracking-wider">
                            Supporting Data Points:
                          </p>
                          {insight.grounded_data_points.map((dp, idx) => (
                            <p key={idx} className="text-[11px] text-[#5E6C64] flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#23866A] shrink-0" />
                              <span>{dp}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    {insight.suggested_action && (
                      <div className="mt-3.5 pt-2.5 border-t border-[#DDE9DF] flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#153D32]">
                          Action: {insight.suggested_action}
                        </span>
                        <ChevronRight className="w-4 h-4 text-[#23866A]" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-[#E7F3EE] text-[#23866A] flex items-center justify-center mx-auto">
                  <Sparkles className="w-6 h-6" />
                </div>
                <h4 className="font-extrabold text-[#153D32] text-sm">Awaiting Store Activity</h4>
                <p className="text-xs text-[#5E6C64] max-w-md mx-auto leading-relaxed">
                  {aiData?.note || 'AI recommendations require recorded sales and inventory items to formulate data-backed guidance. Continue recording customer bills.'}
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
