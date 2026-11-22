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

export type PricingStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'INCOMPLETE' | 'WHOLESALE_ONLY';

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
  mrp?: number;
  /** Where the stored MRP came from (INVOICE, API, MANUAL, STORE) */
  mrpSource?: string;
  /** Pricing lifecycle from the server; only VERIFIED and WHOLESALE_ONLY products can be sold. */
  pricingStatus?: PricingStatus | null;
  /** sellingPrice is quoted per priceBasisQuantity of priceBasisUnit (e.g. ₹30 per 100 g). */
  priceBasisQuantity?: number;
  priceBasisUnit?: string;
  mrpBasisQuantity?: number;
  mrpBasisUnit?: string;
  reorderLevel: number;
  minStock: number; // Backward compatibility alias for reorderLevel
  imageUrl?: string;
  barcode?: string; // Optional future barcode support
  status: StockStatus;
  sku?: string;
  supplierId?: string;
  isActive?: boolean;
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
  mrp?: number;
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
