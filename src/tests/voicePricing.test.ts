/**
 * Voice-to-Bill pricing through the cart: a spoken price is kept from the recognised line to the cart,
 * the displayed bill and the sale payload; totals follow the backend line rule exactly (half-up per line,
 * bill = sum of lines) without JavaScript float errors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MatchedVoiceItem } from '../api/voice';
import type { CartItem, Product } from '../types';
import {
  cartCatalogueTotal,
  cartLineKey,
  cartNeedsApproval,
  cartLineTotal,
  cartTotal,
  cartUnitPrice,
  displayUnitPrice,
  lineTotal,
  mergeIntoCart,
  withCataloguePrice,
} from '../utils/cartPricing';
import { needsPriceApproval, voiceLineToCartItem, withEditedLineTotal } from '../utils/voiceBill';

const product = (over: Partial<Product> = {}): Product =>
  ({ id: 'tea', name: 'Tea', sellingPrice: 40, price: 40, unit: 'packet', ...over }) as Product;

const voiceLine = (over: Partial<MatchedVoiceItem> = {}): MatchedVoiceItem => ({
  product_id: 'tea', name: 'Tea', quantity: 3, unit_price: 33.333, unit_price_exact: 33.3333333333,
  total_price: 100, unit: 'packet', current_stock: 20, is_out_of_stock: false, is_insufficient_stock: false,
  available_stock: 20, price_source: 'spoken', ...over,
});

describe('exact line totals (backend rule)', () => {
  it('reproduces a spoken total from the exact unit price', () => {
    expect(lineTotal(3, 33.3333333333)).toBe(100);
    expect(lineTotal(30, 3.3333333333)).toBe(100);
    expect(lineTotal(12, 8.3325)).toBe(99.99);
  });
  it('rounds half up once per line, without float errors', () => {
    expect(lineTotal(1, 1.005)).toBe(1.01); // 1.005 * 100 in floats is 100.49999...
    expect(lineTotal(3, 0.1)).toBe(0.3);
    expect(lineTotal(2.5, 44)).toBe(110);
    expect(lineTotal(0.125, 132.4)).toBe(16.55);
  });
});

describe('spoken prices reach the cart and the sale', () => {
  it('3 tea packets for 100 rupees: cart line 100.00, not the catalogue 120.00', () => {
    const line = voiceLineToCartItem(voiceLine(), product());
    expect(line).toMatchObject({ quantity: 3, unitPrice: 33.3333333333, priceSource: 'spoken' });
    expect(cartLineTotal(line)).toBe(100);
    expect(cartTotal([line])).toBe(100);
    expect(cartUnitPrice(line)).toBe(33.3333333333); // sent as unit_price with the sale
    expect(displayUnitPrice(line)).toBe(33.333);
  });

  it('a line with no spoken price uses the catalogue price', () => {
    const line = voiceLineToCartItem(voiceLine({ price_source: 'catalogue', unit_price: 40, unit_price_exact: 40, total_price: 120 }), product());
    expect(line.unitPrice).toBeUndefined();
    expect(cartLineTotal(line)).toBe(120);
  });

  it('keeps what was said when the unit was converted', () => {
    const line = voiceLineToCartItem(voiceLine({ spoken_quantity: '500 g', quantity: 0.5 }), product({ unit: 'kg' }));
    expect(line.spokenQuantity).toBe('500 g');
  });

  it('a corrected line total sets the price; the quantity is unchanged', () => {
    const edited = withEditedLineTotal(voiceLine(), 95);
    expect(edited).toMatchObject({ quantity: 3, total_price: 95, price_source: 'edited', unit_price: 31.667 });
    expect(lineTotal(3, edited.unit_price_exact as number)).toBe(95);
    expect(voiceLineToCartItem(edited, product()).priceSource).toBe('edited');
  });
});

describe('cart lines', () => {
  const spoken: CartItem = { product: product(), quantity: 3, unitPrice: 33.3333333333, priceSource: 'spoken' };
  const catalogue: CartItem = { product: product(), quantity: 1 };

  it('the same product at the catalogue price never re-prices a spoken line', () => {
    const cart = mergeIntoCart([spoken], [catalogue]);
    expect(cart).toHaveLength(2);
    expect(cart.map(cartLineTotal)).toEqual([100, 40]);
    expect(cartTotal(cart)).toBe(140);
    expect(new Set(cart.map(cartLineKey)).size).toBe(2);
  });

  it('same product at the same price is merged; fractional quantities stay exact', () => {
    expect(mergeIntoCart([spoken], [spoken])[0].quantity).toBe(6);
    const kg: CartItem = { product: product({ id: 'sugar', unit: 'kg', sellingPrice: 44, price: 44 }), quantity: 2.5 };
    const merged = mergeIntoCart([kg], [{ ...kg, quantity: 0.25 }]);
    expect(merged[0].quantity).toBe(2.75);
    expect(cartTotal(merged)).toBe(121);
  });
});

describe('integration points (source)', () => {
  const sales = readFileSync(resolve(__dirname, '../pages/Sales.tsx'), 'utf8');
  const modal = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');
  it('the sale is sent and totalled at the cart line price, not the catalogue price', () => {
    expect(sales).toMatch(/price: cartUnitPrice\(item\)/);
    expect(sales).toMatch(/const totalAmount = cartTotal\(cart\)/);
    expect(sales).not.toMatch(/price: item\.product\.sellingPrice \?\? item\.product\.price/);
  });
  it('the modal hands the spoken price to the cart and keeps it for ambiguous choices', () => {
    expect(modal).toMatch(/voiceLineToCartItem\(item, prod\)/);
    expect(modal).toMatch(/amb\.options\?\.find/);
    expect(modal).not.toMatch(/cartItemsToAdd\.push\(\{ product: prod, quantity: item\.quantity \}\)/);
  });
});

describe('Stage 4C.1 Decision 1: a spoken price is a request needing approval', () => {
  const requested = voiceLine({ catalog_line_total: 120, needs_price_approval: true });

  it('a differing spoken price stays a marked request in the cart, never a settled bill', () => {
    const line = voiceLineToCartItem(requested, product());
    expect(line).toMatchObject({ needsApproval: true, catalogueLineTotal: 120, unitPrice: 33.3333333333 });
    expect(cartNeedsApproval([line])).toBe(true);
    expect(cartTotal([line])).toBe(100);           // shown as requested ...
    expect(cartCatalogueTotal([line])).toBe(120);  // ... next to the catalogue total
  });

  it('a spoken price equal to the catalogue is an ordinary catalogue line', () => {
    const same = voiceLineToCartItem(voiceLine({ total_price: 120, unit_price_exact: 40, catalog_line_total: 120, needs_price_approval: false }), product());
    expect(same.unitPrice).toBeUndefined();
    expect(same.needsApproval).toBeUndefined();
    expect(cartNeedsApproval([same])).toBe(false);
    expect(cartLineTotal(same)).toBe(120);
  });

  it('"use catalogue price" drops the request', () => {
    const line = withCataloguePrice(voiceLineToCartItem(requested, product()));
    expect(line).toEqual({ product: product(), quantity: 3 });
    expect(cartTotal([line])).toBe(120);
  });

  it('a corrected total needs approval unless it equals the catalogue line', () => {
    expect(needsPriceApproval(withEditedLineTotal(requested, 95))).toBe(true);
    expect(needsPriceApproval(withEditedLineTotal(requested, 120))).toBe(false);
  });

  it('checkout sends the request for approval; labels say the total is not final', () => {
    const sales = readFileSync(resolve(__dirname, '../pages/Sales.tsx'), 'utf8');
    const service = readFileSync(resolve(__dirname, '../services/salesService.ts'), 'utf8');
    const modal = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');
    expect(sales).toMatch(/item\.needsApproval \? \{ requestedLineTotal: cartLineTotal\(item\) \}/);
    expect(service).toMatch(/requested_line_total: item\.requestedLineTotal/);
    expect(sales).toMatch(/data-testid="approval-pending-note"/);
    expect(sales).toMatch(/t\('pricing\.useCatalogue'\)/);  // localized since Stage 5
    expect(modal).toMatch(/data-testid="voice-approval-note"/);
  });
});
