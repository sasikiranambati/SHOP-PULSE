import React, { useState } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  RefreshCw
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { AddProductModal } from '../components/AddProductModal';
import type { Product } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';

interface InventoryProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, 'id'>) => void;
}

export const Inventory: React.FC<InventoryProps> = ({ products, onAddProduct }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);

  const handleAddProduct = (newProd: Omit<Product, 'id'>) => {
    const created: Product = {
      ...newProd,
      id: `p_${Date.now()}`,
    };
    setLocalProducts([created, ...localProducts]);
    onAddProduct(newProd);
  };

  const filteredProducts = localProducts.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const lowStockItems = localProducts.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock');

  const getStatusBadge = (status: Product['status']) => {
    switch (status) {
      case 'In Stock':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            In Stock
          </span>
        );
      case 'Low Stock':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Low Stock
          </span>
        );
      case 'Out of Stock':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Out of Stock
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      
      <PageHeader
        title="Stock & Inventory"
        description="Monitor product stock levels and restock fast"
        action={
          <Button
            variant="primary"
            onClick={() => setIsModalOpen(true)}
            icon={<Plus className="w-5 h-5" />}
          >
            Add Product
          </Button>
        }
      />

      {/* Low Stock Warning Banner */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm uppercase tracking-wide mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <span>⚠️ {lowStockItems.length} Products Need Attention</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {lowStockItems.slice(0, 4).map(item => (
              <div key={item.id} className="bg-white rounded-xl p-2.5 border border-amber-200 shrink-0 flex items-center gap-3">
                <div>
                  <p className="font-extrabold text-slate-900 text-xs">{item.name}</p>
                  <p className="text-[11px] text-slate-500 font-medium">{item.stock} {item.unit} left</p>
                </div>
                <button
                  onClick={() => {
                    setLocalProducts(localProducts.map(p => p.id === item.id ? { ...p, stock: p.stock + 10, status: 'In Stock' } : p));
                  }}
                  className="px-2.5 py-1 bg-emerald-600 text-white font-extrabold text-[11px] rounded-lg active:scale-95 transition-transform shrink-0"
                >
                  Restock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls: Search & Category Filter */}
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

        {/* Category filter pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {PRODUCT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-extrabold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-6">Product</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Stock</th>
                <th className="py-3.5 px-4">Price</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-800">
              {filteredProducts.map((prod) => (
                <tr key={prod.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-4 px-6 font-bold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-xs border border-emerald-200">
                        {prod.name.charAt(0)}
                      </div>
                      <span>{prod.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-slate-600">{prod.category}</td>
                  <td className="py-4 px-4 font-bold text-slate-900">
                    {prod.stock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 font-extrabold text-slate-900">
                    ₹{prod.price}
                  </td>
                  <td className="py-4 px-4">{getStatusBadge(prod.status)}</td>
                  <td className="py-4 px-6 text-right">
                    <button 
                      onClick={() => {
                        setLocalProducts(localProducts.map(p => p.id === prod.id ? { ...p, stock: p.stock + 10, status: 'In Stock' } : p));
                      }}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Restock +10
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Product Card List View */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredProducts.map((prod) => (
            <div key={prod.id} className="p-4 space-y-2.5 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-extrabold text-slate-900 text-base leading-tight">{prod.name}</h4>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{prod.category} • ₹{prod.price} per {prod.unit}</p>
                </div>
                <div>{getStatusBadge(prod.status)}</div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-sm font-black text-slate-900">
                  Stock: {prod.stock} {prod.unit}
                </span>
                <button
                  onClick={() => {
                    setLocalProducts(localProducts.map(p => p.id === prod.id ? { ...p, stock: p.stock + 10, status: 'In Stock' } : p));
                  }}
                  className="text-xs font-extrabold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> +10 Restock
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="p-10 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="font-bold text-slate-700">No products found</p>
            <p className="text-xs text-slate-500">Try adjusting your search or category filter</p>
          </div>
        )}

      </div>

      <AddProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddProduct={handleAddProduct}
      />
    </div>
  );
};
