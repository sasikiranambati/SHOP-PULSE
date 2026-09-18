/**
 * @file salesService.ts
 * @description Sales transaction and inventory deduction service using shared Firestore helpers.
 * Belongs in `src/services/salesService.ts`.
 */

import { orderBy, limit } from 'firebase/firestore';
import { 
  addDocument, 
  getCollection, 
  getDocument 
} from './firestoreHelpers';
import type { Sale, CreateSaleInput, SaleLineItem, DailySalesSummary } from '../types/sale';
import { updateStock, getProductById } from './inventoryService';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const SALES_COLLECTION = 'sales';

/**
 * Record a new sale transaction and automatically deduct product stock.
 */
export async function createSale(input: CreateSaleInput, createdBy?: string): Promise<Sale> {
  try {
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

    // Add sale document using firestoreHelpers
    const createdSale = await addDocument<Omit<Sale, 'id'>>(SALES_COLLECTION, saleData);

    // Deduct inventory for each sold item
    for (const item of input.items) {
      try {
        const product = await getProductById(item.productId);
        if (product) {
          const newStock = Math.max(0, product.stock - item.quantity);
          await updateStock(item.productId, newStock);
        }
      } catch (err) {
        console.warn(`Could not update stock for product ${item.productId}:`, err);
      }
    }

    return createdSale;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Fetch sales history ordered by creation date descending.
 */
export async function getSales(limitCount: number = 20): Promise<Sale[]> {
  try {
    return await getCollection<Omit<Sale, 'id'>>(SALES_COLLECTION, [
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    ]);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Fetch a single sale transaction by ID.
 */
export async function getSaleById(saleId: string): Promise<Sale | null> {
  try {
    return await getDocument<Omit<Sale, 'id'>>(SALES_COLLECTION, saleId);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Calculate total sales revenue and items sold today.
 */
export async function getTodaySalesSummary(): Promise<DailySalesSummary> {
  try {
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
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}
