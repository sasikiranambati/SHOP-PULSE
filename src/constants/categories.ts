/**
 * @file categories.ts
 * @description Standard retail product category definitions for ShopPulse.
 */

export const PRODUCT_CATEGORIES = [
  'All',
  'Dairy',
  'Bakery',
  'Beverages',
  'Snacks',
  'Staples',
  'Packaged Food',
  'Personal Care',
  'Household',
  'Spices & Masalas',
  'Instant Food',
  'Other',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
