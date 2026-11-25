import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CartItem, Product } from '../types';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import {
  clearPosDraft,
  clearSessionExpiredNotice,
  loadPosDraft,
  markSessionExpired,
  readSessionExpiredNotice,
  savePosDraft,
} from '../utils/posDraftStorage';
import { voiceLineToCartItem, withEditedLineTotal } from '../utils/voiceBill';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, String(value)); }
}

const TEST_PRODUCTS: Product[] = [
  { id: 'p-maggi', name: 'Maggi Noodles', category: 'Noodles', price: 14, sellingPrice: 14, stock: 50, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-colgate', name: 'Colgate Dental Cream', category: 'Personal Care', price: 55, sellingPrice: 55, stock: 30, unit: 'tube', pricingStatus: 'VERIFIED' },
  { id: 'p-rice', name: 'Basmati Rice', category: 'Grains', price: 80, sellingPrice: 80, stock: 40, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-sugar', name: 'Sugar', category: 'Grocery', price: 44, sellingPrice: 44, stock: 25, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-oil', name: 'Sunflower Cooking Oil', category: 'Edible Oils', price: 140, sellingPrice: 140, stock: 20, unit: 'L', pricingStatus: 'VERIFIED' },
  { id: 'p-atta', name: 'Aashirvaad Atta', category: 'Grains', price: 52, sellingPrice: 52, stock: 30, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-parle', name: 'Parle-G', category: 'Biscuits', price: 10, sellingPrice: 10, stock: 80, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-soap', name: 'Lux Soap', category: 'Personal Care', price: 35, sellingPrice: 35, stock: 40, unit: 'pcs', pricingStatus: 'VERIFIED' },
];

describe('Voice-to-Bill & POS Final Verification Suite', () => {
  beforeEach(() => {
    const store = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      value: { sessionStorage: store },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: store,
      configurable: true,
      writable: true,
    });
  });

  it('accurately parses English quantities, fractions, units, and multi-item utterances', () => {
    const cases: Array<[string, Array<[string, number, string]>]> = [
      ['Two Maggie', [['Maggi Noodles', 2, 'packet']]],
      ['To Maggie', [['Maggi Noodles', 2, 'packet']]],
      ['2 kg Basmati Rice', [['Basmati Rice', 2, 'kg']]],
      ['500 g Sugar', [['Sugar', 0.5, 'kg']]],
      ['250 g Sugar', [['Sugar', 0.25, 'kg']]],
      ['1.5 kg Basmati Rice', [['Basmati Rice', 1.5, 'kg']]],
      ['2.5 kg Aashirvaad Atta', [['Aashirvaad Atta', 2.5, 'kg']]],
      ['1 L Sunflower Cooking Oil', [['Sunflower Cooking Oil', 1, 'L']]],
      ['500 ml Sunflower Cooking Oil', [['Sunflower Cooking Oil', 0.5, 'L']]],
      ['3 packets Parle-G', [['Parle-G', 3, 'packet']]],
      ['12 pieces Lux Soap', [['Lux Soap', 12, 'pcs']]],
      ['half kg Sugar', [['Sugar', 0.5, 'kg']]],
      ['quarter kg Sugar', [['Sugar', 0.25, 'kg']]],
      ['half dozen Lux Soap', [['Lux Soap', 6, 'pcs']]],
      ['one and a half kg Basmati Rice', [['Basmati Rice', 1.5, 'kg']]],
      ['5 Maggi 2 Colgate', [['Maggi Noodles', 5, 'packet'], ['Colgate Dental Cream', 2, 'tube']]],
    ];

    for (const [text, expected] of cases) {
      const parsed = parseMultilingualVoiceBill(text, TEST_PRODUCTS, 'english');
      const actual = parsed.matched_items.map((m) => [m.name, m.quantity, m.unit]);
      expect(actual, `Transcript: "${text}"`).toEqual(expected);
    }
  });

  it('rejects ordinary conversational false positives cleanly', () => {
    for (const noise of [
      'Go to the counter',
      'Add to my bill',
      'I want to go to market',
      'Need to check price',
      'Hello good morning',
      'For my customer',
    ]) {
      const parsed = parseMultilingualVoiceBill(noise, TEST_PRODUCTS, 'english');
      expect(parsed.matched_items, `Noise matched: "${noise}"`).toEqual([]);
      expect(parsed.ambiguous_items, `Noise ambiguous: "${noise}"`).toEqual([]);
    }
  });

  it('preserves voice agreed pricing metadata and POS draft across simulated 401 session expiration', () => {
    const parsed = parseMultilingualVoiceBill('500 g Sugar', TEST_PRODUCTS, 'english');
    expect(parsed.matched_items).toHaveLength(1);
    const edited = withEditedLineTotal({ ...parsed.matched_items[0], spoken_quantity: '500 g' }, 25);
    const cartItem: CartItem = voiceLineToCartItem(edited, TEST_PRODUCTS[3])!;
    expect(cartItem.unitPrice).toBe(50);
    expect(cartItem.priceSource).toBe('edited');
    expect(cartItem.spokenQuantity).toBe('500 g');

    // User A works in POS and hits a 401 session expiration
    savePosDraft('user-a', {
      cart: [cartItem],
      customerName: 'Ramesh',
      paymentMethod: 'UPI',
    });
    markSessionExpired('sales');

    const expired = readSessionExpiredNotice();
    expect(expired?.returnPage).toBe('sales');
    expect(expired?.hadActiveDraft).toBe(true);

    // Cross-user isolation: another user signing in cannot inherit user A's draft
    expect(loadPosDraft('user-b')).toBeNull();

    // Same user re-authenticates -> exact draft restores
    const restored = loadPosDraft('user-a');
    expect(restored).not.toBeNull();
    expect(restored?.customerName).toBe('Ramesh');
    expect(restored?.paymentMethod).toBe('UPI');
    expect(restored?.cart[0].unitPrice).toBe(50);
    expect(restored?.cart[0].priceSource).toBe('edited');

    // Intentional checkout / clear removes the draft
    clearPosDraft('user-a');
    clearSessionExpiredNotice();
    expect(loadPosDraft('user-a')).toBeNull();
    expect(readSessionExpiredNotice()).toBeNull();
  });

  it('removes outdated 12-language claims from Sales POS and Landing and enforces SpeechRecognition lifecycle guards', () => {
    const salesSrc = readFileSync(resolve(__dirname, '../pages/Sales.tsx'), 'utf8');
    const landingSrc = readFileSync(resolve(__dirname, '../pages/Landing.tsx'), 'utf8');
    const modalSrc = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');

    expect(salesSrc).not.toContain('12 Languages');
    expect(salesSrc).not.toContain('12 Indian Languages');
    expect(salesSrc).not.toContain('बोलकर बिल बनाएं');
    expect(salesSrc).toContain('English Voice');
    expect(landingSrc).not.toContain('12 Indian Regional Languages');
    expect(landingSrc).not.toContain('12 Indian regional languages');

    // SpeechRecognition concurrency / stale-instance / button state / close hygiene guards
    expect(modalSrc).toContain('isStartingRef');
    expect(modalSrc).toContain('isProcessingRef');
    expect(modalSrc).toContain('activeRequestSeqRef');
    expect(modalSrc).toContain('if (speechRecognitionRef.current !== recognition) return;');
    expect(modalSrc).toContain('handleModalClose');
  });
});
