/**
 * @file product.ts
 * @description Product and inventory item data models for ShopPulse.
 * Belongs in `src/types/product.ts`.
 */

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Critical';

/**
 * Main Product data model representing items in shop inventory.
 */
export interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  price: number;
  status: StockStatus;
  purchasePrice?: number;
  sku?: string;
  supplierId?: string;
  barcode?: string;
  lastRestocked?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * DTO for creating or updating a product.
 */
export type ProductInput = Omit<Product, 'id' | 'status'>;

/**
 * Filter parameters for querying inventory products.
 */
export interface ProductQueryFilters {
  category?: string;
  status?: StockStatus;
  search?: string;
  supplierId?: string;
}
