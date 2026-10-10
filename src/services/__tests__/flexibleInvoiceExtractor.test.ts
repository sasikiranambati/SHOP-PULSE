/**
 * @file flexibleInvoiceExtractor.test.ts
 * @description Comprehensive test suite validating ShopPulse Flexible Multi-Format Invoice Extraction.
 * Covers all 12 required invoice formats:
 * 1. Item | Qty | Rate | Amount
 * 2. Description | HSN | Qty | Rate | GST | Total
 * 3. Product | Units | Price | Amount
 * 4. Particulars | Quantity | Unit Rate | Net Amount
 * 5. Product | MRP | Discount | Qty | Taxable Value (out-of-order columns)
 * 6. Multi-line invoice items (wrapped description & stacked values)
 * 7. Invoices with no formal table (free text / informal bills)
 * 8. Poorly aligned OCR / Arbitrary column order (Qty | Product | Amount | Rate)
 * 9. PDF with selectable text (Digital PDF stream extraction)
 * 10. Image-only / Scanned PDF fallback
 * 11. Photograph of invoice (noisy symbols, character substitutions)
 * 12. Multilingual invoice (Hindi, Telugu, Tamil headings & product descriptions)
 *
 * Validates canonical schema, arithmetic checks, and 3-tier inventory matching.
 */

import { describe, it, expect } from 'vitest';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { identifyColumnType } from '../semanticColumnDetector';
import { normalizeCanonicalItem } from '../invoiceNormalizer';
import { matchCanonicalItemsWithInventory, stringSimilarity } from '../inventoryMatcher';
import { isDisallowedItemLine } from '../sectionClassifier';
import type { Product } from '../../types/product';

const MOCK_STORE_PRODUCTS: Product[] = [
  {
    id: 'prod_1',
    name: 'Tata Salt 1kg',
    category: 'Groceries',
    stock: 50,
    unit: 'pcs',
    purchasePrice: 22,
    sellingPrice: 28,
    price: 28,
    reorderLevel: 10,
    minStock: 10,
    status: 'In Stock',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'prod_2',
    name: 'Fortune Sunflower Oil 1L',
    category: 'Groceries',
    stock: 25,
    unit: 'pcs',
    purchasePrice: 135,
    sellingPrice: 160,
    price: 160,
    reorderLevel: 10,
    minStock: 10,
    status: 'In Stock',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'prod_3',
    name: 'Basmati Rice (5kg)',
    category: 'Groceries',
    stock: 30,
    unit: 'bag',
    purchasePrice: 450,
    sellingPrice: 550,
    price: 550,
    reorderLevel: 5,
    minStock: 5,
    status: 'In Stock',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'prod_4',
    name: 'Amul Milk 500ml',
    category: 'Dairy',
    stock: 40,
    unit: 'pcs',
    purchasePrice: 25,
    sellingPrice: 27,
    price: 27,
    reorderLevel: 15,
    minStock: 15,
    status: 'In Stock',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Semantic Column Identification & Aliases', () => {
  it('identifies diverse semantic aliases across English and Indian languages', () => {
    expect(identifyColumnType('Item Description')).toBe('productName');
    expect(identifyColumnType('Particulars')).toBe('productName');
    expect(identifyColumnType('विवरण')).toBe('productName');
    expect(identifyColumnType('వస్తువు')).toBe('productName');

    expect(identifyColumnType('Qty')).toBe('quantity');
    expect(identifyColumnType('Billed Qty')).toBe('quantity');
    expect(identifyColumnType('Units')).toBe('quantity');
    expect(identifyColumnType('मात्रा')).toBe('quantity');

    expect(identifyColumnType('Rate')).toBe('unitPrice');
    expect(identifyColumnType('Unit Price')).toBe('unitPrice');
    expect(identifyColumnType('Price/Unit')).toBe('unitPrice');
    expect(identifyColumnType('दर')).toBe('unitPrice');

    expect(identifyColumnType('Net Amount')).toBe('total');
    expect(identifyColumnType('Line Total')).toBe('total');
    expect(identifyColumnType('Taxable Value')).toBe('taxableAmount');
    expect(identifyColumnType('HSN/SAC Code')).toBe('hsn');
    expect(identifyColumnType('GST %')).toBe('gstRate');
    expect(identifyColumnType('MRP')).toBe('mrp');
    expect(identifyColumnType('Disc %')).toBe('discount');
  });
});

