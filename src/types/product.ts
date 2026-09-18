/**
 * @file product.ts
 * @description Product and inventory item data models for ShopPulse.
 * Belongs in `src/types/product.ts`.
 */

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Critical';

export type ProductCategory = 
  | 'Dairy'
  | 'Groceries'
  | 'Snacks'
  | 'Beverages'
  | 'Household'
  | 'Personal Care'
  | 'Bakery'
  | 'Staples'
  | 'Other';

/**
 * Main Product data model representing items in shop inventory.
 * Uses Firestore timestamp ISO strings or server timestamps.
 */
export interface Product {
  id: string;
  name: string;
  category: ProductCategory | string;
  stock: number;
  unit: string;
  sellingPrice: number;
  price: number; // Backward compatibility alias for sellingPrice
  purchasePrice: number;
  reorderLevel: number;
  minStock: number; // Backward compatibility alias for reorderLevel
  imageUrl?: string;
  barcode?: string; // Optional future barcode support
  status: StockStatus;
  sku?: string;
  supplierId?: string;
  lastRestocked?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating or updating a product.
 */
export interface ProductInput {
  name: string;
  category: ProductCategory | string;
  stock: number;
  unit: string;
  sellingPrice: number;
  price?: number; // Optional alias
  purchasePrice?: number;
  reorderLevel: number;
  minStock?: number; // Optional alias
  imageUrl?: string;
  barcode?: string;
  sku?: string;
  supplierId?: string;
  lastRestocked?: string;
}

/**
 * Filter parameters for querying inventory products.
 */
export interface ProductQueryFilters {
  category?: string;
  status?: StockStatus;
  search?: string;
  supplierId?: string;
}
