import React, { useState, useEffect } from 'react';
import { X, Save, Edit3 } from 'lucide-react';
import { Button } from './Button';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import type { Product, ProductCategory } from '../types';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onUpdateProduct: (id: string, updates: Partial<Product>) => void | Promise<void>;
}

export const EditProductModal: React.FC<EditProductModalProps> = ({
  isOpen,
  onClose,
  product,
  onUpdateProduct,
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('Dairy');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('10');
  const [unit, setUnit] = useState('pkts');
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Populate fields when the selected product changes
  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setCategory(product.category || 'Dairy');
      setStock(String(product.stock ?? 0));
      setMinStock(String(product.reorderLevel ?? product.minStock ?? 10));
      setUnit(product.unit || 'units');
      setSellingPrice(String(product.sellingPrice ?? product.price ?? ''));
      setPurchasePrice(String(product.purchasePrice ?? ''));
      setBarcode(product.barcode || '');
      setValidationError(null);
    }
  }, [product, isOpen]);

  if (!isOpen || !product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!name.trim()) {
      setValidationError('Product name is required.');
      return;
    }

    const priceNum = parseFloat(sellingPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setValidationError('Selling price must be greater than 0.');
      return;
    }

    const stockNum = parseInt(stock);
    if (isNaN(stockNum) || stockNum < 0) {
      setValidationError('Stock cannot be negative.');
      return;
    }

    const minStockNum = parseInt(minStock) || 5;
    const purchaseNum = parseFloat(purchasePrice) || 0;

    let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
    if (stockNum === 0) status = 'Out of Stock';
    else if (stockNum <= minStockNum) status = 'Low Stock';

    setIsSubmitting(true);
    try {
      await onUpdateProduct(product.id, {
        name: name.trim(),
        category: category as ProductCategory,
        stock: stockNum,
        minStock: minStockNum,
        reorderLevel: minStockNum,
        unit: unit.trim() || 'units',
        price: priceNum,
        sellingPrice: priceNum,
        purchasePrice: purchaseNum,
        barcode: barcode.trim() || undefined,
        status,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (err: any) {
      setValidationError(err?.message || 'Failed to update product.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-800 font-extrabold text-lg sm:text-xl">
            <Edit3 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>Edit Product</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {validationError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl">
            {validationError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Product Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium bg-white"
              >
                {PRODUCT_CATEGORIES.filter(c => c !== 'All').map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Selling Price (₹) *
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Purchase Price (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Barcode / SKU
              </label>
              <input
                type="text"
                placeholder="Optional"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Stock *
              </label>
              <input
                type="number"
                required
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Min Stock Alert
              </label>
              <input
                type="number"
                min="1"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Unit
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose} 
              disabled={isSubmitting}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary" 
              disabled={isSubmitting}
              icon={<Save className="w-4 h-4" />} 
              className="rounded-xl font-bold"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
