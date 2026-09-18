import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  AlertTriangle, 
  RefreshCw,
  Pencil,
  Trash2
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { AddProductModal } from '../components/AddProductModal';
import { EditProductModal } from '../components/EditProductModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import type { Product } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import { 
  increaseStock, 
  updateProduct as serviceUpdateProduct, 
  deleteProduct as serviceDeleteProduct 
} from '../services/inventoryService';

interface InventoryProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, 'id'>) => void | Promise<void>;
  onRestock?: (id: string, quantity: number) => void | Promise<void>;
  onUpdateProduct?: (id: string, updates: Partial<Product>) => void | Promise<void>;
  onDeleteProduct?: (id: string) => void | Promise<void>;
}

export const Inventory: React.FC<InventoryProps> = ({ 
  products, 
  onAddProduct, 
  onRestock,
  onUpdateProduct,
  onDeleteProduct
}) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);

  // Synchronize local products with live products stream
  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  const handleAddProduct = async (newProd: Omit<Product, 'id'>) => {
    const created: Product = {
      ...newProd,
      id: `p_${Date.now()}`,
    };
    setLocalProducts([created, ...localProducts]);
    try {
      await onAddProduct(newProd);
    } catch (err) {
      console.error('Error adding product in Inventory page:', err);
    }
  };

  const filteredProducts = localProducts.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          prod.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (prod.barcode && prod.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const lowStockItems = localProducts.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock' || (p.stock <= (p.reorderLevel ?? p.minStock ?? 0)));

  const restockItem = async (id: string) => {
    // Optimistic update
    setLocalProducts(prev => prev.map(p => 
      p.id === id ? { ...p, stock: p.stock + 10, status: 'In Stock' } : p
    ));

    try {
      if (onRestock) {
        await onRestock(id, 10);
      } else {
        await increaseStock(id, 10);
      }
    } catch (err) {
      console.error('Failed to restock item:', err);
    }
  };

  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    // Optimistic update
    setLocalProducts(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));

    try {
      if (onUpdateProduct) {
        await onUpdateProduct(id, updates);
      } else {
        await serviceUpdateProduct(id, updates);
      }
    } catch (err) {
      console.error('Failed to update product:', err);
      setLocalProducts(products); // Revert on failure
      throw err;
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) return;
    const prodId = deletingProduct.id;
    setIsDeleting(true);

    // Optimistic remove
    setLocalProducts(prev => prev.filter(p => p.id !== prodId));

    try {
      if (onDeleteProduct) {
        await onDeleteProduct(prodId);
      } else {
        await serviceDeleteProduct(prodId);
      }
      setDeletingProduct(null);
    } catch (err) {
      console.error('Failed to delete product:', err);
      setLocalProducts(products); // Revert on failure
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        action={
          <Button
            variant="primary"
            onClick={() => setIsModalOpen(true)}
            icon={<Plus className="w-5 h-5" />}
            className="font-black"
          >
            {t('inventory.addProduct')}
          </Button>
        }
      />

      {/* Low Stock Warning Top Banner */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50/90 rounded-2xl border border-amber-300/80 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-amber-900 font-black text-xs sm:text-sm uppercase tracking-wide mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('inventory.productsAttention', { count: lowStockItems.length })}</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {lowStockItems.slice(0, 5).map(item => (
              <div key={item.id} className="bg-white rounded-xl p-2.5 border border-amber-200 shrink-0 flex items-center gap-3 shadow-2xs">
                <div>
                  <p className="font-extrabold text-slate-900 text-xs">{item.name}</p>
                  <p className="text-[11px] text-amber-800 font-bold">{item.stock} {item.unit} {t('dashboard.left')}</p>
                </div>
                <button
                  onClick={() => restockItem(item.id)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-lg active:scale-95 transition-transform shrink-0 cursor-pointer"
                >
                  {t('dashboard.restock')}
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
            placeholder={t('inventory.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium"
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
        
        {/* Desktop Table View (>= 768px) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-black text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-6">{t('inventory.tableProduct')}</th>
                <th className="py-3.5 px-4">{t('inventory.tableCategory')}</th>
                <th className="py-3.5 px-4">{t('inventory.tableStock')}</th>
                <th className="py-3.5 px-4">{t('inventory.tablePrice')}</th>
                <th className="py-3.5 px-4">{t('inventory.tableStatus')}</th>
                <th className="py-3.5 px-6 text-right">{t('inventory.tableActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-800">
              {filteredProducts.map((prod) => (
                <tr key={prod.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-4 px-6 font-bold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      {prod.imageUrl ? (
                        <img 
                          src={prod.imageUrl} 
                          alt={prod.name} 
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0" 
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-xs border border-emerald-200 shrink-0">
                          {prod.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <span>{prod.name}</span>
                        {prod.barcode && (
                          <span className="block text-[10px] text-slate-400 font-normal">
                            UPC: {prod.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4 font-semibold text-slate-600">{prod.category}</td>
                  <td className="py-4 px-4 font-bold text-slate-900">
                    {prod.stock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 font-black text-slate-900">
                    ₹{prod.price}
                  </td>
                  <td className="py-4 px-4">
                    <StatusBadge status={prod.status} />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button 
                        onClick={() => restockItem(prod.id)}
                        title="Restock +10"
                        className="text-xs font-black text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg border border-emerald-200 transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="hidden xl:inline">{t('inventory.restockTen')}</span>
                        <span className="xl:hidden">+10</span>
                      </button>
                      <button 
                        onClick={() => setEditingProduct(prod)}
                        title="Edit Product"
                        className="text-xs font-black text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-200 transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95"
                      >
                        <Pencil className="w-3.5 h-3.5 text-slate-600" />
                        <span>Edit</span>
                      </button>
                      <button 
                        onClick={() => setDeletingProduct(prod)}
                        title="Delete Product"
                        className="p-1.5 text-xs font-black text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-all inline-flex items-center cursor-pointer active:scale-95"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Product Cards View (< 768px) */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredProducts.map((prod) => (
            <div key={prod.id} className="p-4 space-y-2.5 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {prod.imageUrl ? (
                    <img 
                      src={prod.imageUrl} 
                      alt={prod.name} 
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" 
                    />
                  ) : null}
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-base leading-tight">{prod.name}</h4>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">{prod.category} • ₹{prod.price} per {prod.unit}</p>
                    {prod.barcode && <p className="text-[10px] text-slate-400 font-medium">UPC: {prod.barcode}</p>}
                  </div>
                </div>
                <div>
                  <StatusBadge status={prod.status} size="sm" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-sm font-black text-slate-900">
                  {t('inventory.tableStock')}: {prod.stock} {prod.unit}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => restockItem(prod.id)}
                    className="text-xs font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl border border-emerald-200 flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-600" /> +10
                  </button>
                  <button
                    onClick={() => setEditingProduct(prod)}
                    className="text-xs font-black text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-xl border border-slate-200 flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5 text-slate-600" /> Edit
                  </button>
                  <button
                    onClick={() => setDeletingProduct(prod)}
                    className="p-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 flex items-center cursor-pointer active:scale-95 transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="p-10 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="font-extrabold text-slate-700">{t('inventory.noProductsFound')}</p>
            <p className="text-xs text-slate-500 font-medium">{t('inventory.adjustSearch')}</p>
          </div>
        )}

      </div>

      <AddProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddProduct={handleAddProduct}
      />

      <EditProductModal
        isOpen={!!editingProduct}
        product={editingProduct}
        onClose={() => setEditingProduct(null)}
        onUpdateProduct={handleUpdateProduct}
      />

      <DeleteConfirmModal
        isOpen={!!deletingProduct}
        productName={deletingProduct?.name || ''}
        isDeleting={isDeleting}
        onClose={() => setDeletingProduct(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
