/**
 * @file inventoryService.ts
 * @description Production-grade Product Inventory & Stock Management Service for ShopPulse.
 * Belongs in `src/services/inventoryService.ts`.
 */

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc,
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  runTransaction 
} from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Product, ProductInput, StockStatus, ProductQueryFilters, ProductCategory } from '../types/product';
import { validateProductInput } from '../utils/validators';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';
import { INITIAL_PRODUCTS } from '../data/mockData';
import { checkAndSyncProductAlerts } from './alertService';

const PRODUCTS_COLLECTION = 'products';
const LOCAL_STORAGE_KEY = 'shoppulse_inventory_products';

/**
 * Check if running in development / demo mode.
 */
function isDemoMode(): boolean {
  const key = auth.app.options.apiKey || '';
  return !key || key.includes('DemoKey') || key.includes('YourFirebaseApiKey') || key === 'AIzaSyDemoKeyForShopPulseDevelopmentOnly';
}

/**
 * Helper to normalize and synchronize product fields for backward and forward compatibility.
 */
export function normalizeProduct(id: string, data: any): Product {
  const sellingPrice = Number(data.sellingPrice ?? data.price ?? 0);
  const purchasePrice = Number(data.purchasePrice ?? (sellingPrice > 0 ? Math.round(sellingPrice * 0.7) : 0));
  const reorderLevel = Number(data.reorderLevel ?? data.minStock ?? 10);
  const stock = Number(data.stock ?? 0);
  const status: StockStatus = data.status || calculateStockStatus(stock, reorderLevel);

  return {
    id,
    name: data.name || 'Unnamed Product',
    category: data.category || 'Other',
    stock,
    unit: data.unit || 'units',
    sellingPrice,
    price: sellingPrice,
    purchasePrice,
    reorderLevel,
    minStock: reorderLevel,
    imageUrl: data.imageUrl || undefined,
    barcode: data.barcode || undefined,
    status,
    sku: data.sku || undefined,
    supplierId: data.supplierId || undefined,
    lastRestocked: data.lastRestocked || undefined,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
}

/**
 * Local storage fallback helpers for development mode.
 */
function getLocalProducts(): Product[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: any) => normalizeProduct(p.id, p));
      }
    }
  } catch (err) {
    console.warn('Could not parse local inventory products:', err);
  }

  // Seed default initial products
  const seeded = INITIAL_PRODUCTS.map(p => normalizeProduct(p.id, p));
  saveLocalProducts(seeded);
  return seeded;
}

function saveLocalProducts(products: Product[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(products));
    window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
  } catch (err) {
    console.warn('Could not save local inventory products:', err);
  }
}

/**
 * Calculate dynamic StockStatus based on stock and reorderLevel.
 */
export function calculateStockStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= Math.floor(reorderLevel / 2)) return 'Critical';
  if (stock <= reorderLevel) return 'Low Stock';
  return 'In Stock';
}

/**
 * Check if a product is at or below its reorder level.
 */
export function isLowStock(product: Product): boolean {
  const reorder = product.reorderLevel ?? product.minStock ?? 10;
  return product.stock <= reorder;
}

/**
 * Fetch all products from Firestore, optionally filtered.
 */
export async function getProducts(filters?: ProductQueryFilters): Promise<Product[]> {
  if (isDemoMode()) {
    let list = getLocalProducts();
    if (filters?.category && filters.category !== 'All') {
      list = list.filter(p => p.category.toLowerCase() === filters.category!.toLowerCase());
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    if (filters?.status) {
      list = list.filter(p => p.status === filters.status);
    }
    return list;
  }

  try {
    const colRef = collection(db, PRODUCTS_COLLECTION);
    const constraints: QueryConstraint[] = [orderBy('name', 'asc')];

    if (filters?.category && filters.category !== 'All') {
      constraints.push(where('category', '==', filters.category));
    }

    const q = query(colRef, ...constraints);
    const snapshot = await getDocs(q);
    let products = snapshot.docs.map(docSnap => normalizeProduct(docSnap.id, docSnap.data()));

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        p.category.toLowerCase().includes(searchLower) ||
        (p.barcode && p.barcode.includes(searchLower))
      );
    }

    if (filters?.status) {
      products = products.filter(p => p.status === filters.status);
    }

    return products;
  } catch (err) {
    console.warn('Firestore getProducts failed, falling back to local inventory:', err);
    return getLocalProducts();
  }
}

/**
 * Fetch a single product by ID.
 */
export async function getProduct(productId: string): Promise<Product | null> {
  return getProductById(productId);
}

