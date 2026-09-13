import { useState } from 'react';
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

    const sellingPrice = parseFloat(price) || 0;
    onAddProduct({
      name,
      category,
      stock: stockNum,
      minStock: minStockNum,
      unit,
      price: sellingPrice,
      purchasePrice: Math.round(sellingPrice * 0.7),
      supplier: 'Direct Supplier',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-emerald-700 font-bold text-xl">
            <PackageCheck className="w-6 h-6" />
            <span>Add New Product</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Product Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Fresh Milk 500ml"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-base"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              >
                {PRODUCT_CATEGORIES.filter(c => c !== 'All').map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Price (₹) *
              </label>
              <input
                type="number"
                required
                min="0"
                placeholder="45"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Initial Stock *
              </label>
              <input
                type="number"
                required
                min="0"
                placeholder="50"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Min Stock Alert
              </label>
              <input
                type="number"
                min="1"
                placeholder="10"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Unit
              </label>
              <input
                type="text"
                placeholder="pkts / kg"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={<Plus className="w-5 h-5" />}>
              Add Product
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
