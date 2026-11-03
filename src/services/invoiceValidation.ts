/**
 * @file invoiceValidation.ts
 * @description Validation rules and standard unit definitions for scanned invoices.
 * Separated from the InvoiceScanner UI component to preserve React Fast Refresh (HMR).
 */

import type { InvoiceLineItem } from './invoiceScannerService';
import type { Product } from '../types';

export const COMMON_UNITS = [
  'pcs',
  'kg',
  'g',
  'gm',
  'l',
  'ltr',
  'ml',
  'bag',
  'box',
  'pkt',
  'can',
  'tin',
  'ctn',
  'set',
  'pair',
  'dozen',
];

export interface ValidationError {
  itemId: string;
  itemName: string;
  issues: string[];
}

export interface StockSuccessStats {
  processedCount: number;
  restockedCount: number;
  newCount: number;
  unitsAdded: number;
  purchaseValue: number;
  invoiceNumber?: string;
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && isNaN(v));

/**
 * Checks every line before stock is changed. Prices that could not be read are never
 * assumed: the purchase price must be entered, and a new product needs a selling price.
 */
export const validateInvoiceItems = (items: InvoiceLineItem[], products: Product[] = []): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (const item of items) {
    const issues: string[] = [];
    const trimmedName = (item.name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      issues.push('Product name is required (min 2 characters)');
    }
    const qty = Number(item.quantity);
    if (isBlank(item.quantity) || isNaN(qty) || qty <= 0) {
      issues.push('Quantity must be greater than 0');
    } else if (!Number.isInteger(qty)) {
      issues.push('Quantity must be a whole number of stock units');
    }
    if (!item.unit || item.unit.trim() === '') {
      issues.push('Unit is required');
    }
    if (isBlank(item.purchasePrice) && isBlank(item.rate)) {
      issues.push('Purchase price is required (it could not be read from the invoice)');
    } else if (!isBlank(item.purchasePrice)) {
      const pur = Number(item.purchasePrice);
      if (isNaN(pur) || pur < 0) {
        issues.push('Purchase price cannot be negative');
      }
    }
    const existsInStore =
      Boolean(item.matchedProductId) ||
      products.some((p) => p.name.toLowerCase().trim() === trimmedName.toLowerCase());
    if (!existsInStore && isBlank(item.sellingPrice)) {
      issues.push('Selling price is required for a new product');
    }
    if (item.sellingPrice !== null && item.sellingPrice !== undefined) {
      const sell = Number(item.sellingPrice);
      if (isNaN(sell) || sell < 0) {
        issues.push('Selling price cannot be negative');
      }
    }
    if (item.mrp !== null && item.mrp !== undefined) {
      const mrpVal = Number(item.mrp);
      if (isNaN(mrpVal) || mrpVal < 0) {
        issues.push('MRP cannot be negative');
      }
    }
    if (item.discount !== null && item.discount !== undefined) {
      const disc = Number(item.discount);
      if (isNaN(disc) || disc < 0) {
        issues.push('Discount cannot be negative');
      }
    }
    if (item.gstRate !== null && item.gstRate !== undefined) {
      const gst = Number(item.gstRate);
      if (isNaN(gst) || gst < 0) {
        issues.push('GST % cannot be negative');
      }
    }
    if (issues.length > 0) {
      errors.push({
        itemId: item.id,
        itemName: trimmedName || 'Unnamed Item',
        issues,
      });
    }
  }
  return errors;
};
