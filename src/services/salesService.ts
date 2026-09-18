/**
 * @file salesService.ts
 * @description Sales transaction and inventory deduction service using Cloud Firestore.
 * Belongs in `src/services/salesService.ts`.
 */

import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  query, 
  orderBy, 
  limit,
  addDoc 
} from 'firebase/firestore';

import { db } from './firebase';
import type { Sale, CreateSaleInput, SaleLineItem, DailySalesSummary } from '../types/sale';
import { updateStock } from './inventoryService';

const SALES_COLLECTION = 'sales';

/**
 * Record a new sale transaction and automatically deduct product stock.
 */
export async function createSale(input: CreateSaleInput, createdBy?: string): Promise<Sale> {
  const lineItems: SaleLineItem[] = input.items.map(item => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.quantity * item.unitPrice
  }));

  const totalAmount = lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const now = new Date().toISOString();

  const saleData: Omit<Sale, 'id'> = {
    items: lineItems,
    totalAmount,
    paymentMethod: input.paymentMethod,
    createdAt: now,
    createdBy
  };

  // Add sale record
  const docRef = await addDoc(collection(db, SALES_COLLECTION), saleData);

  // Deduct inventory for each sold item
  for (const item of input.items) {
    try {
      const productRef = doc(db, 'products', item.productId);
      const productSnap = await getDoc(productRef);
      if (productSnap.exists()) {
        const currentStock = productSnap.data().stock || 0;
        const newStock = Math.max(0, currentStock - item.quantity);
        await updateStock(item.productId, newStock);
      }
    } catch (err) {
      console.warn(`Could not update stock for product ${item.productId}:`, err);
    }
  }

  return { id: docRef.id, ...saleData };
}

/**
 * Fetch sales history ordered by creation date descending.
 */
export async function getSales(limitCount: number = 20): Promise<Sale[]> {
  const colRef = collection(db, SALES_COLLECTION);
  const q = query(colRef, orderBy('createdAt', 'desc'), limit(limitCount));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Sale, 'id'>)
  }));
}

/**
 * Fetch a single sale transaction by ID.
 */
export async function getSaleById(saleId: string): Promise<Sale | null> {
  const docRef = doc(db, SALES_COLLECTION, saleId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...(docSnap.data() as Omit<Sale, 'id'>) };
  }
  return null;
}

/**
 * Calculate total sales revenue and items sold today.
 */
export async function getTodaySalesSummary(): Promise<DailySalesSummary> {
  const allSales = await getSales(100);
  const todayStr = new Date().toISOString().split('T')[0];

  const todaySalesList = allSales.filter(s => s.createdAt.startsWith(todayStr));

  const todaySales = todaySalesList.reduce((sum, s) => sum + s.totalAmount, 0);
  const itemsSoldToday = todaySalesList.reduce((sum, s) => {
    return sum + s.items.reduce((itemSum, item) => itemSum + item.quantity, 0);
  }, 0);

  return {
    todaySales,
    itemsSoldToday,
    salesCount: todaySalesList.length,
    date: todayStr
  };
}
