import React, { useState } from 'react';
import { X, Plus, PackageCheck } from 'lucide-react';
import { Button } from './Button';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import type { Product } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProduct: (product: Omit<Product, 'id'>) => void;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  onAddProduct,
}) => {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Dairy');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('10');
  const [unit, setUnit] = useState('pkts');
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
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
      setValidationError('Initial stock cannot be negative.');
      return;
    }

    const minStockNum = parseInt(minStock) || 5;
    const purchaseNum = parseFloat(purchasePrice) || (priceNum > 0 ? Math.round(priceNum * 0.7) : 0);

    let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
    if (stockNum === 0) status = 'Out of Stock';
    else if (stockNum <= minStockNum) status = 'Low Stock';

    const timestamp = new Date().toISOString();
    onAddProduct({
      name: name.trim(),
      category: category as any,
      stock: stockNum,
      minStock: minStockNum,
      reorderLevel: minStockNum,
      unit: unit.trim() || 'units',
      price: priceNum,
      sellingPrice: priceNum,
      purchasePrice: purchaseNum,
      barcode: barcode.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      status,
      lastRestocked: 'Just now',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Reset
    setName('');
    setStock('');
    setSellingPrice('');
    setPurchasePrice('');
    setBarcode('');
    setImageUrl('');
    setValidationError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-lg sm:text-xl">
            <PackageCheck className="w-6 h-6 shrink-0" />
            <span>{t('addProductModal.title')}</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {validationError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl">
            {validationError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              {t('addProductModal.productName')}
            </label>
            <input
              type="text"
              required
              placeholder={t('addProductModal.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                {t('addProductModal.category')}
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
                placeholder="28"
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
                placeholder="20"
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
                placeholder="Optional (e.g. 8901030...)"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                {t('addProductModal.initialStock')}
              </label>
              <input
                type="number"
                required
                min="0"
                placeholder="50"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                {t('addProductModal.minStockAlert')}
              </label>
              <input
                type="number"
                min="1"
                placeholder="10"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                {t('addProductModal.unit')}
              </label>
              <input
                type="text"
                placeholder="pkts / kg"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              {t('addProductModal.cancel')}
            </Button>
            <Button type="submit" variant="primary" icon={<Plus className="w-5 h-5" />} className="rounded-xl font-bold">
              {t('addProductModal.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
