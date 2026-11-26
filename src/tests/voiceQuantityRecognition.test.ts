import { describe, expect, it } from 'vitest';
import type { Product } from '../types/product';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import { replayVoiceTranscript } from '../utils/voiceReplay';

const MOCK_CATALOG: Product[] = [
  { id: 'p-maggi', name: 'Maggi Noodles', category: 'Noodles', price: 14, sellingPrice: 14, stock: 50, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-colgate', name: 'Colgate Dental Cream', category: 'Toothpaste', price: 55, sellingPrice: 55, stock: 40, unit: 'tube', pricingStatus: 'VERIFIED' },
  { id: 'p-lux', name: 'Lux Soap', category: 'Personal Care', price: 35, sellingPrice: 35, stock: 30, unit: 'pcs', pricingStatus: 'VERIFIED' },
  { id: 'p-parle', name: 'Parle-G Biscuits', category: 'Biscuits', price: 10, sellingPrice: 10, stock: 60, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-rice', name: 'Basmati Rice', category: 'Grains', price: 80, sellingPrice: 80, stock: 50, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-sugar', name: 'Sugar', category: 'Grocery', price: 45, sellingPrice: 45, stock: 50, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-tea', name: 'Red Label Tea', category: 'Beverages', price: 120, sellingPrice: 120, stock: 25, unit: 'packet', pricingStatus: 'VERIFIED' },
];

describe('Client contextual homophone quantity resolution & replay', () => {
  it('resolves exact and STT homophone single-item phrases cleanly', () => {
    const exact = parseMultilingualVoiceBill('Two Maggie', MOCK_CATALOG, 'english');
    expect(exact.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Maggi Noodles', 2]]);
    expect(exact.matched_items[0].quantity_source).toBe('explicit');

    for (const [utterance, expectedName, expectedQty] of [
      ['To Maggie', 'Maggi Noodles', 2],
      ['Too Maggie', 'Maggi Noodles', 2],
      ['For Colgate', 'Colgate Dental Cream', 4],
      ['Won rice', 'Basmati Rice', 1],
      ['Tree soaps', 'Lux Soap', 3],
      ['Ate biscuits', 'Parle-G Biscuits', 8],
    ] as const) {
      const res = parseMultilingualVoiceBill(utterance, MOCK_CATALOG, 'english');
      expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual([[expectedName, expectedQty]]);
      expect(res.matched_items[0].quantity_source).toBe('contextual_homophone');
    }
  });

  it('prevents false positives on ordinary English sentences', () => {
    for (const prose of [
      'Go to the counter',
      'Give it to him',
      'Too expensive',
      'For my family',
      'Four people came',
      'I want to go to the shop',
    ]) {
      const res = parseMultilingualVoiceBill(prose, MOCK_CATALOG, 'english');
      expect(res.matched_items).toEqual([]);
      expect(res.ambiguous_items).toEqual([]);
      expect(res.unmatched_items).toEqual([]);
    }
  });

  it('segments and resolves multi-item utterances with homophones', () => {
    const cases: Array<[string, Array<[string, number]>]> = [
      ['To Maggie two Colgate', [['Maggi Noodles', 2], ['Colgate Dental Cream', 2]]],
      ['Five Maggie to Colgate', [['Maggi Noodles', 5], ['Colgate Dental Cream', 2]]],
      ['To Maggie for Colgate', [['Maggi Noodles', 2], ['Colgate Dental Cream', 4]]],
      ['Tree soaps two biscuits', [['Lux Soap', 3], ['Parle-G Biscuits', 2]]],
    ];

    for (const [utterance, expected] of cases) {
      const res = parseMultilingualVoiceBill(utterance, MOCK_CATALOG, 'english');
      expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual(expected);
      expect(res.ambiguous_items).toEqual([]);
    }
  });

  it('surfaces moderate-confidence quantity ambiguity as "Did you mean?" options', () => {
    const res = parseMultilingualVoiceBill('sugar for tea', MOCK_CATALOG, 'english');
    expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Sugar', 1]]);
    expect(res.ambiguous_items).toHaveLength(1);
    const amb = res.ambiguous_items[0];
    expect(amb.ambiguity_type).toBe('quantity');
    expect(amb.suggested_quantity).toBe(4);
    expect(amb.fallback_quantity).toBe(1);
    expect(amb.options?.map((o) => [o.name, o.quantity])).toEqual([
      ['Red Label Tea', 4],
      ['Red Label Tea', 1],
    ]);
  });

  it('separates STT drift recovery vs STT failure vs parser failure in replay harness', () => {
    const recovered = replayVoiceTranscript(
      {
        spokenIntent: 'Two Maggie',
        sttTranscript: 'To Maggie',
        speechAlternatives: ['Two Maggie', 'to Maggi'],
        sttConfidence: 0.78,
        expectedItems: [{ productName: 'Maggi Noodles', quantity: 2 }],
      },
      MOCK_CATALOG,
    );
    expect(recovered.classification).toBe('STT_CORRUPTED_RECOVERED');
    expect(recovered.sttDrifted).toBe(true);

    const exact = replayVoiceTranscript(
      {
        spokenIntent: 'Two Maggie',
        sttTranscript: 'Two Maggie',
        expectedItems: [{ productName: 'Maggi Noodles', quantity: 2 }],
      },
      MOCK_CATALOG,
    );
    expect(exact.classification).toBe('PASS');

    const sttFail = replayVoiceTranscript(
      {
        spokenIntent: 'Two Maggie',
        sttTranscript: 'Blue window',
        expectedItems: [{ productName: 'Maggi Noodles', quantity: 2 }],
      },
      MOCK_CATALOG,
    );
    expect(sttFail.classification).toBe('STT_FAILURE');
  });
});