describe('Document Section & Header/Footer Filtering', () => {
  it('strictly excludes totals, taxes, and footer lines from becoming products', () => {
    expect(isDisallowedItemLine('Grand Total: ₹5400.00')).toBe(true);
    expect(isDisallowedItemLine('Subtotal 4800')).toBe(true);
    expect(isDisallowedItemLine('CGST @ 2.5% 120.00')).toBe(true);
    expect(isDisallowedItemLine('SGST @ 2.5% 120.00')).toBe(true);
    expect(isDisallowedItemLine('Round Off 0.50')).toBe(true);
    expect(isDisallowedItemLine('Balance Due: 0.00')).toBe(true);
    expect(isDisallowedItemLine('Terms & Conditions Apply')).toBe(true);
    expect(isDisallowedItemLine('Authorized Signatory')).toBe(true);
    expect(isDisallowedItemLine('GSTIN: 29AAAAA1234A1Z5')).toBe(true);
    expect(isDisallowedItemLine('Thank You! Visit Again')).toBe(true);

    // Regular product lines MUST NOT be disallowed
    expect(isDisallowedItemLine('Rice 25kg 1200')).toBe(false);
    expect(isDisallowedItemLine('Tata Salt 1kg 24 22 528')).toBe(false);
  });
});

describe('12 Benchmark Invoice Formats', () => {
  // -------------------------------------------------------------------------
  // FORMAT 1: Item | Qty | Rate | Amount
  // -------------------------------------------------------------------------
  it('Format 1: processes standard Item | Qty | Rate | Amount', () => {
    const raw = `
METRO WHOLESALE CASH & CARRY
Invoice No: MCC-2026-101
Date: 22/09/2026
Item | Qty | Rate | Amount
Rice 25kg | 2 | 1200 | 2400
Sugar Premium | 10 | 45 | 450
Fortune Oil 1L | 5 | 135 | 675
Total Amount: 3525
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.supplierName).toContain('METRO WHOLESALE');
    expect(parsed.invoiceNumber).toBe('MCC-2026-101');
    expect(parsed.invoiceDate).toBe('22/09/2026');
    expect(parsed.items.length).toBe(3);

    const rice = parsed.items.find((i) => i.name.toLowerCase().includes('rice'));
    expect(rice).toBeDefined();
    expect(rice?.quantity).toBe(2);
    expect(rice?.purchasePrice).toBe(1200);
    expect(rice?.lineTotal).toBe(2400);

    expect(parsed.totalAmount).toBe(3525);
  });

  // -------------------------------------------------------------------------
  // FORMAT 2: Description | HSN | Qty | Rate | GST | Total
  // -------------------------------------------------------------------------
  it('Format 2: processes Description | HSN | Qty | Rate | GST | Total without HSN scrambling columns', () => {
    const raw = `
SRI LAKSHMI ENTERPRISES WHOLESALE
GSTIN: 29AAAAA1234A1Z5
Invoice No: SLE-BLR-8942
Date: 19/09/2026
Description | HSN | Qty | Rate | GST | Total
Basmati Rice 25kg | 1006 | 2 | 1400 | 140 | 2940
Sugar Premium | 1701 | 10 | 45 | 22.5 | 472.5
Sunflower Oil 5L | 1514 | 4 | 650 | 130 | 2730
Grand Total: 6142.50
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.supplierName).toContain('SRI LAKSHMI ENTERPRISES');
    expect(parsed.invoiceNumber).toBe('SLE-BLR-8942');
    expect(parsed.items.length).toBe(3);

    const rice = parsed.items[0];
    expect(rice.quantity).toBe(2);
    expect(rice.purchasePrice).toBe(1400); // Must NOT be 1006 or 140!
    expect(rice.lineTotal).toBe(2940);
    expect(rice.hsnCode).toBe('1006');

    expect(parsed.totalAmount).toBe(6142.5);
  });

  // -------------------------------------------------------------------------
  // FORMAT 3: Product | Units | Price | Amount
  // -------------------------------------------------------------------------
  it('Format 3: processes Product | Units | Price | Amount', () => {
    const raw = `
BALAJI TRADING CO
Bill No: BTC-9912
Date: 14/09/2026
Product | Units | Price | Amount
Tata Salt 1kg | 24 | 22 | 528
Good Day Biscuit | 36 | 18 | 648
Total Amount: 1176
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);
    const salt = parsed.items[0];
    expect(salt.name).toContain('Tata Salt');
    expect(salt.quantity).toBe(24);
    expect(salt.purchasePrice).toBe(22);
    expect(salt.lineTotal).toBe(528);
    expect(parsed.totalAmount).toBe(1176);
  });

  // -------------------------------------------------------------------------
  // FORMAT 4: Particulars | Quantity | Unit Rate | Net Amount
  // -------------------------------------------------------------------------
  it('Format 4: processes Particulars | Quantity | Unit Rate | Net Amount', () => {
    const raw = `
KIRAN ENTERPRISES
Invoice No: KE-5501
Date: 10/09/2026
Particulars | Quantity | Unit Rate | Net Amount
Toor Dal 1kg | 15 | 145 | 2175
Moong Dal 1kg | 10 | 110 | 1100
Net Amount: 3275
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].name).toContain('Toor Dal');
    expect(parsed.items[0].quantity).toBe(15);
    expect(parsed.items[0].purchasePrice).toBe(145);
    expect(parsed.items[0].lineTotal).toBe(2175);
    expect(parsed.totalAmount).toBe(3275);
  });

  // -------------------------------------------------------------------------
  // FORMAT 5: Product | MRP | Discount | Qty | Taxable Value (Out-of-order)
  // -------------------------------------------------------------------------
  it('Format 5: processes out-of-order columns (Product | MRP | Discount | Qty | Taxable Value)', () => {
    const raw = `
SHIVAM PHARMA & COSMETICS
Invoice #: SPC-782
Date: 11/09/2026
Product | MRP | Discount | Qty | Taxable Value
Dettol Soap 125g | 60 | 5 | 20 | 1100
Colgate MaxFresh | 120 | 10 | 15 | 1650
Grand Total: 2750
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);
    const soap = parsed.items[0];
    expect(soap.name).toContain('Dettol Soap');
    expect(soap.mrp).toBe(60);
    expect(soap.discount).toBe(5);
    expect(soap.quantity).toBe(20);
    expect(soap.taxableAmount).toBe(1100);
  });

  // -------------------------------------------------------------------------
  // FORMAT 6: Multi-Line Invoice Items
  // -------------------------------------------------------------------------
  it('Format 6: reconstructs multi-line wrapped product descriptions into single products', () => {
    const raw = `
RELIANCE WHOLESALE MART
Inv No: RWM-2026-442
Date: 16/09/2026
Aashirvaad Superior MP Atta
5kg Pack
2 BAG
₹250
₹500
Fortune Sunlite Refined Oil
1 Litre Pouch
6 PKT
₹135
₹810
Total: 1310
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);

    const atta = parsed.items[0];
    expect(atta.name).toContain('Aashirvaad');
    expect(atta.name).toContain('Atta');
    expect(atta.quantity).toBe(2);
    expect(atta.unit).toBe('bag');
    expect(atta.purchasePrice).toBe(250);
    expect(atta.lineTotal).toBe(500);

    const oil = parsed.items[1];
    expect(oil.name).toContain('Fortune');
    expect(oil.quantity).toBe(6);
    expect(oil.unit).toBe('pkt');
    expect(oil.purchasePrice).toBe(135);
    expect(oil.lineTotal).toBe(810);
  });

  // -------------------------------------------------------------------------
  // FORMAT 7: Invoice with No Formal Table (Free Text / Memo)
  // -------------------------------------------------------------------------
  it('Format 7: processes informal invoices with no table structure', () => {
    const raw = `
SRI BALAJI STORES
Date: 15/09/2026
Bill # 8821
1 Rice 5kg 2 bags 500 1000
2 Tata Salt 1kg 5 pcs 25 125
3 Sugar 10 450
Total: 1575
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(3);

    const rice = parsed.items[0];
    expect(rice.name.toLowerCase()).toContain('rice');
    expect(rice.quantity).toBe(2);
    expect(rice.unit).toBe('bag');
    expect(rice.purchasePrice).toBe(500);
    expect(rice.lineTotal).toBe(1000);

    const salt = parsed.items[1];
    expect(salt.name.toLowerCase()).toContain('tata salt');
    expect(salt.quantity).toBe(5);
    expect(salt.purchasePrice).toBe(25);
    expect(salt.lineTotal).toBe(125);
  });

  // -------------------------------------------------------------------------
  // FORMAT 8: Poorly Aligned OCR / Arbitrary Column Permutations
  // -------------------------------------------------------------------------
  it('Format 8: handles column permutation (Qty | Product | Amount | Rate)', () => {
    const raw = `
MODERN WHOLESALE TRADERS
Invoice No: MWT-402
Date: 12/09/2026
Qty | Product | Amount | Rate
10 | Sugar | 450 | 45
2 | Basmati Rice 25kg | 2400 | 1200
Total Amount: 2850
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);

    const sugar = parsed.items.find((i) => i.name.toLowerCase().includes('sugar'));
    expect(sugar).toBeDefined();
    expect(sugar?.quantity).toBe(10);
    expect(sugar?.purchasePrice).toBe(45);
    expect(sugar?.lineTotal).toBe(450);

    const rice = parsed.items.find((i) => i.name.toLowerCase().includes('rice'));
    expect(rice).toBeDefined();
    expect(rice?.quantity).toBe(2);
    expect(rice?.purchasePrice).toBe(1200);
    expect(rice?.lineTotal).toBe(2400);
  });

  // -------------------------------------------------------------------------
  // FORMAT 9: Digital PDF with Selectable Text
  // -------------------------------------------------------------------------
  it('Format 9: processes digital text stream with pdf_direct engine flag', () => {
    const digitalText = `
METRO CASH & CARRY INDIA PVT LTD
TAX INVOICE
GSTIN: 29AACCM9912D1Z0
Invoice No: MCC/2026/8941
Date: 20/09/2026
Item Description | HSN | Qty | Rate | Taxable Amount | Total
Fortune Sunflower Oil 1L | 1514 | 15 | 135 | 2025 | 2025
Tata Salt 1kg | 2106 | 24 | 22 | 528 | 528
Sub Total: 2553.00
Grand Total: 2553.00
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], digitalText, 'pdf_direct', MOCK_STORE_PRODUCTS);

    expect(parsed.engineUsed).toBe('pdf_direct');
    expect(parsed.items.length).toBe(2);
    expect(parsed.totalAmount).toBe(2553);
  });

  // -------------------------------------------------------------------------
  // FORMAT 10: Scanned PDF Fallback
  // -------------------------------------------------------------------------
  it('Format 10: falls back to OCR parsing when PDF has no selectable text', () => {
    const scannedOcrText = `
TAX INVOICE
BHAGWATI TRADERS
Bill No: BT-301
Date: 18/09/2026
Amul Butter 100g 10 50 500
Amul Milk 500ml 20 25 500
Total: 1000
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], scannedOcrText, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(2);
    expect(parsed.totalAmount).toBe(1000);
    expect(parsed.items[0].purchasePrice).toBe(50);
  });

  // -------------------------------------------------------------------------
  // FORMAT 11: Photograph of Invoice (Noisy OCR, Letter Substitutions)
  // -------------------------------------------------------------------------
  it('Format 11: handles noisy photograph scan with character confusions (0 <-> O, 1 <-> I)', () => {
    const noisyPhotoText = `
*# CASH MEMO #*
GUPTA PROVISIONS STORE
Date: 10-09-2026
Invoice No: GPS-102
| 1 | Surf Excel 1kg | 1 | 14O | 14O |
| 2 | Parle-G Biscuit | 1O | 1O | 1OO |
| Total: 240 |
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], noisyPhotoText, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.supplierName).toContain('GUPTA PROVISIONS');
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].name).toContain('Surf Excel');
    expect(parsed.items[0].purchasePrice).toBe(140);
    expect(parsed.items[1].quantity).toBe(10);
    expect(parsed.items[1].purchasePrice).toBe(10);
  });

  // -------------------------------------------------------------------------
  // FORMAT 12: Multilingual Invoices (Hindi & Telugu headings and items)
  // -------------------------------------------------------------------------
  it('Format 12: processes multilingual invoices without rejecting non-English characters', () => {
    const multilingualText = `
श्री गणेश किराना स्टोर्स
GSTIN: 27AABCS1429E1Z8
Invoice No: SGK-8812
Date: 21/09/2026
विवरण | मात्रा | दर | कुल
चावल बासमती (Rice) | 2 | 500 | 1000
अरहर दाल (Toor Dal) | 5 | 140 | 700
బియ్యం (Rice Pack) | 1 | 1200 | 1200
कुल राशि: 2900
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], multilingualText, 'tesseract', MOCK_STORE_PRODUCTS);

    expect(parsed.items.length).toBe(3);

    const item1 = parsed.items[0];
    expect(item1.name).toContain('चावल');
    expect(item1.quantity).toBe(2);
    expect(item1.purchasePrice).toBe(500);
    expect(item1.lineTotal).toBe(1000);

    const item3 = parsed.items[2];
    expect(item3.name).toContain('బియ్యం');
    expect(item3.quantity).toBe(1);
    expect(item3.purchasePrice).toBe(1200);

    expect(parsed.totalAmount).toBe(2900);
  });
});

