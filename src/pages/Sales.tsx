import React, { useState } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  Sparkles
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import type { Product, CartItem } from '../types';

interface SalesProps {
  products: Product[];
}

export const Sales: React.FC<SalesProps> = ({ products }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
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

  const handleCompleteSale = () => {
    if (cart.length === 0) return;
    setLastSaleTotal(totalAmount);
    setShowSuccessModal(true);
    setCart([]);
  };

  return (
    <div className="space-y-6">
      
      <PageHeader
        title="Quick Sales Counter"
        description="Tap products to quickly build customer bills"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Fast Product Selection Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
              Popular Items
            </h2>
            <span className="text-xs font-semibold text-slate-500">
              Tap + to add to sale
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {products.map((prod) => {
              const inCart = cart.find(item => item.product.id === prod.id);
              return (
                <div
                  key={prod.id}
                  onClick={() => addToCart(prod)}
                  className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col justify-between transition-all cursor-pointer select-none ${
                    inCart 
                      ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20' 
                      : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-500">{prod.category}</span>
                      {inCart && (
                        <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-extrabold text-xs flex items-center justify-center">
                          {inCart.quantity}
                        </span>
                      )}
                    </div>
                    <h3 className="font-extrabold text-slate-900 text-base leading-snug">
                      {prod.name}
                    </h3>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between pt-2 border-t border-slate-100">
                    <span className="text-lg font-black text-slate-900">
                      ₹{prod.price}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(prod);
                      }}
                      className="px-3 py-1 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 active:scale-95 text-xs flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 1 Col: Current Order Basket */}
        <div className="space-y-4">
          <Card className="sticky top-20 border-2 border-emerald-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-slate-900 font-extrabold text-lg">
                <ShoppingCart className="w-5 h-5 text-emerald-600" />
                <span>Current Sale</span>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs font-bold text-rose-600 hover:underline"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto my-3">
              {cart.map((item) => (
                <div key={item.product.id} className="py-3 flex items-center justify-between gap-2">
                  <div className="flex-1 pr-2">
                    <p className="font-bold text-slate-900 text-sm leading-tight">
                      {item.product.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      ₹{item.product.price} × {item.quantity} = ₹{item.product.price * item.quantity}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => updateQuantity(item.product.id, -1)}
                      className="p-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-extrabold text-sm text-slate-900 w-6 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.product.id, 1)}
                      className="p-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 ml-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {cart.length === 0 && (
                <div className="py-12 text-center text-slate-400 space-y-1">
                  <ShoppingCart className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="font-bold text-slate-600 text-sm">Cart is empty</p>
                  <p className="text-xs text-slate-400">Tap products on the left to add to bill</p>
                </div>
              )}
            </div>

            {/* Total Footer */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-slate-700">Total Amount:</span>
                <span className="text-2xl font-black text-emerald-700">
                  ₹{totalAmount}
                </span>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
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

      {/* Sale Complete Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl border border-slate-200">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-slate-900">Sale Completed!</h3>
            <p className="text-slate-600 mt-1 text-sm font-medium">
              Collected ₹{lastSaleTotal} from customer
            </p>
            <div className="mt-4 p-3 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600">
              ℹ️ Phase 0 UI Foundation — Inventory stock auto-deduction will trigger in Phase 1.
            </div>
            <Button
              variant="primary"
              size="md"
              className="w-full mt-6"
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
