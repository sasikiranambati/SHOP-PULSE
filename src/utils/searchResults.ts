/**
 * @file searchResults.ts
 * @description Pure helpers for the global search list: flattening grouped results into one
 * keyboard-navigable list and moving the active option.
 */

import type { ProductSearchHit, PurchaseSearchHit, SaleSearchHit, SearchResults } from '../api/search';

export type SearchOption =
  | { kind: 'product'; id: string; hit: ProductSearchHit }
  | { kind: 'sale'; id: string; hit: SaleSearchHit }
  | { kind: 'purchase'; id: string; hit: PurchaseSearchHit };

export interface SearchGroup {
  key: SearchOption['kind'];
  label: string;
  total: number;
  options: SearchOption[];
}

/** Groups in display order; empty groups are left out. */
export function groupSearchResults(results: SearchResults | null): SearchGroup[] {
  if (!results) return [];
  const groups: SearchGroup[] = [
    {
      key: 'product',
      label: 'Products',
      total: results.totals?.products ?? results.products.length,
      options: results.products.map((hit) => ({ kind: 'product' as const, id: hit.id, hit })),
    },
    {
      key: 'sale',
      label: 'Sales bills',
      total: results.totals?.sales ?? results.sales.length,
      options: results.sales.map((hit) => ({ kind: 'sale' as const, id: hit.id, hit })),
    },
    {
      key: 'purchase',
      label: 'Purchase invoices',
      total: results.totals?.purchases ?? results.purchases.length,
      options: results.purchases.map((hit) => ({ kind: 'purchase' as const, id: hit.id, hit })),
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}

export function flattenSearchGroups(groups: SearchGroup[]): SearchOption[] {
  return groups.flatMap((g) => g.options);
}

/** DOM id for an option, used by aria-activedescendant. */
export function searchOptionDomId(option: SearchOption): string {
  return `search-option-${option.kind}-${option.id}`;
}

/**
 * Next active index for a key press. Arrow keys wrap around; Home/End jump to the ends.
 * Returns -1 when there are no options.
 */
export function nextActiveIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowDown':
      return current < 0 || current >= count - 1 ? 0 : current + 1;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return Math.min(Math.max(current, -1), count - 1);
  }
}
