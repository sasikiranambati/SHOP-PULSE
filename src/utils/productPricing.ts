/**
 * Product pricing status and pricing-basis display for the POS (Stage 5).
 *
 * The server is authoritative: these helpers only decide what to show and which actions to offer. They never
 * calculate a price that is charged (cart totals come from POST /sales/quote and the sale response).
 */
import type { PricingStatus, Product } from '../types/product';

const STATUSES: PricingStatus[] = ['VERIFIED', 'NEEDS_REVIEW', 'INCOMPLETE', 'WHOLESALE_ONLY'];

/** Server status text to a known status; unknown or missing -> null (legacy product: the server decides). */
export function normalizePricingStatus(raw: string | null | undefined): PricingStatus | null {
  const v = (raw ?? '').trim().toUpperCase();
  return (STATUSES as string[]).includes(v) ? (v as PricingStatus) : null;
}

/**
 * Whether the POS should offer the product for sale. NEEDS_REVIEW and INCOMPLETE are refused by the server
 * (only a Manager / Owner can fix that); a missing status is left to the server.
 */
export function isSellableStatus(status: PricingStatus | null | undefined): boolean {
  return status !== 'NEEDS_REVIEW' && status !== 'INCOMPLETE';
}

/** i18n key for the status badge (pricing.status.*), or null when no badge is shown (verified / unknown). */
export function statusBadgeKey(status: PricingStatus | null | undefined): string | null {
  return status && status !== 'VERIFIED' ? `pricing.status.${status}` : null;
}

/** i18n key explaining why a product cannot be sold, or what limits apply (null when nothing to explain). */
export function statusReasonKey(status: PricingStatus | null | undefined): string | null {
  switch (status) {
    case 'NEEDS_REVIEW':
      return 'pricing.reason.NEEDS_REVIEW';
    case 'INCOMPLETE':
      return 'pricing.reason.INCOMPLETE';
    case 'WHOLESALE_ONLY':
      return 'pricing.reason.WHOLESALE_ONLY';
    default:
      return null;
  }
}

/** The quantity and unit the selling price is quoted for: "kg", "100 g", "packet". */
export function basisText(product: Pick<Product, 'unit' | 'priceBasisQuantity' | 'priceBasisUnit'>): string {
  const unit = product.priceBasisUnit || product.unit || '';
  const qty = product.priceBasisQuantity;
  return typeof qty === 'number' && qty > 0 && Math.abs(qty - 1) > 1e-9 ? `${trimNumber(qty)} ${unit}` : unit;
}

/** Rupees as printed: two decimals, a third only when present (₹62.988, ₹40.00). */
export function formatRupees(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const three = Math.round(value * 1000) / 1000;
  const digits = Math.abs(three * 100 - Math.round(three * 100)) > 1e-6 ? 3 : 2;
  return `₹${three.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Catalogue rate with its basis: "₹40.00 / packet", "₹30.00 / 100 g". */
export function rateText(product: Pick<Product, 'sellingPrice' | 'price' | 'unit' | 'priceBasisQuantity' | 'priceBasisUnit'>): string {
  const price = product.sellingPrice ?? product.price;
  const basis = basisText(product);
  return basis ? `${formatRupees(price)} / ${basis}` : formatRupees(price);
}

/** True when the line is priced on a basis other than one stock unit (the server converts the quantity). */
export function hasConvertedBasis(product: Pick<Product, 'unit' | 'priceBasisQuantity' | 'priceBasisUnit'>): boolean {
  const qty = product.priceBasisQuantity ?? 1;
  const unit = (product.priceBasisUnit || product.unit || '').toLowerCase();
  return Math.abs(qty - 1) > 1e-9 || unit !== (product.unit || '').toLowerCase();
}

function trimNumber(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
