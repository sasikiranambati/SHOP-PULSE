import React, { useState, useMemo, useRef, useEffect, useId, lazy, Suspense } from 'react';
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
  X,
  Mic,
  Loader2,
  Printer
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ReceiptModal } from '../components/ReceiptModal';
import { ConfirmDialog } from '../components/ConfirmDialog';

// Lazy-load heavy voice modal so it is only fetched when microphone button is clicked
const VoiceBillModal = lazy(() => import('../components/VoiceBillModal').then(m => ({ default: m.VoiceBillModal })));
import type { Product, CartItem, Sale, PaymentMethod } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import { useSales } from '../hooks/useSales';
import { getSaleById } from '../services/salesService';
import { describeError } from '../utils/errorHandler';
import { useDialog } from '../hooks/useDialog';
import { usePrintRequest } from '../hooks/usePrint';
import { PrintPortal } from '../components/PrintPortal';
import { SalesReportDocument } from '../components/PrintDocuments';

interface SalesProps {
  products: Product[];
  shopName?: string;
  onSaleComplete?: (sale: Sale) => void;
  initialTab?: 'pos' | 'history';
  /**
   * Bill opened from global search. The page is mounted with a new `key` for each request;
   * it starts on Sales History and opens that bill's receipt.
   */
  focusSaleId?: string | null;
}

