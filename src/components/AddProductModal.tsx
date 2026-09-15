import React, { useState } from 'react';
import { X, Plus, PackageCheck } from 'lucide-react';
import { Button } from './Button';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import type { Product } from '../types';

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
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Dairy');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('10');
  const [unit, setUnit] = useState('pkts');
  const [price, setPrice] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !price || !stock) return;

    const stockNum = parseInt(stock) || 0;
    const minStockNum = parseInt(minStock) || 5;

    let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
    if (stockNum === 0) status = 'Out of Stock';
    else if (stockNum <= minStockNum) status = 'Low Stock';

    onAddProduct({
      name,
      category,
      stock: stockNum,
      minStock: minStockNum,
      unit,
      price: parseFloat(price) || 0,
      status,
      lastRestocked: 'Just now',
    });

    // Reset
    setName('');
    setStock('');
    setPrice('');
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
            <PackageCheck className="w-6 h-6" />
            <span>Add New Kirana Product</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Product Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Amul Milk 500ml"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
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
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium bg-white"
              >
                {PRODUCT_CATEGORIES.filter(c => c !== 'All').map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Price (₹) *
              </label>
              <input
                type="number"
                required
                min="0"
                placeholder="28"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Initial Stock *
              </label>
              <input
                type="number"
                required
                min="0"
                placeholder="50"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Min Stock Alert
              </label>
              <input
                type="number"
                min="1"
                placeholder="10"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                Unit
              </label>
              <input
                type="text"
                placeholder="pkts / kg"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base font-medium"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={<Plus className="w-5 h-5" />} className="rounded-xl font-bold">
              Add Product
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
