/**
 * @file useInventory.ts
 * @description Custom React hook for state management of shop inventory & products.
 * Belongs in `src/hooks/useInventory.ts`.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Product, ProductInput, ProductQueryFilters } from '../types/product';
import * as inventoryService from '../services/inventoryService';

export interface UseInventoryResult {
  products: Product[];
  lowStockProducts: Product[];
  loading: boolean;
  error: string | null;
  refreshProducts: () => Promise<void>;
  addNewProduct: (input: ProductInput) => Promise<Product>;
  editProduct: (id: string, updates: Partial<ProductInput>) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
  changeStock: (id: string, newStock: number) => Promise<void>;
}

/**
 * Hook for managing inventory products and low stock alerts.
 */
export function useInventory(initialFilters?: ProductQueryFilters): UseInventoryResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getProducts(initialFilters);
      setProducts(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch inventory');
    } finally {
      setLoading(false);
    }
  }, [initialFilters]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const addNewProduct = async (input: ProductInput): Promise<Product> => {
    const created = await inventoryService.addProduct(input);
    setProducts(prev => [...prev, created]);
    return created;
  };

  const editProduct = async (id: string, updates: Partial<ProductInput>): Promise<void> => {
    await inventoryService.updateProduct(id, updates);
    await fetchInventory();
  };

  const removeProduct = async (id: string): Promise<void> => {
    await inventoryService.deleteProduct(id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const changeStock = async (id: string, newStock: number): Promise<void> => {
    await inventoryService.updateStock(id, newStock);
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const min = p.minStock;
        const status = newStock <= 0 ? 'Out of Stock' : newStock <= min ? 'Low Stock' : 'In Stock';
        return { ...p, stock: newStock, status };
      }
      return p;
    }));
  };

  const lowStockProducts = products.filter(p => p.stock <= p.minStock);

  return {
    products,
    lowStockProducts,
    loading,
    error,
    refreshProducts: fetchInventory,
    addNewProduct,
    editProduct,
    removeProduct,
    changeStock
  };
}
