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
  const [prevProducts, setPrevProducts] = useState<Product[]>(products);

  // Synchronize local products with live products stream during render phase (avoids cascading effect renders)
  if (products !== prevProducts) {
    setPrevProducts(products);
    setLocalProducts(products);
  }
  const deleteInFlight = useRef(false);
  const { isPrinting, requestPrint } = usePrintRequest();

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
            ? 'text-xs font-bold text-[#234B3A] bg-[#E5EEE6] hover:bg-[#D5E4D7] px-3 py-2 rounded-lg border border-[#52745D]/25 flex items-center gap-1 cursor-pointer active:scale-95 transition-all min-h-[40px]'
            : 'text-xs font-bold text-[#234B3A] hover:text-[#18382B] bg-[#E5EEE6] hover:bg-[#D5E4D7] px-2.5 py-1.5 rounded-lg border border-[#52745D]/25 transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95'}
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
            ? 'text-xs font-semibold text-[#202923] hover:text-[#18382B] bg-[#F7F5EF] hover:bg-[#EBE7DF] px-3 py-2 rounded-lg border border-[#E3E5DE] flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all min-h-[40px]'
            : 'text-xs font-semibold text-[#202923] hover:text-[#18382B] bg-[#F7F5EF] hover:bg-[#EBE7DF] px-2.5 py-1.5 rounded-lg border border-[#E3E5DE] transition-all inline-flex items-center gap-1 cursor-pointer active:scale-95'}
        >
          <Pencil className="w-3.5 h-3.5 text-[#69736C]" aria-hidden="true" />
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
            ? 'p-2 text-[#B93838] bg-[#FDF2F2] hover:bg-[#FCE8E8] rounded-lg border border-[#B93838]/20 flex items-center justify-center cursor-pointer active:scale-95 transition-all min-h-[40px] min-w-[40px]'
            : 'p-1.5 text-xs font-semibold text-[#B93838] hover:text-[#9e2d2d] bg-[#FDF2F2] hover:bg-[#FCE8E8] rounded-lg border border-[#B93838]/20 transition-all inline-flex items-center cursor-pointer active:scale-95'}
        >
          <Trash2 className="w-3.5 h-3.5 text-[#B93838]" aria-hidden="true" />
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
              {t('inventory.addProduct').replace(/^\+\s*/, '')}
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
        <div className="bg-[#FEF9EB] rounded-xl border border-[#A66A16]/25 p-4 shadow-xs">
          <div className="flex items-center gap-2 text-[#A66A16] font-bold text-xs sm:text-sm uppercase tracking-wide mb-2">
            <AlertTriangle className="w-4 h-4 text-[#A66A16] shrink-0" aria-hidden="true" />
            <span>{t('inventory.productsAttention', { count: lowStockItems.length })}</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {lowStockItems.slice(0, 5).map(item => {
              const isRestocking = restockingIds.has(item.id);
              return (
                <div key={item.id} className="bg-white rounded-lg p-2.5 border border-[#A66A16]/20 shrink-0 flex items-center gap-3 shadow-xs">
                  <div>
                    <p className="font-bold text-[#202923] text-xs">{item.name}</p>
                    <p className="text-[11px] text-[#A66A16] font-semibold">{item.stock} {item.unit} {t('dashboard.left')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => restockItem(item)}
                    disabled={isRestocking}
                    aria-label={`Restock ${RESTOCK_STEP} units of ${item.name}`}
                    className="px-2.5 py-1 bg-[#234B3A] hover:bg-[#18382B] text-white font-bold text-[11px] rounded-md active:scale-95 transition-transform shrink-0 cursor-pointer inline-flex items-center gap-1"
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
      <div className="bg-white rounded-xl border border-[#E3E5DE] p-3.5 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3.5 top-3 text-[#69736C]" aria-hidden="true" />
          <label htmlFor="inventory-search" className="sr-only">Filter stock list</label>
          <input
            id="inventory-search"
            type="search"
            placeholder={t('inventory.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-2 focus:ring-[#234B3A] focus:border-[#234B3A] text-base sm:text-sm font-medium text-[#202923] bg-white"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear filter"
              className="absolute right-2.5 top-2 p-1 rounded-lg text-[#69736C] hover:text-[#202923] hover:bg-[#F7F5EF] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Filter by category">
          {PRODUCT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              aria-pressed={selectedCategory === cat}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[#234B3A] text-white shadow-xs font-bold'
                  : 'bg-[#F7F5EF] text-[#69736C] hover:text-[#202923] hover:bg-[#EBE7DF]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Container */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs overflow-hidden" aria-busy={loading || undefined}>

        {/* Desktop Table View (>= 768px). The table scrolls inside this box so the
            sticky header stays aligned and never slides under the page navbar. */}
        <div className="hidden md:block overflow-auto max-h-[calc(100dvh-14rem)] min-h-[12rem]">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Stock catalog</caption>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F7F5EF] text-xs font-semibold text-[#69736C] uppercase tracking-wider shadow-[inset_0_-1px_0_0_#E3E5DE]">
                <th scope="col" className="py-3.5 px-6 bg-[#F7F5EF]">{t('inventory.tableProduct')}</th>
                <th scope="col" className="py-3.5 px-4 bg-[#F7F5EF]">{t('inventory.tableCategory')}</th>
                <th scope="col" className="py-3.5 px-4 bg-[#F7F5EF]">{t('inventory.tableStock')}</th>
                <th scope="col" className="py-3.5 px-4 bg-[#F7F5EF] text-right">{t('inventory.tablePrice')}</th>
                <th scope="col" className="py-3.5 px-4 bg-[#F7F5EF]">{t('inventory.tableStatus')}</th>
                <th scope="col" className="py-3.5 px-6 bg-[#F7F5EF] text-right">{t('inventory.tableActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E5DE] text-sm font-medium text-[#202923]">
              {showSkeleton && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                  {[48, 20, 16, 14, 18, 28].map((w, j) => (
                    <td key={j} className="py-4 px-4">
                      <div className="h-3.5 rounded bg-[#E3E5DE]/70 animate-pulse" style={{ width: `${w * 2}px` }} />
                    </td>
                  ))}
                </tr>
              ))}
              {filteredProducts.map((prod) => (
                <tr
                  key={prod.id}
                  data-product-row={prod.id}
                  tabIndex={-1}
                  className={`transition-colors ${highlightedId === prod.id ? 'bg-[#FEF9EB] ring-2 ring-inset ring-[#A66A16]/50' : 'hover:bg-[#F7F5EF]/60'}`}
                >
                  <td className="py-4 px-6 font-bold text-[#202923]">
                    <div className="flex items-center gap-2.5">
                      {prod.imageUrl ? (
                        <img
                          src={prod.imageUrl}
                          alt=""
                          className="w-8 h-8 rounded-lg object-cover border border-[#E3E5DE] shrink-0"
                        />
                      ) : (
                        <div aria-hidden="true" className="w-8 h-8 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center font-bold text-xs border border-[#52745D]/25 shrink-0">
                          {prod.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <span>{prod.name}</span>
                        {prod.barcode && (
                          <span className="block text-[10px] text-[#69736C] font-normal">
                            UPC: {prod.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4 font-medium text-[#69736C]">{prod.category}</td>
                  <td className="py-4 px-4 font-bold text-[#202923] whitespace-nowrap">
                    {prod.stock} {prod.unit}
                  </td>
                  <td className="py-4 px-4 font-extrabold text-[#202923] text-right tabular-nums whitespace-nowrap">
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
        <div className="md:hidden divide-y divide-[#E3E5DE]">
          {showSkeleton && Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-card-${i}`} className="p-4 space-y-2" aria-hidden="true">
              <div className="h-4 w-2/3 rounded bg-[#E3E5DE]/70 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-[#E3E5DE]/70 animate-pulse" />
              <div className="h-8 w-full rounded-lg bg-[#F7F5EF] animate-pulse" />
            </div>
          ))}
          {filteredProducts.map((prod) => (
            <div
              key={prod.id}
              data-product-row={prod.id}
              tabIndex={-1}
              className={`p-4 space-y-2.5 ${highlightedId === prod.id ? 'bg-[#FEF9EB] ring-2 ring-inset ring-[#A66A16]/50' : 'bg-white'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {prod.imageUrl ? (
                    <img
                      src={prod.imageUrl}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover border border-[#E3E5DE] shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <h4 className="font-bold text-[#202923] text-base leading-tight break-words">{prod.name}</h4>
                    <p className="text-xs text-[#69736C] font-medium mt-0.5">{prod.category} • ₹{prod.price} per {prod.unit}</p>
                    {prod.barcode && <p className="text-[10px] text-[#69736C] font-normal break-all">UPC: {prod.barcode}</p>}
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={prod.status} size="sm" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#E3E5DE]">
                <span className="text-xs sm:text-sm font-bold text-[#202923] shrink-0">
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
          <div className="p-10 text-center text-[#69736C]">
            <Package className="w-12 h-12 mx-auto text-[#69736C]/40 mb-2" aria-hidden="true" />
            {loadError && localProducts.length === 0 ? (
              <p className="font-bold text-[#202923]">No products to show until the stock list loads.</p>
            ) : hasFilters ? (
              <>
                <p className="font-bold text-[#202923]">{t('inventory.noProductsFound')}</p>
                <p className="text-xs text-[#69736C] font-normal">{t('inventory.adjustSearch')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('All');
                  }}
                  className="mt-3 text-xs font-bold text-[#234B3A] hover:underline cursor-pointer"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="font-bold text-[#202923]">Your stock catalog is empty.</p>
                <p className="text-xs text-[#69736C] font-normal">Add a product or scan a supplier bill to get started.</p>
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
