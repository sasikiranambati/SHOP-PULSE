import { describe, it, expect } from 'vitest';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { matchCanonicalItemsWithInventory } from '../inventoryMatcher';
import { mapBackendItemToCanonical, mapBackendResponseToParsedInvoice } from '../../api/invoice';
import type { CanonicalInvoiceItem } from '../invoiceTypes';

describe('Demo Invoice Regression - Data Mapping & Non-Zero Prices', () => {
  // Primary Regression Test: Actual 10 items, 9 columns, formatted currency from Section 1
  const actualDemoInvoiceText = `
S.No. | Item Description | HSN/SAC | Qty | Unit | Rate | Discount | Tax | Amount
1 | Aashirvaad Atta 5 kg | 1001 | 10 | BAG | ₹250 | 0 | 5% | ₹2,500
2 | Tata Salt 1 kg | 2501 | 20 | PKT | ₹25 | 0 | 0% | ₹500
3 | Fortune Sunflower Oil 1 L | 1512 | 10 | BTL | ₹150 | 0 | 5% | ₹1,500
4 | Parle-G Biscuit 800 g | 1905 | 30 | PKT | ₹60 | 0 | 0% | ₹1,800
5 | Britannia Marie Gold 800 g | 1905 | 20 | PKT | ₹70 | 0 | 0% | ₹1,400
6 | Surf Excel 1 kg | 3402 | 5 | PKT | ₹200 | 0 | 18% | ₹1,000
7 | Colgate Toothpaste 200 g | 3306 | 24 | PKT | ₹85 | 0 | 12% | ₹2,040
8 | Dettol Soap 125 g | 3401 | 36 | PKT | ₹35 | 0 | 18% | ₹1,260
9 | Sugar 1 kg | 1701 | 50 | PKT | ₹40 | 0 | 5% | ₹2,000
10 | Masoor Dal 1 kg | 0713 | 25 | PKT | ₹120 | 0 | 0% | ₹3,000

Subtotal: ₹17,000.00
Grand Total: ₹17,000.00
`.trim();

  it('correctly extracts 10 products, 230 units, and ₹17,000 subtotal from the Section 1 demo invoice', () => {
    const lines = actualDemoInvoiceText
      .split('\n')
      .map((text, idx) => ({ text: text.trim(), confidence: 95, lineIndex: idx }))
      .filter((l) => l.text.length > 0);

    const result = parseInvoiceWithFlexibleEngine(lines, [], actualDemoInvoiceText, 'tesseract', []);

    expect(result.items.length).toBe(10);

    // 1. Aashirvaad Atta 5 kg
    const aashirvaad = result.items.find((i) => i.name.toLowerCase().includes('aashirvaad'));
    expect(aashirvaad).toBeDefined();
    expect(aashirvaad!.quantity).toBe(10);
    expect(aashirvaad!.rate).toBe(250);
    expect(aashirvaad!.purchasePrice).toBe(250);
    expect(aashirvaad!.sellingPrice).toBeNull();
    expect(aashirvaad!.mrp).toBeNull();
    expect(aashirvaad!.lineTotal).toBe(2500);

    // 2. Tata Salt 1 kg
    const tataSalt = result.items.find((i) => i.name.toLowerCase().includes('tata salt'));
    expect(tataSalt).toBeDefined();
    expect(tataSalt!.quantity).toBe(20);
    expect(tataSalt!.rate).toBe(25);
    expect(tataSalt!.purchasePrice).toBe(25);
    expect(tataSalt!.sellingPrice).toBeNull();
    expect(tataSalt!.lineTotal).toBe(500);

    // 3. Fortune Sunflower Oil 1 L
    const fortuneOil = result.items.find((i) => i.name.toLowerCase().includes('fortune sunflower'));
    expect(fortuneOil).toBeDefined();
    expect(fortuneOil!.quantity).toBe(10);
    expect(fortuneOil!.rate).toBe(150);
    expect(fortuneOil!.purchasePrice).toBe(150);
    expect(fortuneOil!.sellingPrice).toBeNull();
    expect(fortuneOil!.lineTotal).toBe(1500);

    // 4. Parle-G Biscuit 800 g
    const parleG = result.items.find((i) => i.name.toLowerCase().includes('parle-g'));
    expect(parleG).toBeDefined();
    expect(parleG!.quantity).toBe(30);
    expect(parleG!.rate).toBe(60);
    expect(parleG!.purchasePrice).toBe(60);
    expect(parleG!.sellingPrice).toBeNull();
    expect(parleG!.lineTotal).toBe(1800);

    // 5. Britannia Marie Gold 800 g
    const marieGold = result.items.find((i) => i.name.toLowerCase().includes('marie gold'));
    expect(marieGold).toBeDefined();
    expect(marieGold!.quantity).toBe(20);
    expect(marieGold!.rate).toBe(70);
    expect(marieGold!.purchasePrice).toBe(70);
    expect(marieGold!.sellingPrice).toBeNull();
    expect(marieGold!.lineTotal).toBe(1400);

    // 6. Surf Excel 1 kg
    const surfExcel = result.items.find((i) => i.name.toLowerCase().includes('surf excel'));
    expect(surfExcel).toBeDefined();
    expect(surfExcel!.quantity).toBe(5);
    expect(surfExcel!.rate).toBe(200);
    expect(surfExcel!.purchasePrice).toBe(200);
    expect(surfExcel!.sellingPrice).toBeNull();
    expect(surfExcel!.lineTotal).toBe(1000);

    // 7. Colgate Toothpaste 200 g
    const colgate = result.items.find((i) => i.name.toLowerCase().includes('colgate'));
    expect(colgate).toBeDefined();
    expect(colgate!.quantity).toBe(24);
    expect(colgate!.rate).toBe(85);
    expect(colgate!.purchasePrice).toBe(85);
    expect(colgate!.sellingPrice).toBeNull();
    expect(colgate!.lineTotal).toBe(2040);

    // 8. Dettol Soap 125 g
    const dettol = result.items.find((i) => i.name.toLowerCase().includes('dettol'));
    expect(dettol).toBeDefined();
    expect(dettol!.quantity).toBe(36);
    expect(dettol!.rate).toBe(35);
    expect(dettol!.purchasePrice).toBe(35);
    expect(dettol!.sellingPrice).toBeNull();
    expect(dettol!.lineTotal).toBe(1260);

    // 9. Sugar 1 kg
    const sugar = result.items.find((i) => i.name.toLowerCase().includes('sugar'));
    expect(sugar).toBeDefined();
    expect(sugar!.quantity).toBe(50);
    expect(sugar!.rate).toBe(40);
    expect(sugar!.purchasePrice).toBe(40);
    expect(sugar!.sellingPrice).toBeNull();
    expect(sugar!.lineTotal).toBe(2000);

    // 10. Masoor Dal 1 kg
    const masoor = result.items.find((i) => i.name.toLowerCase().includes('masoor'));
    expect(masoor).toBeDefined();
    expect(masoor!.quantity).toBe(25);
    expect(masoor!.rate).toBe(120);
    expect(masoor!.purchasePrice).toBe(120);
    expect(masoor!.sellingPrice).toBeNull();
    expect(masoor!.lineTotal).toBe(3000);

    // Total units: 10 + 20 + 10 + 30 + 20 + 5 + 24 + 36 + 50 + 25 = 230
    const calculatedUnits = result.items.reduce((acc, it) => acc + (it.quantity || 0), 0);
    expect(calculatedUnits).toBe(230);

    // Subtotal: 2500 + 500 + 1500 + 1800 + 1400 + 1000 + 2040 + 1260 + 2000 + 3000 = 17,000
    const calculatedTotal = result.items.reduce((acc, it) => acc + (it.lineTotal || 0), 0);
    expect(calculatedTotal).toBe(17000);
  });

  it('ensures inventory matching failure (+ New Item) does NOT zero prices or totals', () => {
    const rawCanonicalItems: CanonicalInvoiceItem[] = [
      {
        id: 'canon_1',
        productName: 'Tata Salt 1 kg',
        quantity: 20,
        unit: 'PKT',
        rate: 25,
        purchasePrice: 25,
        sellingPrice: null,
        mrp: null,
        discount: 0,
        taxableAmount: 500,
        taxAmount: null,
        gstRate: null,
        hsnCode: null,
        lineTotal: 500,
        confidence: 95,
        confidenceLevel: 'HIGH',
        sourceText: 'Tata Salt 1 kg | 20 | PKT | 25 | 500',
        extractionMethod: 'TABLE_STRUCTURED',
      },
      {
        id: 'canon_2',
        productName: 'Aashirvaad Atta 5 kg',
        quantity: 10,
        unit: 'BAG',
        rate: 250,
        purchasePrice: 250,
        sellingPrice: null,
        mrp: null,
        discount: 0,
        taxableAmount: 2500,
        taxAmount: null,
        gstRate: 5,
        hsnCode: null,
        lineTotal: 2500,
        confidence: 95,
        confidenceLevel: 'HIGH',
        sourceText: 'Aashirvaad Atta 5 kg | 10 | BAG | 250 | 2500',
        extractionMethod: 'TABLE_STRUCTURED',
      },
    ];

    // No existing products in store inventory
    const matched = matchCanonicalItemsWithInventory(rawCanonicalItems, []);

    expect(matched.length).toBe(2);

    // Unmatched item shows no matchedProductId ("+ New Item")
    expect(matched[0].matchedProductId).toBeUndefined();
    expect(matched[0].name).toBe('Tata Salt 1 kg');
    expect(matched[0].quantity).toBe(20);
    expect(matched[0].rate).toBe(25);
    expect(matched[0].purchasePrice).toBe(25);
    expect(matched[0].sellingPrice).toBeNull();
    expect(matched[0].lineTotal).toBe(500);

    expect(matched[1].matchedProductId).toBeUndefined();
    expect(matched[1].name).toBe('Aashirvaad Atta 5 kg');
    expect(matched[1].quantity).toBe(10);
    expect(matched[1].rate).toBe(250);
    expect(matched[1].purchasePrice).toBe(250);
    expect(matched[1].sellingPrice).toBeNull();
    expect(matched[1].lineTotal).toBe(2500);
  });

  it('maps backend response explicitly from rate / purchase_price to frontend purchasePrice', () => {
    const backendResponseItem = {
      id: 'item_be_1',
      product_name: 'Aashirvaad Atta 5 kg',
      quantity: 10,
      unit: 'BAG',
      rate: 250,
      purchase_price: 250,
      selling_price: null,
      line_total: 2500,
      confidence: 90,
      confidence_level: 'HIGH',
    };

    const canonical = mapBackendItemToCanonical(backendResponseItem);

    expect(canonical.productName).toBe('Aashirvaad Atta 5 kg');
    expect(canonical.quantity).toBe(10);
    expect(canonical.rate).toBe(250);
    expect(canonical.purchasePrice).toBe(250);
    expect(canonical.sellingPrice).toBeNull();
    expect(canonical.lineTotal).toBe(2500);

    const fullBackendResponse = {
      id: 'inv_101',
      supplier_name: 'Metro Cash & Carry',
      total_amount: 17000,
      items: [
        backendResponseItem,
        {
          id: 'item_be_2',
          product_name: 'Tata Salt 1 kg',
          quantity: 20,
          rate: 25,
          purchase_price: 25,
          selling_price: null,
          line_total: 500,
        },
      ],
    };

    const parsed = mapBackendResponseToParsedInvoice(fullBackendResponse, []);
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].purchasePrice).toBe(250);
    expect(parsed.items[0].sellingPrice).toBeNull();
    expect(parsed.items[0].lineTotal).toBe(2500);
    expect(parsed.items[1].purchasePrice).toBe(25);
    expect(parsed.items[1].sellingPrice).toBeNull();
    expect(parsed.items[1].lineTotal).toBe(500);
  });

  // Section 19: Test Different Invoice Price Formats (A, B, C, D, E)
  describe('Different Invoice Price Formats (Section 19)', () => {
    it('Format A: Product | Qty | Rate | Amount', () => {
      const text = `
Product | Qty | Rate | Amount
Aashirvaad Atta 5 kg | 10 | 250 | 2500
Tata Salt 1 kg | 20 | 25 | 500
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(2);
      expect(res.items[0].purchasePrice).toBe(250);
      expect(res.items[0].sellingPrice).toBeNull();
      expect(res.items[0].lineTotal).toBe(2500);
      expect(res.items[1].purchasePrice).toBe(25);
      expect(res.items[1].lineTotal).toBe(500);
    });

    it('Format B: Product | Qty | Unit Price | Total', () => {
      const text = `
Product | Qty | Unit Price | Total
Fortune Sunflower Oil 1 L | 10 | 150 | 1500
Parle-G Biscuit 800 g | 30 | 60 | 1800
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(2);
      expect(res.items[0].purchasePrice).toBe(150);
      expect(res.items[0].lineTotal).toBe(1500);
      expect(res.items[1].purchasePrice).toBe(60);
      expect(res.items[1].lineTotal).toBe(1800);
    });

    it('Format C: Product | Qty | Purchase Rate | Selling Price | MRP | Amount', () => {
      const text = `
Product | Qty | Purchase Rate | Selling Price | MRP | Amount
Surf Excel 1 kg | 5 | 200 | 220 | 230 | 1000
Colgate Toothpaste 200 g | 24 | 85 | 95 | 100 | 2040
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(2);
      expect(res.items[0].purchasePrice).toBe(200);
      expect(res.items[0].sellingPrice).toBe(220);
      expect(res.items[0].mrp).toBe(230);
      expect(res.items[0].lineTotal).toBe(1000);
      expect(res.items[1].purchasePrice).toBe(85);
      expect(res.items[1].sellingPrice).toBe(95);
      expect(res.items[1].mrp).toBe(100);
      expect(res.items[1].lineTotal).toBe(2040);
    });

    it('Format D: Product | Qty | MRP | Sale Price | Amount', () => {
      const text = `
Product | Qty | MRP | Sale Price | Amount
Britannia Marie Gold 800 g | 20 | 80 | 70 | 1400
Dettol Soap 125 g | 36 | 40 | 35 | 1260
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(2);
      expect(res.items[0].purchasePrice).toBeNull();
      expect(res.items[0].sellingPrice).toBe(70);
      expect(res.items[0].mrp).toBe(80);
      expect(res.items[0].lineTotal).toBe(1400);
      expect(res.items[1].purchasePrice).toBeNull();
      expect(res.items[1].sellingPrice).toBe(35);
      expect(res.items[1].mrp).toBe(40);
      expect(res.items[1].lineTotal).toBe(1260);
    });

    it('Format E: Product | Qty | Cost | GST | Net Amount', () => {
      const text = `
Product | Qty | Cost | GST | Net Amount
Sugar 1 kg | 50 | 40 | 5% | 2000
Masoor Dal 1 kg | 25 | 120 | 0% | 3000
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(2);
      expect(res.items[0].purchasePrice).toBe(40);
      expect(res.items[0].lineTotal).toBe(2000);
      expect(res.items[1].purchasePrice).toBe(120);
      expect(res.items[1].lineTotal).toBe(3000);
    });

    it('Safely normalizes OCR price errors (2S0 -> 250, 25O -> 250, 2,5OO -> 2500, ₹ 2,500 -> 2500)', () => {
      const text = `
Product | Qty | Rate | Amount
Aashirvaad Atta 5 kg | 10 | 2S0 | 2,5OO
Tata Salt 1 kg | 20 | 25O | ₹ 500
Fortune Oil 1 L | 10 | ₹ 150 | ₹ 1,500
      `.trim();
      const res = parseInvoiceWithFlexibleEngine([], [], text, 'tesseract', []);
      expect(res.items.length).toBe(3);
      expect(res.items[0].purchasePrice).toBe(250);
      expect(res.items[0].lineTotal).toBe(2500);
      expect(res.items[1].purchasePrice).toBe(250);
      expect(res.items[1].lineTotal).toBe(500);
      expect(res.items[2].purchasePrice).toBe(150);
      expect(res.items[2].lineTotal).toBe(1500);
    });
  });

  // Step 7 Regression Test: Exact Rate (₹) Sequence [250, 25, 150, 60, 70, 200, 85, 35, 40, 120]
  describe('STEP 7 Regression Test — Rate (₹) to Purchase Price Mapping & Sequence', () => {
    const rateSymbolInvoiceText = `
S.No. | Item Description | HSN/SAC | Qty | Unit | Rate (₹) | Discount | Tax % | Amount
1 | Aashirvaad Atta 5 kg | 1001 | 10 | BAG | 250.00 | 0 | 5% | 2,500.00
2 | Tata Salt 1 kg | 2501 | 20 | PKT | 25.00 | 0 | 0% | 500.00
3 | Fortune Sunflower Oil 1 L | 1512 | 10 | BTL | 150.00 | 0 | 5% | 1,500.00
4 | Parle-G Biscuit 800 g | 1905 | 30 | PKT | 60.00 | 0 | 0% | 1,800.00
5 | Britannia Marie Gold 800 g | 1905 | 20 | PKT | 70.00 | 0 | 0% | 1,400.00
6 | Surf Excel 1 kg | 3402 | 5 | PKT | 200.00 | 0 | 18% | 1,000.00
7 | Colgate Toothpaste 200 g | 3306 | 24 | PKT | 85.00 | 0 | 12% | 2,040.00
8 | Dettol Soap 125 g | 3401 | 36 | PKT | 35.00 | 0 | 18% | 1,260.00
9 | Sugar 1 kg | 1701 | 50 | PKT | 40.00 | 0 | 5% | 2,000.00
10 | Masoor Dal 1 kg | 0713 | 25 | PKT | 120.00 | 0 | 0% | 3,000.00

Subtotal: ₹17,000.00
Grand Total: ₹17,000.00
`.trim();

    it('extracts exactly the expected 10-rate sequence [250, 25, 150, 60, 70, 200, 85, 35, 40, 120] from Rate (₹) column', () => {
      const res = parseInvoiceWithFlexibleEngine([], [], rateSymbolInvoiceText, 'tesseract', []);
      expect(res.items.length).toBe(10);

      const expectedRates = [250, 25, 150, 60, 70, 200, 85, 35, 40, 120];
      const extractedRates = res.items.map((it) => it.rate);
      const extractedPurchasePrices = res.items.map((it) => it.purchasePrice);

      expect(extractedRates).toEqual(expectedRates);
      expect(extractedPurchasePrices).toEqual(expectedRates);

      // Selling Price and MRP must remain null (no fake prices or copying from rate)
      expect(res.items.every((it) => it.sellingPrice === null)).toBe(true);
      expect(res.items.every((it) => it.mrp === null)).toBe(true);

      // Line totals should match the Amount column directly
      const expectedTotals = [2500, 500, 1500, 1800, 1400, 1000, 2040, 1260, 2000, 3000];
      const extractedTotals = res.items.map((it) => it.lineTotal);
      expect(extractedTotals).toEqual(expectedTotals);

      // Subtotal check approx ₹17,000
      const totalSum = res.items.reduce((acc, it) => acc + (it.lineTotal || 0), 0);
      expect(totalSum).toBe(17000);
    });

    it('maps backend response with rate and amount to frontend purchasePrice and lineTotal without losing values', () => {
      const backendItems = [
        { id: '1', product_name: 'Aashirvaad Atta 5 kg', quantity: 10, unit: 'BAG', rate: 250, purchase_price: 250, amount: 2500, line_total: 2500 },
        { id: '2', product_name: 'Tata Salt 1 kg', quantity: 20, unit: 'PKT', rate: 25, purchase_price: 25, amount: 500, line_total: 500 },
        { id: '3', product_name: 'Fortune Sunflower Oil 1 L', quantity: 10, unit: 'BTL', rate: 150, purchase_price: 150, amount: 1500, line_total: 1500 },
        { id: '4', product_name: 'Parle-G Biscuit 800 g', quantity: 30, unit: 'PKT', rate: 60, purchase_price: 60, amount: 1800, line_total: 1800 },
        { id: '5', product_name: 'Britannia Marie Gold 800 g', quantity: 20, unit: 'PKT', rate: 70, purchase_price: 70, amount: 1400, line_total: 1400 },
        { id: '6', product_name: 'Surf Excel 1 kg', quantity: 5, unit: 'PKT', rate: 200, purchase_price: 200, amount: 1000, line_total: 1000 },
        { id: '7', product_name: 'Colgate Toothpaste 200 g', quantity: 24, unit: 'PKT', rate: 85, purchase_price: 85, amount: 2040, line_total: 2040 },
        { id: '8', product_name: 'Dettol Soap 125 g', quantity: 36, unit: 'PKT', rate: 35, purchase_price: 35, amount: 1260, line_total: 1260 },
        { id: '9', product_name: 'Sugar 1 kg', quantity: 50, unit: 'PKT', rate: 40, purchase_price: 40, amount: 2000, line_total: 2000 },
        { id: '10', product_name: 'Masoor Dal 1 kg', quantity: 25, unit: 'PKT', rate: 120, purchase_price: 120, amount: 3000, line_total: 3000 },
      ];

      const backendResp = {
        id: 'inv_real_1',
        supplier_name: 'Wholesale Supplier',
        total_amount: 17000,
        items: backendItems,
      };

      const parsed = mapBackendResponseToParsedInvoice(backendResp, []);
      expect(parsed.items.length).toBe(10);

      const expectedRates = [250, 25, 150, 60, 70, 200, 85, 35, 40, 120];
      expect(parsed.items.map((it) => it.purchasePrice)).toEqual(expectedRates);
      expect(parsed.items.map((it) => it.rate)).toEqual(expectedRates);
      expect(parsed.items.every((it) => it.sellingPrice === null)).toBe(true);
      expect(parsed.items.every((it) => it.mrp === null)).toBe(true);
      expect(parsed.items.map((it) => it.lineTotal)).toEqual([2500, 500, 1500, 1800, 1400, 1000, 2040, 1260, 2000, 3000]);
    });

    it('correctly detects Rate (₹) and Amount columns from OCR header words without destructive merges', () => {
      const headerWords = [
        { text: "S.No.", confidence: 95, bbox: { x0: 40, y0: 100, x1: 90, y1: 120 } },
        { text: "Item", confidence: 95, bbox: { x0: 100, y0: 100, x1: 150, y1: 120 } },
        { text: "Description", confidence: 95, bbox: { x0: 160, y0: 100, x1: 300, y1: 120 } },
        { text: "HSN/SAC", confidence: 95, bbox: { x0: 380, y0: 100, x1: 460, y1: 120 } },
        { text: "Qty", confidence: 95, bbox: { x0: 480, y0: 100, x1: 520, y1: 120 } },
        { text: "Unit", confidence: 95, bbox: { x0: 540, y0: 100, x1: 590, y1: 120 } },
        { text: "Rate", confidence: 95, bbox: { x0: 620, y0: 100, x1: 670, y1: 120 } },
        { text: "(₹)", confidence: 95, bbox: { x0: 675, y0: 100, x1: 710, y1: 120 } },
        { text: "Discount", confidence: 95, bbox: { x0: 730, y0: 100, x1: 800, y1: 120 } },
        { text: "Tax", confidence: 95, bbox: { x0: 820, y0: 100, x1: 860, y1: 120 } },
        { text: "Amount", confidence: 95, bbox: { x0: 890, y0: 100, x1: 960, y1: 120 } },
      ];

      const rowWords = [
        { text: "1", confidence: 95, bbox: { x0: 50, y0: 150, x1: 65, y1: 170 } },
        { text: "Aashirvaad", confidence: 95, bbox: { x0: 100, y0: 150, x1: 190, y1: 170 } },
        { text: "Atta", confidence: 95, bbox: { x0: 200, y0: 150, x1: 240, y1: 170 } },
        { text: "5", confidence: 95, bbox: { x0: 250, y0: 150, x1: 260, y1: 170 } },
        { text: "kg", confidence: 95, bbox: { x0: 265, y0: 150, x1: 285, y1: 170 } },
        { text: "1001", confidence: 95, bbox: { x0: 390, y0: 150, x1: 440, y1: 170 } },
        { text: "10", confidence: 95, bbox: { x0: 490, y0: 150, x1: 515, y1: 170 } },
        { text: "BAG", confidence: 95, bbox: { x0: 550, y0: 150, x1: 590, y1: 170 } },
        { text: "250.00", confidence: 95, bbox: { x0: 630, y0: 150, x1: 690, y1: 170 } },
        { text: "0", confidence: 95, bbox: { x0: 740, y0: 150, x1: 755, y1: 170 } },
        { text: "5%", confidence: 95, bbox: { x0: 830, y0: 150, x1: 855, y1: 170 } },
        { text: "2500.00", confidence: 95, bbox: { x0: 900, y0: 150, x1: 960, y1: 170 } },
      ];

      const lines = [
        { text: "S.No. Item Description HSN/SAC Qty Unit Rate (₹) Discount Tax Amount", words: headerWords, confidence: 95 },
        { text: "1 Aashirvaad Atta 5 kg 1001 10 BAG 250.00 0 5% 2500.00", words: rowWords, confidence: 95 },
      ];

      const parsed = parseInvoiceWithFlexibleEngine(lines, [...headerWords, ...rowWords], lines.map(l => l.text).join('\n'), 'tesseract', []);
      expect(parsed.items.length).toBe(1);
      const item = parsed.items[0];
      expect(item.name).toContain('Aashirvaad Atta');
      expect(item.quantity).toBe(10);
      expect(item.rate).toBe(250);
      expect(item.purchasePrice).toBe(250);
      expect(item.sellingPrice).toBeNull();
      expect(item.mrp).toBeNull();
      expect(item.lineTotal).toBe(2500);
    });
  });
});
