import React, { useState } from 'react';
import { AddProductModal } from '../components/AddProductModal';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { TodaySummary } from '../components/dashboard/TodaySummary';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { QuickActionGrid } from '../components/dashboard/QuickActionGrid';
import { TopSellers } from '../components/dashboard/TopSellers';
import { SalesOverview } from '../components/dashboard/SalesOverview';
import { Card } from '../components/Card';
import { Receipt, ArrowUpRight, AlertCircle, RefreshCw } from 'lucide-react';

import type { PageRoute, Product } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useSales } from '../hooks/useSales';
import { useAlerts } from '../hooks/useAlerts';
import { useAnalytics } from '../hooks/useAnalytics';
import { increaseStock, addProduct } from '../services/inventoryService';

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
  const { todaySummary, dashboardStats, error: salesError, refreshSales } = useSales();
  const { lowStockAlerts } = useAlerts(products);
  const { 
    weeklyTrend, 
    monthlyTrend, 
    loading: analyticsLoading, 
    error: analyticsError, 
    refresh: refreshAnalytics 
  } = useAnalytics();

  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<'7days' | '30days'>('7days');
  const [isRetrying, setIsRetrying] = useState(false);

  // Live verified performance metrics from backend API
  const todayRevenue = todaySummary ? todaySummary.todaySales : (dashboardStats?.todayRevenue ?? 0);
  const itemsSoldToday = todaySummary ? todaySummary.itemsSoldToday : (dashboardStats?.itemsSoldToday ?? 0);
  const productsCount = products ? products.length : 0;
  const billsCount = todaySummary?.salesCount ?? dashboardStats?.totalTransactionsToday ?? 0;

  // Selected time series dataset for SalesOverview Line Chart
  const activeTrend = chartPeriod === '30days' ? monthlyTrend : weeklyTrend;
  const periodRevenue = activeTrend?.totalRevenue ?? 0;
  const periodAvgDaily = activeTrend?.averageDailyRevenue ?? 0;
  const periodGrowthFormatted = activeTrend?.growthRatePercentage !== undefined && activeTrend.growthRatePercentage !== null
    ? `${activeTrend.growthRatePercentage >= 0 ? '+' : ''}${Math.round(activeTrend.growthRatePercentage)}%`
    : undefined;

  // Filter low stock items from live products list
  const lowStockItems = products.filter(
    (p) =>
      p.status === 'Low Stock' ||
      p.status === 'Out of Stock' ||
      p.stock <= (p.reorderLevel ?? p.minStock ?? 10)
  );
  const hasAlerts = lowStockAlerts.length > 0 || lowStockItems.length > 0;

  // Handle restock with live inventory service
  const handleRestock = async (productId: string, quantity: number = 10) => {
    try {
      await increaseStock(productId, quantity);
    } catch (err) {
      console.error('Failed to restock product from dashboard:', err);
    }
  };

  // Handle new product creation from dashboard
  const handleAddProduct = async (newProd: Omit<Product, 'id'>) => {
    try {
      await addProduct({
        name: newProd.name,
        category: newProd.category,
        stock: newProd.stock,
        unit: newProd.unit,
        sellingPrice: newProd.sellingPrice ?? newProd.price,
        purchasePrice: newProd.purchasePrice ?? 0,
        reorderLevel: newProd.reorderLevel ?? newProd.minStock ?? 10,
        imageUrl: newProd.imageUrl,
        barcode: newProd.barcode,
      });
      setIsAddProductModalOpen(false);
    } catch (err) {
      console.error('Failed to add product from dashboard:', err);
    }
  };

  const handleRetryAll = async () => {
    setIsRetrying(true);
    try {
      await Promise.all([refreshSales(), refreshAnalytics()]);
    } finally {
      setIsRetrying(false);
    }
  };

  const recentSalesList = dashboardStats?.recentSales ?? [];
  const displayError = salesError || analyticsError;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto min-w-0">

      {/* 1. Header Greeting & Store Identity */}
      <DashboardHeader
        shopName={shopName}
        setActivePage={setActivePage}
      />

      {/* Error Notice (if API issue occurs) */}
      {displayError && (
        <div className="bg-[#FDF2F2] border border-[#B93838]/25 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2.5 text-[#B93838] min-w-0">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-semibold truncate">
              Unable to sync latest live metrics. Displaying last verified records.
            </span>
          </div>
          <button
            onClick={handleRetryAll}
            disabled={isRetrying}
            className="px-3 py-1.5 rounded-lg bg-[#B93838] text-white font-bold text-xs hover:bg-[#992626] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* 2. Key Business Metrics */}
      <TodaySummary
        revenue={todayRevenue}
        itemsSold={itemsSoldToday}
        productsCount={productsCount}
        billsCount={billsCount}
        setActivePage={setActivePage}
      />

      {/* 3. Two-column section: Left (Needs Attention) | Right (Quick Actions) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <AttentionCard
          lowStockItems={hasAlerts ? lowStockItems : []}
          onRestock={handleRestock}
          setActivePage={setActivePage}
        />

        <QuickActionGrid
          onNewSale={() => setActivePage('sales')}
          onAddProduct={() => setIsAddProductModalOpen(true)}
          onAddStock={() => setActivePage('inventory')}
          onScanBill={() => setActivePage('scanner')}
        />
      </div>

      {/* 4. Business Performance Visualization (Line Chart) & Top Sellers */}
      {/* On mobile: Top Sellers displays first (order-1), then Sales Overview (order-2) */}
      {/* On desktop: Sales Overview on left (lg:order-1), Top Sellers on right (lg:order-2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="order-2 lg:order-1">
          <SalesOverview
            totalRevenue={periodRevenue}
            growthPercent={periodGrowthFormatted}
            averageDailyRevenue={periodAvgDaily}
            data={activeTrend?.points && activeTrend.points.length > 0 ? activeTrend.points : []}
            period={chartPeriod}
            onPeriodChange={setChartPeriod}
            setActivePage={setActivePage}
            isLoading={analyticsLoading && !activeTrend}
          />
        </div>

        <div className="order-1 lg:order-2">
          <TopSellers
            items={dashboardStats?.topProducts ?? []}
            setActivePage={setActivePage}
          />
        </div>
      </div>

      {/* 5. Recent Activity Log */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
          <h3 className="font-extrabold text-[#202923] text-sm sm:text-base flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0 border border-[#52745D]/20">
              <Receipt className="w-4 h-4 text-[#234B3A]" />
            </span>
            <span>{t('dashboard.recentActivity')}</span>
          </h3>
          <button
            onClick={() => setActivePage('sales')}
            className="text-xs font-bold text-[#234B3A] hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>{t('dashboard.createSale')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-[#E3E5DE] mt-1">
          {recentSalesList.length === 0 ? (
            <div className="py-7 text-center text-[#69736C] text-xs font-medium">
              No sales recorded yet today. Completed customer checkouts will appear here in real time.
            </div>
          ) : (
            recentSalesList.slice(0, 5).map((sale: any) => {
              const itemSummary = Array.isArray(sale.items)
                ? sale.items.map((i: any) => `${i.quantity}x ${i.name || i.productName || 'Item'}`).join(', ')
                : (sale.items || 'Counter Sale');
              const timeFormatted = sale.time || (sale.createdAt ? new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently');

              return (
                <div key={sale.id} className="py-2.5 sm:py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-[#202923] text-xs sm:text-sm leading-tight truncate">
                      {itemSummary}
                    </p>
                    <p className="text-[11px] text-[#69736C] font-medium mt-0.5">{timeFormatted}</p>
                  </div>
                  <div className="text-right font-extrabold text-[#234B3A] text-sm sm:text-base shrink-0">
                    ₹{(sale.total ?? sale.totalAmount ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Add Product Modal (Triggered by Quick Action) */}
      <AddProductModal
        isOpen={isAddProductModalOpen}
        onClose={() => setIsAddProductModalOpen(false)}
        onAddProduct={handleAddProduct}
      />

    </div>
  );
};
