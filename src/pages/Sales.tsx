import React, { useState, useMemo } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  Sparkles,
  Search,
  Receipt,
  Zap,
  RefreshCw,
  Clock,
  CreditCard,
  Banknote,
  Smartphone,
  User,
  AlertTriangle,
  X
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ReceiptModal } from '../components/ReceiptModal';
import type { Product, CartItem, Sale, PaymentMethod } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import { useSales } from '../hooks/useSales';

interface SalesProps {
  products: Product[];
  shopName?: string;
  onSaleComplete?: (sale: Sale) => void;
  initialTab?: 'pos' | 'history';
}

function formatSaleDateTime(isoString: string): { date: string; time: string } {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: 'Today', time: '' };
    return {
      date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    };
  } catch {
    return { date: 'Today', time: '' };
  }
}

export const Sales: React.FC<SalesProps> = ({ 
  products, 
  shopName = 'Kiran General Store',
  onSaleComplete,
  initialTab = 'pos'
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'pos' | 'history'>(initialTab);

  // Live sales hook connected to Firestore and real-time counter updates
  const { 
    sales, 
    loading: salesLoading, 
    recordSale, 
    deleteSale, 
    refreshSales 
  } = useSales();

  // POS State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Card'>('Cash');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [lastSaleTotal, setLastSaleTotal] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);

  // History State & Receipt Modal
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<Sale | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<'today' | '7days' | '30days' | 'all'>('all');
  const [historyPaymentMethod, setHistoryPaymentMethod] = useState<'All' | 'Cash' | 'UPI' | 'Card'>('All');
  const [historySearch, setHistorySearch] = useState('');
  const [deletingSale, setDeletingSale] = useState<Sale | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ---------------------------------------------------------------------------
  // Cart Actions
  // ---------------------------------------------------------------------------
  const addToCart = (product: Product) => {
    setSaleError(null);
    const existing = cart.find(item => item.product.id === product.id);
    if (existing) {
      setCart(cart.map(item => 
        item.product.id === product.id 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setSaleError(null);
    setCart(cart.map(item => {
      if (item.product.id === productId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean) as CartItem[]);
  };

  const removeFromCart = (productId: string) => {
    setSaleError(null);
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + (item.product.sellingPrice ?? item.product.price) * item.quantity, 
    0
  );

  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ---------------------------------------------------------------------------
  // Complete Sale (Checkout)
  // ---------------------------------------------------------------------------
  const handleCompleteSale = async () => {
    if (cart.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setSaleError(null);

    try {
      const { sale } = await recordSale({
        items: cart.map(item => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.sellingPrice ?? item.product.price,
          unit: item.product.unit
        })),
        paymentMethod: paymentMethod as PaymentMethod,
        customerName: customerName.trim() || undefined
      }, 'cashier_1', shopName);

      setCompletedSale(sale);
      setSelectedReceiptSale(sale);
      setLastSaleTotal(sale.total);
      setShowSuccessModal(true);
      setCart([]);
      setCustomerName('');
      onSaleComplete?.(sale);
    } catch (err: any) {
      setSaleError(err.message || 'Transaction failed. Please check stock and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete Past Sale
  // ---------------------------------------------------------------------------
  const handleConfirmDelete = async () => {
    if (!deletingSale) return;
    setIsDeleting(true);
    try {
      await deleteSale(deletingSale.id, true);
      setDeletingSale(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete sale.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // POS Filtering
  // ---------------------------------------------------------------------------
  const favoriteProducts = products.slice(0, 6);

  const filteredProducts = products.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // ---------------------------------------------------------------------------
  // History Filtering & Aggregation
  // ---------------------------------------------------------------------------
  const filteredHistorySales = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayTime = startOfToday.getTime();

    const seen = new Set<string>();
    const uniqueSales: Sale[] = [];

    for (const sale of sales) {
      const key = sale.id || sale.billNumber;
      if (seen.has(key)) continue;
      seen.add(key);

      // 1. Period filter
      if (historyPeriod !== 'all') {
        const saleTime = new Date(sale.createdAt).getTime();
        if (historyPeriod === 'today') {
          if (saleTime < startOfTodayTime) continue;
        } else if (historyPeriod === '7days') {
          if (now - saleTime > 7 * 24 * 3600 * 1000) continue;
        } else if (historyPeriod === '30days') {
          if (now - saleTime > 30 * 24 * 3600 * 1000) continue;
        }
      }

      // 2. Payment method filter
      if (historyPaymentMethod !== 'All' && sale.paymentMethod !== historyPaymentMethod) {
        continue;
      }

      // 3. Search query filter (matches bill number, customer name, or item names)
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const matchBill = sale.billNumber?.toLowerCase().includes(q);
        const matchCustomer = sale.customerName?.toLowerCase().includes(q);
        const matchItems = sale.items?.some(i => i.name.toLowerCase().includes(q));
        if (!matchBill && !matchCustomer && !matchItems) continue;
      }

      uniqueSales.push(sale);
    }

    return uniqueSales;
  }, [sales, historyPeriod, historyPaymentMethod, historySearch]);

  const historyTotals = useMemo(() => {
    const revenue = filteredHistorySales.reduce((sum, s) => sum + s.total, 0);
    const items = filteredHistorySales.reduce(
      (sum, s) => sum + s.items.reduce((itemSum, i) => itemSum + i.quantity, 0), 
      0
    );
    const avg = filteredHistorySales.length > 0 
      ? Math.round(revenue / filteredHistorySales.length) 
      : 0;
    return { revenue, items, count: filteredHistorySales.length, avg };
  }, [filteredHistorySales]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      
      {/* Page Header */}
      <PageHeader
        title={activeTab === 'pos' ? t('sales.title') : 'Sales History & Past Bills'}
        description={
          activeTab === 'pos' 
            ? t('sales.description') 
            : 'Track daily transactions, search by bill number, print receipts, and manage sales records'
        }
      />

      {/* Top Segmented Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-black transition-all cursor-pointer ${
              activeTab === 'pos'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span>Quick POS</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-black transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="w-4 h-4 text-emerald-600" />
            <span>Sales History</span>
            <span className="px-2 py-0.5 text-[11px] font-black rounded-full bg-emerald-100 text-emerald-800">
              {sales.length}
            </span>
          </button>
        </div>

        {activeTab === 'history' ? (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshSales()}
              disabled={salesLoading}
              className="rounded-xl text-xs font-bold"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${salesLoading ? 'animate-spin' : ''}`} />}
            >
              Sync
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveTab('pos')}
              className="rounded-xl text-xs font-black"
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              New Sale
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setActiveTab('history')}
            className="text-xs font-black text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer self-end sm:self-auto px-2"
          >
            <span>View Recent Bills ({sales.length})</span>
            <span>→</span>
          </button>
        )}
      </div>

      {/* =================================================================== */}
      {/* VIEW 1: QUICK POS (BILLING COUNTER)                                 */}
      {/* =================================================================== */}
      {activeTab === 'pos' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          
          {/* Quick Favorite Products Ribbon (1-Tap Add) */}
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-black text-emerald-800 uppercase tracking-wide mb-2">
              <Zap className="w-4 h-4 text-emerald-600 fill-emerald-600" />
              <span>{t('sales.quickCounterTap')}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {favoriteProducts.map((prod) => (
                <button
                  key={prod.id}
                  onClick={() => addToCart(prod)}
                  className="bg-white hover:bg-emerald-600 hover:text-white rounded-xl p-2.5 border border-emerald-200 text-left shrink-0 transition-all active:scale-95 shadow-2xs cursor-pointer group flex flex-col justify-between min-w-[120px]"
                >
                  <p className="font-extrabold text-xs text-slate-900 group-hover:text-white truncate max-w-[110px]">
                    {prod.name}
                  </p>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-100 group-hover:border-emerald-500">
                    <span className="font-black text-xs text-emerald-700 group-hover:text-white">₹{prod.price}</span>
                    <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 group-hover:bg-white group-hover:text-emerald-700 px-1.5 py-0.5 rounded-md">
                      {t('sales.add')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Search & Category Filter Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-3">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder={t('sales.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {PRODUCT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* POS Grid: Left Col Catalog + Right Col Bill Basket */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            
            {/* Left Col (2/3): Touch Product Cards Grid */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                  {t('sales.tapToBuild')}
                </h2>
                <span className="text-xs font-bold text-slate-500">
                  {t('sales.itemsAvailable', { count: filteredProducts.length })}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {filteredProducts.map((prod) => {
                  const inCart = cart.find(item => item.product.id === prod.id);
                  return (
                    <div
                      key={prod.id}
                      onClick={() => addToCart(prod)}
                      className={`bg-white rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-all cursor-pointer select-none active:scale-95 min-h-[110px] ${
                        inCart 
                          ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/30' 
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-extrabold uppercase text-slate-400">{prod.category}</span>
                          {inCart && (
                            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
                              {inCart.quantity}
                            </span>
                          )}
                        </div>
                        <h3 className="font-extrabold text-slate-900 text-xs sm:text-sm leading-tight line-clamp-2">
                          {prod.name}
                        </h3>
                      </div>

                      <div className="mt-3 flex items-baseline justify-between pt-2 border-t border-slate-100">
                        <span className="text-sm sm:text-base font-black text-slate-900">
                          ₹{prod.price}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart(prod);
                          }}
                          className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold rounded-lg hover:bg-emerald-700 text-xs flex items-center gap-1 active:scale-90 transition-transform cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> {t('sales.add')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Col (1/3): Current Customer Basket */}
            <div className="space-y-4">
              <Card className="sticky top-20 border-2 border-emerald-300 shadow-md">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-slate-900 font-black text-base">
                    <Receipt className="w-5 h-5 text-emerald-600" />
                    <span>{t('sales.customerBill')}</span>
                  </div>
                  {cart.length > 0 && (
                    <button
                      onClick={() => setCart([])}
                      className="text-xs font-extrabold text-rose-600 hover:underline cursor-pointer"
                    >
                      {t('sales.clearAll')}
                    </button>
                  )}
                </div>

                {/* Optional Customer Name Input */}
                <div className="pt-2.5">
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Customer name (optional)"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium bg-slate-50"
                    />
                  </div>
                </div>

                {/* Cart Items List */}
                <div className="divide-y divide-slate-100 max-h-[280px] overflow-y-auto my-2 pr-1">
                  {cart.map((item) => (
                    <div key={item.product.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                          {item.product.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 font-bold">
                          ₹{item.product.price} × {item.quantity} = <span className="text-emerald-700">₹{item.product.price * item.quantity}</span>
                        </p>
                      </div>

                      {/* Quantity Stepper [-] Qty [+] */}
                      <div className="flex items-center gap-1 shrink-0 bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, -1)}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-black text-sm text-slate-900 w-5 text-center">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 ml-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {cart.length === 0 && (
                    <div className="py-10 text-center text-slate-400 space-y-1">
                      <ShoppingCart className="w-10 h-10 mx-auto text-slate-300" />
                      <p className="font-extrabold text-slate-700 text-sm">{t('sales.billEmpty')}</p>
                      <p className="text-xs text-slate-400 font-medium">{t('sales.tapToBuild')}</p>
                    </div>
                  )}
                </div>

                {/* Payment Method Selector */}
                <div className="pt-2.5 border-t border-slate-100">
                  <label className="block text-[11px] font-black uppercase text-slate-500 mb-1.5">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['Cash', 'UPI', 'Card'] as const).map(method => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`py-2 text-xs font-black rounded-xl border transition-all cursor-pointer ${
                          paymentMethod === method
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                {saleError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl mt-2">
                    {saleError}
                  </div>
                )}

                {/* Total Footer */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-slate-500">
                      {t('sales.total', { count: totalItemCount })}
                    </span>
                    <span className="text-2xl font-black text-emerald-700">
                      ₹{totalAmount}
                    </span>
                  </div>

                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full font-black text-base py-3.5 rounded-2xl shadow-md shadow-emerald-600/20"
                    disabled={cart.length === 0 || isProcessing}
                    onClick={handleCompleteSale}
                    icon={<CheckCircle2 className="w-5 h-5" />}
                  >
                    {isProcessing ? 'Processing Sale...' : t('sales.completeSale', { total: `₹${totalAmount}` })}
                  </Button>
                </div>
              </Card>
            </div>

          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* VIEW 2: SALES HISTORY & PAST BILLS                                 */}
      {/* =================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          
          {/* Aggregated KPI Row for Filtered Period */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Period Revenue</p>
              <p className="text-2xl font-black text-emerald-700 mt-1">₹{historyTotals.revenue.toLocaleString('en-IN')}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Across filtered bills</p>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Total Bills</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{historyTotals.count}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Completed transactions</p>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Items Sold</p>
              <p className="text-2xl font-black text-blue-600 mt-1">{historyTotals.items}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Physical product units</p>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Average Bill</p>
              <p className="text-2xl font-black text-purple-600 mt-1">₹{historyTotals.avg}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Per customer ticket</p>
            </div>
          </div>

          {/* History Search & Filters Ribbon */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search by Bill Number (e.g. SP-2026...), customer name, or item..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
              />
              {historySearch && (
                <button
                  type="button"
                  onClick={() => setHistorySearch('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Pills: Time Period & Payment Method */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
              
              {/* Period Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="font-black text-slate-400 uppercase tracking-wider mr-1 shrink-0">Time:</span>
                {[
                  { id: 'all', label: 'All Time' },
                  { id: 'today', label: "Today" },
                  { id: '7days', label: '7 Days' },
                  { id: '30days', label: '30 Days' }
                ].map((period) => (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => setHistoryPeriod(period.id as any)}
                    className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                      historyPeriod === period.id
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>

              {/* Payment Method Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="font-black text-slate-400 uppercase tracking-wider mr-1 shrink-0">Payment:</span>
                {(['All', 'Cash', 'UPI', 'Card'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setHistoryPaymentMethod(method)}
                    className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                      historyPaymentMethod === method
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>

            </div>
          </div>

          {/* Sales List Table / Cards */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-slate-900 text-sm sm:text-base">
                  Past Transactions
                </h3>
                <span className="text-xs font-bold text-slate-400">
                  ({filteredHistorySales.length} found)
                </span>
              </div>

              {salesLoading && (
                <span className="text-xs font-bold text-emerald-600 animate-pulse">
                  Syncing live sales...
                </span>
              )}
            </div>

            {filteredHistorySales.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {filteredHistorySales.map((sale) => {
                  const { date, time } = formatSaleDateTime(sale.createdAt);
                  const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                  const summaryText = sale.items
                    .map(i => `${i.name} × ${i.quantity}`)
                    .slice(0, 3)
                    .join(', ') + (sale.items.length > 3 ? ` +${sale.items.length - 3} more` : '');

                  return (
                    <div 
                      key={sale.id}
                      className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      {/* Left: Bill Details & Line Items */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black bg-slate-900 text-white px-2.5 py-0.5 rounded-lg tracking-wide">
                            {sale.billNumber}
                          </span>
                          <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {date} • {time}
                          </span>
                          {sale.customerName && (
                            <span className="text-xs font-extrabold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <User className="w-3 h-3 text-slate-400" />
                              {sale.customerName}
                            </span>
                          )}
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                            sale.paymentMethod === 'Cash'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : sale.paymentMethod === 'UPI'
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}>
                            {sale.paymentMethod === 'Cash' && <Banknote className="w-3 h-3" />}
                            {sale.paymentMethod === 'UPI' && <Smartphone className="w-3 h-3" />}
                            {sale.paymentMethod === 'Card' && <CreditCard className="w-3 h-3" />}
                            {sale.paymentMethod}
                          </span>
                        </div>

                        {/* Line Items Preview */}
                        <p className="text-xs sm:text-sm font-bold text-slate-700 truncate">
                          {summaryText}
                        </p>
                        <p className="text-[11px] text-slate-400 font-medium">
                          {itemCount} total units sold
                        </p>
                      </div>

                      {/* Right: Amount & Actions */}
                      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                        <div className="text-left md:text-right">
                          <div className="text-lg sm:text-xl font-black text-emerald-700">
                            ₹{sale.total}
                          </div>
                          <div className="text-[10px] font-extrabold text-slate-400 uppercase">
                            Paid in Full
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedReceiptSale(sale);
                              setShowReceiptModal(true);
                            }}
                            className="rounded-xl text-xs font-black py-1.5 px-3 border-slate-300 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                            icon={<Receipt className="w-3.5 h-3.5" />}
                          >
                            Receipt
                          </Button>
                          <button
                            type="button"
                            onClick={() => setDeletingSale(sale)}
                            title="Delete transaction and restore inventory"
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                <Receipt className="w-12 h-12 mx-auto text-slate-300" />
                <h4 className="text-base font-black text-slate-800">
                  No sales found
                </h4>
                <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
                  {historySearch || historyPaymentMethod !== 'All' || historyPeriod !== 'all'
                    ? 'No sales matched your filters. Try resetting the filters or search keywords.'
                    : 'No sales records currently exist. Ring up customer purchases in Quick POS to start tracking sales history.'}
                </p>
                <div className="pt-2 flex items-center justify-center gap-2">
                  {(historySearch || historyPaymentMethod !== 'All' || historyPeriod !== 'all') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHistorySearch('');
                        setHistoryPaymentMethod('All');
                        setHistoryPeriod('all');
                      }}
                      className="rounded-xl text-xs font-bold"
                    >
                      Clear Filters
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveTab('pos')}
                    className="rounded-xl text-xs font-black"
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Open Quick POS
                  </Button>
                </div>
              </div>
            )}

          </div>

        </div>
      )}

      {/* Sale Complete Success Modal Sheet */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-6 max-w-sm w-full text-center shadow-xl border border-slate-200 animate-slide-up sm:animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">{t('sales.saleRecorded')}</h3>
            
            {completedSale?.billNumber && (
              <div className="mt-1.5">
                <span className="text-xs font-black bg-slate-100 text-slate-700 px-3 py-1 rounded-full border border-slate-200">
                  Bill No: {completedSale.billNumber}
                </span>
              </div>
            )}

            <p className="text-slate-600 mt-2 text-sm font-semibold">
              {t('sales.totalCollected')} <span className="text-emerald-700 font-black">₹{lastSaleTotal}</span>
              {completedSale?.paymentMethod && (
                <span className="text-slate-400 text-xs block mt-0.5">Paid via {completedSale.paymentMethod}</span>
              )}
            </p>

            <div className="mt-4 p-3 rounded-2xl bg-emerald-50 text-xs font-bold text-emerald-900 border border-emerald-200">
              {t('sales.stockUpdated')}
            </div>

            <div className="space-y-2 mt-5">
              <Button
                variant="outline"
                size="md"
                className="w-full font-extrabold py-2.5 rounded-xl border-slate-300"
                onClick={() => {
                  setSelectedReceiptSale(completedSale);
                  setShowReceiptModal(true);
                }}
              >
                🧾 View & Print Receipt
              </Button>

              <Button
                variant="outline"
                size="md"
                className="w-full font-extrabold py-2.5 rounded-xl border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setShowSuccessModal(false);
                  setActiveTab('history');
                }}
              >
                📜 View in Sales History
              </Button>

              <Button
                variant="primary"
                size="md"
                className="w-full font-extrabold py-3 rounded-xl"
                onClick={() => setShowSuccessModal(false)}
              >
                {t('sales.nextCustomer')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Digital Receipt Modal */}
      <ReceiptModal
        isOpen={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        sale={selectedReceiptSale || completedSale}
        shopName={shopName}
      />

      {/* Delete Sale Confirmation Modal */}
      {deletingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 text-rose-600 font-extrabold text-lg">
                <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600 shrink-0 border border-rose-200">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <span>Delete Bill Record</span>
              </div>
              <button 
                onClick={() => setDeletingSale(null)}
                disabled={isDeleting}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-2">
              <p className="text-sm text-slate-700 font-medium leading-relaxed">
                Are you sure you want to delete bill <span className="font-extrabold text-slate-900">"{deletingSale.billNumber}"</span> (₹{deletingSale.total})?
              </p>
              <p className="text-xs text-rose-700 font-semibold bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                ⚠️ This will cancel the transaction and automatically return the sold items back to your inventory stock.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 mt-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setDeletingSale(null)} 
                disabled={isDeleting}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button 
                type="button" 
                variant="primary" 
                onClick={handleConfirmDelete} 
                disabled={isDeleting}
                className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
                icon={<Trash2 className="w-4 h-4" />}
              >
                {isDeleting ? 'Deleting...' : 'Delete & Restore Stock'}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
