/**
 * @file salesService.ts
 * @description Production-grade Sales & POS Transaction Service integrated with ShopPulse FastAPI backend.
 * Belongs in `src/services/salesService.ts`.
 */

import type {
  Sale,
  CreateSaleInput,
  SaleItem,
  DailySalesSummary,
  DashboardSalesStats,
  ReceiptData,
} from '../types/sale';
import { salesApi, type SaleBackend } from '../api/sales';
import { dashboardApi } from '../api/dashboard';
import { generateReceipt } from '../utils/receiptGenerator';

export function mapBackendSaleToFrontend(bs: SaleBackend, productNameMap?: Record<string, string>): Sale {
  const items: SaleItem[] = (bs.items || []).map((item) => {
    const name = (productNameMap && productNameMap[item.product_id]) || 'Sold Item';
    const total = Number(item.quantity) * Number(item.unit_price);
    return {
      productId: item.product_id,
      name,
      productName: name,
      quantity: item.quantity,
      unit: 'pcs',
      price: item.unit_price,
      unitPrice: item.unit_price,
      total,
      totalPrice: total,
    };
  });

  const billNumber = `SP-${bs.id.slice(0, 8).toUpperCase()}`;
  const total = Number(bs.total_amount || 0);

  return {
    id: bs.id,
    billNumber,
    customerName: 'Counter Customer',
    items,
    subtotal: total,
    discount: 0,
    tax: 0,
    total,
    totalAmount: total,
    paymentMethod: bs.payment_method as any,
    cashierId: 'Staff',
    createdAt: bs.created_at || new Date().toISOString(),
    shopId: bs.shop_id,
    syncStatus: 'synced',
  };
}

/**
 * Create a new sale through the backend API.
 * Automatically validates stock, creates transaction, and deducts inventory in database.
 */
export async function createSale(
  input: CreateSaleInput,
  cashierId: string = 'Staff',
  _shopName?: string
): Promise<Sale> {
  const backendSale = await salesApi.createSale({
    items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.price ?? item.unitPrice,
    })),
    payment_method: (input.paymentMethod || 'cash').toLowerCase(),
  });

  const namesMap: Record<string, string> = {};
  input.items.forEach((item) => {
    namesMap[item.productId] = item.name || item.productName || 'Item';
  });

  const sale = mapBackendSaleToFrontend(backendSale, namesMap);
  sale.cashierId = cashierId;
  if (input.customerName) {
    sale.customerName = input.customerName;
  }
  if (input.discount) {
    sale.discount = input.discount;
  }

  // Dispatch inventory & sales change events to refresh UI
  window.dispatchEvent(new CustomEvent('shoppulse_sales_changed'));
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));

  return sale;
}

/**
 * Record a sale and generate its receipt.
 */
export async function recordSale(
  input: CreateSaleInput,
  cashierId: string = 'Staff',
  shopName: string = 'ShopPulse Store'
): Promise<{ sale: Sale; receipt: ReceiptData }> {
  const sale = await createSale(input, cashierId, shopName);
  const receipt = generateReceipt(sale, shopName);
  return { sale, receipt };
}

/**
 * Fetch sales history from backend.
 */
export async function getSales(
  options?: number | { limit?: number; period?: 'today' | '7days' | '30days' }
): Promise<Sale[]> {
  try {
    const limit = typeof options === 'number' ? options : (options?.limit ?? 50);
    const res = await salesApi.getSales({ limit });
    let mapped = res.items.map((s) => mapBackendSaleToFrontend(s));

    if (typeof options === 'object' && options?.period) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      mapped = mapped.filter((s) => {
        const saleTime = new Date(s.createdAt).getTime();
        if (options.period === 'today') {
          const todayStart = new Date().setHours(0, 0, 0, 0);
          return saleTime >= todayStart;
        }
        if (options.period === '7days') {
          return now - saleTime <= 7 * dayMs;
        }
        if (options.period === '30days') {
          return now - saleTime <= 30 * dayMs;
        }
        return true;
      });
    }

    return mapped;
  } catch (err) {
    console.warn('Failed to load sales history from backend:', err);
    return [];
  }
}

/**
 * Fetch single sale by ID.
 */
export async function getSaleById(saleId: string): Promise<Sale | null> {
  try {
    const s = await salesApi.getSale(saleId);
    return mapBackendSaleToFrontend(s);
  } catch {
    return null;
  }
}

