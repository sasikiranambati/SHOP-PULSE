/**
 * @file validators.ts
 * @description Input validation and sanitization utility methods for ShopPulse.
 * Belongs in `src/utils/validators.ts`.
 */

import type { ProductInput } from '../types/product';

/**
 * Validate email address format.
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validate user password strength (at least 6 characters).
 */
export function validatePassword(password: string): { isValid: boolean; message?: string } {
  if (!password || password.length < 6) {
    return { isValid: false, message: 'Password must be at least 6 characters long.' };
  }
  return { isValid: true };
}

/**
 * Validate product creation or update input payload.
 */
export function validateProductInput(input: Partial<ProductInput>): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input.name || input.name.trim().length === 0) {
    errors.name = 'Product name is required.';
  }

  const sellingPrice = input.sellingPrice !== undefined ? input.sellingPrice : input.price;
  if (sellingPrice === undefined || typeof sellingPrice !== 'number' || isNaN(sellingPrice) || sellingPrice <= 0) {
    errors.sellingPrice = 'Selling price must be a positive number greater than 0.';
    errors.price = 'Selling price must be a positive number greater than 0.';
  }

  if (input.purchasePrice !== undefined && (typeof input.purchasePrice !== 'number' || isNaN(input.purchasePrice) || input.purchasePrice < 0)) {
    errors.purchasePrice = 'Purchase price must be a non-negative number.';
  }

  if (input.stock !== undefined && (typeof input.stock !== 'number' || isNaN(input.stock) || input.stock < 0 || !Number.isInteger(input.stock))) {
    errors.stock = 'Stock must be a non-negative integer.';
  }

  const reorderLevel = input.reorderLevel !== undefined ? input.reorderLevel : input.minStock;
  if (reorderLevel !== undefined && (typeof reorderLevel !== 'number' || isNaN(reorderLevel) || reorderLevel < 0 || !Number.isInteger(reorderLevel))) {
    errors.reorderLevel = 'Reorder level must be a non-negative integer.';
    errors.minStock = 'Reorder level must be a non-negative integer.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate stock adjustment quantity.
 */
export function validateStockQuantity(quantity: number): boolean {
  return typeof quantity === 'number' && !isNaN(quantity) && quantity >= 0 && Number.isInteger(quantity);
}

/** Raw text values from the add/edit product form. */
export interface ProductFormValues {
  name: string;
  category: string;
  sellingPrice: string;
  purchasePrice: string;
  stock: string;
  minStock: string;
  unit: string;
  barcode: string;
}

export type ProductFormField = keyof ProductFormValues;

export interface ParsedProductForm {
  name: string;
  category: string;
  sellingPrice: number;
  /** Undefined when the field was left blank: a missing purchase price is never guessed. */
  purchasePrice?: number;
  stock: number;
  minStock: number;
  unit: string;
  barcode?: string;
}

const DEFAULT_MIN_STOCK = 5;

/**
 * Validates the product form field by field so each problem can be shown next to its input.
 * Returns parsed values only when every field is valid.
 */
export function validateProductForm(values: ProductFormValues): {
  errors: Partial<Record<ProductFormField, string>>;
  parsed: ParsedProductForm | null;
} {
  const errors: Partial<Record<ProductFormField, string>> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Enter a product name.';

  const sellingText = values.sellingPrice.trim();
  const selling = Number(sellingText);
  if (!sellingText) errors.sellingPrice = 'Enter a selling price.';
  else if (!Number.isFinite(selling) || selling <= 0) errors.sellingPrice = 'Selling price must be more than ₹0.';

  const purchaseText = values.purchasePrice.trim();
  const purchase = purchaseText ? Number(purchaseText) : undefined;
  if (purchase !== undefined && (!Number.isFinite(purchase) || purchase < 0)) {
    errors.purchasePrice = 'Purchase price cannot be negative.';
  }

  const stockText = values.stock.trim();
  const stock = Number(stockText);
  if (!stockText) errors.stock = 'Enter the stock quantity (0 if none).';
  else if (!Number.isInteger(stock) || stock < 0) errors.stock = 'Stock must be a whole number of 0 or more.';

  const minText = values.minStock.trim();
  const minStock = minText ? Number(minText) : DEFAULT_MIN_STOCK;
  if (minText && (!Number.isInteger(minStock) || minStock < 0)) {
    errors.minStock = 'Min stock alert must be a whole number of 0 or more.';
  }

  if (Object.keys(errors).length > 0) return { errors, parsed: null };

  return {
    errors,
    parsed: {
      name,
      category: values.category,
      sellingPrice: selling,
      purchasePrice: purchase,
      stock,
      minStock,
      unit: values.unit.trim() || 'units',
      barcode: values.barcode.trim() || undefined,
    },
  };
}

/** True when any field differs from its starting value (used to warn before discarding edits). */
export function isProductFormDirty(current: ProductFormValues, initial: ProductFormValues): boolean {
  return (Object.keys(initial) as ProductFormField[]).some((key) => current[key] !== initial[key]);
}
