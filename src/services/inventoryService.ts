/**
 * @file inventoryService.ts
 * @description Production-grade Product Inventory & Stock Management Service integrated with ShopPulse FastAPI backend.
 * Belongs in `src/services/inventoryService.ts`.
 */

import type { Product, ProductInput, StockStatus, ProductQueryFilters } from '../types/product';
import { productsApi, type ProductBackend } from '../api/products';

export function calculateStockStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= reorderLevel) return 'Low Stock';
  return 'In Stock';
}

export function isLowStock(product: Product): boolean {
  return product.stock <= (product.reorderLevel ?? product.minStock ?? 0);
}

/**
 * Map backend product model to frontend Product interface.
 */
export function mapBackendProductToFrontend(bp: ProductBackend): Product {
  const stock = Number(bp.current_stock ?? 0);
  const sellingPrice = Number(bp.selling_price ?? 0);
  const purchasePrice = Number(bp.purchase_price ?? 0);
  const reorderLevel = Number(bp.reorder_level ?? 0);

  let status: StockStatus = 'In Stock';
  if (stock <= 0) {
    status = 'Out of Stock';
  } else if (bp.stock_status === 'Critical') {
    status = 'Critical';
  } else if (bp.stock_status === 'Low Stock' || stock <= reorderLevel) {
    status = 'Low Stock';
  }

  return {
    id: bp.id,
    name: bp.name,
    category: bp.category || 'Other',
    stock,
    unit: bp.unit || 'pcs',
    sellingPrice,
    price: sellingPrice,
    purchasePrice,
    reorderLevel,
    minStock: reorderLevel,
    status,
    barcode: bp.sku || undefined,
    sku: bp.sku || undefined,
    supplierId: bp.supplier_id || undefined,
    createdAt: bp.created_at || new Date().toISOString(),
    updatedAt: bp.updated_at || new Date().toISOString(),
  };
}

export function normalizeProduct(id: string, data: any): Product {
  const sellingPrice = Number(data.sellingPrice ?? data.price ?? data.selling_price ?? 0);
  const purchasePrice = Number(data.purchasePrice ?? data.purchase_price ?? 0);
  const reorderLevel = Number(data.reorderLevel ?? data.minStock ?? data.reorder_level ?? 10);
  const stock = Number(data.stock ?? data.current_stock ?? 0);
  const status: StockStatus = data.status || calculateStockStatus(stock, reorderLevel);

  return {
    id,
    name: data.name || 'Unnamed Product',
    category: data.category || 'Other',
    stock,
    unit: data.unit || 'pcs',
    sellingPrice,
    price: sellingPrice,
    purchasePrice,
    reorderLevel,
    minStock: reorderLevel,
    status,
    barcode: data.barcode || data.sku,
    sku: data.sku || data.barcode,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

/**
 * Fetch all products from the backend with optional category/search filters.
 */
export async function getProducts(filters?: ProductQueryFilters): Promise<Product[]> {
  try {
    const res = await productsApi.getProducts({
      search: filters?.search,
      category: filters?.category,
      limit: 100,
    });

    let mapped = res.items.map(mapBackendProductToFrontend);

    if (filters?.status) {
      if (filters.status === 'Low Stock') {
        mapped = mapped.filter((p) => p.status === 'Low Stock' || p.status === 'Critical' || isLowStock(p));
      } else if (filters.status === 'Out of Stock') {
        mapped = mapped.filter((p) => p.stock <= 0);
      } else if (filters.status === 'In Stock') {
        mapped = mapped.filter((p) => p.status === 'In Stock' && p.stock > 0);
      }
    }

    return mapped;
  } catch (err) {
    console.warn('Failed to load products from backend API:', err);
    return [];
  }
}

/**
 * Get product by ID.
 */
export async function getProductById(id: string): Promise<Product | null> {
  try {
    const bp = await productsApi.getProduct(id);
    return mapBackendProductToFrontend(bp);
  } catch {
    return null;
  }
}

/**
 * Add a new product to inventory.
 */
export async function addProduct(input: ProductInput): Promise<Product> {
  const sellingPrice = Number(input.sellingPrice ?? input.price ?? 0);
  const purchasePrice = Number(input.purchasePrice ?? 0);
  const reorderLevel = Number(input.reorderLevel ?? input.minStock ?? 0);
  const stock = Number(input.stock ?? 0);

  const bp = await productsApi.createProduct({
    name: input.name.trim(),
    category: input.category || 'Other',
    selling_price: sellingPrice,
    purchase_price: purchasePrice,
    current_stock: stock,
    reorder_level: reorderLevel,
    unit: input.unit || 'pcs',
    sku: input.barcode || input.sku || undefined,
  });

  const product = mapBackendProductToFrontend(bp);
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
  return product;
}

/**
 * Update an existing product.
 */
export async function updateProduct(id: string, updates: Partial<ProductInput>): Promise<void> {
  await productsApi.updateProduct(id, {
    name: updates.name?.trim(),
    category: updates.category,
    selling_price: updates.sellingPrice ?? updates.price,
    purchase_price: updates.purchasePrice,
    current_stock: updates.stock,
    reorder_level: updates.reorderLevel ?? updates.minStock,
    unit: updates.unit,
    sku: updates.barcode || updates.sku,
  });

  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

/**
 * Delete a product.
 */
export async function deleteProduct(id: string): Promise<void> {
  await productsApi.deleteProduct(id);
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

/**
 * Increase stock for a product (restock).
 */
export async function increaseStock(id: string, quantity: number = 10, newPurchasePrice?: number): Promise<void> {
  const current = await getProductById(id);
  if (!current) throw new Error('Product not found');
  const updatePayload: any = {
    current_stock: current.stock + quantity,
  };
  if (newPurchasePrice && newPurchasePrice > 0) {
    updatePayload.purchase_price = newPurchasePrice;
  }
  await productsApi.updateProduct(id, updatePayload);
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

/**
 * Decrease stock for a product.
 */
export async function decreaseStock(id: string, quantity: number = 1): Promise<void> {
  const current = await getProductById(id);
  if (!current) throw new Error('Product not found');
  await productsApi.updateProduct(id, {
    current_stock: Math.max(0, current.stock - quantity),
  });
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

/**
 * Set exact stock count for a product.
 */
export async function setStock(id: string, newStock: number): Promise<void> {
  await productsApi.updateProduct(id, {
    current_stock: Math.max(0, newStock),
  });
  window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
}

/**
 * Search products by name, category, or barcode.
 */
export async function searchProducts(queryText: string): Promise<Product[]> {
  return getProducts({ search: queryText });
}

/**
 * Subscribe to real-time inventory updates.
 */
export function subscribeToProducts(
  callback: (products: Product[]) => void,
  filters?: ProductQueryFilters
): () => void {
  let active = true;

  const refresh = async () => {
    if (!active) return;
    const items = await getProducts(filters);
    if (active) callback(items);
  };

  // Immediate initial load
  refresh();

  // Listen to local mutations
  const handleInventoryChange = () => {
    refresh();
  };

  window.addEventListener('shoppulse_inventory_changed', handleInventoryChange);
  window.addEventListener('shoppulse_auth_changed', handleInventoryChange);

  return () => {
    active = false;
    window.removeEventListener('shoppulse_inventory_changed', handleInventoryChange);
    window.removeEventListener('shoppulse_auth_changed', handleInventoryChange);
  };
}
