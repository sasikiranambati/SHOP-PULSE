/**
 * @file invoiceReview.ts
 * @description Rules used by the invoice review table: when a line amount may be recalculated
 * and how a line's MRP origin (or the reason it is missing) is described.
 */

import type { InvoiceLineItem } from './invoiceTypes';
import type { Product } from '../types/product';

/**
 * Recomputes a line amount after quantity/price edits, unless the amount was printed on the
 * invoice or typed by the user: those are kept and the mismatch stays visible for review.
 */
export function recalculateLineTotal(item: InvoiceLineItem): void {
  if (item.lineTotalSource === 'INVOICE' || item.lineTotalSource === 'MANUAL') return;
  const price = item.purchasePrice ?? item.rate;
  if (price !== null && price !== undefined && item.quantity !== null && item.quantity !== undefined) {
    item.lineTotal = Math.round(Number(item.quantity) * Number(price) * 100) / 100;
    item.lineTotalSource = 'CALCULATED';
  }
}

/** Short text describing where the line's MRP came from, or why there is none. */
export function describeMrp(item: InvoiceLineItem): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  switch (item.mrpSource) {
    case 'INVOICE':
      return { label: 'From invoice', tone: 'ok' };
    case 'API':
      return { label: `From ${item.mrpLookup?.provider || 'provider'}`, tone: 'ok' };
    case 'MANUAL':
      return { label: 'Entered manually', tone: 'muted' };
    case 'STORE':
      return { label: 'From store record', tone: 'muted' };
  }
  const lookup = item.mrpLookup;
  if (!lookup) return { label: 'Not on invoice', tone: 'muted' };
  const reasons: Record<string, string> = {
    PRODUCT_NOT_FOUND: 'Product not found at MRP provider',
    MRP_UNAVAILABLE: 'Provider has no MRP for this product',
    MANUAL_REVIEW_REQUIRED: 'Several possible matches — enter MRP',
    API_AUTHENTICATION_ERROR: 'MRP provider rejected credentials',
    API_RATE_LIMITED: 'MRP provider rate limit reached',
    API_TIMEOUT: 'MRP provider timed out',
    API_CONFIGURATION_ERROR: 'MRP lookup not configured',
    API_ERROR: 'MRP provider error',
    SKIPPED: 'MRP lookup skipped',
  };
  return { label: reasons[lookup.status] || 'MRP not available', tone: 'warn' };
}

export type ExtractionIssueKey =
  | 'missing_quantity'
  | 'missing_purchase_price'
  | 'low_confidence'
  | 'arithmetic_mismatch'
  | 'mrp_lookup_failed'
  | 'mrp_lookup_unconfigured'
  | 'mrp_not_found';

export interface ExtractionIssueGroup {
  key: ExtractionIssueKey;
  label: string;
  detail: string;
  /** 'error' blocks adding to stock until fixed; 'warning' needs checking; 'info' is optional. */
  severity: 'error' | 'warning' | 'info';
  itemIds: string[];
  itemNames: string[];
}

const MRP_LOOKUP_ERRORS = new Set(['API_AUTHENTICATION_ERROR', 'API_RATE_LIMITED', 'API_TIMEOUT', 'API_ERROR']);
const MRP_NOT_FOUND = new Set(['PRODUCT_NOT_FOUND', 'MRP_UNAVAILABLE', 'MANUAL_REVIEW_REQUIRED']);

const isMissing = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));

/**
 * Groups the problems found in extracted lines by kind, so the review screen can tell a value that
 * could not be read apart from a value read with low confidence, a quantity × rate that does not
 * match the printed amount, and an MRP lookup that failed. It only reports; it never changes values.
 */
