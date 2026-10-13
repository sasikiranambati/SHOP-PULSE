import React, { useState, useEffect, useRef } from 'react';
import {
  Package,
  Search,
  Plus,
  AlertTriangle,
  RefreshCw,
  Pencil,
  Trash2,
  Loader2,
  X,
  Printer
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { AddProductModal } from '../components/AddProductModal';
import { EditProductModal } from '../components/EditProductModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { PrintPortal } from '../components/PrintPortal';
import { InventoryReportDocument } from '../components/PrintDocuments';
import { usePrintRequest } from '../hooks/usePrint';
import type { Product } from '../types';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import { useToast } from '../hooks/useToast';
import { describeError } from '../utils/errorHandler';
import {
  increaseStock,
  updateProduct as serviceUpdateProduct,
  deleteProduct as serviceDeleteProduct
} from '../services/inventoryService';

const RESTOCK_STEP = 10;

interface InventoryProps {
  products: Product[];
  /** True while the product list is being fetched. */
  loading?: boolean;
  /** Set when the product list could not be loaded. */
  loadError?: string | null;
  onRetryLoad?: () => void | Promise<void>;
  onAddProduct: (product: Omit<Product, 'id'>) => void | Promise<void>;
  onRestock?: (id: string, quantity: number) => void | Promise<void>;
  onUpdateProduct?: (id: string, updates: Partial<Product>) => void | Promise<void>;
  onDeleteProduct?: (id: string) => void | Promise<void>;
  /**
   * Request from global search. The page is mounted with a new `key` for each request, so the
   * filter starts with `query`; a chosen product is highlighted and scrolled into view.
   */
  searchRequest?: { query: string; highlightId?: string } | null;
  /** Used as the heading of the printed stock report. */
  shopName?: string;
}

export const Inventory: React.FC<InventoryProps> = ({
  products,
  loading = false,
  loadError = null,
  onRetryLoad,
  onAddProduct,
  onRestock,
  onUpdateProduct,
  onDeleteProduct,
  searchRequest = null,
  shopName = 'ShopPulse',
}) => {
  const { t } = useLanguage();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState(() => searchRequest?.query ?? '');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restockingIds, setRestockingIds] = useState<Set<string>>(() => new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(() => searchRequest?.highlightId ?? null);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);
  const deleteInFlight = useRef(false);
  const { isPrinting, requestPrint } = usePrintRequest();

  // Synchronize local products with live products stream
  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  // A product opened from global search is highlighted and scrolled into view once.
  const highlightRequestId = searchRequest?.highlightId;
  useEffect(() => {
    if (!highlightRequestId) return;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const row = Array.from(document.querySelectorAll<HTMLElement>(`[data-product-row="${highlightRequestId}"]`))
        .find((el) => el.offsetParent !== null);
      row?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      row?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setHighlightedId(null), 5000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightRequestId]);

  const handleAddProduct = async (newProd: Omit<Product, 'id'>) => {
    // No placeholder row is inserted: the list updates from the server once the save succeeds.
    await onAddProduct(newProd);
    toast.success(`Product saved successfully`, { description: `${newProd.name} was added to your stock catalog.` });
  };

  const query = searchTerm.toLowerCase();
  const filteredProducts = localProducts.filter((prod) => {
    const matchesSearch = prod.name.toLowerCase().includes(query) ||
                          prod.category.toLowerCase().includes(query) ||
                          (prod.barcode && prod.barcode.toLowerCase().includes(query));
    const matchesCategory = selectedCategory === 'All' || prod.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const lowStockItems = localProducts.filter(p => p.status === 'Low Stock' || p.status === 'Out of Stock' || (p.stock <= (p.reorderLevel ?? p.minStock ?? 0)));

  const restockItem = async (product: Product) => {
    const id = product.id;
    // One restock at a time per product: a second click before the first finishes could
    // read the same starting stock and lose one of the updates.
    if (restockingIds.has(id)) return;
    setRestockingIds((prev) => new Set(prev).add(id));
    const previous = localProducts.find((p) => p.id === id);

    // Optimistic update
    setLocalProducts(prev => prev.map(p =>
      p.id === id ? { ...p, stock: p.stock + RESTOCK_STEP, status: 'In Stock' } : p
    ));

    try {
      if (onRestock) {
        await onRestock(id, RESTOCK_STEP);
      } else {
        await increaseStock(id, RESTOCK_STEP);
      }
      toast.success('Inventory updated successfully', {
        description: `Added ${RESTOCK_STEP} ${product.unit} to ${product.name}.`,
      });
    } catch (err) {
      console.error('Failed to restock item:', err);
      if (previous) {
        setLocalProducts(prev => prev.map(p => (p.id === id ? previous : p)));
      }
      toast.error(`Stock for ${product.name} was not updated`, {
        description: describeError(err, 'Please check your connection and try again.'),
        action: { label: 'Retry', onClick: () => void restockItem(product) },
      });
    } finally {
      setRestockingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
      toast.success('Product saved successfully', { description: `${updates.name || 'Product'} was updated.` });
    } catch (err) {
      console.error('Failed to update product:', err);
      setLocalProducts(products); // Revert on failure
      throw err;
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct || deleteInFlight.current) return;
    deleteInFlight.current = true;
    const product = deletingProduct;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      if (onDeleteProduct) {
        await onDeleteProduct(product.id);
      } else {
        await serviceDeleteProduct(product.id);
      }
      setLocalProducts(prev => prev.filter(p => p.id !== product.id));
      setDeletingProduct(null);
      toast.success('Product deleted', { description: `${product.name} was removed from your catalog.` });
    } catch (err) {
      console.error('Failed to delete product:', err);
      setDeleteError(describeError(err, 'The product could not be deleted. Please try again.'));
    } finally {
      setIsDeleting(false);
      deleteInFlight.current = false;
    }
  };

  const showSkeleton = loading && localProducts.length === 0 && !loadError;
  const hasFilters = searchTerm.trim() !== '' || selectedCategory !== 'All';

  const actionButtonsFor = (prod: Product, compact: boolean) => {
    const isRestocking = restockingIds.has(prod.id);
    return (
      <>
        <button
          type="button"
          onClick={() => restockItem(prod)}
          disabled={isRestocking}
          aria-label={`Restock ${RESTOCK_STEP} units of ${prod.name}`}
          title={`Restock +${RESTOCK_STEP}`}
          className={compact
            ? 'text-xs font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl border border-emerald-200 flex items-center gap-1 cursor-pointer active:scale-95 transition-all min-h-[38px]'
            : 'text-xs font-black text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg border border-emerald-200 transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95'}
        >
          {isRestocking
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
          {compact ? (
            <span>{isRestocking ? 'Saving…' : `+${RESTOCK_STEP}`}</span>
          ) : (
            <>
              <span className="hidden xl:inline">{isRestocking ? 'Saving…' : t('inventory.restockTen')}</span>
              <span className="xl:hidden">{isRestocking ? '…' : `+${RESTOCK_STEP}`}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setEditingProduct(prod)}
          aria-label={`Edit ${prod.name}`}
          title="Edit Product"
          className={compact
            ? 'text-xs font-black text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-xl border border-slate-200 flex items-center gap-1 cursor-pointer active:scale-95 transition-all min-h-[38px]'
            : 'text-xs font-black text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-200 transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95'}
        >
          <Pencil className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
          <span>Edit</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleteError(null);
            setDeletingProduct(prod);
          }}
          aria-label={`Delete ${prod.name}`}
          title="Delete Product"
          className={compact
            ? 'p-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-200 flex items-center justify-center cursor-pointer active:scale-95 transition-all min-h-[38px] min-w-[38px]'
            : 'p-1.5 text-xs font-black text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-all inline-flex items-center cursor-pointer active:scale-95'}
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
        </button>
      </>
    );
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">

      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={requestPrint}
              disabled={filteredProducts.length === 0}
              icon={<Printer className="w-4 h-4" />}
              aria-label="Print stock report"
              title="Print the products currently shown"
            >
              <span className="hidden sm:inline">Print report</span>
              <span className="sm:hidden">Print</span>
            </Button>
            <Button
              variant="primary"
              onClick={() => setIsModalOpen(true)}
              icon={<Plus className="w-5 h-5" />}
              className="font-black"
            >
              {t('inventory.addProduct')}
            </Button>
          </div>
        }
      />

      {isPrinting && (
        <PrintPortal label="Stock report print view">
          <InventoryReportDocument
            products={filteredProducts}
            shopName={shopName}
            filterLabel={[
              selectedCategory === 'All' ? 'All categories' : selectedCategory,
              searchTerm.trim() ? `matching “${searchTerm.trim()}”` : null,
            ].filter(Boolean).join(', ')}
          />
        </PrintPortal>
      )}

      {loadError && (
        <div role="alert" className="bg-rose-50 rounded-2xl border border-rose-300 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-rose-900">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-black">Stock list could not be loaded.</p>
              <p className="text-xs font-medium mt-0.5">
                {describeError({ message: loadError }, 'The server did not respond.')}
                {localProducts.length > 0 ? ' The list below may be out of date.' : ''}
              </p>
            </div>
          </div>
          {onRetryLoad && (
            <Button
              variant="outline"
              size="sm"
              loading={loading}
              onClick={() => void onRetryLoad()}
              icon={<RefreshCw className="w-4 h-4" />}
              className="shrink-0"
            >
              {loading ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      )}

      {/* Low Stock Warning Top Banner */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50/90 rounded-2xl border border-amber-300/80 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-amber-900 font-black text-xs sm:text-sm uppercase tracking-wide mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
            <span>{t('inventory.productsAttention', { count: lowStockItems.length })}</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {lowStockItems.slice(0, 5).map(item => {
              const isRestocking = restockingIds.has(item.id);
              return (
                <div key={item.id} className="bg-white rounded-xl p-2.5 border border-amber-200 shrink-0 flex items-center gap-3 shadow-2xs">
                  <div>
                    <p className="font-extrabold text-slate-900 text-xs">{item.name}</p>
                    <p className="text-[11px] text-amber-800 font-bold">{item.stock} {item.unit} {t('dashboard.left')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => restockItem(item)}
                    disabled={isRestocking}
                    aria-label={`Restock ${RESTOCK_STEP} units of ${item.name}`}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-lg active:scale-95 transition-transform shrink-0 cursor-pointer inline-flex items-center gap-1"
                  >
                    {isRestocking && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                    {isRestocking ? 'Saving…' : t('dashboard.restock')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls: Search & Category Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" aria-hidden="true" />
          <label htmlFor="inventory-search" className="sr-only">Filter stock list</label>
          <input
            id="inventory-search"
            type="search"
            placeholder={t('inventory.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base sm:text-sm font-medium"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear filter"
              className="absolute right-2.5 top-2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Filter by category">
          {PRODUCT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              aria-pressed={selectedCategory === cat}
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden" aria-busy={loading || undefined}>

        {/* Desktop Table View (>= 768px). The table scrolls inside this box so the
            sticky header stays aligned and never slides under the page navbar. */}
        <div className="hidden md:block overflow-auto max-h-[calc(100dvh-14rem)] min-h-[12rem]">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Stock catalog</caption>
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider shadow-[inset_0_-1px_0_0_rgb(226_232_240)]">
                <th scope="col" className="py-3.5 px-6 bg-slate-50">{t('inventory.tableProduct')}</th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50">{t('inventory.tableCategory')}</th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50">{t('inventory.tableStock')}</th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50 text-right">{t('inventory.tablePrice')}</th>
                <th scope="col" className="py-3.5 px-4 bg-slate-50">{t('inventory.tableStatus')}</th>
                <th scope="col" className="py-3.5 px-6 bg-slate-50 text-right">{t('inventory.tableActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-800">
              {showSkeleton && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                  {[48, 20, 16, 14, 18, 28].map((w, j) => (
                    <td key={j} className="py-4 px-4">
                      <div className="h-3.5 rounded bg-slate-200 animate-pulse" style={{ width: `${w * 2}px` }} />
                    </td>
                  ))}
                </tr>
              ))}
              {filteredProducts.map((prod) => (
                <tr
                  key={prod.id}
                  data-product-row={prod.id}
                  tabIndex={-1}
                  className={`transition-colors ${highlightedId === prod.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : 'hover:bg-slate-50/80'}`}
                >
                  <td className="py-4 px-6 font-bold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      {prod.imageUrl ? (
                        <img
                          src={prod.imageUrl}
                          alt=""
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div aria-hidden="true" className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-xs border border-emerald-200 shrink-0">
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
                  <td className="py-4 px-4 font-bold text-slate-900 whitespace-nowrap">
                    {prod.stock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 font-black text-slate-900 text-right tabular-nums whitespace-nowrap">
                    ₹{prod.price}
                  </td>
                  <td className="py-4 px-4">
                    <StatusBadge status={prod.status} />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {actionButtonsFor(prod, false)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Product Cards View (< 768px) */}
        <div className="md:hidden divide-y divide-slate-100">
          {showSkeleton && Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-card-${i}`} className="p-4 space-y-2" aria-hidden="true">
              <div className="h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-slate-200 animate-pulse" />
              <div className="h-8 w-full rounded-xl bg-slate-100 animate-pulse" />
            </div>
          ))}
          {filteredProducts.map((prod) => (
            <div
              key={prod.id}
              data-product-row={prod.id}
              tabIndex={-1}
              className={`p-4 space-y-2.5 ${highlightedId === prod.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : 'bg-white'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {prod.imageUrl ? (
                    <img
                      src={prod.imageUrl}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <h4 className="font-extrabold text-slate-900 text-base leading-tight break-words">{prod.name}</h4>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">{prod.category} • ₹{prod.price} per {prod.unit}</p>
                    {prod.barcode && <p className="text-[10px] text-slate-400 font-medium break-all">UPC: {prod.barcode}</p>}
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={prod.status} size="sm" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                <span className="text-xs sm:text-sm font-black text-slate-900 shrink-0">
                  {t('inventory.tableStock')}: {prod.stock} {prod.unit}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {actionButtonsFor(prod, true)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {showSkeleton && <p className="sr-only" role="status">Loading stock list…</p>}

        {!showSkeleton && filteredProducts.length === 0 && (
          <div className="p-10 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto text-slate-300 mb-2" aria-hidden="true" />
            {loadError && localProducts.length === 0 ? (
              <p className="font-extrabold text-slate-700">No products to show until the stock list loads.</p>
            ) : hasFilters ? (
              <>
                <p className="font-extrabold text-slate-700">{t('inventory.noProductsFound')}</p>
                <p className="text-xs text-slate-500 font-medium">{t('inventory.adjustSearch')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('All');
                  }}
                  className="mt-3 text-xs font-black text-emerald-700 hover:underline cursor-pointer"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="font-extrabold text-slate-700">Your stock catalog is empty.</p>
                <p className="text-xs text-slate-500 font-medium">Add a product or scan a supplier bill to get started.</p>
              </>
            )}
          </div>
        )}

      </div>

      <AddProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddProduct={handleAddProduct}
      />

      {editingProduct && (
        <EditProductModal
          key={editingProduct.id}
          isOpen
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onUpdateProduct={handleUpdateProduct}
        />
      )}

      <DeleteConfirmModal
        isOpen={!!deletingProduct}
        productName={deletingProduct?.name || ''}
        isDeleting={isDeleting}
        error={deleteError}
        onClose={() => {
          if (isDeleting) return;
          setDeletingProduct(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
