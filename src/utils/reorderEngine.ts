/**
 * @file reorderEngine.ts
 * @description Intelligent restocking recommendation engine for Kirana retail inventory.
 * Belongs in `src/utils/reorderEngine.ts`.
 */

import type { Product } from '../types/product';
import type { ReorderSuggestion } from '../types/alert';

/**
 * Calculates suggested restocking orders for products at or below their reorder threshold.
 * 
 * Example:
 * Current Stock: 8, Reorder Level: 10
 * Suggested Restock: 20 units
 * 
 * @param products - List of catalog products to evaluate
 * @returns Sorted list of products needing restock, ordered by urgency
 */
export function calculateReorderSuggestions(products: Product[]): ReorderSuggestion[] {
  const suggestions: ReorderSuggestion[] = [];

  for (const prod of products) {
    const stock = Number(prod.stock ?? 0);
    const reorderLevel = Number(prod.reorderLevel ?? prod.minStock ?? 10);

    // Product needs restocking if stock is at or below reorder level
    if (stock <= reorderLevel) {
      // Calculate suggested restock amount:
      // Bring stock up to 2x-3x reorder level, ensuring a minimum sensible batch order
      const targetStock = Math.max(reorderLevel * 2, 20);
      const deficit = Math.max(0, targetStock - stock);
      const suggestedRestock = Math.max(10, Math.ceil(deficit / 5) * 5); // Round to nearest 5 units

      let urgency: 'critical' | 'high' | 'medium';
      if (stock === 0) {
        urgency = 'critical';
      } else if (stock <= Math.floor(reorderLevel / 2)) {
        urgency = 'high';
      } else {
        urgency = 'medium';
      }

      suggestions.push({
        productId: prod.id,
        productName: prod.name,
        currentStock: stock,
        reorderLevel,
        suggestedRestock,
        unit: prod.unit || 'units',
        urgency,
        category: prod.category,
        price: prod.sellingPrice ?? prod.price
      });
    }
  }

  // Sort by urgency: 'critical' (0 stock) first, then lowest stock/reorderLevel ratio
  return suggestions.sort((a, b) => {
    const urgencyWeight = { critical: 0, high: 1, medium: 2 };
    if (urgencyWeight[a.urgency] !== urgencyWeight[b.urgency]) {
      return urgencyWeight[a.urgency] - urgencyWeight[b.urgency];
    }

    const ratioA = a.reorderLevel > 0 ? a.currentStock / a.reorderLevel : 0;
    const ratioB = b.reorderLevel > 0 ? b.currentStock / b.reorderLevel : 0;
    if (ratioA !== ratioB) {
      return ratioA - ratioB;
    }

    return a.productName.localeCompare(b.productName);
  });
}
