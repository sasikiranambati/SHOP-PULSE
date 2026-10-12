import { describe, it, expect } from 'vitest';
import {
  extractPackagingInfo,
  parseQuantityAndUnit,
  parsePriceToken,
  detectTableColumnsFromHeaders,
  inferColumnsFromSpatialLayout,
  validateStructuredRow,
  extractStructuredProductRows,
  convertStructuredRowsToLineItems,
} from '../productTableScanner';
import type { OCRLine, OCRWord } from '../ocrService';
import type { StructuredProductRow } from '../invoiceTypes';
import type { Product } from '../../types/product';

// Helper to construct simulated OCR lines with bounding boxes
function createMockLine(
  text: string,
  y: number,
  wordConfigs: Array<{ text: string; x0: number; x1: number; confidence?: number }>
): OCRLine {
  const words: OCRWord[] = wordConfigs.map((cfg) => ({
    text: cfg.text,
    confidence: cfg.confidence ?? 95,
    bbox: {
      x0: cfg.x0,
      y0: y,
      x1: cfg.x1,
      y1: y + 25,
    },
  }));

  return {
    text,
    confidence: 95,
    bbox: {
      x0: Math.min(...words.map((w) => w.bbox.x0)),
      y0: y,
      x1: Math.max(...words.map((w) => w.bbox.x1)),
      y1: y + 25,
    },
    words,
  };
}