describe('Product Normalization & Inventory Matching', () => {
  it('corrects OCR typos in product names for fuzzy matching', () => {
    // "Tata Sa1t" -> "Tata Salt"
    const score1 = stringSimilarity('Tata Sa1t', 'Tata Salt 1kg');
    expect(score1).toBeGreaterThanOrEqual(0.85);

    // "R1ce" -> "Basmati Rice"
    const score2 = stringSimilarity('R1ce', 'Basmati Rice (5kg)');
    expect(score2).toBeGreaterThanOrEqual(0.6);
  });

  it('enforces 3 confidence tiers for matching without silently committing uncertain products', () => {
    const canonicalItems = [
      normalizeCanonicalItem(
        {
          productName: 'Tata Salt 1kg',
          quantity: 10,
          purchasePrice: 22,
          lineTotal: 220,
          confidence: 95,
          sourceText: 'Tata Salt 1kg 10 22 220',
          extractionMethod: 'TABLE_STRUCTURED',
        },
        0
      ),
      normalizeCanonicalItem(
        {
          productName: 'Rice Brand Unknown',
          quantity: 2,
          purchasePrice: 300,
          lineTotal: 600,
          confidence: 75,
          sourceText: 'Rice Brand Unknown 2 300 600',
          extractionMethod: 'TEXT_LINE_ITEM',
        },
        1
      ),
    ];

    const matched = matchCanonicalItemsWithInventory(canonicalItems, MOCK_STORE_PRODUCTS);

    // 1. High match auto-matches
    expect(matched[0].matchedProductId).toBe('prod_1');
    expect(matched[0].isMatchConfirmed).toBe(true);

    // 2. Uncertain match does NOT auto-commit
    expect(matched[1].matchedProductId).toBeUndefined();
  });
});

