/**
 * Voice-to-Bill line helpers: how a recognised line becomes a cart line, and manual price correction.
 * A spoken (or corrected) price that differs from the catalogue is carried with the line as a requested
 * price pending Manager / Owner approval; the server applies it only after that approval (audited).
 */
import type { MatchedVoiceItem } from '../api/voice';
import type { CartItem, Product } from '../types';
import { lineTotal } from './cartPricing';

/**
 * Stage 4C.1 Decision 1: a spoken (or corrected) price is a customer request. When it differs from the
 * catalogue line it needs Manager / Owner approval at checkout; when it matches, the line is a normal
 * catalogue line. It is never applied silently and never replaced silently by the catalogue price.
 */
export function needsPriceApproval(item: MatchedVoiceItem): boolean {
  if (typeof item.needs_price_approval === 'boolean') return item.needs_price_approval;
  if (item.price_source === 'catalogue') return false;
  if (typeof item.catalog_line_total === 'number') return Math.abs(item.total_price - item.catalog_line_total) > 0.01;
  return item.price_source === 'spoken' || item.price_source === 'edited';
}

/** Exact unit price of a line: quantity x this, rounded to paise, gives the line total. */
export function exactUnitPrice(item: MatchedVoiceItem): number {
  if (typeof item.unit_price_exact === 'number') return item.unit_price_exact;
  return item.quantity > 0 ? item.total_price / item.quantity : item.unit_price;
}

export function voiceLineToCartItem(item: MatchedVoiceItem, product: Product): CartItem {
  const line: CartItem = { product, quantity: item.quantity };
  if (needsPriceApproval(item)) {
    // The requested price travels with the line, clearly marked as pending approval
    line.unitPrice = exactUnitPrice(item);
    line.priceSource = item.price_source === 'edited' ? 'edited' : 'spoken';
    line.needsApproval = true;
    if (typeof item.catalog_line_total === 'number') line.catalogueLineTotal = item.catalog_line_total;
  }
  if (item.spoken_quantity) line.spokenQuantity = item.spoken_quantity;
  return line;
}

/** A line whose total the user corrected: the unit price follows the new total; the quantity is unchanged. */
export function withEditedLineTotal(item: MatchedVoiceItem, total: number): MatchedVoiceItem {
  const paise = lineTotal(1, total); // to the paisa, half-up
  const exact = item.quantity > 0 ? paise / item.quantity : paise;
  const differs = typeof item.catalog_line_total === 'number' ? Math.abs(paise - item.catalog_line_total) > 0.01 : true;
  return {
    ...item,
    total_price: paise,
    unit_price_exact: exact,
    unit_price: Math.round(exact * 1000) / 1000,
    price_source: 'edited',
    needs_price_approval: differs,
  };
}
