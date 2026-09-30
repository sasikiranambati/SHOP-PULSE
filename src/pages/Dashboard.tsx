import React, { useState } from 'react';
import { SmartCounterWidget } from '../components/SmartCounterWidget';
import { AddProductModal } from '../components/AddProductModal';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { TodaySummary } from '../components/dashboard/TodaySummary';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { QuickActionGrid } from '../components/dashboard/QuickActionGrid';
import { TopSellers } from '../components/dashboard/TopSellers';
import { SalesOverview } from '../components/dashboard/SalesOverview';
import { Card } from '../components/Card';
import { Receipt, ArrowUpRight } from 'lucide-react';

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
  const { todaySummary, dashboardStats } = useSales();
  const { lowStockAlerts } = useAlerts(products);
  const { weeklyTrend } = useAnalytics();

  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);

  // Live performance metrics from backend API
  const todayRevenue = todaySummary ? todaySummary.todaySales : (dashboardStats?.todayRevenue ?? 0);
  const itemsSoldToday = todaySummary ? todaySummary.itemsSoldToday : (dashboardStats?.itemsSoldToday ?? 0);
  const productsCount = products ? products.length : 0;

  // Filter low stock items from live products list
  const lowStockItems = products.filter(
    (p) =>
      p.status === 'Low Stock' ||
      p.status === 'Out of Stock' ||
      p.stock <= (p.reorderLevel ?? p.minStock ?? 10)
  );
  // Total alerts considered
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

  const recentSalesList = dashboardStats?.recentSales ?? [];

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto pb-10">
      
      {/* 1. Header Greeting & Store Identity */}
      <DashboardHeader
        shopName={shopName}
        setActivePage={setActivePage}
      />

      {/* 2. Coherent Today Performance Summary */}
      <TodaySummary
        revenue={todayRevenue}
        itemsSold={itemsSoldToday}
        productsCount={productsCount}
        growthPercent="+12%"
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

      {/* 4. Top Sellers & Sales Overview */}
      {/* On mobile: Top Sellers displays first (order-1), then Sales Overview (order-2) */}
      {/* On desktop: Sales Overview on left (lg:order-1), Top Sellers on right (lg:order-2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="order-2 lg:order-1">
          <SalesOverview
            totalWeekRevenue={48320}
            weekGrowthPercent="+18%"
            data={weeklyTrend?.points && weeklyTrend.points.length > 0 ? weeklyTrend.points : undefined}
            setActivePage={setActivePage}
          />
        </div>

        <div className="order-1 lg:order-2">
          <TopSellers
            setActivePage={setActivePage}
          />
        </div>
      </div>

      {/* 5. Smart Counter IoT Hardware Widget (Preserved) */}
      <SmartCounterWidget />

      {/* 6. Recent Activity Log */}
      <Card>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span>{t('dashboard.recentActivity')}</span>
          </h3>
          <button
            onClick={() => setActivePage('sales')}
            className="text-xs font-black text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>{t('dashboard.createSale')}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 mt-1">
          {recentSalesList.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-xs font-semibold">
              No sales recorded yet today.
            </div>
          ) : (
            recentSalesList.slice(0, 5).map((sale: any) => {
              const itemSummary = Array.isArray(sale.items)
                ? sale.items.map((i: any) => `${i.quantity}x ${i.name || i.productName || 'Item'}`).join(', ')
                : (sale.items || 'Counter Sale');
              const timeFormatted = sale.time || (sale.createdAt ? new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently');

              return (
                <div key={sale.id} className="py-2.5 sm:py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900 text-xs sm:text-sm leading-tight truncate">
                      {itemSummary}
                    </p>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5">{timeFormatted}</p>
                  </div>
                  <div className="text-right font-black text-emerald-700 text-sm sm:text-base shrink-0">
                    ₹{sale.total ?? sale.totalAmount ?? 0}
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