describe('Multi-Page Invoices & Repeated Header Suppression (Phase 23)', () => {
  it('suppresses repeated page headers and page indicators across multiple pages', () => {
    const multiPageOcrText = `
METRO WHOLESALE CASH & CARRY
Invoice No: MCC-2026-901
Date: 25/09/2026
Page 1 of 2
Item | Qty | Rate | Amount
Basmati Rice 25kg | 2 | 1200 | 2400
Sugar Premium | 10 | 45 | 450
Page 1 of 2 End

METRO WHOLESALE CASH & CARRY
Invoice No: MCC-2026-901
Date: 25/09/2026
Page 2 of 2
Item | Qty | Rate | Amount
Fortune Oil 1L | 5 | 135 | 675
Tata Salt 1kg | 24 | 22 | 528
Page 2 of 2
Subtotal: 4053
Grand Total: 4053
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], multiPageOcrText, 'tesseract', MOCK_STORE_PRODUCTS);

    // Should extract all 4 products across both pages
    expect(parsed.items.length).toBe(4);
    // Page indicators or headers must NOT become items
    expect(parsed.items.some(i => i.name.toLowerCase().includes('page'))).toBe(false);
    expect(parsed.items.some(i => i.name.toLowerCase().includes('metro wholesale'))).toBe(false);

    expect(parsed.totalAmount).toBe(4053);
  });
});

describe('Mathematical Validation & Confidence Penalties (Phase 12 & 17)', () => {
  it('flags items with arithmetic discrepancy and downgrades confidence level to LOW', () => {
    const invalidMathRaw = {
      productName: 'Organic Honey 500g',
      quantity: 2,
      purchasePrice: 200,
      lineTotal: 900, // 2 * 200 = 400 != 900
      sourceText: 'Organic Honey 500g 2 200 900',
      extractionMethod: 'TABLE_STRUCTURED' as const,
      confidence: 85,
    };

    const normalized = normalizeCanonicalItem(invalidMathRaw, 0);

    expect(normalized.confidenceLevel).toBe('LOW');
    expect(normalized.validationIssues).toBeDefined();
    expect(normalized.validationIssues?.some(i => i.includes('does not match quantity × rate'))).toBe(true);
    // Printed values are kept and the difference is reported, never "corrected"
    expect(normalized.lineTotal).toBe(900);
    expect(normalized.quantity).toBe(2);
    expect(normalized.calculatedAmount).toBe(400);
    expect(normalized.amountDifference).toBe(500);
    expect(normalized.arithmeticStatus).toBe('MISMATCH');
  });

  it('boosts confidence when unitPrice * quantity precisely matches lineTotal', () => {
    const validMathRaw = {
      productName: 'Sunflower Oil 1L',
      quantity: 5,
      purchasePrice: 135,
      lineTotal: 675, // 5 * 135 = 675
      sourceText: 'Sunflower Oil 1L 5 135 675',
      extractionMethod: 'TABLE_STRUCTURED' as const,
      confidence: 85,
    };

    const normalized = normalizeCanonicalItem(validMathRaw, 0);

    expect(normalized.confidenceLevel).toBe('HIGH');
    expect(normalized.confidence).toBeGreaterThanOrEqual(90);
    expect(normalized.validationIssues).toBeUndefined();
  });
});

describe('Strict Value Preservation (Phase 13 & 16)', () => {
  it('preserves sellingPrice as null instead of fabricating or setting to 0', () => {
    const raw = {
      productName: 'Maggi Noodles 280g',
      quantity: 12,
      purchasePrice: 40,
      lineTotal: 480,
      sourceText: 'Maggi Noodles 280g 12 40 480',
      extractionMethod: 'TEXT_LINE_ITEM' as const,
      confidence: 85,
    };

    const normalized = normalizeCanonicalItem(raw, 0);

    expect(normalized.sellingPrice).toBeNull();
    expect(normalized.sellingPrice).not.toBe(0);
    expect(normalized.purchasePrice).toBe(40);
  });
});

describe('Comprehensive Price Extraction, Mapping, and Preservation (Sections 1-23)', () => {
  it('Section 9: extracts all price columns separately (Purchase Rate, Selling Rate, MRP, Amount)', () => {
    const raw = `
SHREE GANESH WHOLESALE DISTRIBUTORS
Invoice No: SGW-8812
Date: 01/10/2026
Product | Qty | Purchase Rate | Selling Rate | MRP | Amount
Aashirvaad Atta 5kg | 10 | 250 | 280 | 300 | 2500
Tata Salt 1kg | 20 | 25 | 28 | 30 | 500
Total Amount: 3000
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(2);

    const atta = parsed.items[0];
    expect(atta.name).toContain('Aashirvaad Atta');
    expect(atta.quantity).toBe(10);
    expect(atta.purchasePrice).toBe(250);
    expect(atta.sellingPrice).toBe(280);
    expect(atta.mrp).toBe(300);
    expect(atta.lineTotal).toBe(2500);

    // Verify raw values are preserved
    expect(atta.rawPurchasePrice).toBe(250);
    expect(atta.rawSellingPrice).toBe(280);
    expect(atta.rawMrp).toBe(300);

    const salt = parsed.items[1];
    expect(salt.purchasePrice).toBe(25);
    expect(salt.sellingPrice).toBe(28);
    expect(salt.mrp).toBe(30);
    expect(salt.lineTotal).toBe(500);
  });

  it('Section 10: invoice with only Rate and Amount (Purchase = rate, Selling = null, MRP = null)', () => {
    const raw = `
KIRAN ENTERPRISES
Invoice No: KE-101
Date: 01/10/2026
Product | Qty | Rate | Amount
Rice 10kg | 10 | 250 | 2500
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const rice = parsed.items[0];
    expect(rice.quantity).toBe(10);
    expect(rice.purchasePrice).toBe(250);
    expect(rice.sellingPrice).toBeNull();
    expect(rice.sellingPrice).not.toBe(0);
    expect(rice.mrp).toBeNull();
    expect(rice.mrp).not.toBe(0);
    expect(rice.lineTotal).toBe(2500);
  });

  it('Section 11: invoice with MRP + Selling Price + Amount (Purchase = null, Selling = sale price, MRP = MRP)', () => {
    const raw = `
SUPER BAZAAR RETAIL
Bill No: SB-500
Date: 01/10/2026
Product | Qty | MRP | Sale Price | Amount
Britannia Good Day | 5 | 30 | 28 | 140
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.quantity).toBe(5);
    expect(item.mrp).toBe(30);
    expect(item.sellingPrice).toBe(28);
    expect(item.purchasePrice).toBeNull(); // Must NOT be derived or mapped to MRP!
    expect(item.lineTotal).toBe(140);
  });

  it('Section 12: invoice with Rate + MRP (Purchase = rate, MRP = mrp, Selling = null)', () => {
    const raw = `
WHOLESALE DEPOT
Bill No: WD-707
Date: 01/10/2026
Product | Qty | Rate | MRP | Amount
Everest Turmeric 500g | 20 | 120 | 150 | 2400
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.quantity).toBe(20);
    expect(item.purchasePrice).toBe(120);
    expect(item.mrp).toBe(150);
    expect(item.sellingPrice).toBeNull();
    expect(item.lineTotal).toBe(2400);
  });

  it('Section 14: parses out-of-order columns correctly (Product | MRP | Qty | Selling | Rate | Amount)', () => {
    const raw = `
INVOICE PERMUTATION 1
Bill No: IP-1
Product | MRP | Qty | Selling Price | Buy Rate | Amount
Sunflower Oil 1L | 180 | 10 | 160 | 135 | 1350
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.quantity).toBe(10);
    expect(item.mrp).toBe(180);
    expect(item.sellingPrice).toBe(160);
    expect(item.purchasePrice).toBe(135);
    expect(item.lineTotal).toBe(1350);
  });

  it('Section 14: parses out-of-order columns correctly (Product | Selling | MRP | Qty | Rate | Amount)', () => {
    const raw = `
INVOICE PERMUTATION 2
Bill No: IP-2
Product | Selling Rate | Maximum Retail Price | Quantity | Cost Price | Net Amount
Basmati Rice 5kg | 550 | 600 | 5 | 450 | 2250
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.quantity).toBe(5);
    expect(item.sellingPrice).toBe(550);
    expect(item.mrp).toBe(600);
    expect(item.purchasePrice).toBe(450);
    expect(item.lineTotal).toBe(2250);
  });

  it('Section 14: parses out-of-order columns correctly (Product | Qty | Amount | MRP | Rate)', () => {
    const raw = `
INVOICE PERMUTATION 3
Bill No: IP-3
Product | Qty | Line Total | MRP | Unit Price
Toor Dal 1kg | 8 | 1200 | 160 | 150
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.quantity).toBe(8);
    expect(item.lineTotal).toBe(1200);
    expect(item.mrp).toBe(160);
    expect(item.purchasePrice).toBe(150);
    expect(item.sellingPrice).toBeNull();
  });

  it('Section 19: preserves invoice prices and attaches inventoryData without overwriting during matching', () => {
    // Invoice has Tata Salt: Purchase 25, Selling 28, MRP 30
    // Mock Store has Tata Salt: Purchase 22, Selling 28
    const raw = `
SUPPLIER BILL
Bill No: SB-99
Product | Qty | Purchase Rate | Selling Rate | MRP | Amount
Tata Salt 1kg | 20 | 25 | 28 | 30 | 500
    `.trim();

    const parsed = parseInvoiceWithFlexibleEngine([], [], raw, 'tesseract', MOCK_STORE_PRODUCTS);
    expect(parsed.items.length).toBe(1);

    const item = parsed.items[0];
    expect(item.matchedProductId).toBe('prod_1');
    // Invoice extracted values MUST NOT be overwritten by mock store's 22!
    expect(item.purchasePrice).toBe(25);
    expect(item.sellingPrice).toBe(28);
    expect(item.mrp).toBe(30);

    // Existing store catalog prices must be preserved in inventoryData for side-by-side comparison
    expect(item.inventoryData).toBeDefined();
    expect(item.inventoryData?.storePurchasePrice).toBe(22);
    expect(item.inventoryData?.storeSellingPrice).toBe(28);
  });
});