export async function getProductById(productId: string): Promise<Product | null> {
  if (isDemoMode()) {
    const found = getLocalProducts().find(p => p.id === productId);
    return found || null;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return normalizeProduct(snap.id, snap.data());
    }
    return null;
  } catch (err) {
    console.warn(`Firestore getProductById failed for ${productId}:`, err);
    return getLocalProducts().find(p => p.id === productId) || null;
  }
}

/**
 * Add a new product to Firestore inventory.
 */
export async function addProduct(input: ProductInput): Promise<Product> {
  const validation = validateProductInput(input);
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0];
    throw new Error(firstError || 'Please provide valid product information.');
  }

  const sellingPrice = Number(input.sellingPrice ?? input.price ?? 0);
  const purchasePrice = Number(input.purchasePrice ?? (sellingPrice > 0 ? Math.round(sellingPrice * 0.7) : 0));
  const reorderLevel = Number(input.reorderLevel ?? input.minStock ?? 10);
  const stock = Number(input.stock ?? 0);
  const status = calculateStockStatus(stock, reorderLevel);
  const now = new Date().toISOString();

  const productData = {
    name: input.name.trim(),
    category: input.category || 'Other',
    stock,
    unit: input.unit || 'units',
    sellingPrice,
    price: sellingPrice,
    purchasePrice,
    reorderLevel,
    minStock: reorderLevel,
    imageUrl: input.imageUrl || '',
    barcode: input.barcode || '',
    status,
    sku: input.sku || '',
    supplierId: input.supplierId || '',
    lastRestocked: now,
    createdAt: now,
    updatedAt: now
  };

  if (isDemoMode()) {
    const id = `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newProduct: Product = { id, ...productData };
    const list = getLocalProducts();
    list.unshift(newProduct);
    saveLocalProducts(list);
    return newProduct;
  }

  try {
    const colRef = collection(db, PRODUCTS_COLLECTION);
    const docRef = await addDoc(colRef, productData);
    const created: Product = { id: docRef.id, ...productData };
    const list = getLocalProducts();
    list.unshift(created);
    saveLocalProducts(list);
    checkAndSyncProductAlerts(created).catch(() => {});
    return created;
  } catch (err) {
    console.warn('Firestore addDoc failed, storing locally:', err);
    const id = `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newProduct: Product = { id, ...productData };
    const list = getLocalProducts();
    list.unshift(newProduct);
    saveLocalProducts(list);
    checkAndSyncProductAlerts(newProduct).catch(() => {});
    return newProduct;
  }
}

/**
 * Update product attributes.
 */
export async function updateProduct(productId: string, updates: Partial<ProductInput>): Promise<void> {
  const existing = await getProductById(productId);
  if (!existing) throw new Error(`Product with ID ${productId} not found.`);

  const validation = validateProductInput({ ...existing, ...updates });
  if (!validation.isValid) {
    const firstError = Object.values(validation.errors)[0];
    throw new Error(firstError || 'Invalid product updates.');
  }

  const newStock = updates.stock !== undefined ? Number(updates.stock) : existing.stock;
  const newReorder = updates.reorderLevel !== undefined 
    ? Number(updates.reorderLevel) 
    : updates.minStock !== undefined 
    ? Number(updates.minStock) 
    : existing.reorderLevel;

  const sellingPrice = updates.sellingPrice !== undefined 
    ? Number(updates.sellingPrice) 
    : updates.price !== undefined 
    ? Number(updates.price) 
    : existing.sellingPrice;

  const purchasePrice = updates.purchasePrice !== undefined ? Number(updates.purchasePrice) : existing.purchasePrice;
  const status = calculateStockStatus(newStock, newReorder);
  const now = new Date().toISOString();

  const cleanUpdates = {
    ...updates,
    stock: newStock,
    sellingPrice,
    price: sellingPrice,
    purchasePrice,
    reorderLevel: newReorder,
    minStock: newReorder,
    status,
    updatedAt: now
  };

  const updatedProduct = { ...existing, ...cleanUpdates };
  checkAndSyncProductAlerts(updatedProduct).catch(() => {});

  if (isDemoMode()) {
    const list = getLocalProducts().map(p => p.id === productId ? updatedProduct : p);
    saveLocalProducts(list);
    return;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    await updateDoc(docRef, cleanUpdates);
    const list = getLocalProducts().map(p => p.id === productId ? updatedProduct : p);
    saveLocalProducts(list);
  } catch (err) {
    console.warn('Firestore updateDoc failed, updating local copy:', err);
    const list = getLocalProducts().map(p => p.id === productId ? updatedProduct : p);
    saveLocalProducts(list);
  }
}

/**
 * Delete a product from inventory.
 */
