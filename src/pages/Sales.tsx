import React, { useState } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  Sparkles,
  Search,
  Receipt
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import type { Product, CartItem } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';

interface SalesProps {
  products: Product[];
}

export const Sales: React.FC<SalesProps> = ({ products }) => {
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

  const filteredProducts = products.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      
      <PageHeader
        title="Mobile Quick POS"
        description="Tap products to build customer bills instantly"
      />

      {/* Top Search & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search milk, rice, biscuits..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
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
            <h2 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
              Tap + To Add Item
            </h2>
            <span className="text-xs font-bold text-slate-500">
              {filteredProducts.length} Items Available
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {filteredProducts.map((prod) => {
              const inCart = cart.find(item => item.product.id === prod.id);
              return (
                <div
                  key={prod.id}
                  onClick={() => addToCart(prod)}
                  className={`bg-white rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-all cursor-pointer select-none active:scale-95 ${
                    inCart 
                      ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/30' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-extrabold uppercase text-slate-400">{prod.category}</span>
                      {inCart && (
                        <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">
                          {inCart.quantity}
                        </span>
                      )}
                    </div>
                    <h3 className="font-extrabold text-slate-900 text-sm leading-tight line-clamp-2">
                      {prod.name}
                    </h3>
                  </div>

                  <div className="mt-3 flex items-baseline justify-between pt-2 border-t border-slate-100">
                    <span className="text-base font-black text-slate-900">
                      ₹{prod.price}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(prod);
                      }}
                      className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold rounded-lg hover:bg-emerald-700 text-xs flex items-center gap-1 active:scale-90 transition-transform"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col (1/3): Current Order Basket */}
        <div className="space-y-4">
          <Card className="sticky top-20 border-2 border-emerald-200 shadow-md">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-black text-base">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <span>Current Customer Bill</span>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs font-bold text-rose-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto my-2">
              {cart.map((item) => (
                <div key={item.product.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                      {item.product.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">
                      ₹{item.product.price} × {item.quantity} = ₹{item.product.price * item.quantity}
                    </p>
                  </div>

                  {/* Quantity Stepper [-] Qty [+] */}
                  <div className="flex items-center gap-1 shrink-0 bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => updateQuantity(item.product.id, -1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-black text-sm text-slate-900 w-5 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.product.id, 1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold active:scale-90"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 ml-0.5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {cart.length === 0 && (
                <div className="py-8 text-center text-slate-400 space-y-1">
                  <ShoppingCart className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="font-extrabold text-slate-700 text-sm">Bill is empty</p>
                  <p className="text-xs text-slate-400">Tap items on the left to build order</p>
                </div>
              )}
            </div>

            {/* Total Footer */}
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase text-slate-500">
                  Total ({totalItemCount} items)
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
                Complete Sale
              </Button>
            </div>
          </Card>
        </div>

      </div>

      {/* Sale Complete Success Modal Sheet */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-6 max-w-sm w-full text-center shadow-xl border border-slate-200 animate-in slide-in-from-bottom duration-200">
            <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Sale Recorded!</h3>
            <p className="text-slate-600 mt-1 text-sm font-semibold">
              Total Bill Collected: <span className="text-emerald-700 font-black">₹{lastSaleTotal}</span>
            </p>
            <div className="mt-4 p-3 rounded-2xl bg-slate-50 text-xs font-semibold text-slate-600 border border-slate-200">
              ℹ️ Phase 0 UI Mock — Stock deduction and transaction logging active.
            </div>
            <Button
              variant="primary"
              size="md"
              className="w-full mt-5 font-extrabold py-3 rounded-xl"
              onClick={() => setShowSuccessModal(false)}
            >
              Next Sale
            </Button>
          </div>
        </div>
      )}

    </div>
  );
};
