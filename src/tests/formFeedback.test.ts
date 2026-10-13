/**
 * Form validation and user-facing error messages: invalid fields are reported individually,
 * a missing purchase price is never estimated, and technical errors are not shown to users.
 */
import { describe, it, expect } from 'vitest';
import { validateProductForm, isProductFormDirty, type ProductFormValues } from '../utils/validators';
import { describeError } from '../utils/errorHandler';
import { normalizePaymentMethod, deleteSale } from '../services/salesService';

const filled = (overrides: Partial<ProductFormValues> = {}): ProductFormValues => ({
  name: 'Amul Milk 500ml',
  category: 'Dairy',
  sellingPrice: '28',
  purchasePrice: '',
  stock: '24',
  minStock: '10',
  unit: 'pkts',
  barcode: '',
  ...overrides,
});

describe('validateProductForm', () => {
  it('accepts a valid form and leaves a blank purchase price unknown', () => {
    const { errors, parsed } = validateProductForm(filled());
    expect(errors).toEqual({});
    expect(parsed?.sellingPrice).toBe(28);
    // Previously the form silently stored 70% of the selling price here.
    expect(parsed?.purchasePrice).toBeUndefined();
  });

  it('keeps a typed purchase price exactly', () => {
    expect(validateProductForm(filled({ purchasePrice: '19.5' })).parsed?.purchasePrice).toBe(19.5);
  });

  it('reports each invalid field separately', () => {
    const { errors, parsed } = validateProductForm(
      filled({ name: '  ', sellingPrice: '0', purchasePrice: '-1', stock: '2.5', minStock: '-3' })
    );
    expect(parsed).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['minStock', 'name', 'purchasePrice', 'sellingPrice', 'stock']);
  });

  it('requires a stock quantity rather than assuming zero', () => {
    expect(validateProductForm(filled({ stock: '' })).errors.stock).toBeDefined();
  });

  it('detects unsaved edits', () => {
    expect(isProductFormDirty(filled(), filled())).toBe(false);
    expect(isProductFormDirty(filled({ name: 'Amul Gold' }), filled())).toBe(true);
  });
});

describe('describeError', () => {
  it('passes through a readable API message', () => {
    expect(describeError(new Error('Insufficient stock for product Milk.'), 'fallback')).toBe('Insufficient stock for product Milk.');
  });

  it('hides stack traces and database internals', () => {
    expect(describeError(new Error('Traceback (most recent call last):\n  File "x.py"'), 'Could not save.')).toBe('Could not save.');
    expect(describeError(new Error('sqlite3.IntegrityError: NOT NULL constraint failed'), 'Could not save.')).toBe('Could not save.');
    expect(describeError({}, 'Could not save.')).toBe('Could not save.');
  });
});

describe('sales records', () => {
  it('maps backend payment methods to the labels the history filters use', () => {
    expect(normalizePaymentMethod('cash')).toBe('Cash');
    expect(normalizePaymentMethod('upi')).toBe('UPI');
    expect(normalizePaymentMethod('card')).toBe('Card');
  });

  it('refuses to delete a sale instead of pretending it worked', async () => {
    await expect(deleteSale('sale-1', true)).rejects.toThrow(/not supported/i);
  });
});
