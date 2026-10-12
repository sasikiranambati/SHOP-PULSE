/**
 * @file hybridVerifiedPipeline.test.ts
 * @description Comprehensive test suite for the Verified Hybrid Pipeline:
 * - Packaging separation (Fortune 500 GM, Godrej White 240 GM)
 * - Strict schema preservation & unit disambiguation
 * - Arithmetic validation without trusting multiplication alone
 * - Independent verification between Vision and OCR
 * - Missing rates & safety against premature canonical commitment
 */

import { describe, it, expect } from 'vitest';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import {
  extractProductSizeAndTitle,
  extractUnitFromTitle,
  type RawExtractedItem,
} from '../tableLayoutExtractor';
import {
  normalizeCanonicalItem,
  validateLineArithmetic,
} from '../invoiceNormalizer';
import { matchCanonicalItemsWithInventory } from '../inventoryMatcher';
import { mapBackendItemToCanonical } from '../../api/invoice';
import { validateInvoiceItems } from '../../pages/InvoiceScanner';
import type { Product } from '../../types/product';

describe('ShopPulse Verified Hybrid Pipeline & Packaging Separation', () => {
  // =========================================================================
  // 1. Packaging Separation (Fortune 500 GM & Godrej White 240 GM)
  // =========================================================================
  describe('1. Packaging Separation', () => {
    it('separates purchased quantity (20) from pack size (500 g) for FORTUNE 500 GM', () => {
      const rawLine = 'FORTUNE 500 GM | 20 | 70 | 1400';
      const lines = [
        { text: 'Item | Qty | Rate | Amount', confidence: 95, lineIndex: 0 },
        { text: rawLine, confidence: 95, lineIndex: 1 },
      ];

      const result = parseInvoiceWithFlexibleEngine(lines, [], rawLine, 'tesseract', []);
      expect(result.items.length).toBe(1);

      const item = result.items[0];
      expect(item.name).toContain('FORTUNE 500 GM');
      expect(item.quantity).toBe(20);
      expect(item.purchasedQuantity).toBe(20);
      expect(item.packSize).toBe(500);
      expect(item.packSizeUnit).toBe('g');
      // The unit must NOT be 'g' simply because product title has 500 GM
      expect(item.unit).not.toBe('g');
      expect(item.purchasePrice).toBe(70);
      expect(item.lineTotal).toBe(1400);
    });

    it('separates purchased quantity (10) from pack size (240 g) for Godrej White 240 GM', () => {
      const rawLine = 'Godrej White 240 GM | 10 | 45 | 450';
      const lines = [
        { text: 'Item | Qty | Rate | Amount', confidence: 95, lineIndex: 0 },
        { text: rawLine, confidence: 95, lineIndex: 1 },
      ];

      const result = parseInvoiceWithFlexibleEngine(lines, [], rawLine, 'tesseract', []);
      expect(result.items.length).toBe(1);

      const item = result.items[0];
      expect(item.name).toContain('Godrej White 240 GM');
      expect(item.quantity).toBe(10);
      expect(item.purchasedQuantity).toBe(10);
      expect(item.packSize).toBe(240);
      expect(item.packSizeUnit).toBe('g');
      // The unit must NOT be 'g'
      expect(item.unit).not.toBe('g');
      expect(item.purchasePrice).toBe(45);
      expect(item.lineTotal).toBe(450);
    });

    it('extractUnitFromTitle never returns weight or volume pack units as purchase units', () => {
      expect(extractUnitFromTitle('FORTUNE 500 GM')).toBeNull();
      expect(extractUnitFromTitle('Godrej White 240 GM')).toBeNull();
      expect(extractUnitFromTitle('Amul Milk 1 Ltr')).toBeNull();
      expect(extractUnitFromTitle('Aashirvaad Atta 5kg')).toBeNull();

      // Explicit container units are correctly recognized
      expect(extractUnitFromTitle('Tata Tea Premium 10 Pcs')).toBe('pcs');
      expect(extractUnitFromTitle('Marie Gold 24 Pkt')).toBe('pkt');
      expect(extractUnitFromTitle('Bournvita Jar 1 Box')).toBe('box');
    });
  });

  // =========================================================================
  // 2. Missing Rates & Canonical Confirmation Guard
  // =========================================================================
  describe('2. Missing Rates & Safe Canonical Matching', () => {
    it('marks line items with missing rates as INSUFFICIENT_DATA', () => {
      const rawItem: RawExtractedItem = {
        productName: 'Surf Excel Quick Wash 1kg',
        quantity: 10,
        rate: null,
        purchasePrice: null,
        lineTotal: 1400,
        sourceText: 'Surf Excel Quick Wash 1kg | 10 | | 1400',
        extractionMethod: 'TABLE_STRUCTURED',
      };

      const normalized = normalizeCanonicalItem(rawItem, 0);
      expect(normalized.rate).toBeNull();
      expect(normalized.purchasePrice).toBeNull();
      expect(normalized.validationState).toBe('INSUFFICIENT_DATA');
      expect(normalized.validationIssues).toBeDefined();
      expect(normalized.validationIssues?.some(i => i.toLowerCase().includes('rate'))).toBe(true);
    });

    it('never automatically marks a high-similarity product as confirmed if rate is missing', () => {
      const storeProducts: Product[] = [
        {
          id: 'prod_surf_1',
          name: 'Surf Excel Quick Wash 1kg',
          category: 'Household',
          price: 150,
          purchasePrice: 135,
          stock: 25,
          unit: 'pcs',
        },
      ];

      const canonicalItem = normalizeCanonicalItem({
        productName: 'Surf Excel Quick Wash 1kg',
        quantity: 10,
        rate: null,
        purchasePrice: null,
        lineTotal: 1350,
        sourceText: 'Surf Excel Quick Wash 1kg 10 1350',
        extractionMethod: 'TABLE_STRUCTURED',
      }, 0);

      const matched = matchCanonicalItemsWithInventory([canonicalItem], storeProducts);
      expect(matched.length).toBe(1);
      // High score matches product id for convenience, BUT isMatchConfirmed MUST be false!
      expect(matched[0].matchedProductId).toBe('prod_surf_1');
      expect(matched[0].isMatchConfirmed).toBe(false);
    });
  });

  // =========================================================================
  // 3. Mathematical Validation & Multi-Dimensional Arithmetic
  // =========================================================================
  describe('3. Multi-Dimensional Arithmetic Validation', () => {
    it('validates exact multiplication without discounts or taxes', () => {
      const check = validateLineArithmetic(20, 70, 1400);
      expect(check.status).toBe('VERIFIED');
      expect(check.state).toBe('EXACT_MATCH');
      expect(check.warning).toBeUndefined();
    });

    it('validates lines with trade discount applied', () => {
      // 20 * 70 = 1400 - 100 discount = 1300 line total
      const check = validateLineArithmetic(20, 70, 1300, 100);
      expect(check.status).toBe('VERIFIED');
      expect(check.state).toBe('EXACT_MATCH');
    });

    it('validates lines with GST tax applied', () => {
      // 10 * 100 = 1000 + 18% GST (180) = 1180 line total
      const check = validateLineArithmetic(10, 100, 1180, 0, 18);
      expect(check.status).toBe('VERIFIED');
      expect(check.state).toBe('EXACT_MATCH');
    });

    it('flags arithmetic discrepancies as MISMATCH', () => {
      // 20 * 70 = 1400 != 1550
      const check = validateLineArithmetic(20, 70, 1550);
      expect(check.status).toBe('MISMATCH');
      expect(check.state).toBe('MISMATCH');
      expect(check.warning).toContain('Arithmetic discrepancy');
    });
  });

  // =========================================================================
  // 4. Backend Strict Schema Mapping
  // =========================================================================
  describe('4. Backend Response Mapping to Canonical Item', () => {
    it('maps backend strict schema fields onto canonical item correctly', () => {
      const backendItem = {
        id: 'item_fortune_123',
        product_name: 'FORTUNE 500 GM',
        source_row_text: 'FORTUNE 500 GM | 20 | 70 | 1400',
        purchased_quantity: 20,
        purchase_unit: null,
        pack_size: 500,
        pack_size_unit: 'g',
        unit_rate: 70,
        line_total: 1400,
        validation_status: 'NEEDS_REVIEW',
        review_reasons: ['Quantity unit not established on invoice; please confirm if pieces or packs.'],
        confidence: 88,
        confidence_level: 'HIGH',
        needs_review: true,
      };

      const canon = mapBackendItemToCanonical(backendItem);
      expect(canon.productName).toBe('FORTUNE 500 GM');
      expect(canon.purchasedQuantity).toBe(20);
      expect(canon.quantity).toBe(20);
      expect(canon.purchaseUnit).toBeNull();
      expect(canon.packSize).toBe(500);
      expect(canon.packSizeUnit).toBe('g');
      expect(canon.rate).toBe(70);
      expect(canon.purchasePrice).toBe(70);
      expect(canon.lineTotal).toBe(1400);
      expect(canon.validationState).toBe('NEEDS_REVIEW');
      expect(canon.reviewReasons?.length).toBeGreaterThan(0);
      expect(canon.needsReview).toBe(true);
    });
  });

  // =========================================================================
  // 5. Inventory Import Guard (validateInvoiceItems)
  // =========================================================================
  describe('5. Inventory Import Guard', () => {
    it('blocks import when unit or rate is missing until user provides correction', () => {
      const incompleteItem = {
        id: 'item_inc_1',
        name: 'FORTUNE 500 GM',
        category: 'Groceries',
        quantity: 20,
        unit: '', // Missing unit
        purchasePrice: null, // Missing rate
        sellingPrice: 85,
        lineTotal: 1400,
        confidence: 70,
        confidenceLevel: 'LOW' as const,
        lowConfidence: true,
      };

      const errors = validateInvoiceItems([incompleteItem]);
      expect(errors.length).toBe(1);
      const issues = errors[0].issues;
      expect(issues.some(i => i.toLowerCase().includes('unit is required'))).toBe(true);
      expect(issues.some(i => i.toLowerCase().includes('purchase price is required'))).toBe(true);
    });

    it('passes validation when item is corrected with positive price and unit', () => {
      const validItem = {
        id: 'item_valid_1',
        name: 'FORTUNE 500 GM',
        category: 'Groceries',
        quantity: 20,
        unit: 'pcs',
        purchasePrice: 70,
        sellingPrice: 85,
        lineTotal: 1400,
        confidence: 95,
        confidenceLevel: 'HIGH' as const,
        lowConfidence: false,
      };

      const errors = validateInvoiceItems([validItem]);
      expect(errors.length).toBe(0);
    });
  });
});