export async function deleteProduct(productId: string): Promise<void> {
  if (isDemoMode()) {
    const list = getLocalProducts().filter(p => p.id !== productId);
    saveLocalProducts(list);
    return;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    await deleteDoc(docRef);
    const list = getLocalProducts().filter(p => p.id !== productId);
    saveLocalProducts(list);
  } catch (err) {
    console.warn('Firestore deleteDoc failed, removing from local copy:', err);
    const list = getLocalProducts().filter(p => p.id !== productId);
    saveLocalProducts(list);
  }
}

/**
 * Direct update of product stock quantity.
 */
export async function updateStock(productId: string, newStock: number): Promise<void> {
  await setStock(productId, newStock);
}

/**
 * Set exact stock quantity for a product.
 */
export async function setStock(productId: string, newStock: number): Promise<void> {
  if (newStock < 0) throw new Error('Stock quantity cannot be negative.');

  if (isDemoMode()) {
    const existing = getLocalProducts().find(p => p.id === productId);
    if (!existing) throw new Error(`Product ${productId} not found.`);
    const reorder = existing.reorderLevel ?? existing.minStock ?? 10;
    const status = calculateStockStatus(newStock, reorder);
    const updated: Product = {
      ...existing,
      stock: newStock,
      status,
      lastRestocked: newStock > existing.stock ? new Date().toISOString() : existing.lastRestocked,
      updatedAt: new Date().toISOString()
    };
    const list = getLocalProducts().map(p => p.id === productId ? updated : p);
    saveLocalProducts(list);
    checkAndSyncProductAlerts(updated).catch(() => {});
    return;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    let updatedProduct: Product | null = null;

    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(docRef);
      if (!sfDoc.exists()) {
        throw new Error(`Product with ID ${productId} does not exist.`);
      }

      const current = sfDoc.data() as Product;
      const reorder = current.reorderLevel ?? current.minStock ?? 10;
      const status = calculateStockStatus(newStock, reorder);

      updatedProduct = {
        ...current,
        id: productId,
        stock: newStock,
        status,
        lastRestocked: newStock > current.stock ? new Date().toISOString() : current.lastRestocked,
        updatedAt: new Date().toISOString()
      };

      transaction.update(docRef, {
        stock: newStock,
        status,
        lastRestocked: updatedProduct.lastRestocked,
        updatedAt: updatedProduct.updatedAt
      });
    });

    if (updatedProduct) {
      checkAndSyncProductAlerts(updatedProduct).catch(() => {});
    }
  } catch (err: any) {
    console.warn('Transaction setStock failed, updating local store:', err);
    const existing = getLocalProducts().find(p => p.id === productId);
    if (existing) {
      const status = calculateStockStatus(newStock, existing.reorderLevel);
      const updated: Product = { ...existing, stock: newStock, status };
      const list = getLocalProducts().map(p => p.id === productId ? updated : p);
      saveLocalProducts(list);
      checkAndSyncProductAlerts(updated).catch(() => {});
    }
  }
}

/**
 * Increase stock quantity using transactions.
 */
export async function increaseStock(productId: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error('Increase quantity must be greater than 0.');

  if (isDemoMode()) {
    const existing = getLocalProducts().find(p => p.id === productId);
    if (!existing) throw new Error(`Product ${productId} not found.`);
    const newStock = existing.stock + quantity;
    const status = calculateStockStatus(newStock, existing.reorderLevel);
    const updated: Product = {
      ...existing,
      stock: newStock,
      status,
      lastRestocked: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const list = getLocalProducts().map(p => p.id === productId ? updated : p);
    saveLocalProducts(list);
    checkAndSyncProductAlerts(updated).catch(() => {});
    return;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    let updatedProduct: Product | null = null;

    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(docRef);
      if (!sfDoc.exists()) {
        throw new Error(`Product ${productId} not found.`);
      }

      const current = sfDoc.data() as Product;
      const newStock = current.stock + quantity;
      const reorder = current.reorderLevel ?? current.minStock ?? 10;
      const status = calculateStockStatus(newStock, reorder);

      updatedProduct = {
        ...current,
        id: productId,
        stock: newStock,
        status,
        lastRestocked: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      transaction.update(docRef, {
        stock: newStock,
        status,
        lastRestocked: updatedProduct.lastRestocked,
        updatedAt: updatedProduct.updatedAt
      });
    });

    if (updatedProduct) {
      checkAndSyncProductAlerts(updatedProduct).catch(() => {});
    }
  } catch (err: any) {
    console.warn('Transaction increaseStock failed, updating local store:', err);
    const existing = getLocalProducts().find(p => p.id === productId);
    if (existing) {
      const newStock = existing.stock + quantity;
      const status = calculateStockStatus(newStock, existing.reorderLevel);
      const updated: Product = { ...existing, stock: newStock, status };
      const list = getLocalProducts().map(p => p.id === productId ? updated : p);
      saveLocalProducts(list);
      checkAndSyncProductAlerts(updated).catch(() => {});
    }
  }
}

