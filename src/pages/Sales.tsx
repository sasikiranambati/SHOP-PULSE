import React, { useState } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  Sparkles,
  Search,
  Receipt,
  Zap
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import type { Product, CartItem } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';

interface SalesProps {
  products: Product[];
}

export const Sales: React.FC<SalesProps> = ({ products }) => {
  const { t } = useLanguage();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastSaleTotal, setLastSaleTotal] = useState(0);

  const addToCart = (product: Product) => {
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
    setCart(cart.map(item => {
      if (item.product.id === productId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean) as CartItem[]);
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity, 
    0
  );

  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCompleteSale = () => {
    if (cart.length === 0) return;
    setLastSaleTotal(totalAmount);
    setShowSuccessModal(true);
    setCart([]);
  };

  // Quick favorite products for instant 1-tap add
  const favoriteProducts = products.slice(0, 6);

  const filteredProducts = products.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      
      <PageHeader
        title={t('sales.title')}
        description={t('sales.description')}
      />

      {/* 1. Quick Favorite Products Ribbon (1-Tap Add) */}
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

      {/* 2. Top Search & Filter Bar */}
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

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto my-2 pr-1">
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
                      onClick={() => updateQuantity(item.product.id, -1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-black text-sm text-slate-900 w-5 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.product.id, 1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
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
                disabled={cart.length === 0}
                onClick={handleCompleteSale}
                icon={<CheckCircle2 className="w-5 h-5" />}
              >
                {t('sales.completeSale', { total: `₹${totalAmount}` })}
              </Button>
            </div>
          </Card>
        </div>

      </div>

      {/* Sale Complete Success Modal Sheet */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-6 max-w-sm w-full text-center shadow-xl border border-slate-200 animate-slide-up sm:animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">{t('sales.saleRecorded')}</h3>
            <p className="text-slate-600 mt-1 text-sm font-semibold">
              {t('sales.totalCollected')} <span className="text-emerald-700 font-black">₹{lastSaleTotal}</span>
            </p>
            <div className="mt-4 p-3 rounded-2xl bg-emerald-50 text-xs font-bold text-emerald-900 border border-emerald-200">
              {t('sales.stockUpdated')}
            </div>
            <Button
              variant="primary"
              size="md"
              className="w-full mt-5 font-extrabold py-3 rounded-xl"
              onClick={() => setShowSuccessModal(false)}
            >
              {t('sales.nextCustomer')}
            </Button>
          </div>
        </div>
      )}

    </div>
  );
};
