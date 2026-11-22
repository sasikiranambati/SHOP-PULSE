/**
 * Cart pricing for the POS and Voice-to-Bill.
 *
 * A cart line is priced by its own agreed unit price when it has one (a price spoken in Voice-to-Bill,
 * or one the user corrected), otherwise by the catalogue selling price. A spoken price is never replaced
 * by the catalogue price.
 *
 * Line totals follow the backend sale rule exactly (services/money.py sale_line_amount): quantity x unit
 * price computed exactly from the decimal text of each number, rounded once to paise with ROUND_HALF_UP;
 * the bill is the sum of the rounded lines. Integer (BigInt) arithmetic avoids JavaScript float errors,
 * so the total shown before checkout is the total the backend saves.
 */
import type { CartItem } from '../types/sale';
import type { Product } from '../types/product';

/** Decimal text of a number as an integer and a scale: 33.3333333333 -> [333333333333n, 10]. */
function toScaledInt(value: number): [bigint, number] {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  // Same text as the backend's Decimal(str(value)); exponent forms are expanded first
  let text = String(value);
  if (/e/i.test(text)) text = value.toFixed(20).replace(/\.?0+$/, '');
  const negative = text.startsWith('-');
  const [intPart, fracPart = ''] = text.replace('-', '').split('.');
  const digits = BigInt(`${intPart}${fracPart}` || '0');
  return [negative ? -digits : digits, fracPart.length];
}

/** Half-up division of a non-negative integer by 10^places. */
function roundHalfUpDiv(value: bigint, places: number): bigint {
  if (places <= 0) return value * 10n ** BigInt(-places);
  const divisor = 10n ** BigInt(places);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rounded = (abs + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/** quantity x unit price in paise, rounded once half-up (the backend's sale line rule). */
export function lineTotalPaise(quantity: number, unitPrice: number): bigint {
  const [q, qs] = toScaledInt(quantity);
  const [p, ps] = toScaledInt(unitPrice);
  return roundHalfUpDiv(q * p, qs + ps - 2);
}

/** quantity x unit price in rupees, exact to the paisa. 3 x 33.3333333333 -> 100. */
export function lineTotal(quantity: number, unitPrice: number): number {
  return Number(lineTotalPaise(quantity, unitPrice)) / 100;
}

export function catalogPrice(product: Product): number {
  return Number(product.sellingPrice ?? product.price ?? 0);
}

/** The price per unit this line is sold at: its agreed (spoken / corrected) price, else the catalogue. */
export function cartUnitPrice(item: CartItem): number {
  return typeof item.unitPrice === 'number' ? item.unitPrice : catalogPrice(item.product);
}

export function cartLineTotal(item: CartItem): number {
  return lineTotal(item.quantity, cartUnitPrice(item));
}

/** Bill total = sum of the rounded lines (paise), as the backend saves it. */
export function cartTotal(items: CartItem[]): number {
  return Number(items.reduce((sum, i) => sum + lineTotalPaise(i.quantity, cartUnitPrice(i)), 0n)) / 100;
}

/** Shown unit price (3 decimals at most): 33.3333333333 -> 33.333. */
export function displayUnitPrice(item: CartItem): number {
  return Math.round(cartUnitPrice(item) * 1000) / 1000;
}

/**
 * Identifies a cart line. Catalogue-priced lines of a product share one line; a line with its own agreed
 * price is kept separate, so adding the same product at the catalogue price never re-prices it.
 */
export function cartLineKey(item: CartItem): string {
  return typeof item.unitPrice === 'number' ? `${item.product.id}@${item.unitPrice}` : item.product.id;
}

/** Add lines to the cart: same product at the same price is merged (quantities added), otherwise appended. */
export function mergeIntoCart(cart: CartItem[], additions: CartItem[]): CartItem[] {
  const next = [...cart];
  for (const add of additions) {
    const key = cartLineKey(add);
    const idx = next.findIndex((c) => cartLineKey(c) === key);
    if (idx >= 0) {
      next[idx] = { ...next[idx], quantity: round3(next[idx].quantity + add.quantity) };
    } else {
      next.push({ ...add });
    }
  }
  return next;
}

/** True when any line carries a requested price that still needs Manager / Owner approval. */
export function cartNeedsApproval(items: CartItem[]): boolean {
  return items.some((i) => i.needsApproval === true);
}

/** The bill at catalogue prices (requested prices replaced by their catalogue line), for comparison. */
export function cartCatalogueTotal(items: CartItem[]): number {
  return Number(items.reduce((sum, i) => sum + (i.needsApproval
    ? (typeof i.catalogueLineTotal === 'number' ? lineTotalPaise(1, i.catalogueLineTotal) : lineTotalPaise(i.quantity, catalogPrice(i.product)))
    : lineTotalPaise(i.quantity, cartUnitPrice(i))), 0n)) / 100;
}

/** Drop a requested price: the line is sold at the catalogue price (no approval needed). */
export function withCataloguePrice(item: CartItem): CartItem {
  const { unitPrice: _u, priceSource: _s, needsApproval: _n, catalogueLineTotal: _c, ...rest } = item;
  return rest;
}

/** Quantities keep at most 3 decimals (2.5 kg + 0.25 kg = 2.75, never 2.7500000000000004). */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
