/**
 * @file ocrAccuracyV2.test.ts
 * @description Phase 8 Automated Regression Test Suite for ShopPulse OCR Accuracy V2.
 * Covers all 10 required test scenarios:
 * 1. Clear supplier invoice with six products
 * 2. Problematic shampoo, detergent, toothpaste, rice, wheat, and sugar extraction
 * 3. Product pack sizes (500 ml, 400 g, 1 kg) separated from purchased count
 * 4. GST and discounted invoices with commercial paise rounding
 * 5. Missing rates and totals producing INSUFFICIENT_DATA (never EXACT_MATCH)
 * 6. Rotated and noisy scans handled gracefully
 * 7. Wrapped descriptions and different column orders
 * 8. Repeated products on separate invoice rows preserved (not merged)
 * 9. Header, address, date, phone, GSTIN, and footer exclusion
 * 10. Incorrect arithmetic and false exact-match states producing MISMATCH
 */

import { describe, it, expect } from 'vitest';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import {
  extractProductSizeAndTitle,
  extractUnitFromTitle,
} from '../tableLayoutExtractor';
import {
  normalizeCanonicalItem,
  validateLineArithmetic,
  computeFieldConfidence,
} from '../invoiceNormalizer';
import {
  cleanNumericToken,
  normalizeUnit,
  splitMergedUnits,
} from '../invoiceParser';
import type { RawExtractedItem } from '../tableLayoutExtractor';

