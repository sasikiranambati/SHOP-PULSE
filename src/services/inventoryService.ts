/**
 * @file inventoryService.ts
 * @description Product inventory and stock management services using Cloud Firestore.
 * Belongs in `src/services/inventoryService.ts`.
 */

import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  orderBy 
} from 'firebase/firestore';
import { db } from './firebase';
import type { Product, ProductInput, StockStatus, ProductQueryFilters } from '../types/product';

const PRODUCTS_COLLECTION = 'products';

/**
 * Calculate dynamic StockStatus based on stock and minStock.
 */
function calculateStockStatus(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= Math.floor(minStock / 2)) return 'Critical';
  if (stock <= minStock) return 'Low Stock';
  return 'In Stock';
}

/**
 * Fetch all products from Firestore, optionally filtered.
 */
export async function getProducts(filters?: ProductQueryFilters): Promise<Product[]> {
  const colRef = collection(db, PRODUCTS_COLLECTION);
  let q = query(colRef, orderBy('name', 'asc'));

  if (filters?.category) {
    q = query(q, where('category', '==', filters.category));
  }

  const snapshot = await getDocs(q);
  let products: Product[] = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Product, 'id'>)
  }));

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    products = products.filter(p => p.name.toLowerCase().includes(searchLower));
  }

  return products;
}

/**
 * Fetch a single product by ID.
 */
export async function getProductById(productId: string): Promise<Product | null> {
  const docRef = doc(db, PRODUCTS_COLLECTION, productId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...(docSnap.data() as Omit<Product, 'id'>) };
  }
  return null;
}

/**
 * Add a new product to Firestore inventory.
 */
export async function addProduct(input: ProductInput): Promise<Product> {
  const status = calculateStockStatus(input.stock, input.minStock);
  const now = new Date().toISOString();
  
  const productData = {
    ...input,
    status,
    createdAt: now,
    updatedAt: now
  };

  const docRef = await addDoc(collection(db, PRODUCTS_COLLECTION), productData);
  return { id: docRef.id, ...productData };
}

/**
 * Update product attributes.
 */
export async function updateProduct(productId: string, updates: Partial<ProductInput>): Promise<void> {
  const existing = await getProductById(productId);
  if (!existing) throw new Error(`Product with ID ${productId} not found.`);

  const newStock = updates.stock !== undefined ? updates.stock : existing.stock;
  const newMinStock = updates.minStock !== undefined ? updates.minStock : existing.minStock;
  const status = calculateStockStatus(newStock, newMinStock);

  const docRef = doc(db, PRODUCTS_COLLECTION, productId);
  await updateDoc(docRef, {
    ...updates,
    status,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Delete a product from inventory.
 */
export async function deleteProduct(productId: string): Promise<void> {
  const docRef = doc(db, PRODUCTS_COLLECTION, productId);
  await deleteDoc(docRef);
}

/**
 * Direct update of product stock quantity.
 */
export async function updateStock(productId: string, newStock: number): Promise<void> {
  const existing = await getProductById(productId);
  if (!existing) throw new Error(`Product with ID ${productId} not found.`);

  const status = calculateStockStatus(newStock, existing.minStock);
  const docRef = doc(db, PRODUCTS_COLLECTION, productId);
  await updateDoc(docRef, {
    stock: newStock,
    status,
    lastRestocked: newStock > existing.stock ? new Date().toISOString() : existing.lastRestocked,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Query products that require restocking (stock <= minStock).
 */
export async function getLowStockProducts(): Promise<Product[]> {
  const products = await getProducts();
  return products.filter(p => p.stock <= p.minStock);
}
