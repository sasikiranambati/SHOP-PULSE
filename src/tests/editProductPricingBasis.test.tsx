import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Product } from '../types/product';
import type { UnitRegistry } from '../api/units';
import { createUnitIndex, convertBasisQuantityUsingRegistry } from '../utils/unitRegistry';
import { validateProductForm } from '../utils/validators';
import {
  resolveUnitChange,
  validateEditPricingBasis,
  buildProductUpdatePayload,
  getInitialPricingBasisState,
  hasPricingOrUnitChanges,
} from '../utils/productEditPricing';

const registry: UnitRegistry = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/unit_registry.json'), 'utf8'),
);
const unitIndex = createUnitIndex(registry);

let mockShopRole = { isCashier: false, isOwner: true, isManager: false, role: 'OWNER' as const };

vi.mock('../hooks/useUnitRegistry', () => ({
  useUnitRegistry: () => ({ index: unitIndex, status: 'ready' as const }),
}));

vi.mock('../hooks/useShopRole', () => ({
  useShopRole: () => mockShopRole,
}));

vi.mock('../i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string) =>
      ({
        'addProductModal.category': 'Category',
        'addProductModal.minStockAlert': 'Min Stock Alert',
        'addProductModal.unit': 'Unit',
      }[k] ?? k),
  }),
}));

vi.mock('../api/products', () => ({
  productsApi: {
    updateProduct: vi.fn().mockResolvedValue({}),
  },
}));

