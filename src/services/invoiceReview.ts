/**
 * @file invoiceReview.ts
 * @description Rules used by the invoice review table: when a line amount may be recalculated
 * and how a line's MRP origin (or the reason it is missing) is described.
 */

import type { InvoiceLineItem } from './invoiceTypes';

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
