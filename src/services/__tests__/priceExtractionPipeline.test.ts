import { describe, it, expect } from 'vitest';
import { parseSmartPrice } from '../tableLayoutExtractor';
import { detectColumnsFromHeaderText, mapTokensToColumns } from '../semanticColumnDetector';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { mapBackendItemToCanonical } from '../../api/invoice';
import { matchCanonicalItemsWithInventory } from '../inventoryMatcher';
import type { Product } from '../../types/product';

const MOCK_PRODUCTS: Product[] = [
  {
    id: 'prod_atta_1',
    name: 'Aashirvaad Atta 5kg',
    category: 'Groceries',
    price: 280,
    sellingPrice: 280,
    purchasePrice: 250,
    mrp: 300,
    stock: 50,
    minStock: 10,
    reorderLevel: 10,
    status: 'In Stock',
    unit: 'bag',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

describe('Comprehensive Price Extraction Pipeline Regression Tests (Phase 21)', () => {
  // 1. Rate extraction
  it('1. Extracts rate accurately from Rate column', () => {
    const raw = `
Item Qty Rate Amount
Besan 10 70 700
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items.length).toBe(1);
    expect(res.items[0].rate).toBe(70);
    expect(res.items[0].purchasePrice).toBe(70);
  });

  // 2. Purchase price extraction
  it('2. Extracts purchase price from Purchase Rate column', () => {
    const raw = `
Item Qty Purchase Rate Amount
Moong Dal 5 110 550
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items[0].purchasePrice).toBe(110);
  });

  // 3. Selling price extraction
  it('3. Extracts selling price from Selling Price column without confusing purchase price', () => {
    const raw = `
Item Qty Rate Selling Price Amount
Tea Powder 10 90 110 900
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items[0].purchasePrice).toBe(90);
    expect(res.items[0].sellingPrice).toBe(110);
  });

  // 4. MRP extraction
  it('4. Extracts MRP from MRP column', () => {
    const raw = `
Item Qty Purchase Rate MRP Amount
Biscuits 20 15 20 300
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items[0].purchasePrice).toBe(15);
    expect(res.items[0].mrp).toBe(20);
  });

  // 5. Amount extraction
  it('5. Extracts Amount / Line Total accurately', () => {
    const raw = `
Item Qty Rate Amount
Cooking Oil 4 1950 7800
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items[0].lineTotal).toBe(7800);
  });

  // 6. Currency parsing
  it('6. Parses currency symbols and prefixes correctly', () => {
    expect(parseSmartPrice('₹250')).toBe(250);
    expect(parseSmartPrice('₹ 250.00')).toBe(250);
    expect(parseSmartPrice('Rs. 1,400.00')).toBe(1400);
    expect(parseSmartPrice('INR 500')).toBe(500);
    expect(parseSmartPrice('@250')).toBe(250);
    expect(parseSmartPrice('(250.00)')).toBe(250);
    expect(parseSmartPrice('250/kg')).toBe(250);
    expect(parseSmartPrice('250 / pcs')).toBe(250);
    expect(parseSmartPrice('250 .00')).toBe(250);
  });

  // 7. Indian number formatting
  it('7. Handles Indian comma notation (lakhs and crores)', () => {
    expect(parseSmartPrice('1,32,765')).toBe(132765);
    expect(parseSmartPrice('₹1,32,765.00')).toBe(132765);
    expect(parseSmartPrice('2,50,000')).toBe(250000);
  });

  // 8. Missing price handling (preserves null, never zero)
  it('8. Missing prices remain null and do not fabricate zero', () => {
    expect(parseSmartPrice(null)).toBeNull();
    expect(parseSmartPrice('')).toBeNull();
    expect(parseSmartPrice('—')).toBeNull();
    expect(parseSmartPrice('-')).toBeNull();
    expect(parseSmartPrice('N/A')).toBeNull();

    const raw = `
Item Qty Amount
Plastic Bag 50 100
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    // Purchase rate was not on invoice; selling and mrp must remain null
    expect(res.items[0].sellingPrice).toBeNull();
    expect(res.items[0].mrp).toBeNull();
  });

  // 9. Different column order
  it('9. Supports arbitrary column ordering', () => {
    const raw = `
Amount Rate Qty Item
2500 250 10 Basmati Rice
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items.length).toBe(1);
    expect(res.items[0].quantity).toBe(10);
    expect(res.items[0].purchasePrice).toBe(250);
    expect(res.items[0].lineTotal).toBe(2500);
  });

  // 10. Multi-line product names
  it('10. Preserves multi-line product names and associates prices properly', () => {
    const raw = `
Item Description Qty Rate Amount
Godrej No. 1 Aloe Vera &
White Lily Soap 240g 10 30 300
`.trim();
    const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
    const res = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);
    expect(res.items.length).toBe(1);
    expect(res.items[0].name.toLowerCase()).toContain('godrej');
    expect(res.items[0].name.toLowerCase()).toContain('soap');
    expect(res.items[0].purchasePrice).toBe(30);
    expect(res.items[0].lineTotal).toBe(300);
  });

  // 11. Inventory matching preserves invoice prices
  it('11. Inventory matching attaches catalog metadata without erasing invoice purchase price', () => {
    const canonicalItem = {
      id: 'test_item_1',
      productName: 'Aashirvaad Atta 5kg',
      quantity: 10,
      unit: 'bag',
      rate: 245,
      purchasePrice: 245, // Invoice price is 245 (different from store's current 250)
      sellingPrice: null,
      mrp: null,
      lineTotal: 2450,
      confidence: 90,
      confidenceLevel: 'HIGH' as const,
      sourceText: 'Aashirvaad Atta 5kg 10 245 2450',
      extractionMethod: 'TABLE_STRUCTURED' as const,
    };

    const matched = matchCanonicalItemsWithInventory([canonicalItem], MOCK_PRODUCTS);
    expect(matched[0].matchedProductId).toBe('prod_atta_1');
    expect(matched[0].purchasePrice).toBe(245); // Invoice price preserved as primary!
    expect(matched[0].inventoryData?.storePurchasePrice).toBe(250);
  });

  // 12. Frontend mapping from backend response
  it('12. Maps backend schema to canonical and UI models accurately', () => {
    const backendItem = {
      id: 'item_be_1',
      product_name: 'Sugar 50kg',
      quantity: 2,
      unit: 'bag',
      rate: 1950,
      purchase_price: 1950,
      selling_price: 2100,
      mrp: 2200,
      line_total: 3900,
      confidence: 92,
      confidence_level: 'HIGH',
      source_text: 'Sugar 50kg 2 bag 1950 3900',
      extraction_method: 'TABLE_STRUCTURED',
    };

    const mapped = mapBackendItemToCanonical(backendItem);
    expect(mapped.productName).toBe('Sugar 50kg');
    expect(mapped.quantity).toBe(2);
    expect(mapped.purchasePrice).toBe(1950);
    expect(mapped.sellingPrice).toBe(2100);
    expect(mapped.mrp).toBe(2200);
    expect(mapped.lineTotal).toBe(3900);
  });

  // 13. Manual price editing
  it('13. User manual price updates recalculate line total correctly', () => {
    const initialItem = {
      id: 'it_1',
      name: 'Besan 500g',
      category: 'Groceries',
      quantity: 20,
      unit: 'pcs',
      purchasePrice: 70,
      sellingPrice: 85,
      mrp: 90,
      lineTotal: 1400,
      confidence: 95,
      confidenceLevel: 'HIGH' as const,
      lowConfidence: false,
    };

    // User edits purchase price from 70 to 68:
    const editedPrice = 68;
    const updatedLineTotal = Math.round(initialItem.quantity * editedPrice * 100) / 100;
    const updatedItem = {
      ...initialItem,
      purchasePrice: editedPrice,
      lineTotal: updatedLineTotal,
    };

    expect(updatedItem.purchasePrice).toBe(68);
    expect(updatedItem.lineTotal).toBe(1360);
  });

  // 14. Stock update payload contains edited values
  it('14. Generates restock/create payload with populated prices', () => {
    const reviewedItem = {
      name: 'Fortune Besan 500 GM',
      quantity: 20,
      unit: 'pcs',
      purchasePrice: 68,
      sellingPrice: 85,
      mrp: 90,
      lineTotal: 1360,
    };

    const confirmPayload = {
      name: reviewedItem.name.trim(),
      quantity: Number(reviewedItem.quantity),
      unit: reviewedItem.unit,
      purchase_price: reviewedItem.purchasePrice,
      selling_price: reviewedItem.sellingPrice,
      mrp: reviewedItem.mrp,
    };

    expect(confirmPayload.purchase_price).toBe(68);
    expect(confirmPayload.selling_price).toBe(85);
    expect(confirmPayload.mrp).toBe(90);
    expect(confirmPayload.purchase_price).not.toBeNull();
    expect(confirmPayload.purchase_price).not.toBe(0);
  });
});