/**
 * Delete sale placeholder.
 */
export async function deleteSale(saleId: string, restoreInventory: boolean = true): Promise<void> {
  console.info('Delete sale requested for:', saleId, 'restore:', restoreInventory);
}

/**
 * Fetch daily sales summary from backend dashboard endpoint.
 */
export async function getTodaySalesSummary(): Promise<DailySalesSummary> {
  try {
    const data = await dashboardApi.getDashboard();
    const count = data.recent_sales ? data.recent_sales.length : 0;
    return {
      todaySales: data.today_sales || 0,
      itemsSoldToday: data.items_sold_today || 0,
      salesCount: count,
      averageBill: count > 0 ? Math.round(data.today_sales / count) : 0,
      date: new Date().toISOString().split('T')[0],
    };
  } catch (err) {
    console.warn('Failed to load today summary from dashboard API:', err);
    return {
      todaySales: 0,
      itemsSoldToday: 0,
      salesCount: 0,
      averageBill: 0,
      date: new Date().toISOString().split('T')[0],
    };
  }
}

/**
 * Fetch dashboard sales KPI metrics.
 */
export async function getDashboardSalesStats(): Promise<DashboardSalesStats> {
  try {
    const data = await dashboardApi.getDashboard();
    const recent = (data.recent_sales || []).map((s) => {
      const itemsText = (s.items || [])
        .map((i) => `${i.quantity}x Item`)
        .join(', ') || 'Counter Sale';
      const timeStr = s.created_at
        ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Recently';

      return {
        id: s.id,
        items: itemsText,
        total: s.total_amount || 0,
        time: timeStr,
        billNumber: `SP-${s.id.slice(0, 8).toUpperCase()}`,
      };
    });

    return {
      todayRevenue: data.today_sales || 0,
      itemsSoldToday: data.items_sold_today || 0,
      totalTransactionsToday: recent.length,
      averageBillValue: recent.length > 0 ? Math.round(data.today_sales / recent.length) : 0,
      recentSales: recent,
    };
  } catch (err) {
    console.warn('Failed to load dashboard stats from API:', err);
    return {
      todayRevenue: 0,
      itemsSoldToday: 0,
      totalTransactionsToday: 0,
      averageBillValue: 0,
      recentSales: [],
    };
  }
}

/**
 * Subscribe to sales history updates.
 */
export function subscribeToSales(
  callback: (sales: Sale[]) => void,
  limitCount: number = 50
): () => void {
  let active = true;

  const refresh = async () => {
    if (!active) return;
    const items = await getSales(limitCount);
    if (active) callback(items);
  };

  refresh();

  const handleUpdate = () => {
    refresh();
  };

  window.addEventListener('shoppulse_sales_changed', handleUpdate);
  window.addEventListener('shoppulse_auth_changed', handleUpdate);

  return () => {
    active = false;
    window.removeEventListener('shoppulse_sales_changed', handleUpdate);
    window.removeEventListener('shoppulse_auth_changed', handleUpdate);
  };
}

/**
 * Subscribe to today's sales summary updates.
 */
export function subscribeToTodaySales(
  callback: (summary: DailySalesSummary) => void
): () => void {
  let active = true;

  const refresh = async () => {
    if (!active) return;
    const summary = await getTodaySalesSummary();
    if (active) callback(summary);
  };

  refresh();

  const handleUpdate = () => {
    refresh();
  };

  window.addEventListener('shoppulse_sales_changed', handleUpdate);
  window.addEventListener('shoppulse_auth_changed', handleUpdate);

  return () => {
    active = false;
    window.removeEventListener('shoppulse_sales_changed', handleUpdate);
    window.removeEventListener('shoppulse_auth_changed', handleUpdate);
  };
}

/**
 * Get sales by period ('today' | '7days' | '30days').
 */
export async function getSalesByPeriod(period: 'today' | '7days' | '30days'): Promise<Sale[]> {
  return getSales({ period, limit: 100 });
}

/**
 * Search sales by bill number.
 */
export async function searchSales(billNumber: string): Promise<Sale[]> {
  const sales = await getSales(100);
  const query = billNumber.toLowerCase().trim();
  return sales.filter((s) => s.billNumber.toLowerCase().includes(query));
}

export const searchSalesByBillNumber = searchSales;