import { EditProductModal } from '../components/EditProductModal';
import { updateProduct as serviceUpdateProduct, mapBackendProductToFrontend } from '../services/inventoryService';
import { productsApi } from '../api/products';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Sugar Loose',
    category: 'Groceries',
    stock: 25,
    unit: 'kg',
    sellingPrice: 60,
    price: 60,
    purchasePrice: 48,
    mrp: 70,
    reorderLevel: 5,
    minStock: 5,
    status: 'In Stock',
    priceBasisQuantity: 1,
    priceBasisUnit: 'kg',
    mrpBasisQuantity: 1,
    mrpBasisUnit: 'kg',
    pricingStatus: 'VERIFIED',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Stage 3D: EditProductModal & pricing-basis compatibility', () => {
  beforeEach(() => {
    mockShopRole = { isCashier: false, isOwner: true, isManager: false, role: 'OWNER' };
    vi.mocked(productsApi.updateProduct).mockReset().mockResolvedValue({} as any);
  });

  // -------------------------------------------------------------------------
  // Test Group A — Normal edits
  // -------------------------------------------------------------------------
  it('Group A: normal name and stock edits preserve pricing and omit pricing fields from update payload', async () => {
    const product = makeProduct({ stock: 2.5, unit: 'kg', priceBasisQuantity: 1, priceBasisUnit: 'kg' });
    const html = renderToStaticMarkup(
      <EditProductModal isOpen product={product} onClose={vi.fn()} onUpdateProduct={vi.fn()} />,
    );
    expect(html).toContain('Verified Pricing');
    expect(html).toContain('per 1 kg');
    expect(html).not.toContain('data-testid="confirm-pricing-basis"');

    // Fractional stock on kg succeeds cleanly
    const formCheck = validateProductForm(
      {
        name: 'Refined Sugar',
        category: 'Groceries',
        sellingPrice: '60',
        purchasePrice: '48',
        stock: '12.5',
        minStock: '5',
        unit: 'kg',
        barcode: '',
      },
      { allowFractionalStock: true },
    );
    expect(formCheck.errors).toEqual({});
    expect(formCheck.parsed?.stock).toBe(12.5);

    const basisCheck = validateEditPricingBasis('kg', 60, getInitialPricingBasisState(product), unitIndex);
    expect(basisCheck.isValid).toBe(true);
    expect(hasPricingOrUnitChanges(product, formCheck.parsed!, basisCheck.parsed!, unitIndex)).toBe(false);

    const updates = buildProductUpdatePayload(product, formCheck.parsed!, basisCheck.parsed!, unitIndex);
    expect(updates.name).toBe('Refined Sugar');
    expect(updates.stock).toBe(12.5);
    expect(updates.unit).toBeUndefined();
    expect(updates.sellingPrice).toBeUndefined();
    expect(updates.priceBasisQuantity).toBeUndefined();
    expect(updates.priceBasisUnit).toBeUndefined();
    expect(updates.mrp).toBeUndefined();

    await serviceUpdateProduct('prod-1', updates);
    expect(productsApi.updateProduct).toHaveBeenCalledWith('prod-1', {
      name: 'Refined Sugar',
      category: 'Groceries',
      purchase_price: 48,
      current_stock: 12.5,
      reorder_level: 5,
    });
  });

  // -------------------------------------------------------------------------
  // Test Group B — Compatible unit changes (kg <-> g, L <-> ml)
  // -------------------------------------------------------------------------
  it('Group B: converts kg <-> g and L <-> ml using canonical registry without altering stock', async () => {
    const product = makeProduct({ stock: 5, sellingPrice: 60, mrp: 70, unit: 'kg', priceBasisQuantity: 1, priceBasisUnit: 'kg' });
    const resKgToG = resolveUnitChange(product, 'g', getInitialPricingBasisState(product), unitIndex);
    expect(resKgToG.kind).toBe('compatible_converted');
    expect(resKgToG.nextBasis.priceBasisQuantity).toBe('1000');
    expect(resKgToG.nextBasis.priceBasisUnit).toBe('g');
    expect(resKgToG.nextBasis.mrpBasisQuantity).toBe('1000');
    expect(resKgToG.nextBasis.mrpBasisUnit).toBe('g');
    expect(resKgToG.noticeMessage).toContain('Stock quantity was not altered');

    // Reverting g -> kg restores 1 kg cleanly
    const reverted = resolveUnitChange(product, 'kg', resKgToG.nextBasis, unitIndex, false);
    expect(reverted.kind).toBe('unchanged');
    expect(reverted.nextBasis.priceBasisQuantity).toBe('1');
    expect(reverted.nextBasis.priceBasisUnit).toBe('kg');

    // Build payload for kg -> g update and send through service
    const parsedForm = {
      name: 'Sugar Loose',
      category: 'Groceries',
      sellingPrice: 60,
      purchasePrice: 48,
      stock: 5, // stock intentionally unchanged
      minStock: 5,
      unit: 'g',
    };
    const basisValid = validateEditPricingBasis('g', 60, resKgToG.nextBasis, unitIndex);
    expect(basisValid.isValid).toBe(true);
    const payload = buildProductUpdatePayload(product, parsedForm, basisValid.parsed!, unitIndex);
    expect(payload).toMatchObject({
      unit: 'g',
      sellingPrice: 60,
      priceBasisQuantity: 1000,
      priceBasisUnit: 'g',
      mrp: 70,
      mrpBasisQuantity: 1000,
      mrpBasisUnit: 'g',
      stock: 5,
    });

    await serviceUpdateProduct('prod-1', payload);
    expect(productsApi.updateProduct).toHaveBeenCalledWith(
      'prod-1',
      expect.objectContaining({
        unit: 'g',
        selling_price: 60,
        price_basis_quantity: 1000,
        price_basis_unit: 'g',
        mrp: 70,
        mrp_basis_quantity: 1000,
        mrp_basis_unit: 'g',
        current_stock: 5,
      }),
    );

    // L -> ml and ml -> L
    const oilL = makeProduct({ unit: 'L', sellingPrice: 180, priceBasisQuantity: 1, priceBasisUnit: 'L', mrp: 200, mrpBasisQuantity: 1, mrpBasisUnit: 'L' });
    const resLtoMl = resolveUnitChange(oilL, 'ml', getInitialPricingBasisState(oilL), unitIndex);
    expect(resLtoMl.kind).toBe('compatible_converted');
    expect(resLtoMl.nextBasis.priceBasisQuantity).toBe('1000');
    expect(resLtoMl.nextBasis.priceBasisUnit).toBe('ml');

    const oilMl = makeProduct({ unit: 'ml', sellingPrice: 45, priceBasisQuantity: 250, priceBasisUnit: 'ml', mrp: 50, mrpBasisQuantity: 250, mrpBasisUnit: 'ml' });
    const resMlToL = resolveUnitChange(oilMl, 'L', getInitialPricingBasisState(oilMl), unitIndex);
    expect(resMlToL.kind).toBe('compatible_converted');
    expect(resMlToL.nextBasis.priceBasisQuantity).toBe('0.25');
    expect(resMlToL.nextBasis.priceBasisUnit).toBe('L');

    // Fractional count conversion (1 pcs -> dozen) refuses inexact rounding
    expect(convertBasisQuantityUsingRegistry(1, 'pcs', 'dozen', unitIndex)).toEqual({ ok: false, reason: 'inexact' });
    const pcsProd = makeProduct({ unit: 'pcs', priceBasisQuantity: 1, priceBasisUnit: 'pcs', mrp: undefined });
    const resPcsDozen = resolveUnitChange(pcsProd, 'dozen', getInitialPricingBasisState(pcsProd), unitIndex);
    expect(resPcsDozen.kind).toBe('compatible_unconverted');
    expect(resPcsDozen.nextBasis.priceBasisUnit).toBe('pcs');
  });

  // -------------------------------------------------------------------------
  // Test Group C — Ambiguous package unit changes
  // -------------------------------------------------------------------------
  it.each([
    ['packet', 'pcs'],
    ['box', 'pcs'],
    ['bag', 'kg'],
    ['bottle', 'ml'],
  ])('Group C: %s -> %s refuses silent assumption and rejects unchanged basis unit', (fromUnit, toUnit) => {
    const prod = makeProduct({
      unit: fromUnit,
      sellingPrice: 50,
      mrp: 60,
      priceBasisQuantity: 1,
      priceBasisUnit: fromUnit,
      mrpBasisQuantity: 1,
      mrpBasisUnit: fromUnit,
    });
    const transition = resolveUnitChange(prod, toUnit, getInitialPricingBasisState(prod), unitIndex);
    expect(transition.kind).toBe('ambiguous_package');
    expect(transition.nextBasis.priceBasisUnit).toBe(fromUnit);
    expect(transition.noticeMessage).toMatch(/cannot convert/i);

    // Without updating basis unit, validation rejects saving
    const checkInvalid = validateEditPricingBasis(toUnit, 50, transition.nextBasis, unitIndex);
    expect(checkInvalid.isValid).toBe(false);
    expect(checkInvalid.priceBasisUnitError).toMatch(/incompatible/i);

    // Explicitly supplying compatible priceBasisUnit + mrpBasisUnit resolves validation
    const checkResolved = validateEditPricingBasis(
      toUnit,
      50,
      { ...transition.nextBasis, priceBasisUnit: toUnit, mrpBasisUnit: toUnit },
      unitIndex,
    );
    expect(checkResolved.isValid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test Group D — Incompatible unit changes & unrecognized units
  // -------------------------------------------------------------------------
  it.each([
    ['kg', 'pcs'],
    ['L', 'kg'],
    ['packet', 'kg'],
  ])('Group D: %s -> %s rejects incompatible units cleanly', (fromUnit, toUnit) => {
    const prod = makeProduct({ unit: fromUnit, priceBasisQuantity: 1, priceBasisUnit: fromUnit, mrp: undefined });
    const transition = resolveUnitChange(prod, toUnit, getInitialPricingBasisState(prod), unitIndex);
    expect(['incompatible_family', 'ambiguous_package']).toContain(transition.kind);

    const check = validateEditPricingBasis(toUnit, 60, transition.nextBasis, unitIndex);
    expect(check.isValid).toBe(false);
    expect(check.priceBasisUnitError).toMatch(/incompatible/i);
  });

  it('Group D: rejects unknown inventory/basis units instead of falling back to pcs', () => {
    const prod = makeProduct({ unit: 'kg', priceBasisUnit: 'kg' });
    const unknownTransition = resolveUnitChange(prod, 'bundle', getInitialPricingBasisState(prod), unitIndex);
    expect(unknownTransition.kind).toBe('unknown_unit');

    const check = validateEditPricingBasis('bundle', 60, getInitialPricingBasisState(prod), unitIndex);
    expect(check.isValid).toBe(false);
    expect(check.unitError).toMatch(/not a registered unit/i);
  });

  // -------------------------------------------------------------------------
  // Test Group E — Pricing basis, MRP ceiling, & backend mapping
  // -------------------------------------------------------------------------
  it('Group E: enforces positive basis quantities, MRP basis compatibility, and SP <= MRP across normalized units', () => {
    const mrpCheck = validateEditPricingBasis(
      'kg',
      160,
      {
        priceBasisQuantity: '500',
        priceBasisUnit: 'g',
        mrp: '150',
        mrpBasisQuantity: '1',
        mrpBasisUnit: 'kg',
      },
      unitIndex,
    );
    expect(mrpCheck.isValid).toBe(false);
    expect(mrpCheck.mrpError).toMatch(/cannot exceed MRP/i);

    const zeroBasis = validateEditPricingBasis(
      'kg',
      60,
      {
        priceBasisQuantity: '0',
        priceBasisUnit: 'kg',
        mrp: '',
        mrpBasisQuantity: '1',
        mrpBasisUnit: 'kg',
      },
      unitIndex,
    );
    expect(zeroBasis.isValid).toBe(false);
    expect(zeroBasis.priceBasisQuantityError).toMatch(/greater than 0/i);

    // mapBackendProductToFrontend preserves all basis & MRP fields + status
    const mapped = mapBackendProductToFrontend({
      id: 'b-1',
      shop_id: 's-1',
      name: 'Chana Dal',
      selling_price: 75,
      mrp: 160,
      current_stock: 10,
      reorder_level: 2,
      unit: 'kg',
      price_basis_quantity: 500,
      price_basis_unit: 'g',
      mrp_basis_quantity: 1,
      mrp_basis_unit: 'kg',
      pricing_status: 'NEEDS_REVIEW',
      stock_status: 'In Stock',
    });
    expect(mapped.priceBasisQuantity).toBe(500);
    expect(mapped.priceBasisUnit).toBe('g');
    expect(mapped.mrpBasisQuantity).toBe(1);
    expect(mapped.mrpBasisUnit).toBe('kg');
    expect(mapped.pricingStatus).toBe('NEEDS_REVIEW');
  });

  it('Group E: inventoryService.updateProduct forwards pricing basis fields cleanly without nulls', async () => {
    await serviceUpdateProduct('prod-stock', { stock: 42 });
    expect(productsApi.updateProduct).toHaveBeenCalledWith('prod-stock', { current_stock: 42 });

    await serviceUpdateProduct('prod-basis', {
      unit: 'g',
      priceBasisQuantity: 500,
      priceBasisUnit: 'g',
      mrp: 80,
      mrpBasisQuantity: 500,
      mrpBasisUnit: 'g',
      sellingPrice: 75,
    });
    expect(productsApi.updateProduct).toHaveBeenCalledWith('prod-basis', {
      unit: 'g',
      selling_price: 75,
      price_basis_quantity: 500,
      price_basis_unit: 'g',
      mrp: 80,
      mrp_basis_quantity: 500,
      mrp_basis_unit: 'g',
    });
  });

  // -------------------------------------------------------------------------
  // Test Group F — Role hint & status distinction
  // -------------------------------------------------------------------------
  it('Group F: displays Cashier hint on VERIFIED products and preserves non-VERIFIED status badges', () => {
    mockShopRole = { isCashier: true, isOwner: false, isManager: false, role: 'CASHIER' };
    const verifiedHtml = renderToStaticMarkup(
      <EditProductModal isOpen product={makeProduct({ pricingStatus: 'VERIFIED' })} onClose={vi.fn()} onUpdateProduct={vi.fn()} />,
    );
    expect(verifiedHtml).toContain('data-testid="cashier-verified-hint"');
    expect(verifiedHtml).toContain('Stock and name edits remain allowed');

    const needsReviewHtml = renderToStaticMarkup(
      <EditProductModal isOpen product={makeProduct({ pricingStatus: 'NEEDS_REVIEW' })} onClose={vi.fn()} onUpdateProduct={vi.fn()} />,
    );
    expect(needsReviewHtml).toContain('NEEDS REVIEW');
    expect(needsReviewHtml).not.toContain('data-testid="cashier-verified-hint"');
  });
});