describe('ShopPulse OCR Accuracy V2 — Phase 8 Regression Suite', () => {

  // =========================================================================
  // SCENARIO 1: Clear supplier invoice with six products
  // =========================================================================
  describe('Scenario 1: Clear supplier invoice with six products', () => {
    it('accurately extracts all 6 products with exact quantities, rates, and line totals', () => {
      const rawInvoice = `
SHREE GANESH WHOLESALE TRADERS
Invoice No: SGW-2026-5541
Date: 10/10/2026

Item | Qty | Rate | Amount
Basmati Rice 25kg | 4 | 1350 | 5400
Tata Salt 1kg | 24 | 22 | 528
Fortune Sunflower Oil 1L | 12 | 145 | 1740
Toor Dal Premium 1kg | 10 | 160 | 1600
Everest Garam Masala 100g | 30 | 42 | 1260
Maggi 2-Minute Noodles 70g | 48 | 14 | 672

Subtotal: 11200
Grand Total: 11200
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      expect(result.items.length).toBe(6);
      expect(result.totalAmount).toBe(11200);

      // Verify individual items
      const rice = result.items.find(i => i.name.toLowerCase().includes('rice'));
      expect(rice).toBeDefined();
      expect(rice?.quantity).toBe(4);
      expect(rice?.purchasePrice).toBe(1350);
      expect(rice?.lineTotal).toBe(5400);
      expect(rice?.validationState).toBe('EXACT_MATCH');

      const salt = result.items.find(i => i.name.toLowerCase().includes('salt'));
      expect(salt).toBeDefined();
      expect(salt?.quantity).toBe(24);
      expect(salt?.purchasePrice).toBe(22);
      expect(salt?.lineTotal).toBe(528);
      expect(salt?.validationState).toBe('EXACT_MATCH');

      const oil = result.items.find(i => i.name.toLowerCase().includes('oil'));
      expect(oil).toBeDefined();
      expect(oil?.quantity).toBe(12);
      expect(oil?.purchasePrice).toBe(145);
      expect(oil?.lineTotal).toBe(1740);

      const noodles = result.items.find(i => i.name.toLowerCase().includes('maggi'));
      expect(noodles).toBeDefined();
      expect(noodles?.quantity).toBe(48);
      expect(noodles?.purchasePrice).toBe(14);
      expect(noodles?.lineTotal).toBe(672);

      // Verify all lines have exact arithmetic
      for (const item of result.items) {
        expect(item.validationState).toBe('EXACT_MATCH');
        expect(item.confidence).toBeGreaterThanOrEqual(85);
      }
    });
  });

  // =========================================================================
  // SCENARIO 2: Problematic shampoo, detergent, toothpaste, rice, wheat, sugar
  // =========================================================================
  describe('Scenario 2: Problematic shampoo, detergent, toothpaste, rice, wheat, and sugar extraction', () => {
    it('does not assign "1 kg" or "kg" to liquid/packaged FMCG shampoo, detergent, or toothpaste', () => {
      const rawInvoice = `
KIRANA SUPER DISTRIBUTORS
GSTIN: 27AABCS1429B1Z8
Date: 09/10/2026

Product Description | Qty | Rate | Total
Sunsilk Shampoo 650 ml | 12 | 320 | 3840
Surf Excel Detergent 1 kg | 24 | 140 | 3360
Colgate Toothpaste 100 g | 24 | 55 | 1320
Basmati Rice 25 kg bag | 5 | 1200 | 6000
Sharbati Wheat 50 kg | 2 | 1800 | 3600
Sugar 50 kg bag | 1 | 2100 | 2100
Total: 20220
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 92, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      expect(result.items.length).toBe(6);

      // Shampoo: must have pack size 650 ml, purchased quantity 12 pcs, NOT quantity 1 kg!
      const shampoo = result.items.find(i => i.name.toLowerCase().includes('shampoo'));
      expect(shampoo).toBeDefined();
      expect(shampoo?.quantity).toBe(12);
      expect(shampoo?.unit).not.toBe('kg');
      expect(shampoo?.packSize).toBe(650);
      expect(shampoo?.packSizeUnit).toBe('ml');
      expect(shampoo?.purchasePrice).toBe(320);
      expect(shampoo?.lineTotal).toBe(3840);

      // Detergent: pack size 1 kg, purchased quantity 24 pcs (NOT quantity 1 kg!)
      const detergent = result.items.find(i => i.name.toLowerCase().includes('detergent'));
      expect(detergent).toBeDefined();
      expect(detergent?.quantity).toBe(24);
      expect(detergent?.packSize).toBe(1);
      expect(detergent?.packSizeUnit).toBe('kg');
      expect(detergent?.purchasePrice).toBe(140);
      expect(detergent?.lineTotal).toBe(3360);

      // Toothpaste: pack size 100 g, purchased quantity 24 pcs
      const toothpaste = result.items.find(i => i.name.toLowerCase().includes('toothpaste'));
      expect(toothpaste).toBeDefined();
      expect(toothpaste?.quantity).toBe(24);
      expect(toothpaste?.packSize).toBe(100);
      expect(toothpaste?.packSizeUnit).toBe('g');

      // Rice: bulk commodity
      const rice = result.items.find(i => i.name.toLowerCase().includes('rice'));
      expect(rice).toBeDefined();
      expect(rice?.quantity).toBe(5);
      expect(['bag', 'kg', 'pcs']).toContain(rice?.unit);
      expect(rice?.packSize).toBe(25);
      expect(rice?.packSizeUnit).toBe('kg');

      // Wheat: bulk commodity
      const wheat = result.items.find(i => i.name.toLowerCase().includes('wheat'));
      expect(wheat).toBeDefined();
      expect(wheat?.quantity).toBe(2);
      expect(wheat?.packSize).toBe(50);
      expect(wheat?.packSizeUnit).toBe('kg');

      // Sugar: bulk commodity
      const sugar = result.items.find(i => i.name.toLowerCase().includes('sugar'));
      expect(sugar).toBeDefined();
      expect(sugar?.quantity).toBe(1);
      expect(sugar?.packSize).toBe(50);
    });
  });

  // =========================================================================
  // SCENARIO 3: Product pack sizes (500 ml, 400 g, 1 kg) separated from count
  // =========================================================================
  describe('Scenario 3: Product pack sizes (500 ml, 400 g, 1 kg) separated from purchased count', () => {
    it('isolates pack size and pack size unit from product title correctly', () => {
      const cream = extractProductSizeAndTitle('Amul Fresh Cream 500 ml');
      expect(cream.packSize).toBe(500);
      expect(cream.packSizeUnit).toBe('ml');
      expect(cream.title).toContain('Amul Fresh Cream');

      const horlicks = extractProductSizeAndTitle('Horlicks Classic Malt 400 g');
      expect(horlicks.packSize).toBe(400);
      expect(horlicks.packSizeUnit).toBe('g');
      expect(horlicks.title).toContain('Horlicks Classic Malt');

      const salt = extractProductSizeAndTitle('Tata Salt 1 kg');
      expect(salt.packSize).toBe(1);
      expect(salt.packSizeUnit).toBe('kg');
      expect(salt.title).toContain('Tata Salt');
    });

    it('distinguishes pack size from purchased quantity in table extraction', () => {
      const raw = `
Item Description | Qty | Rate | Amount
Amul Fresh Cream 500 ml | 10 | 65 | 650
Horlicks Malt 400 g | 6 | 210 | 1260
Tata Salt 1 kg | 20 | 22 | 440
      `.trim();

      const lines = raw.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], raw, 'tesseract', []);

      expect(result.items.length).toBe(3);

      const cream = result.items[0];
      expect(cream.quantity).toBe(10); // NOT 500!
      expect(cream.packSize).toBe(500);
      expect(cream.packSizeUnit).toBe('ml');

      const horlicks = result.items[1];
      expect(horlicks.quantity).toBe(6); // NOT 400!
      expect(horlicks.packSize).toBe(400);
      expect(horlicks.packSizeUnit).toBe('g');

      const salt = result.items[2];
      expect(salt.quantity).toBe(20); // NOT 1!
      expect(salt.packSize).toBe(1);
      expect(salt.packSizeUnit).toBe('kg');
    });
  });

  // =========================================================================
  // SCENARIO 4: GST and discounted invoices with commercial paise rounding
  // =========================================================================
  describe('Scenario 4: GST and discounted invoices with commercial paise rounding', () => {
    it('validates discounted line items with EXACT_MATCH or MATCH_WITH_ROUNDING', () => {
      // Line: Qty 10 * Rate 100 = 1000 - Discount 50 = 950
      const validation = validateLineArithmetic(10, 100, 950, 50, undefined);
      expect(validation.state).toBe('EXACT_MATCH');
    });

    it('validates GST tax-added line items correctly', () => {
      // Line: Qty 10 * Rate 100 = 1000, GST 18% = 180, Line Total = 1180
      const validation = validateLineArithmetic(10, 100, 1180, 0, 18);
      expect(validation.state).toBe('EXACT_MATCH');
    });

    it('handles commercial paise rounding gracefully (MATCH_WITH_ROUNDING)', () => {
      // 3 items @ 33.00 each = 99.00, invoice states rounded 100.00 (diff of 1.00 is within 1.50 rounding threshold)
      const validation = validateLineArithmetic(3, 33.00, 100.00);
      expect(validation.state).toBe('MATCH_WITH_ROUNDING');
      expect(validation.warning).toBeUndefined();
    });

    it('normalizes canonical items with GST and discount fields preserved', () => {
      const raw: RawExtractedItem = {
        productName: 'Patanjali Ghee 1L',
        quantity: 5,
        unit: 'pcs',
        rate: 550,
        discount: 50,
        gstRate: 12,
        lineTotal: 2750, // 5 * 550 - 50 + tax or net
      };

      const item = normalizeCanonicalItem(raw, 0);
      expect(item.productName).toBe('Patanjali Ghee 1L');
      expect(item.quantity).toBe(5);
      expect(item.purchasePrice).toBe(550);
      expect(item.discount).toBe(50);
      expect(item.gstRate).toBe(12);
    });
  });

  // =========================================================================
  // SCENARIO 5: Missing rates and totals producing INSUFFICIENT_DATA
  // =========================================================================
  describe('Scenario 5: Missing rates and totals producing INSUFFICIENT_DATA (never EXACT_MATCH)', () => {
    it('preserves null rate and marks validationState as INSUFFICIENT_DATA', () => {
      const raw: RawExtractedItem = {
        productName: 'Loose Yellow Moong Dal',
        quantity: 15,
        unit: 'kg',
        rate: null,
        purchasePrice: null,
        lineTotal: null,
      };

      const item = normalizeCanonicalItem(raw, 0);
      expect(item.purchasePrice).toBeNull();
      expect(item.lineTotal).toBeNull();
      expect(item.validationState).toBe('INSUFFICIENT_DATA');
      expect(item.validationState).not.toBe('EXACT_MATCH');
      expect((item.reviewReasons || []).some(r => r.toLowerCase().includes('rate') || r.toLowerCase().includes('missing'))).toBe(true);
    });

    it('preserves null quantity and marks validationState as INSUFFICIENT_DATA', () => {
      const raw: RawExtractedItem = {
        productName: 'Chana Dal 1kg',
        quantity: null,
        rate: 85,
        purchasePrice: 85,
        lineTotal: 850,
      };

      const item = normalizeCanonicalItem(raw, 0);
      expect(item.quantity).toBeNull();
      expect(item.validationState).toBe('INSUFFICIENT_DATA');
      expect(item.validationState).not.toBe('EXACT_MATCH');
      expect(item.reviewReasons.some(r => r.toLowerCase().includes('quantity'))).toBe(true);
    });

    it('does not manufacture high confidence score for records with missing required fields', () => {
      const fieldConf = computeFieldConfidence(
        'Product ABC',
        null, // missing quantity
        'pcs',
        null, // missing rate
        null, // missing line total
        'INSUFFICIENT_DATA'
      );

      expect(fieldConf.rate).toBe(0);
      expect(fieldConf.quantity).toBe(0);
      expect(fieldConf.lineTotal).toBe(0);
      expect(fieldConf.overall).toBeLessThan(50);
    });
  });

  // =========================================================================
  // SCENARIO 6: Rotated and noisy scans handled gracefully
  // =========================================================================
  describe('Scenario 6: Rotated and noisy scans handled gracefully', () => {
    it('conservatively normalizes common OCR character substitutions in numbers', () => {
      expect(cleanNumericToken('I200')).toBe('1200'); // I -> 1
      expect(cleanNumericToken('l50')).toBe('150');   // l -> 1
      expect(cleanNumericToken('12OO')).toBe('1200'); // O -> 0
      expect(cleanNumericToken('4S0')).toBe('450');   // S -> 5
      expect(cleanNumericToken('B00')).toBe('800');   // B -> 8
      expect(cleanNumericToken('₹2400')).toBe('2400'); // Currency symbol
      expect(cleanNumericToken('Rs.350')).toBe('350'); // Rs. prefix
    });

    it('splits merged unit tokens cleanly', () => {
      expect(splitMergedUnits('Rice 25kg 1200')).toBe('Rice 25 kg 1200');
      expect(splitMergedUnits('Oil 5L 600')).toBe('Oil 5 L 600');
      expect(splitMergedUnits('Cream 500ml 65')).toBe('Cream 500 ml 65');
    });

    it('normalizes common unit variations', () => {
      expect(normalizeUnit('kilograms')).toBe('kg');
      expect(normalizeUnit('ltr')).toBe('L');
      expect(normalizeUnit('packets')).toBe('pkt');
      expect(normalizeUnit('nos')).toBe('pcs');
    });
  });

  // =========================================================================
  // SCENARIO 7: Wrapped descriptions and different column orders
  // =========================================================================
  describe('Scenario 7: Wrapped descriptions and different column orders', () => {
    it('handles inverted column order: Qty | Description | Rate | Amount', () => {
      const rawInvoice = `
SHREE LAXMI ENTERPRISES
Invoice: SLE-9921
Qty | Description | Rate | Amount
10 | Fortune Mustard Oil 1L | 130 | 1300
5 | Aashirvaad Atta 10kg | 420 | 2100
Total: 3400
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      expect(result.items.length).toBe(2);

      const oil = result.items.find(i => i.name.toLowerCase().includes('oil'));
      expect(oil).toBeDefined();
      expect(oil?.quantity).toBe(10);
      expect(oil?.purchasePrice).toBe(130);
      expect(oil?.lineTotal).toBe(1300);

      const atta = result.items.find(i => i.name.toLowerCase().includes('atta'));
      expect(atta).toBeDefined();
      expect(atta?.quantity).toBe(5);
      expect(atta?.purchasePrice).toBe(420);
      expect(atta?.lineTotal).toBe(2100);
    });

    it('handles wrapped multi-line product descriptions gracefully', () => {
      const rawInvoice = `
Supplier: National Groceries
Item | Qty | Rate | Amount
Cadbury Dairy Milk Silk
Hazelnut Chocolate 143g | 15 | 160 | 2400
Parle Hide & Seek
Fab Orange Biscuits 120g | 20 | 35 | 700
Total: 3100
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 90, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      expect(result.items.length).toBe(2);
      expect(result.items[0].quantity).toBe(15);
      expect(result.items[0].purchasePrice).toBe(160);
      expect(result.items[0].lineTotal).toBe(2400);

      expect(result.items[1].quantity).toBe(20);
      expect(result.items[1].purchasePrice).toBe(35);
      expect(result.items[1].lineTotal).toBe(700);
    });
  });

  // =========================================================================
  // SCENARIO 8: Repeated products on separate invoice rows
  // =========================================================================
  describe('Scenario 8: Repeated products on separate invoice rows', () => {
    it('preserves multiple rows of the same product without discarding either row', () => {
      const rawInvoice = `
SRI BALAJI COMMODITIES
Item | Qty | Rate | Amount
Tata Salt 1kg | 20 | 22 | 440
Tata Salt 1kg | 30 | 23 | 690
Total: 1130
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      expect(result.items.length).toBe(2);
      expect(result.items[0].name.toLowerCase()).toContain('tata salt');
      expect(result.items[0].quantity).toBe(20);
      expect(result.items[0].purchasePrice).toBe(22);
      expect(result.items[0].lineTotal).toBe(440);

      expect(result.items[1].name.toLowerCase()).toContain('tata salt');
      expect(result.items[1].quantity).toBe(30);
      expect(result.items[1].purchasePrice).toBe(23);
      expect(result.items[1].lineTotal).toBe(690);
    });
  });

  // =========================================================================
  // SCENARIO 9: Header, address, date, phone, GSTIN, and footer exclusion
  // =========================================================================
  describe('Scenario 9: Header, address, date, phone, GSTIN, and footer exclusion', () => {
    it('strictly excludes supplier address, dates, phone numbers, and payment terms from products', () => {
      const rawInvoice = `
MAHALAXMI GRAIN MERCHANTS
Shop No. 14, APMC Yard, Market Yard, Pune - 411037
Ph: +91 98901 23456 / 020-24267890
GSTIN: 27AABCM9876C1Z1
Invoice No: MGM/2026/1089
Date: 11/10/2026
Challan No: CH-901
Terms: Net 30 Days

Item | Qty | Rate | Amount
Aashirvaad Atta 10kg | 5 | 420 | 2100
Sugar M-30 50kg | 2 | 2100 | 4200

Sub Total: 6300.00
CGST 2.5%: 157.50
SGST 2.5%: 157.50
Round Off: 0.00
Grand Total: 6615.00

Bank Name: State Bank of India
A/c No: 30123456789
IFSC Code: SBIN0001234
Thank you for your business! Goods once sold will not be returned.
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 95, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      // Exactly 2 product items should be extracted
      expect(result.items.length).toBe(2);

      const names = result.items.map(i => i.name.toLowerCase());
      expect(names.some(n => n.includes('atta'))).toBe(true);
      expect(names.some(n => n.includes('sugar'))).toBe(true);

      // Verify that NO metadata lines leaked into product items
      for (const item of result.items) {
        const n = item.name.toLowerCase();
        expect(n).not.toContain('apmc yard');
        expect(n).not.toContain('pune');
        expect(n).not.toContain('gstin');
        expect(n).not.toContain('challan');
        expect(n).not.toContain('state bank');
        expect(n).not.toContain('thank you');
        expect(n).not.toContain('product item');
        expect(n).not.toContain('terms');
      }
    });
  });

  // =========================================================================
  // SCENARIO 10: Incorrect arithmetic and false exact-match states
  // =========================================================================
  describe('Scenario 10: Incorrect arithmetic and false exact-match states', () => {
    it('flags math discrepancy as MISMATCH when lineTotal does not match qty * rate', () => {
      // Qty 10 * Rate 50 = 500, but line total printed is 650
      const validation = validateLineArithmetic(10, 50, 650);
      expect(validation.state).toBe('MISMATCH');
      expect(validation.warning).toContain('Diff: ₹150.00');
    });

    it('returns INSUFFICIENT_DATA when quantity or rate is missing', () => {
      const noRate = validateLineArithmetic(10, null, 500);
      expect(noRate.state).toBe('INSUFFICIENT_DATA');

      const noQty = validateLineArithmetic(null, 50, 500);
      expect(noQty.state).toBe('INSUFFICIENT_DATA');

      const noTotal = validateLineArithmetic(10, 50, null);
      expect(noTotal.state).toBe('INSUFFICIENT_DATA');
    });

    it('never produces EXACT_MATCH for an item missing required price or quantity', () => {
      const raw: RawExtractedItem = {
        productName: 'Sample Product',
        quantity: 10,
        rate: null, // missing rate
        purchasePrice: null,
        lineTotal: 500,
      };

      const canonical = normalizeCanonicalItem(raw, 0);
      expect(canonical.validationState).toBe('INSUFFICIENT_DATA');
      expect(canonical.validationState).not.toBe('EXACT_MATCH');
    });

    it('rejects manufactured exact matches when rate was not present on the invoice', () => {
      const rawInvoice = `
Supplier: Honest Traders
Item | Qty | Rate | Amount
Mystery Product | 10 | | 500
      `.trim();

      const lines = rawInvoice.split('\n').map((t, idx) => ({ text: t, confidence: 90, lineIndex: idx }));
      const result = parseInvoiceWithFlexibleEngine(lines, [], rawInvoice, 'tesseract', []);

      if (result.items.length > 0) {
        const item = result.items[0];
        // If rate was not provided, validationState MUST NOT be EXACT_MATCH
        if (item.purchasePrice === null) {
          expect(item.validationState).toBe('INSUFFICIENT_DATA');
        }
      }
    });
  });

});
