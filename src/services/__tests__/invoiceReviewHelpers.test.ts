/**
 * Review-screen helpers for scanned invoices: issue summary, store-price copying,
 * store matching and pack-size editing. None of them may invent or overwrite prices.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeExtractionIssues,
  describeScanCompletion,
  applyStoreMatch,
  copyStorePrices,
  setPackSizeText,
  formatPackSize,
  knownStorePrice,
} from '../invoiceReview';
import type { InvoiceLineItem } from '../invoiceTypes';
import type { Product } from '../../types/product';

const line = (overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem => ({
  id: 'l1',
  name: 'Tata Salt 1kg',
  category: 'Groceries',
  quantity: 10,
  unit: 'pcs',
  purchasePrice: 22,
  rate: 22,
  sellingPrice: null,
  mrp: null,
  lineTotal: 220,
  lineTotalSource: 'INVOICE',
  confidence: 95,
  confidenceLevel: 'HIGH',
  lowConfidence: false,
  ...overrides,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Tata Salt 1kg',
  category: 'Groceries',
  stock: 5,
  unit: 'pcs',
  sellingPrice: 28,
  price: 28,
  purchasePrice: 21,
  mrp: 30,
  reorderLevel: 5,
  minStock: 5,
  status: 'In Stock',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('summarizeExtractionIssues', () => {
  it('returns nothing for a clean line', () => {
    expect(summarizeExtractionIssues([line()])).toEqual([]);
  });

  it('keeps missing values, low confidence, arithmetic and MRP problems in separate groups', () => {
    const items = [
      line({ id: 'a', name: 'Coffee', purchasePrice: null, rate: null }),
      line({ id: 'b', name: 'Tea', quantity: null }),
      line({ id: 'c', name: 'Soap', confidence: 40, lowConfidence: true }),
      line({ id: 'd', name: 'Oil', arithmeticStatus: 'MISMATCH' }),
      line({ id: 'e', name: 'Rice', mrpLookup: { status: 'API_TIMEOUT', provider: 'x', message: 'timeout' } as any }),
      line({ id: 'f', name: 'Dal', mrpLookup: { status: 'PRODUCT_NOT_FOUND', provider: 'x', message: 'none' } as any }),
      line({ id: 'g', name: 'Sugar', mrpLookup: { status: 'API_CONFIGURATION_ERROR', provider: 'openmrp', message: 'not configured' } as any }),
    ];
    const groups = Object.fromEntries(summarizeExtractionIssues(items).map((g) => [g.key, g]));
    expect(groups.missing_purchase_price.itemNames).toEqual(['Coffee']);
    expect(groups.missing_purchase_price.severity).toBe('error');
    expect(groups.missing_quantity.itemNames).toEqual(['Tea']);
    expect(groups.low_confidence.itemNames).toEqual(['Soap']);
    expect(groups.arithmetic_mismatch.itemNames).toEqual(['Oil']);
    expect(groups.mrp_lookup_failed.itemNames).toEqual(['Rice']);
    expect(groups.mrp_not_found.itemNames).toEqual(['Dal']);
    // An unconfigured provider is reported as such, not as a failed request
    expect(groups.mrp_lookup_unconfigured.itemNames).toEqual(['Sugar']);
  });

  it('does not report an MRP lookup problem when an MRP is present', () => {
    const items = [line({ mrp: 30, mrpSource: 'INVOICE', mrpLookup: { status: 'API_ERROR', provider: 'x', message: '' } as any })];
    expect(summarizeExtractionIssues(items)).toEqual([]);
  });

  it('does not change the items it summarises', () => {
    const item = line({ purchasePrice: null, rate: null });
    const before = JSON.stringify(item);
    summarizeExtractionIssues([item]);
    expect(JSON.stringify(item)).toBe(before);
  });
});

describe('store prices', () => {
  it('treats an unrecorded (0) store price as unknown', () => {
    expect(knownStorePrice(0)).toBeNull();
    expect(knownStorePrice(null)).toBeNull();
    expect(knownStorePrice(undefined)).toBeNull();
    expect(knownStorePrice(21)).toBe(21);
  });

  it('never copies a ₹0 purchase price into the invoice line', () => {
    const item = line({
      purchasePrice: null,
      rate: null,
      lineTotal: 500,
      inventoryData: { storePurchasePrice: 0, storeSellingPrice: 28, storeMrp: null },
    });
    const updated = copyStorePrices(item);
    expect(updated.purchasePrice).toBeNull();
    expect(updated.rate).toBeNull();
    expect(updated.sellingPrice).toBe(28);
    expect(updated.mrp).toBeNull();
  });

  it('copies known store prices, marks the MRP as STORE and keeps a printed amount', () => {
    const item = line({
      purchasePrice: null,
      rate: null,
      lineTotal: 230,
      lineTotalSource: 'INVOICE',
      inventoryData: { storePurchasePrice: 21, storeSellingPrice: 28, storeMrp: 30 },
    });
    const updated = copyStorePrices(item);
    expect(updated.purchasePrice).toBe(21);
    expect(updated.mrp).toBe(30);
    expect(updated.mrpSource).toBe('STORE');
    // The amount printed on the invoice is evidence and is never replaced.
    expect(updated.lineTotal).toBe(230);
    expect(updated.lineTotalSource).toBe('INVOICE');
  });
});

describe('applyStoreMatch', () => {
  it('links a product without turning an unrecorded purchase price into ₹0', () => {
    const linked = applyStoreMatch(line(), product({ purchasePrice: 0 }));
    expect(linked.matchedProductId).toBe('p1');
    expect(linked.isMatchConfirmed).toBe(true);
    expect(linked.inventoryData?.storePurchasePrice).toBeNull();
    expect(linked.inventoryData?.storeSellingPrice).toBe(28);
  });

  it('does not touch the line prices when linking', () => {
    const linked = applyStoreMatch(line({ purchasePrice: 22, mrp: null }), product());
    expect(linked.purchasePrice).toBe(22);
    expect(linked.mrp).toBeNull();
  });

  it('unlinks when no product is given', () => {
    const unlinked = applyStoreMatch(applyStoreMatch(line(), product()), null);
    expect(unlinked.matchedProductId).toBeUndefined();
    expect(unlinked.inventoryData).toBeUndefined();
    expect(unlinked.isMatchConfirmed).toBe(false);
  });
});

describe('pack size editing', () => {
  it('shows the extracted pack size with its unit', () => {
    expect(formatPackSize({ packSize: 400, packSizeUnit: 'g' })).toBe('400 g');
    expect(formatPackSize({ packSize: null, packSizeUnit: null })).toBe('');
  });

  it('stores typed text without appending the old unit again', () => {
    const edited = setPackSizeText(line({ packSize: 400, packSizeUnit: 'g' }), '500g');
    expect(formatPackSize(edited)).toBe('500g');
    expect(formatPackSize(setPackSizeText(edited, '500g '))).toBe('500g ');
    expect(formatPackSize(setPackSizeText(edited, ''))).toBe('');
  });
});

describe('describeScanCompletion', () => {
  it('reports success only when no line needs fixing or checking', () => {
    const done = describeScanCompletion([line(), line({ id: 'l2' })]);
    expect(done.tone).toBe('success');
    expect(done.title).toBe('Invoice processed successfully');
  });

  it('does not claim success when a line is unusable', () => {
    // e.g. a phone photo where the header row was read as an item with no quantity
    const done = describeScanCompletion([line({ name: 'Item Description HSN', quantity: null, confidence: 40, lowConfidence: true })]);
    expect(done.tone).toBe('info');
    expect(done.title).not.toMatch(/success/i);
    expect(done.description).toContain('1 needs fixing');
  });

  it('ignores optional notes such as a missing MRP lookup', () => {
    const done = describeScanCompletion([line({ mrpLookup: { status: 'API_CONFIGURATION_ERROR', provider: 'openmrp', message: '' } as any })]);
    expect(done.tone).toBe('success');
  });
});
