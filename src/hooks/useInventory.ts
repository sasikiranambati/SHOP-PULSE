/**
 * @file useInventory.ts
 * @description Custom React hook for real-time state management of shop inventory & products.
 * Belongs in `src/hooks/useInventory.ts`.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Product, ProductInput, ProductQueryFilters } from '../types/product';
import * as inventoryService from '../services/inventoryService';
import { uploadProductImage, replaceProductImage } from '../services/storageService';
import { useAuth } from './useAuth';

export interface UseInventoryResult {
  products: Product[];
  lowStockProducts: Product[];
  loading: boolean;
  error: string | null;
  addProduct: (input: ProductInput, imageFile?: File) => Promise<Product>;
  updateProduct: (id: string, updates: Partial<ProductInput>, newImageFile?: File) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  searchProducts: (queryText: string) => Promise<Product[]>;
  refreshInventory: () => Promise<void>;
  increaseStock: (id: string, quantity: number) => Promise<void>;
  decreaseStock: (id: string, quantity: number) => Promise<void>;
  setStock: (id: string, newStock: number) => Promise<void>;
  // Backward compatibility aliases
  addNewProduct: (input: ProductInput, imageFile?: File) => Promise<Product>;
  editProduct: (id: string, updates: Partial<ProductInput>, newImageFile?: File) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
  changeStock: (id: string, newStock: number) => Promise<void>;
  refreshProducts: () => Promise<void>;
}

/**
 * Hook for managing inventory products, real-time sync, and low stock alerts.
 */
export function useInventory(initialFilters?: ProductQueryFilters): UseInventoryResult {
  const { user } = useAuth();
  const currentUid = user?.uid;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const categoryFilter = initialFilters?.category;
  const searchFilter = initialFilters?.search;
  const statusFilter = initialFilters?.status;

  // Real-time listener for products with automatic unsubscribe cleanup and user-isolation reset
  useEffect(() => {
    if (!currentUid) {
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = inventoryService.subscribeToProducts((liveProducts) => {
      setProducts(liveProducts);
      setLoading(false);
    }, { category: categoryFilter, search: searchFilter, status: statusFilter });

    const handleAuthChange = () => {
      setProducts([]);
      setLoading(true);
    };
    window.addEventListener('shoppulse_auth_changed', handleAuthChange);

    return () => {
      unsubscribe();
      window.removeEventListener('shoppulse_auth_changed', handleAuthChange);
    };
  }, [currentUid, categoryFilter, searchFilter, statusFilter]);

  const refreshInventory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getProducts(initialFilters);
      setProducts(data);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh inventory.');
    } finally {
      setLoading(false);
    }
  }, [initialFilters]);

  const addProduct = useCallback(async (input: ProductInput, imageFile?: File): Promise<Product> => {
    setError(null);
    try {
      let imageUrl = input.imageUrl;
      if (imageFile) {
        imageUrl = await uploadProductImage(imageFile);
      }
      return await inventoryService.addProduct({ ...input, imageUrl });
    } catch (err: any) {
      setError(err.message || 'Failed to add product.');
      throw err;
    }
  }, []);

  const updateProduct = useCallback(async (
    id: string, 
    updates: Partial<ProductInput>, 
    newImageFile?: File
  ): Promise<void> => {
    setError(null);
    try {
      let cleanUpdates = { ...updates };
      if (newImageFile) {
        const existing = products.find(p => p.id === id);
        const imageUrl = existing?.imageUrl 
          ? await replaceProductImage(existing.imageUrl, newImageFile) 
          : await uploadProductImage(newImageFile);
        cleanUpdates.imageUrl = imageUrl;
      }
      await inventoryService.updateProduct(id, cleanUpdates);
    } catch (err: any) {
      setError(err.message || 'Failed to update product.');
      throw err;
    }
  }, [products]);

  const deleteProduct = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      await inventoryService.deleteProduct(id);
    } catch (err: any) {
      setError(err.message || 'Failed to delete product.');
      throw err;
    }
  }, []);

  const searchProducts = useCallback(async (queryText: string): Promise<Product[]> => {
    try {
      return await inventoryService.searchProducts(queryText);
    } catch (err: any) {
      setError(err.message || 'Search failed.');
      return [];
    }
  }, []);

  const increaseStock = useCallback(async (id: string, quantity: number): Promise<void> => {
    setError(null);
    try {
      await inventoryService.increaseStock(id, quantity);
    } catch (err: any) {
      setError(err.message || 'Failed to increase stock.');
      throw err;
    }
  }, []);

  const decreaseStock = useCallback(async (id: string, quantity: number): Promise<void> => {
    setError(null);
    try {
      await inventoryService.decreaseStock(id, quantity);
    } catch (err: any) {
      setError(err.message || 'Failed to decrease stock.');
      throw err;
    }
  }, []);

  const setStock = useCallback(async (id: string, newStock: number): Promise<void> => {
    setError(null);
    try {
      await inventoryService.setStock(id, newStock);
    } catch (err: any) {
      setError(err.message || 'Failed to set stock.');
      throw err;
    }
  }, []);

  const lowStockProducts = useMemo(() => {
    return products.filter(inventoryService.isLowStock);
  }, [products]);

  return {
    products,
    lowStockProducts,
    loading,
    error,
    addProduct,
    updateProduct,
    deleteProduct,
    searchProducts,
    refreshInventory,
    increaseStock,
    decreaseStock,
    setStock,
    // Compatibility aliases
    addNewProduct: addProduct,
    editProduct: updateProduct,
    removeProduct: deleteProduct,
    changeStock: setStock,
    refreshProducts: refreshInventory
  };
}