describe('Product Table Scanner V2', () => {
  // =========================================================================
  // PHASE 5: PACKAGING AND QUANTITY SEPARATION
  // =========================================================================
  describe('Packaging vs Purchased Quantity Separation', () => {
    it('separates pack size from title without conflating with purchased quantity', () => {
      const p1 = extractPackagingInfo('FRUIT BISCUITS 400');
      expect(p1.packSize).toBe(400);
      expect(p1.packSizeUnit).toBeNull();

      const p2 = extractPackagingInfo('Shampoo 1 L');
      expect(p2.packSize).toBe(1);
      expect(p2.packSizeUnit).toBe('L');

      const p3 = extractPackagingInfo('Rice 25 kg bag');
      expect(p3.packSize).toBe(25);
      expect(p3.packSizeUnit).toBe('kg');

      const p4 = extractPackagingInfo('LUX 10');
      expect(p4.packSize).toBe(10);
      expect(p4.packSizeUnit).toBeNull();

      const p5 = extractPackagingInfo('AYUR SHAMPOO(B)');
      expect(p5.packSize).toBeNull();
      expect(p5.packSizeUnit).toBeNull();
    });

    it('correctly distinguishes purchased count from pack size in lines', () => {
      // "Shampoo 1 L | 12 Nos | 100 | 1200" -> 12 purchased bottles, 1 L pack size
      const parsed = parseQuantityAndUnit('12 Nos');
      expect(parsed.quantity).toBe(12);
      expect(parsed.unit).toBe('Nos');

      // "Rice 25 kg bag | 5 bags | 900 | 4500" -> 5 bags, 25 kg pack size
      const parsedBag = parseQuantityAndUnit('5 bags');
      expect(parsedBag.quantity).toBe(5);
      expect(parsedBag.unit).toBe('bag');
    });

    it('never extracts packaging grams/milliliters as purchased quantity', () => {
      const parsed = parseQuantityAndUnit('Qty: 3 Nos');
      expect(parsed.quantity).toBe(3);
      expect(parsed.unit).toBe('Nos');
    });
  });

  // =========================================================================
  // PHASE 6: VALIDATION ENGINE
  // =========================================================================
  describe('Validation Engine', () => {
    it('grants EXACT_MATCH only when arithmetic matches and no review reasons exist', () => {
      const validRow: StructuredProductRow = {
        productName: 'FRUIT BISCUITS 400',
        purchasedQuantity: 1,
        purchaseUnit: 'Nos',
        packSize: 400,
        packSizeUnit: null,
        mrp: null,
        purchaseRate: 165,
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 165,
        confidence: { productName: 95, quantity: 95, unit: 95, rate: 95, lineTotal: 95 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(validRow);
      expect(result.validationStatus).toBe('EXACT_MATCH');
      expect(result.reviewReasons).toHaveLength(0);
    });

    it('flags MISMATCH when quantity × rate does not equal line total', () => {
      const mismatchRow: StructuredProductRow = {
        productName: 'SPICY BISCUIT',
        purchasedQuantity: 3,
        purchaseUnit: 'Nos',
        packSize: null,
        packSizeUnit: null,
        mrp: null,
        purchaseRate: 25,
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 100, // Expected 75
        confidence: { productName: 90, quantity: 90, unit: 90, rate: 90, lineTotal: 90 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(mismatchRow);
      expect(result.validationStatus).toBe('MISMATCH');
      expect(result.reviewReasons.some((r) => r.includes('Arithmetic discrepancy'))).toBe(true);
    });

    it('sets INSUFFICIENT_DATA when quantity or rate is missing', () => {
      const missingRateRow: StructuredProductRow = {
        productName: 'HAIR SPA SHAMPOO',
        purchasedQuantity: 1,
        purchaseUnit: 'Nos',
        packSize: null,
        packSizeUnit: null,
        mrp: null,
        purchaseRate: null, // missing rate
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 690,
        confidence: { productName: 90, quantity: 90, unit: 90, rate: 0, lineTotal: 90 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(missingRateRow);
      expect(result.validationStatus).toBe('INSUFFICIENT_DATA');
      expect(result.reviewReasons.some((r) => r.includes('Purchase rate is missing'))).toBe(true);
    });

    it('flags MATCH_WITH_ROUNDING for minor rounding fractions', () => {
      const roundingRow: StructuredProductRow = {
        productName: 'WHOLE GRAIN FLOUR',
        purchasedQuantity: 3,
        purchaseUnit: 'kg',
        packSize: null,
        packSizeUnit: null,
        mrp: null,
        purchaseRate: 33.33,
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 100.0, // 3 * 33.33 = 99.99
        confidence: { productName: 90, quantity: 90, unit: 90, rate: 90, lineTotal: 90 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(roundingRow);
      expect(result.validationStatus).toBe('MATCH_WITH_ROUNDING');
    });
  });

  // =========================================================================
  // PHASE 8: REFERENCE INVOICE TEST FIXTURE (5 ROWS)
  // =========================================================================
  describe('Phase 8 Reference Invoice Test Fixture', () => {
    it('correctly extracts and validates all 5 reference invoice rows and matches 1117 total', () => {
      const tableWidth = 1000;

      // Header: Item Description (x: 50-400) | Qty (x: 450-550) | Rate (x: 600-750) | Amount (x: 800-950)
      const headerLine = createMockLine('Item Description Qty Rate Amount', 100, [
        { text: 'Item', x0: 50, x1: 150 },
        { text: 'Description', x0: 160, x1: 350 },
        { text: 'Qty', x0: 480, x1: 540 },
        { text: 'Rate', x0: 650, x1: 720 },
        { text: 'Amount', x0: 820, x1: 920 },
      ]);

      const columns = detectTableColumnsFromHeaders(headerLine, tableWidth);
      expect(columns.length).toBeGreaterThanOrEqual(4);

      // 5 Reference rows
      const row1 = createMockLine('FRUIT BISCUITS 400 1 Nos 165 165', 150, [
        { text: 'FRUIT', x0: 50, x1: 120 },
        { text: 'BISCUITS', x0: 130, x1: 230 },
        { text: '400', x0: 240, x1: 290 },
        { text: '1', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '165', x0: 650, x1: 710 },
        { text: '165', x0: 820, x1: 880 },
      ]);

      const row2 = createMockLine('HAIR SPA SHAMPOO 1 Nos 690 690', 190, [
        { text: 'HAIR', x0: 50, x1: 110 },
        { text: 'SPA', x0: 120, x1: 170 },
        { text: 'SHAMPOO', x0: 180, x1: 300 },
        { text: '1', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '690', x0: 650, x1: 710 },
        { text: '690', x0: 820, x1: 880 },
      ]);

      const row3 = createMockLine('SPICY BISCUIT 3 Nos 25 75', 230, [
        { text: 'SPICY', x0: 50, x1: 130 },
        { text: 'BISCUIT', x0: 140, x1: 250 },
        { text: '3', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '25', x0: 660, x1: 690 },
        { text: '75', x0: 830, x1: 860 },
      ]);

      const row4 = createMockLine('LUX 10 5 Nos 10 50', 270, [
        { text: 'LUX', x0: 50, x1: 100 },
        { text: '10', x0: 110, x1: 140 },
        { text: '5', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '10', x0: 660, x1: 690 },
        { text: '50', x0: 830, x1: 860 },
      ]);

      const row5 = createMockLine('AYUR SHAMPOO(B) 1 Nos 137 137', 310, [
        { text: 'AYUR', x0: 50, x1: 120 },
        { text: 'SHAMPOO(B)', x0: 130, x1: 280 },
        { text: '1', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '137', x0: 650, x1: 710 },
        { text: '137', x0: 820, x1: 880 },
      ]);

      const rows = extractStructuredProductRows([row1, row2, row3, row4, row5], columns);
      expect(rows).toHaveLength(5);

      // Row 1: FRUIT BISCUITS 400 | Qty 1 Nos | Rate 165 | Amount 165
      expect(rows[0].productName).toBe('FRUIT BISCUITS 400');
      expect(rows[0].purchasedQuantity).toBe(1);
      expect(rows[0].purchaseUnit).toBe('Nos');
      expect(rows[0].packSize).toBe(400);
      expect(rows[0].purchaseRate).toBe(165);
      expect(rows[0].lineTotal).toBe(165);
      expect(rows[0].validationStatus).toBe('EXACT_MATCH');

      // Row 2: HAIR SPA SHAMPOO | Qty 1 Nos | Rate 690 | Amount 690
      expect(rows[1].productName).toBe('HAIR SPA SHAMPOO');
      expect(rows[1].purchasedQuantity).toBe(1);
      expect(rows[1].purchaseUnit).toBe('Nos');
      expect(rows[1].purchaseRate).toBe(690);
      expect(rows[1].lineTotal).toBe(690);
      expect(rows[1].validationStatus).toBe('EXACT_MATCH');

      // Row 3: SPICY BISCUIT | Qty 3 Nos | Rate 25 | Amount 75
      expect(rows[2].productName).toBe('SPICY BISCUIT');
      expect(rows[2].purchasedQuantity).toBe(3);
      expect(rows[2].purchaseUnit).toBe('Nos');
      expect(rows[2].purchaseRate).toBe(25);
      expect(rows[2].lineTotal).toBe(75);
      expect(rows[2].validationStatus).toBe('EXACT_MATCH');

      // Row 4: LUX 10 | Qty 5 Nos | Rate 10 | Amount 50
      expect(rows[3].productName).toBe('LUX 10');
      expect(rows[3].purchasedQuantity).toBe(5);
      expect(rows[3].purchaseUnit).toBe('Nos');
      expect(rows[3].packSize).toBe(10);
      expect(rows[3].purchaseRate).toBe(10);
      expect(rows[3].lineTotal).toBe(50);
      expect(rows[3].validationStatus).toBe('EXACT_MATCH');

      // Row 5: AYUR SHAMPOO(B) | Qty 1 Nos | Rate 137 | Amount 137
      expect(rows[4].productName).toBe('AYUR SHAMPOO(B)');
      expect(rows[4].purchasedQuantity).toBe(1);
      expect(rows[4].purchaseUnit).toBe('Nos');
      expect(rows[4].purchaseRate).toBe(137);
      expect(rows[4].lineTotal).toBe(137);
      expect(rows[4].validationStatus).toBe('EXACT_MATCH');

      // Expected total: 1117 (165 + 690 + 75 + 50 + 137)
      const totalAmount = rows.reduce((acc, r) => acc + (r.lineTotal || 0), 0);
      expect(totalAmount).toBe(1117);
    });
  });

  // =========================================================================
  // MISSING HEADERS & VARYING COLUMN ORDERS
  // =========================================================================
  describe('Missing Headers and Layout Robustness', () => {
    it('infers columns from spatial alignment when header row is missing', () => {
      const tableWidth = 1000;
      const row1 = createMockLine('TEA POWDER 2 Nos 80 160', 150, [
        { text: 'TEA', x0: 50, x1: 100 },
        { text: 'POWDER', x0: 110, x1: 220 },
        { text: '2', x0: 480, x1: 500 },
        { text: 'Nos', x0: 505, x1: 535 },
        { text: '80', x0: 660, x1: 690 },
        { text: '160', x0: 830, x1: 880 },
      ]);

      const inferredCols = inferColumnsFromSpatialLayout([row1], tableWidth);
      expect(inferredCols.length).toBeGreaterThanOrEqual(2);

      const rows = extractStructuredProductRows([row1], inferredCols, true);
      expect(rows).toHaveLength(1);
      expect(rows[0].productName).toBe('TEA POWDER');
      expect(rows[0].purchasedQuantity).toBe(2);
      expect(rows[0].purchaseRate).toBe(80);
      expect(rows[0].lineTotal).toBe(160);
      // Because header was inferred, it must flag for review
      expect(rows[0].reviewReasons.some((r) => r.includes('missing'))).toBe(true);
      expect(rows[0].validationStatus).toBe('NEEDS_REVIEW');
    });

    it('supports different column orders (e.g. Item | Rate | Qty | Amount)', () => {
      const tableWidth = 1000;
      // Inverted: Rate before Qty!
      const headerLine = createMockLine('Product Rate Qty Amount', 100, [
        { text: 'Product', x0: 50, x1: 250 },
        { text: 'Rate', x0: 450, x1: 530 },
        { text: 'Qty', x0: 650, x1: 720 },
        { text: 'Amount', x0: 820, x1: 920 },
      ]);

      const columns = detectTableColumnsFromHeaders(headerLine, tableWidth);
      const rateCol = columns.find((c) => c.type === 'unitPrice' || c.type === 'purchasePrice');
      const qtyCol = columns.find((c) => c.type === 'quantity');

      expect(rateCol).toBeDefined();
      expect(qtyCol).toBeDefined();
      expect(rateCol!.minX).toBeLessThan(qtyCol!.minX);

      const row = createMockLine('SOAP BAR 40 4 160', 150, [
        { text: 'SOAP', x0: 50, x1: 120 },
        { text: 'BAR', x0: 130, x1: 180 },
        { text: '40', x0: 470, x1: 510 },
        { text: '4', x0: 670, x1: 690 },
        { text: '160', x0: 840, x1: 890 },
      ]);

      const rows = extractStructuredProductRows([row], columns);
      expect(rows).toHaveLength(1);
      expect(rows[0].purchaseRate).toBe(40);
      expect(rows[0].purchasedQuantity).toBe(4);
      expect(rows[0].lineTotal).toBe(160);
      expect(rows[0].validationStatus).toBe('EXACT_MATCH');
    });
  });

  // =========================================================================
  // INVENTORY INTEGRATION SAFETY
  // =========================================================================
  describe('Inventory Integration Safety', () => {
    it('does not auto-confirm matching when rate is missing', () => {
      const mockStoreProducts: Product[] = [
        {
          id: 'prod_123',
          name: 'SPICY BISCUIT',
          category: 'Snacks',
          price: 30,
          sellingPrice: 30,
          purchasePrice: 22,
          stock: 15,
          unit: 'pcs',
        },
      ];

      const rowWithoutRate: StructuredProductRow = {
        productName: 'SPICY BISCUIT',
        purchasedQuantity: 3,
        purchaseUnit: 'Nos',
        packSize: null,
        packSizeUnit: null,
        mrp: null,
        purchaseRate: null, // missing rate
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 75,
        confidence: { productName: 90, quantity: 90, unit: 90, rate: 0, lineTotal: 90 },
        validationStatus: 'INSUFFICIENT_DATA',
        reviewReasons: ['Purchase rate is missing.'],
      };

      const lineItems = convertStructuredRowsToLineItems([rowWithoutRate], mockStoreProducts);
      expect(lineItems).toHaveLength(1);
      expect(lineItems[0].matchedProductId).toBe('prod_123');
      // Critical requirement: isMatchConfirmed MUST NOT be true when rate is missing!
      expect(lineItems[0].isMatchConfirmed).toBe(false);
      // Selling price must NOT be overwritten with purchase rate!
      expect(lineItems[0].sellingPrice).toBe(30);
      expect(lineItems[0].purchasePrice).toBeNull();
    });
  });

  // =========================================================================
  // ADDITIONAL EDGE CASES: DECIMAL PRICES, PACKAGING AMBIGUITY, FRAGMENTS
  // =========================================================================
  describe('Edge Cases and Conservative Rules', () => {
    it('handles decimal prices and fractional quantities correctly', () => {
      const decimalRow: StructuredProductRow = {
        productName: 'SUNFLOWER COOKING OIL',
        purchasedQuantity: 2.5,
        purchaseUnit: 'L',
        packSize: 1,
        packSizeUnit: 'L',
        mrp: 180,
        purchaseRate: 140.5,
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 351.25, // 2.5 * 140.50 = 351.25
        confidence: { productName: 92, quantity: 92, unit: 92, rate: 92, lineTotal: 92 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(decimalRow);
      expect(result.validationStatus).toBe('EXACT_MATCH');
      expect(result.lineTotal).toBe(351.25);
    });

    it('flags row for review when packaged product has unestablished purchase unit', () => {
      const ambiguousPackRow: StructuredProductRow = {
        productName: 'FORTUNE ATTA 5 KG',
        purchasedQuantity: 4,
        purchaseUnit: null, // unit unestablished
        packSize: 5,
        packSizeUnit: 'kg',
        mrp: 260,
        purchaseRate: 240,
        sellingPrice: null,
        discount: null,
        taxRate: null,
        lineTotal: 960, // 4 * 240 = 960
        confidence: { productName: 90, quantity: 90, unit: 0, rate: 90, lineTotal: 90 },
        validationStatus: 'NEEDS_REVIEW',
        reviewReasons: [],
      };

      const result = validateStructuredRow(ambiguousPackRow);
      expect(result.validationStatus).toBe('NEEDS_REVIEW');
      expect(result.reviewReasons.some((r) => r.includes('Purchase unit not established'))).toBe(true);
    });
  });
});