/** Backend sale lines carry only a product id; show the catalog name for that id when it is known. */
function withCatalogNames(sale: Sale, namesById: Map<string, { name: string; unit: string }>): Sale {
  if (!sale.items.some((i) => i.name === 'Sold Item' && namesById.has(i.productId))) return sale;
  return {
    ...sale,
    items: sale.items.map((item) => {
      const known = item.name === 'Sold Item' ? namesById.get(item.productId) : undefined;
      return known ? { ...item, name: known.name, productName: known.name, unit: known.unit || item.unit } : item;
    }),
  };
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
  initialTab = 'pos',
  focusSaleId = null
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'pos' | 'history'>(focusSaleId ? 'history' : initialTab);

  // Live sales hook connected to Firestore and real-time counter updates
  const { 
    sales: rawSales, 
    loading: salesLoading, 
    loadError: salesLoadError,
    recordSale, 
    refreshSales 
  } = useSales();

  const productNamesById = useMemo(
    () => new Map(products.map((p) => [p.id, { name: p.name, unit: p.unit }])),
    [products]
  );
  const sales = useMemo(
    () => rawSales.map((sale) => withCatalogNames(sale, productNamesById)),
    [rawSales, productNamesById]
  );

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
  const checkoutInFlight = useRef(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Synchronize mobile cart active state to body for floating elements (e.g. AI Assistant)
  useEffect(() => {
    if (cart.length > 0) {
      document.body.setAttribute('data-mobile-cart-active', 'true');
    } else {
      document.body.removeAttribute('data-mobile-cart-active');
    }
    return () => {
      document.body.removeAttribute('data-mobile-cart-active');
    };
  }, [cart.length]);

  // ---------------------------------------------------------------------------
  // Voice-to-Bill Cart Integration (Phase 8)
  // ---------------------------------------------------------------------------
  const handleVoiceItemsConfirmed = (items: Array<{ product: Product; quantity: number }>) => {
    setSaleError(null);
    setCart(prev => {
      const updated = [...prev];
      for (const item of items) {
        const existingIdx = updated.findIndex(c => c.product.id === item.product.id);
        if (existingIdx >= 0) {
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: updated[existingIdx].quantity + item.quantity
          };
        } else {
          updated.push({ product: item.product, quantity: item.quantity });
        }
      }
      return updated;
    });

    // Smooth scroll to bill section
    setTimeout(() => {
      document.getElementById('customer-bill-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
  };

  const handleVoiceDirectCheckout = (items: Array<{ product: Product; quantity: number }>) => {
    handleVoiceItemsConfirmed(items);
  };

  // History State & Receipt Modal
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<Sale | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<'today' | '7days' | '30days' | 'all'>('all');
  const [historyPaymentMethod, setHistoryPaymentMethod] = useState<'All' | 'Cash' | 'UPI' | 'Card'>('All');
  const [historySearch, setHistorySearch] = useState('');
  const [receiptLookupError, setReceiptLookupError] = useState<string | null>(null);
  const successTitleId = useId();
  const successRef = useDialog<HTMLDivElement>({ isOpen: showSuccessModal && !showReceiptModal, onClose: () => setShowSuccessModal(false), lockScroll: true });
  const { isPrinting: isPrintingReport, requestPrint: printReport } = usePrintRequest();

  // Open the bill chosen in global search (fetched directly if it is older than the loaded history).
  useEffect(() => {
    if (!focusSaleId) return;
    let cancelled = false;
    getSaleById(focusSaleId).then((found) => {
      if (cancelled) return;
      if (found) {
        setSelectedReceiptSale(withCatalogNames(found, productNamesById));
        setShowReceiptModal(true);
      } else {
        setReceiptLookupError('That bill could not be loaded. Check your connection and try again.');
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once per search request; the page is re-mounted for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSaleId]);

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
    // The ref blocks a second tap that arrives before React re-renders the disabled button.
    if (cart.length === 0 || isProcessing || checkoutInFlight.current) return;
    checkoutInFlight.current = true;
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
      // The cart is kept so the sale can be retried after fixing the problem.
      setSaleError(describeError(err, 'Transaction failed. Please check stock and try again.'));
    } finally {
      setIsProcessing(false);
      checkoutInFlight.current = false;
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
    <div className="space-y-4 max-w-5xl mx-auto min-w-0">
      
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2 rounded-xl border border-[#E3E5DE] shadow-xs">
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 bg-[#F7F5EF] p-1 rounded-lg w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-bold transition-all cursor-pointer min-h-[40px] ${
              activeTab === 'pos'
                ? 'bg-white text-[#202923] shadow-xs ring-1 ring-[#E3E5DE]'
                : 'text-[#69736C] hover:text-[#202923]'
            }`}
          >
            <Zap className="w-4 h-4 text-[#A66A16] fill-[#A66A16] shrink-0" />
            <span className="truncate">Quick POS</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-bold transition-all cursor-pointer min-h-[40px] ${
              activeTab === 'history'
                ? 'bg-white text-[#202923] shadow-xs ring-1 ring-[#E3E5DE]'
                : 'text-[#69736C] hover:text-[#202923]'
            }`}
          >
            <Receipt className="w-4 h-4 text-[#234B3A] shrink-0" />
            <span className="truncate">History</span>
            <span className="px-1.5 sm:px-2 py-0.5 text-[11px] font-bold rounded-full bg-[#E5EEE6] text-[#234B3A] shrink-0">
              {sales.length}
            </span>
          </button>
        </div>

        {activeTab === 'history' ? (
          <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto justify-end sm:justify-start">
            <Button
              variant="outline"
              size="sm"
              onClick={printReport}
              disabled={filteredHistorySales.length === 0}
              className="rounded-lg text-xs font-semibold min-h-[36px]"
              icon={<Printer className="w-3.5 h-3.5" />}
              title="Print the bills currently shown"
            >
              Print report
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshSales()}
              disabled={salesLoading}
              className="rounded-lg text-xs font-semibold min-h-[36px]"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${salesLoading ? 'animate-spin' : ''}`} />}
            >
              {salesLoading ? 'Syncing…' : 'Sync'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveTab('pos')}
              className="rounded-lg text-xs font-bold min-h-[36px]"
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              New Sale
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setShowVoiceModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#E5EEE6] border border-[#52745D]/30 text-[#234B3A] hover:bg-[#D5E4D7] text-xs font-bold transition-all cursor-pointer shadow-xs min-h-[38px]"
              title="Voice-to-Bill assistant"
            >
              <Mic className="w-3.5 h-3.5 text-[#234B3A] animate-pulse" />
              <span>Voice to Bill</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className="text-xs font-bold text-[#234B3A] hover:underline flex items-center gap-1 cursor-pointer px-2 min-h-[38px]"
            >
              <span>Recent Bills ({sales.length})</span>
              <span>→</span>
            </button>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* VIEW 1: QUICK POS (BILLING COUNTER)                                 */}
      {/* =================================================================== */}
      {activeTab === 'pos' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          
          {/* Quick Favorite Products Ribbon (1-Tap Add) */}
          <div className="bg-[#F7F5EF] rounded-xl border border-[#E3E5DE] p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#202923] uppercase tracking-wide mb-2">
              <Zap className="w-4 h-4 text-[#A66A16] fill-[#A66A16]" />
              <span>{t('sales.quickCounterTap')}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {favoriteProducts.map((prod) => (
                <button
                  key={prod.id}
                  onClick={() => addToCart(prod)}
                  className="bg-white hover:border-[#234B3A] rounded-lg p-2.5 border border-[#E3E5DE] text-left shrink-0 transition-all active:scale-95 shadow-xs cursor-pointer group flex flex-col justify-between min-w-[120px]"
                >
                  <p className="font-bold text-xs text-[#202923] truncate max-w-[110px]">
                    {prod.name}
                  </p>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#E3E5DE]">
                    <span className="font-extrabold text-xs text-[#202923]">₹{prod.price}</span>
                    <span className="text-[10px] font-bold bg-[#E5EEE6] text-[#234B3A] px-1.5 py-0.5 rounded">
                      {t('sales.add')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Search & Category Filter Bar */}
          <div className="bg-white rounded-xl border border-[#E3E5DE] p-3.5 shadow-xs space-y-3">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="w-5 h-5 absolute left-3.5 top-3 text-[#69736C]" />
                <input
                  type="text"
                  placeholder={t('sales.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-2 focus:ring-[#234B3A] focus:border-[#234B3A] text-base sm:text-sm font-medium text-[#202923] bg-white"
                />
              </div>

              {/* Voice-to-Bill Interactive Trigger Button */}
              <button
                type="button"
                onClick={() => setShowVoiceModal(true)}
                className="px-3.5 sm:px-4 py-2 bg-[#234B3A] hover:bg-[#18382B] active:scale-95 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs flex items-center gap-2 cursor-pointer transition-all shrink-0 min-h-[42px]"
                title="Create bill with Voice in 12 Indian Languages (बोलकर बिल बनाएं)"
                aria-label="Open Voice-to-Bill"
              >
                <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center shrink-0">
                  <Mic className="w-3.5 h-3.5 text-white animate-pulse" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="leading-tight font-bold text-xs sm:text-sm">Voice-to-Bill</span>
                  <span className="text-[10px] text-[#E5EEE6] font-normal hidden sm:inline">12 Languages</span>
                </div>
              </button>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {PRODUCT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#234B3A] text-white shadow-xs font-bold'
                      : 'bg-[#F7F5EF] text-[#69736C] hover:text-[#202923] hover:bg-[#EBE7DF]'
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
                <h2 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  {t('sales.tapToBuild')}
                </h2>
                <span className="text-xs font-medium text-[#64748B]">
                  {t('sales.itemsAvailable', { count: filteredProducts.length })}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredProducts.map((prod) => {
                  const inCart = cart.find(item => item.product.id === prod.id);
                  return (
                    <div
                      key={prod.id}
                      onClick={() => addToCart(prod)}
                      className={`bg-white rounded-xl border p-4 shadow-xs flex flex-col justify-between transition-all cursor-pointer select-none active:scale-95 min-h-[115px] ${
                        inCart 
                          ? 'border-[#234B3A] bg-[#E5EEE6]/30 ring-2 ring-[#234B3A]/20' 
                          : 'border-[#E3E5DE] hover:border-[#52745D]/50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase text-[#69736C]">{prod.category}</span>
                          {inCart && (
                            <span className="w-5 h-5 rounded-full bg-[#234B3A] text-white font-bold text-xs flex items-center justify-center shadow-xs">
                              {inCart.quantity}
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-[#202923] text-xs sm:text-sm leading-tight line-clamp-2">
                          {prod.name}
                        </h3>
                      </div>

                      <div className="mt-3 flex items-baseline justify-between pt-2 border-t border-[#E3E5DE]">
                        <span className="text-sm sm:text-base font-extrabold text-[#202923]">
                          ₹{prod.price}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart(prod);
                          }}
                          className="px-2.5 py-1 bg-[#234B3A] text-white font-bold rounded-lg hover:bg-[#18382B] text-xs flex items-center gap-1 active:scale-90 transition-transform cursor-pointer"
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
            <div id="customer-bill-section" className="space-y-4">
              <Card className="sticky top-20 border border-[#E3E5DE] shadow-xs">
                <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
                  <div className="flex items-center gap-2 text-[#202923] font-bold text-base">
                    <Receipt className="w-5 h-5 text-[#234B3A]" />
                    <span>{t('sales.customerBill')}</span>
                  </div>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(true)}
                      className="text-xs font-semibold text-[#B93838] hover:underline cursor-pointer min-h-[32px] px-1.5 inline-flex items-center"
                      title="Clear all items from current bill"
                    >
                      {t('sales.clearAll')}
                    </button>
                  )}
                </div>

                {/* Optional Customer Name Input */}
                <div className="pt-2.5">
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-3 text-[#69736C]" />
                    <input
                      type="text"
                      placeholder="Customer name (optional)"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-base sm:text-xs rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-1 focus:ring-[#234B3A] font-medium text-[#202923] bg-white min-h-[40px]"
                    />
                  </div>
                </div>

                {/* Cart Items List */}
                <div className="divide-y divide-[#E3E5DE] max-h-[280px] overflow-y-auto my-2 pr-1">
                  {cart.map((item) => (
                    <div key={item.product.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#202923] text-xs sm:text-sm truncate">
                          {item.product.name}
                        </p>
                        <p className="text-xs text-[#69736C] mt-0.5 font-medium">
                          ₹{item.product.price} × {item.quantity} = <span className="text-[#202923] font-bold">₹{item.product.price * item.quantity}</span>
                        </p>
                      </div>

                      {/* Quantity Stepper [-] Qty [+] */}
                      <div className="flex items-center gap-1 shrink-0 bg-[#F7F5EF] p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, -1)}
                          aria-label={`Decrease quantity of ${item.product.name}`}
                          className="w-7 h-7 rounded-md bg-white border border-[#E3E5DE] text-[#202923] flex items-center justify-center font-bold active:scale-90 cursor-pointer min-h-[28px] min-w-[28px]"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-bold text-sm text-[#202923] w-6 text-center">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product.id, 1)}
                          aria-label={`Increase quantity of ${item.product.name}`}
                          className="w-7 h-7 rounded-md bg-white border border-[#E3E5DE] text-[#202923] flex items-center justify-center font-bold active:scale-90 cursor-pointer min-h-[28px] min-w-[28px]"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          aria-label={`Remove ${item.product.name} from bill`}
                          className="p-1.5 text-[#69736C] hover:text-[#B93838] ml-0.5 cursor-pointer min-h-[28px] min-w-[28px] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {cart.length === 0 && (
                    <div className="py-10 text-center text-[#69736C] space-y-1">
                      <ShoppingCart className="w-10 h-10 mx-auto text-[#69736C]/40" />
                      <p className="font-bold text-[#202923] text-sm">{t('sales.billEmpty')}</p>
                      <p className="text-xs text-[#69736C] font-normal">{t('sales.tapToBuild')}</p>
                    </div>
                  )}
                </div>

                {/* Payment Method Selector */}
                <div className="pt-2.5 border-t border-[#E3E5DE]">
                  <label className="block text-[11px] font-bold uppercase text-[#69736C] mb-1.5">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['Cash', 'UPI', 'Card'] as const).map(method => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer min-h-[38px] active:scale-95 ${
                          paymentMethod === method
                            ? 'bg-[#234B3A] text-white border-[#234B3A] shadow-xs'
                            : 'bg-white text-[#69736C] border-[#E3E5DE] hover:bg-[#F7F5EF]'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                {saleError && (
                  <div role="alert" className="p-2.5 bg-[#FDF2F2] border border-[#B93838]/30 text-[#B93838] text-xs font-bold rounded-lg mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-[#B93838]" aria-hidden="true" />
                    <span>Sale not recorded. {saleError} Your bill items are kept so you can try again.</span>
                  </div>
                )}

                {/* Total Footer */}
                <div className="pt-3 border-t border-[#E3E5DE] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-[#69736C]">
                      {t('sales.total', { count: totalItemCount })}
                    </span>
                    <span className="text-2xl font-black text-[#202923]">
                      ₹{totalAmount}
                    </span>
                  </div>

                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full font-bold text-base py-3.5 rounded-lg shadow-xs min-h-[48px]"
                    disabled={cart.length === 0}
                    loading={isProcessing}
                    onClick={handleCompleteSale}
                    icon={<CheckCircle2 className="w-5 h-5" />}
                  >
                    {isProcessing ? 'Processing Sale...' : t('sales.completeSale', { total: `₹${totalAmount}` })}
                  </Button>
                </div>
              </Card>
            </div>

          </div>

          {/* Mobile Floating Cart Summary Bar (Quick Jump to Bill) */}
          {cart.length > 0 && (
            <div className="lg:hidden fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-3.5 right-3.5 z-30 bg-[#202923]/95 backdrop-blur-md text-white p-2.5 sm:p-3 rounded-xl shadow-xl border border-[#303c34] flex items-center justify-between animate-slide-up">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#234B3A] flex items-center justify-center text-white shrink-0">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-300 truncate">
                    {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'} in bill
                  </p>
                  <p className="text-sm font-extrabold text-white leading-tight">
                    ₹{totalAmount}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('customer-bill-section');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-3.5 py-2 bg-[#234B3A] hover:bg-[#18382B] active:scale-95 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 min-h-[38px]"
              >
                <span>View Bill</span>
                <span>→</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* VIEW 2: SALES HISTORY & PAST BILLS                                 */}
      {/* =================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          
          {/* Aggregated KPI Row for Filtered Period */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-white rounded-xl p-3 sm:p-4 border border-[#E3E5DE] shadow-xs min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#69736C] truncate">Period Revenue</p>
              <p className="text-xl sm:text-2xl font-black text-[#234B3A] mt-1 truncate">₹{historyTotals.revenue.toLocaleString('en-IN')}</p>
              <p className="text-[10px] sm:text-[11px] text-[#69736C] font-normal mt-0.5 truncate">Across filtered bills</p>
            </div>

            <div className="bg-white rounded-xl p-3 sm:p-4 border border-[#E3E5DE] shadow-xs min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#69736C] truncate">Total Bills</p>
              <p className="text-xl sm:text-2xl font-black text-[#202923] mt-1 truncate">{historyTotals.count}</p>
              <p className="text-[10px] sm:text-[11px] text-[#69736C] font-normal mt-0.5 truncate">Completed transactions</p>
            </div>

            <div className="bg-white rounded-xl p-3 sm:p-4 border border-[#E3E5DE] shadow-xs min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#69736C] truncate">Items Sold</p>
              <p className="text-xl sm:text-2xl font-black text-[#202923] mt-1 truncate">{historyTotals.items}</p>
              <p className="text-[10px] sm:text-[11px] text-[#69736C] font-normal mt-0.5 truncate">Physical product units</p>
            </div>

            <div className="bg-white rounded-xl p-3 sm:p-4 border border-[#E3E5DE] shadow-xs min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#69736C] truncate">Average Bill</p>
              <p className="text-xl sm:text-2xl font-black text-[#202923] mt-1 truncate">₹{historyTotals.avg}</p>
              <p className="text-[10px] sm:text-[11px] text-[#69736C] font-normal mt-0.5 truncate">Per customer ticket</p>
            </div>
          </div>

          {/* History Search & Filters Ribbon */}
          <div className="bg-white rounded-xl border border-[#E3E5DE] p-4 shadow-xs space-y-3">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3.5 top-3 text-[#69736C]" />
              <input
                type="text"
                placeholder="Search by Bill Number (e.g. SP-2026...), customer name, or item..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-2 focus:ring-[#234B3A] focus:border-[#234B3A] text-base sm:text-sm font-medium text-[#202923] bg-white"
              />
              {historySearch && (
                <button
                  type="button"
                  onClick={() => setHistorySearch('')}
                  className="absolute right-3 top-3 text-[#69736C] hover:text-[#202923]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Pills: Time Period & Payment Method */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#E3E5DE] text-xs">
              
              {/* Period Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="font-bold text-[#69736C] uppercase tracking-wider mr-1 shrink-0">Time:</span>
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
                    className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      historyPeriod === period.id
                        ? 'bg-[#234B3A] text-white shadow-xs font-bold'
                        : 'bg-[#F7F5EF] text-[#69736C] hover:text-[#202923] hover:bg-[#EBE7DF]'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>

              {/* Payment Method Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="font-bold text-[#69736C] uppercase tracking-wider mr-1 shrink-0">Payment:</span>
                {(['All', 'Cash', 'UPI', 'Card'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setHistoryPaymentMethod(method)}
                    className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      historyPaymentMethod === method
                        ? 'bg-[#202923] text-white shadow-xs font-bold'
                        : 'bg-[#F7F5EF] text-[#69736C] hover:text-[#202923] hover:bg-[#EBE7DF]'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>

            </div>
          </div>

          {/* Sales List Table / Cards */}
          <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs overflow-hidden">
            <div className="p-4 border-b border-[#E3E5DE] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#234B3A]" />
                <h3 className="font-bold text-[#202923] text-sm sm:text-base">
                  Past Transactions
                </h3>
                <span className="text-xs font-medium text-[#69736C]">
                  ({filteredHistorySales.length} found)
                </span>
              </div>

              {salesLoading && (
                <span role="status" className="text-xs font-semibold text-[#234B3A] flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Loading sales…
                </span>
              )}
            </div>

            {(salesLoadError || receiptLookupError) && (
              <div role="alert" className="m-4 p-3 rounded-lg bg-[#FDF2F2] border border-[#B93838]/30 text-[#B93838] text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#B93838] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-bold">{receiptLookupError ? 'Bill could not be opened.' : 'Sales history could not be loaded.'}</p>
                    <p className="font-normal">
                      {receiptLookupError || describeError({ message: salesLoadError }, 'The server did not respond.')}
                      {!receiptLookupError && sales.length > 0 ? ' The bills below may be out of date.' : ''}
                    </p>
                  </div>
                </div>
                {!receiptLookupError && (
                  <Button variant="outline" size="sm" loading={salesLoading} onClick={() => void refreshSales()} className="shrink-0">
                    Retry
                  </Button>
                )}
              </div>
            )}

            {salesLoading && sales.length === 0 && !salesLoadError ? (
              <div className="divide-y divide-[#E3E5DE]" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="h-4 w-40 rounded bg-[#E3E5DE]/70 animate-pulse" />
                    <div className="h-3 w-2/3 rounded bg-[#E3E5DE]/70 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : filteredHistorySales.length > 0 ? (
              <div className="divide-y divide-[#E3E5DE]">
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
                      className="p-4 hover:bg-[#F7F5EF]/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      {/* Left: Bill Details & Line Items */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold bg-[#202923] text-white px-2.5 py-0.5 rounded-md tracking-wide">
                            {sale.billNumber}
                          </span>
                          <span className="text-xs text-[#69736C] font-medium flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-[#69736C]" />
                            {date} • {time}
                          </span>
                          {sale.customerName && (
                            <span className="text-xs font-semibold text-[#202923] bg-[#F7F5EF] px-2 py-0.5 rounded-md flex items-center gap-1">
                              <User className="w-3 h-3 text-[#69736C]" />
                              {sale.customerName}
                            </span>
                          )}
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                            sale.paymentMethod === 'Cash'
                              ? 'bg-[#E5EEE6] text-[#234B3A] border-[#52745D]/30'
                              : sale.paymentMethod === 'UPI'
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-[#EEF4FC] text-[#3567A8] border-[#3567A8]/20'
                          }`}>
                            {sale.paymentMethod === 'Cash' && <Banknote className="w-3 h-3" />}
                            {sale.paymentMethod === 'UPI' && <Smartphone className="w-3 h-3" />}
                            {sale.paymentMethod === 'Card' && <CreditCard className="w-3 h-3" />}
                            {sale.paymentMethod}
                          </span>
                        </div>

                        {/* Line Items Preview */}
                        <p className="text-xs sm:text-sm font-semibold text-[#202923] truncate">
                          {summaryText}
                        </p>
                        <p className="text-[11px] text-[#69736C] font-normal">
                          {itemCount} total units sold
                        </p>
                      </div>

                      {/* Right: Amount & Actions */}
                      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#E3E5DE]">
                        <div className="text-left md:text-right">
                          <div className="text-lg sm:text-xl font-black text-[#202923]">
                            ₹{sale.total}
                          </div>
                          <div className="text-[10px] font-semibold text-[#234B3A] uppercase">
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
                            className="rounded-lg text-xs font-bold py-1.5 px-3 border-[#E3E5DE] hover:bg-[#E5EEE6] hover:text-[#234B3A] hover:border-[#52745D]/40 text-[#202923]"
                            icon={<Receipt className="w-3.5 h-3.5" />}
                          >
                            Receipt
                          </Button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                <Receipt className="w-12 h-12 mx-auto text-[#69736C]/40" />
                <h4 className="text-base font-bold text-[#202923]">
                  No sales found
                </h4>
                <p className="text-xs sm:text-sm text-[#69736C] max-w-sm mx-auto">
                  {salesLoadError && sales.length === 0
                    ? 'Sales could not be loaded, so none are shown. Use Retry above.'
                    : historySearch || historyPaymentMethod !== 'All' || historyPeriod !== 'all'
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
                      className="rounded-lg text-xs font-semibold"
                    >
                      Clear Filters
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveTab('pos')}
                    className="rounded-lg text-xs font-bold"
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

      {isPrintingReport && (
        <PrintPortal label="Sales report print view">
          <SalesReportDocument
            sales={filteredHistorySales}
            shopName={shopName}
            totals={historyTotals}
            filterLabel={[
              { all: 'All time', today: 'Today', '7days': 'Last 7 days', '30days': 'Last 30 days' }[historyPeriod],
              historyPaymentMethod === 'All' ? 'all payment methods' : historyPaymentMethod,
              historySearch.trim() ? `matching “${historySearch.trim()}”` : null,
            ].filter(Boolean).join(', ')}
          />
        </PrintPortal>
      )}

      {/* Sale Complete Success Modal Sheet */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60">
          <div
            ref={successRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={successTitleId}
            className="bg-white rounded-t-2xl sm:rounded-xl p-6 sm:p-7 max-w-sm w-full text-center shadow-xl border border-[#E3E5DE] animate-slide-up sm:animate-fade-in max-h-[90vh] max-h-[90dvh] overflow-y-auto"
          >
            <div className="w-14 h-14 rounded-xl bg-[#E5EEE6] text-[#234B3A] mx-auto flex items-center justify-center mb-3">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 id={successTitleId} className="text-xl sm:text-2xl font-black text-[#202923]">{t('sales.saleRecorded')}</h3>
            
            {completedSale?.billNumber && (
              <div className="mt-1.5">
                <span className="text-xs font-semibold bg-[#F7F5EF] text-[#202923] px-3 py-1 rounded-full border border-[#E3E5DE]">
                  Bill No: {completedSale.billNumber}
                </span>
              </div>
            )}

            <p className="text-[#69736C] mt-2 text-sm font-medium">
              {t('sales.totalCollected')} <span className="text-[#202923] font-extrabold">₹{lastSaleTotal}</span>
              {completedSale?.paymentMethod && (
                <span className="text-[#69736C] text-xs block mt-0.5">Paid via {completedSale.paymentMethod}</span>
              )}
            </p>

            <div className="mt-4 p-3 rounded-lg bg-[#E5EEE6] text-xs font-semibold text-[#234B3A] border border-[#52745D]/25">
              {t('sales.stockUpdated')}
            </div>

            <div className="space-y-2 mt-5">
              <Button
                variant="outline"
                size="md"
                className="w-full font-bold py-2.5 rounded-lg border-[#E3E5DE] text-[#202923] hover:bg-[#F7F5EF] min-h-[42px]"
                icon={<Receipt className="w-4 h-4" />}
                onClick={() => {
                  setSelectedReceiptSale(completedSale);
                  setShowReceiptModal(true);
                }}
              >
                View & Print Receipt
              </Button>

              <Button
                variant="outline"
                size="md"
                className="w-full font-bold py-2.5 rounded-lg border-[#E3E5DE] text-[#202923] hover:bg-[#F7F5EF] min-h-[42px]"
                icon={<Clock className="w-4 h-4" />}
                onClick={() => {
                  setShowSuccessModal(false);
                  setActiveTab('history');
                }}
              >
                View in Sales History
              </Button>

              <Button
                variant="primary"
                size="md"
                className="w-full font-bold py-3 rounded-lg min-h-[44px]"
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

      {/* Voice-to-Bill Modal (Phases 3, 6, 7, 8, 10) */}
      {showVoiceModal && (
        <Suspense fallback={null}>
          <VoiceBillModal
            isOpen={showVoiceModal}
            onClose={() => setShowVoiceModal(false)}
            products={products}
            onConfirmToCart={handleVoiceItemsConfirmed}
            onDirectCheckout={handleVoiceDirectCheckout}
          />
        </Suspense>
      )}

      {/* Confirm Discard/Clear Active Bill Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear current bill?"
        message={`Are you sure you want to remove all ${totalItemCount} item${totalItemCount === 1 ? '' : 's'} (₹${totalAmount}) from this bill?`}
        warning="This will clear the current customer bill. Items are not lost from your store stock and can be added again."
        confirmLabel="Clear bill"
        tone="danger"
        onConfirm={() => {
          setCart([]);
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />

    </div>
  );
};
