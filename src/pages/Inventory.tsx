import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  Filter, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  RefreshCw
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { AddProductModal } from '../components/AddProductModal';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { Product, StoreProfile } from '../types';

interface InventoryProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, 'id'>) => void;
  profile: StoreProfile;
}

export const Inventory: React.FC<InventoryProps> = ({ products, onAddProduct, profile }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);

  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === profile.businessTypeId) || BUSINESS_TYPE_OPTIONS[0];

  useEffect(() => {
    setLocalProducts(products);
    setSelectedCategory('All');
  }, [products]);

  const handleAddProduct = (newProd: Omit<Product, 'id'>) => {
    const created: Product = {
      ...newProd,
      id: `p_${Date.now()}`,
    };
    setLocalProducts([created, ...localProducts]);
    onAddProduct(newProd);
  };

  const categories = ['All', ...activeOption.categoryList];

  const filteredProducts = localProducts.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.supplier.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getStatusBadge = (status: Product['status']) => {
    switch (status) {
      case 'In Stock':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            In Stock
          </span>
        );
      case 'Low Stock':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Low Stock
          </span>
        );
      case 'Out of Stock':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Out of Stock
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 font-sans">
      
      <PageHeader
        title={`Inventory Catalog (${activeOption.name})`}
        description={`View, filter and restock product inventory for ${profile.shopName}`}
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

      {/* Controls: Search & Category Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${activeOption.name} products by name, category, or supplier...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
            />
          </div>

        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Filter className="w-4 h-4 text-slate-400 shrink-0 mr-1" />
          {categories.map((cat) => (
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

      {/* Inventory Table / Card List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        
        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-extrabold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-6">Product</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Selling Price</th>
                <th className="py-3.5 px-4">Purchase Price</th>
                <th className="py-3.5 px-4">Stock</th>
                <th className="py-3.5 px-4">Reorder Level</th>
                <th className="py-3.5 px-4">Supplier</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-800">
              {filteredProducts.map((prod) => (
                <tr key={prod.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-4 px-6 font-bold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-xs border border-emerald-200 shrink-0">
                        {prod.name.charAt(0)}
                      </div>
                      <span>{prod.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-slate-600">{prod.category}</td>
                  <td className="py-4 px-4 font-black text-slate-900">
                    ₹{prod.price}
                  </td>
                  <td className="py-4 px-4 font-semibold text-slate-500">
                    ₹{prod.purchasePrice}
                  </td>
                  <td className="py-4 px-4 font-extrabold text-slate-900">
                    {prod.stock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 text-slate-500 font-semibold">
                    {prod.minStock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 text-slate-600 font-medium">
                    {prod.supplier}
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

        {/* Mobile & Tablet Card List View */}
        <div className="lg:hidden divide-y divide-slate-100">
          {filteredProducts.map((prod) => (
            <div key={prod.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900 text-base">{prod.name}</h4>
                  <p className="text-xs text-slate-500">
                    Category: {prod.category} • Supplier: {prod.supplier}
                  </p>
                </div>
                <div>{getStatusBadge(prod.status)}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-500 font-medium">Selling Price: </span>
                  <span className="font-black text-slate-900">₹{prod.price}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Purchase Price: </span>
                  <span className="font-bold text-slate-700">₹{prod.purchasePrice}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Stock: </span>
                  <span className="font-black text-slate-900">{prod.stock} {prod.unit}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Reorder Level: </span>
                  <span className="font-bold text-slate-700">{prod.minStock} {prod.unit}</span>
                </div>
              </div>

              <div className="flex items-center justify-end pt-1">
                <button
                  onClick={() => {
                    setLocalProducts(localProducts.map(p => p.id === prod.id ? { ...p, stock: p.stock + 10, status: 'In Stock' } : p));
                  }}
                  className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> +10 Stock
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="font-bold text-slate-700">No products found in {activeOption.name} catalog</p>
            <p className="text-sm text-slate-500">Try adjusting your search query or category filter</p>
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
