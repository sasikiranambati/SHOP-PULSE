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

  if (input.price === undefined || input.price < 0) {
    errors.price = 'Selling price must be a positive number.';
  }

  if (input.stock !== undefined && (input.stock < 0 || !Number.isInteger(input.stock))) {
    errors.stock = 'Stock must be a non-negative integer.';
  }

  if (input.minStock !== undefined && (input.minStock < 0 || !Number.isInteger(input.minStock))) {
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
