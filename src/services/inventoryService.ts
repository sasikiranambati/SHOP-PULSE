/**
 * @file inventoryService.ts
 * @description Product inventory and stock management services using shared Firestore helpers.
 * Belongs in `src/services/inventoryService.ts`.
 */

import { orderBy, where } from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { 
  getCollection, 
  getDocument, 
  addDocument, 
  updateDocument, 
  deleteDocument 
} from './firestoreHelpers';
import type { Product, ProductInput, StockStatus, ProductQueryFilters } from '../types/product';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

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
  try {
    const constraints: QueryConstraint[] = [orderBy('name', 'asc')];

    if (filters?.category) {
      constraints.push(where('category', '==', filters.category));
    }

    let products = await getCollection<Omit<Product, 'id'>>(PRODUCTS_COLLECTION, constraints);

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      products = products.filter(p => p.name.toLowerCase().includes(searchLower));
    }

    return products;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Fetch a single product by ID.
 */
export async function getProductById(productId: string): Promise<Product | null> {
  try {
    return await getDocument<Omit<Product, 'id'>>(PRODUCTS_COLLECTION, productId);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Add a new product to Firestore inventory.
 */
export async function addProduct(input: ProductInput): Promise<Product> {
  try {
    const status = calculateStockStatus(input.stock, input.minStock);
    const now = new Date().toISOString();
    
    const productData = {
      ...input,
      status,
      createdAt: now,
      updatedAt: now
    };

    return await addDocument<typeof productData>(PRODUCTS_COLLECTION, productData);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Update product attributes.
 */
export async function updateProduct(productId: string, updates: Partial<ProductInput>): Promise<void> {
  try {
    const existing = await getProductById(productId);
    if (!existing) throw new Error(`Product with ID ${productId} not found.`);

    const newStock = updates.stock !== undefined ? updates.stock : existing.stock;
    const newMinStock = updates.minStock !== undefined ? updates.minStock : existing.minStock;
    const status = calculateStockStatus(newStock, newMinStock);

    await updateDocument(PRODUCTS_COLLECTION, productId, {
      ...updates,
      status,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Delete a product from inventory.
 */
export async function deleteProduct(productId: string): Promise<void> {
  try {
    await deleteDocument(PRODUCTS_COLLECTION, productId);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Direct update of product stock quantity.
 */
export async function updateStock(productId: string, newStock: number): Promise<void> {
  try {
    const existing = await getProductById(productId);
    if (!existing) throw new Error(`Product with ID ${productId} not found.`);

    const status = calculateStockStatus(newStock, existing.minStock);
    await updateDocument(PRODUCTS_COLLECTION, productId, {
      stock: newStock,
      status,
      lastRestocked: newStock > existing.stock ? new Date().toISOString() : existing.lastRestocked,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Query products that require restocking (stock <= minStock).
 */
export async function getLowStockProducts(): Promise<Product[]> {
  const products = await getProducts();
  return products.filter(p => p.stock <= p.minStock);
}