/**
 * Decrease stock quantity using transactions with negative stock prevention.
 */
export async function decreaseStock(productId: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error('Decrease quantity must be greater than 0.');

  if (isDemoMode()) {
    const existing = getLocalProducts().find(p => p.id === productId);
    if (!existing) throw new Error(`Product ${productId} not found.`);
    if (existing.stock < quantity) {
      throw new Error(`Cannot decrease stock below zero. Current stock: ${existing.stock}, requested: ${quantity}.`);
    }
    const newStock = existing.stock - quantity;
    const status = calculateStockStatus(newStock, existing.reorderLevel);
    const updated: Product = {
      ...existing,
      stock: newStock,
      status,
      updatedAt: new Date().toISOString()
    };
    const list = getLocalProducts().map(p => p.id === productId ? updated : p);
    saveLocalProducts(list);
    checkAndSyncProductAlerts(updated).catch(() => {});
    return;
  }

  try {
    const docRef = doc(db, PRODUCTS_COLLECTION, productId);
    let updatedProduct: Product | null = null;

    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(docRef);
      if (!sfDoc.exists()) {
        throw new Error(`Product ${productId} not found.`);
      }

      const current = sfDoc.data() as Product;
      if (current.stock < quantity) {
        throw new Error(`Insufficient stock. Current: ${current.stock}, requested: ${quantity}.`);
      }

      const newStock = current.stock - quantity;
      const reorder = current.reorderLevel ?? current.minStock ?? 10;
      const status = calculateStockStatus(newStock, reorder);

      updatedProduct = {
        ...current,
        id: productId,
        stock: newStock,
        status,
        updatedAt: new Date().toISOString()
      };

      transaction.update(docRef, {
        stock: newStock,
        status,
        updatedAt: updatedProduct.updatedAt
      });
    });

    if (updatedProduct) {
      checkAndSyncProductAlerts(updatedProduct).catch(() => {});
    }
  } catch (err: any) {
    throw new Error(err.message || getFirebaseErrorMessage(err));
  }
}

/**
 * Search products by query term across name, category, or barcode.
 */
export async function searchProducts(queryText: string): Promise<Product[]> {
  return getProducts({ search: queryText });
}

/**
 * Filter products by category.
 */
export async function filterProductsByCategory(category: ProductCategory | string): Promise<Product[]> {
  return getProducts({ category });
}

/**
 * Real-time subscription to inventory products using onSnapshot with cleanup.
 */
export function subscribeToProducts(
  callback: (products: Product[]) => void,
  filters?: ProductQueryFilters
): () => void {
  if (isDemoMode()) {
    const emit = () => {
      let list = getLocalProducts();
      if (filters?.category && filters.category !== 'All') {
        list = list.filter(p => p.category.toLowerCase() === filters.category!.toLowerCase());
      }
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
      }
      if (filters?.status) {
        list = list.filter(p => p.status === filters.status);
      }
      callback(list);
    };

    emit();
    const handleEvent = () => emit();
    window.addEventListener('shoppulse_inventory_changed', handleEvent);
    return () => window.removeEventListener('shoppulse_inventory_changed', handleEvent);
  }

  try {
    const colRef = collection(db, PRODUCTS_COLLECTION);
    const constraints: QueryConstraint[] = [orderBy('name', 'asc')];

    if (filters?.category && filters.category !== 'All') {
      constraints.push(where('category', '==', filters.category));
    }

    const q = query(colRef, ...constraints);
    return onSnapshot(
      q,
      (snapshot) => {
        let products = snapshot.docs.map(docSnap => normalizeProduct(docSnap.id, docSnap.data()));
        if (filters?.search) {
          const searchLower = filters.search.toLowerCase();
          products = products.filter(p => 
            p.name.toLowerCase().includes(searchLower) || 
            p.category.toLowerCase().includes(searchLower) ||
            (p.barcode && p.barcode.includes(searchLower))
          );
        }
        if (filters?.status) {
          products = products.filter(p => p.status === filters.status);
        }
        callback(products);
      },
      (error) => {
        console.warn('Firestore onSnapshot subscription failed, using local store:', error);
        callback(getLocalProducts());
      }
    );
  } catch (err) {
    console.warn('Could not initialize Firestore onSnapshot listener:', err);
    callback(getLocalProducts());
    return () => {};
  }
}

/**
 * Query products that require restocking (stock <= reorderLevel).
 */
export async function getLowStockProducts(): Promise<Product[]> {
  const products = await getProducts();
  return products.filter(isLowStock);
}