export function summarizeExtractionIssues(items: InvoiceLineItem[]): ExtractionIssueGroup[] {
  const groups: Record<ExtractionIssueKey, ExtractionIssueGroup> = {
    missing_quantity: {
      key: 'missing_quantity',
      label: 'Quantity could not be read',
      detail: 'Enter the quantity for these lines.',
      severity: 'error',
      itemIds: [],
      itemNames: [],
    },
    missing_purchase_price: {
      key: 'missing_purchase_price',
      label: 'Purchase price could not be extracted',
      detail: 'Type the purchase price from the bill. It is never guessed.',
      severity: 'error',
      itemIds: [],
      itemNames: [],
    },
    low_confidence: {
      key: 'low_confidence',
      label: 'Low-confidence values',
      detail: 'The text was hard to read. Compare these lines with the paper bill.',
      severity: 'warning',
      itemIds: [],
      itemNames: [],
    },
    arithmetic_mismatch: {
      key: 'arithmetic_mismatch',
      label: 'Quantity × rate does not match the printed amount',
      detail: 'The printed amount is kept as-is. Check the quantity, rate, discount or tax.',
      severity: 'warning',
      itemIds: [],
      itemNames: [],
    },
    mrp_lookup_failed: {
      key: 'mrp_lookup_failed',
      label: 'MRP lookup failed',
      detail: 'The MRP service could not be reached or rejected the request. Enter MRP manually if needed.',
      severity: 'info',
      itemIds: [],
      itemNames: [],
    },
    mrp_lookup_unconfigured: {
      key: 'mrp_lookup_unconfigured',
      label: 'MRP lookup not configured',
      detail: 'No MRP provider is set up on the server, so MRP comes only from the bill. Enter it manually if needed.',
      severity: 'info',
      itemIds: [],
      itemNames: [],
    },
    mrp_not_found: {
      key: 'mrp_not_found',
      label: 'MRP not found',
      detail: 'MRP is not printed on the bill and the lookup found none. It is left empty.',
      severity: 'info',
      itemIds: [],
      itemNames: [],
    },
  };

  const add = (key: ExtractionIssueKey, item: InvoiceLineItem) => {
    groups[key].itemIds.push(item.id);
    groups[key].itemNames.push((item.name || '').trim() || 'Unnamed line');
  };

  for (const item of items) {
    if (isMissing(item.quantity)) add('missing_quantity', item);
    if (isMissing(item.purchasePrice) && isMissing(item.rate)) add('missing_purchase_price', item);
    if (item.lowConfidence || (typeof item.confidence === 'number' && item.confidence < 70)) add('low_confidence', item);
    if (item.arithmeticStatus === 'MISMATCH' || item.validationStatus === 'MISMATCH') add('arithmetic_mismatch', item);
    if (isMissing(item.mrp) && item.mrpLookup) {
      if (MRP_LOOKUP_ERRORS.has(item.mrpLookup.status)) add('mrp_lookup_failed', item);
      else if (item.mrpLookup.status === 'API_CONFIGURATION_ERROR') add('mrp_lookup_unconfigured', item);
      else if (MRP_NOT_FOUND.has(item.mrpLookup.status)) add('mrp_not_found', item);
    }
  }

  return Object.values(groups).filter((g) => g.itemIds.length > 0);
}

/**
 * A stored price that is usable as evidence. Products created without a purchase price are
 * stored with 0 (meaning "not recorded"), so 0 is treated as unknown rather than as ₹0.
 */
export function knownStorePrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Links an invoice line to a store product (or unlinks it when `product` is null). */
export function applyStoreMatch(item: InvoiceLineItem, product: Product | null): InvoiceLineItem {
  if (!product) {
    return { ...item, matchedProductId: undefined, isMatchConfirmed: false, inventoryData: undefined };
  }
  return {
    ...item,
    matchedProductId: product.id,
    isMatchConfirmed: true,
    unit: item.unit || product.unit || '',
    inventoryData: {
      id: product.id,
      name: product.name,
      currentStock: product.stock,
      storePurchasePrice: knownStorePrice(product.purchasePrice),
      storeSellingPrice: knownStorePrice(product.sellingPrice ?? product.price),
      storeMrp: product.mrp,
    },
  };
}

/**
 * Copies the linked product's stored prices into the line when the user asks for it.
 * Prices the store never recorded are skipped, so an unknown price is not turned into ₹0.
 * A copied MRP is marked STORE so its origin stays visible.
 */
export function copyStorePrices(item: InvoiceLineItem): InvoiceLineItem {
  const inv = item.inventoryData;
  if (!inv) return item;
  const updated: InvoiceLineItem = { ...item };
  const purchase = knownStorePrice(inv.storePurchasePrice);
  if (purchase !== null) {
    updated.purchasePrice = purchase;
    updated.rate = purchase;
    recalculateLineTotal(updated);
  }
  const selling = knownStorePrice(inv.storeSellingPrice);
  if (selling !== null) updated.sellingPrice = selling;
  const mrp = knownStorePrice(inv.storeMrp);
  if (mrp !== null) {
    updated.mrp = mrp;
    updated.mrpSource = 'STORE';
  }
  return updated;
}

/** Stores a typed pack size as-is; the separate unit is cleared so it is not appended twice. */
export function setPackSizeText(item: InvoiceLineItem, text: string): InvoiceLineItem {
  const trimmed = text.trim();
  return { ...item, packSize: (trimmed === '' ? null : text) as unknown as number | null, packSizeUnit: null };
}

/** How a line's pack size is shown in the review inputs. */
export function formatPackSize(item: Pick<InvoiceLineItem, 'packSize' | 'packSizeUnit'>): string {
  if (item.packSize === null || item.packSize === undefined || String(item.packSize) === '') return '';
  return `${item.packSize}${item.packSizeUnit ? ' ' + item.packSizeUnit : ''}`;
}

/**
 * Wording for the "scan finished" notification. It only says the invoice was processed
 * successfully when no line needs fixing or checking; otherwise it says how many lines do.
 */
export function describeScanCompletion(items: InvoiceLineItem[]): {
  tone: 'success' | 'info';
  title: string;
  description: string;
} {
  const lines = `${items.length} line${items.length === 1 ? '' : 's'}`;
  const needsAttention = new Set(
    summarizeExtractionIssues(items)
      .filter((g) => g.severity !== 'info')
      .flatMap((g) => g.itemIds)
  );
  if (needsAttention.size === 0) {
    return {
      tone: 'success',
      title: 'Invoice processed successfully',
      description: `${lines} extracted. Review them before adding to stock.`,
    };
  }
  const n = needsAttention.size;
  return {
    tone: 'info',
    title: 'Invoice read: some values need checking',
    description: `${lines} extracted; ${n} ${n === 1 ? 'needs' : 'need'} fixing or checking before it can be added to stock.`,
  };
}
