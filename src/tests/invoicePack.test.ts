/**
 * OCR rectification (frontend): pack size -> physical quantity -> cost per standard unit on the review
 * screen, and a confirm payload that never invents a selling price.
 * Uses the backend's own unit registry snapshot (fixtures/unit_registry.json). Generic test values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UnitRegistry } from '../api/units';
import { createUnitIndex } from '../utils/unitRegistry';
import {
  newProductsWithoutSellingPrice,
  packDisplay,
  packPayload,
  priceBasisFor,
  sellingPricePayload,
  type PackLine,
} from '../utils/invoicePack';

const index = createUnitIndex(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/unit_registry.json'), 'utf8')) as UnitRegistry);

const line = (over: Partial<PackLine> = {}): PackLine => ({
  product_name: 'Basmati Rice 25kg', quantity: 2, unit: 'bag', purchase_price: 2350, amount: 4700, mrp: null,
  pack_size: 25, pack_size_unit: 'kg', rate_basis_unit: 'bag', pack_conversion: 'PACK_CONVERTED', ...over,
});

describe('pack size -> physical quantity -> cost per standard unit (display)', () => {
  it('2 bag x 25 kg at Rs 2,350 = 50 kg at Rs 94 per kg', () => {
    expect(packDisplay(line(), index)).toEqual({
      packText: '25 kg per bag', physicalQuantity: 50, standardUnit: 'kg', costPerStandardUnit: 94, convertible: true,
    });
  });

  it('grams and millilitres are costed per kg / L', () => {
    expect(packDisplay(line({ product_name: 'Tea 250g', quantity: 20, unit: 'pkt', purchase_price: 145, pack_size: 250, pack_size_unit: 'g', rate_basis_unit: 'packet' }), index))
      .toMatchObject({ physicalQuantity: 5, standardUnit: 'kg', costPerStandardUnit: 580 });
    expect(packDisplay(line({ quantity: 10, unit: 'box', purchase_price: 165, pack_size: 475, pack_size_unit: 'g', rate_basis_unit: 'box' }), index))
      .toMatchObject({ physicalQuantity: 4.75, costPerStandardUnit: 347.368 });
    expect(packDisplay(line({ quantity: 6, unit: 'bottle', purchase_price: 85, pack_size: 500, pack_size_unit: 'ml', rate_basis_unit: 'bottle' }), index))
      .toMatchObject({ physicalQuantity: 3, standardUnit: 'L', costPerStandardUnit: 170 });
  });

  it('a rate printed per kg stays per kg', () => {
    expect(packDisplay(line({ purchase_price: 47, rate_basis_unit: 'kg' }), index)).toMatchObject({ physicalQuantity: 50, costPerStandardUnit: 47 });
  });

  it('editing quantity or pack size updates the dependent values', () => {
    expect(packDisplay(line({ quantity: 3 }), index).physicalQuantity).toBe(75);
    expect(packDisplay(line({ pack_size: 50 }), index)).toMatchObject({ physicalQuantity: 100, costPerStandardUnit: 47 });
  });

  it('never invents a conversion', () => {
    expect(packDisplay(line({ pack_size: null, pack_size_unit: null }), index).physicalQuantity).toBeNull();
    expect(packDisplay(line({ pack_size_unit: 'pcs' }), index).costPerStandardUnit).toBeNull();
    expect(packDisplay(line({ unit: 'pcs' }), index).convertible).toBe(false); // count unit: shown, stock stays in pieces
    expect(packDisplay(line({ unit: '' }), index).physicalQuantity).toBeNull();
  });
});

describe('confirm payload', () => {
  it('sends the printed pack size only for a convertible line', () => {
    expect(packPayload(line(), index)).toEqual({ pack_size: 25, pack_size_unit: 'kg', rate_basis_unit: 'bag' });
    expect(packPayload(line({ unit: 'pcs' }), index)).toEqual({});
    expect(packPayload(line({ pack_size: null }), index)).toEqual({});
  });

  it('a new product can be stocked in kg; an existing product keeps its own unit', () => {
    expect(packPayload(line({ stock_mode: 'physical' }), index)).toMatchObject({ stock_unit: 'kg' });
    expect(packPayload(line({ stock_mode: 'physical', matched_product_id: 'p1' }), index)).not.toHaveProperty('stock_unit');
  });

  it('never invents a selling price and never overwrites one that was not typed', () => {
    // Matched product, nothing typed: the current selling price is kept
    expect(sellingPricePayload(line({ matched_product_id: 'p1', mrp: 289 }))).toEqual({ update_selling_price: false });
    // Matched product, a printed selling price the reviewer did not touch: not sent
    expect(sellingPricePayload(line({ matched_product_id: 'p1', selling_price: 120 }))).toEqual({ update_selling_price: false });
    // Matched product, typed by the reviewer: sent and applied
    expect(sellingPricePayload(line({ matched_product_id: 'p1', selling_price: 125, selling_price_edited: true })))
      .toEqual({ selling_price: 125, update_selling_price: true });
    // New product: the entered price is sent; with none, nothing is invented
    expect(sellingPricePayload(line({ selling_price: 110 }))).toEqual({ selling_price: 110, update_selling_price: false });
    expect(sellingPricePayload(line({ mrp: 289 }))).toEqual({ update_selling_price: false });
  });

  it('new products without a selling price block the confirmation', () => {
    const lines = [line(), line({ product_name: 'Salt', matched_product_id: 'p2' }), line({ product_name: 'Oil', selling_price: 150 })];
    expect(newProductsWithoutSellingPrice(lines).map((l) => l.product_name)).toEqual(['Basmati Rice 25kg']);
  });
});

describe('price basis sent with a line', () => {
  it('a per-kg guess on a line bought in pcs falls back to the line unit', () => {
    const jeera = line({ product_name: 'Jeera Powder 100g', quantity: 10, unit: 'pcs', purchase_price: 30, pack_size: 100, pack_size_unit: 'g', pack_conversion: 'COUNT_ONLY' });
    expect(priceBasisFor(jeera, 1, 'kg', index)).toEqual({ quantity: 1, unit: 'pcs' });
  });
  it('a stale unregistered basis follows the unit the reviewer corrected', () => {
    expect(priceBasisFor(line({ unit: 'box', pack_size: null, pack_size_unit: null }), 1, 'unit', index)).toEqual({ quantity: 1, unit: 'box' });
  });
  it('a compatible basis is kept as chosen (Rs 800 per 10 kg on a kg line)', () => {
    expect(priceBasisFor(line({ unit: 'kg', pack_size: null, pack_size_unit: null }), 10, 'kg', index)).toEqual({ quantity: 10, unit: 'kg' });
  });
  it('a pack line keeps the reviewer basis (costed through the pack conversion)', () => {
    expect(priceBasisFor(line(), 1, 'kg', index)).toEqual({ quantity: 1, unit: 'kg' });
  });
});

describe('scanner integration (source)', () => {
  const src = readFileSync(resolve(__dirname, '../pages/InvoiceScanner.tsx'), 'utf8');
  it('no selling price is derived from purchase cost or MRP', () => {
    expect(src).not.toMatch(/purchasePrice \* 1\.2|purchase_price \* 1\.2/);
    expect(src).not.toMatch(/update_selling_price: true/);
    expect(src).toMatch(/\.\.\.sellingPricePayload\(i\)/);
    expect(src).toMatch(/\.\.\.packPayload\(i, unitIndex\)/);
    expect(src).toMatch(/newProductsWithoutSellingPrice\(selectedItems\)/);
  });
  it('a manual line starts empty and flagged (no invented prices or confidence)', () => {
    const manual = src.slice(src.indexOf('const handleAddItem'), src.indexOf('const handleAddItem') + 1400);
    expect(manual).toMatch(/purchase_price: null/);
    expect(manual).toMatch(/selling_price: null/);
    expect(manual).toMatch(/mrp: null/);
    expect(manual).toMatch(/needs_review: true/);
    expect(manual).not.toMatch(/purchase_price: 100|selling_price: 120|confidence: 100/);
  });
  it('no artificial delay before extraction', () => {
    expect(src).not.toMatch(/setTimeout\(r, 600\)/);
  });
  it('backend pack fields are kept, not replaced', () => {
    expect(src).toMatch(/pack_size: typeof item\.pack_size === 'number'/);
    expect(src).toMatch(/cost_per_standard_unit: typeof item\.cost_per_standard_unit === 'number'/);
  });
});
