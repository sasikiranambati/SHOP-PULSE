import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  extractItemsFromClause,
  normalizeIndianSpeechNumbers,
  parseMultilingualVoiceBill,
} from '../utils/multilingualVoiceParser';
import {
  computeDraftMatchedItems,
  createEmptyVoiceBillDraft,
  flattenDraftToBase,
  upsertVoiceUtteranceOutcome,
} from '../utils/voiceBill';

const TEST_CATALOG: Product[] = [
  {
    id: 'p-maggi',
    name: 'Maggi Noodles',
    category: 'Instant Noodles',
    price: 14,
    sellingPrice: 14,
    purchasePrice: 10,
    stock: 40,
    unit: 'packet',
  },
  {
    id: 'p-colgate',
    name: 'Colgate Dental Cream',
    category: 'Toothpaste',
    price: 55,
    sellingPrice: 55,
    purchasePrice: 40,
    stock: 25,
    unit: 'tube',
  },
  {
    id: 'p-lux',
    name: 'Lux Soap',
    category: 'Personal Care',
    price: 35,
    sellingPrice: 35,
    purchasePrice: 25,
    stock: 30,
    unit: 'pcs',
  },
  {
    id: 'p-parle',
    name: 'Parle-G',
    category: 'Biscuits',
    price: 10,
    sellingPrice: 10,
    purchasePrice: 8,
    stock: 100,
    unit: 'packet',
  },
  {
    id: 'p-rice',
    name: 'Basmati Rice',
    category: 'Grains',
    price: 80,
    sellingPrice: 80,
    purchasePrice: 65,
    stock: 50,
    unit: 'kg',
  },
  {
    id: 'p-oil',
    name: 'Sunflower Cooking Oil',
    category: 'Oils',
    price: 160,
    sellingPrice: 160,
    purchasePrice: 130,
    stock: 20,
    unit: 'L',
  },
];

describe('Frontend Multi-Item Voice Extraction & Draft State Management', () => {
  it('parses basic number words and package variations accurately', () => {
    const res1 = parseMultilingualVoiceBill('Two Maggie packets', TEST_CATALOG);
    expect(res1.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Maggi Noodles', 2]]);

    const res2 = parseMultilingualVoiceBill('2 packets of Maggie', TEST_CATALOG);
    expect(res2.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Maggi Noodles', 2]]);

    const res3 = parseMultilingualVoiceBill('Maggie five packets', TEST_CATALOG);
    expect(res3.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Maggi Noodles', 5]]);

    expect(normalizeIndianSpeechNumbers('twenty five Maggie')).toBe('25 Maggie');
  });

  it('segments continuous speech without punctuation into independent items', () => {
    const r1 = parseMultilingualVoiceBill('5 Maggie 2 Colgate', TEST_CATALOG);
    expect(r1.matched_items.map((m) => [m.name, m.quantity, m.total_price])).toEqual([
      ['Maggi Noodles', 5, 70],
      ['Colgate Dental Cream', 2, 110],
    ]);
    expect(r1.total).toBe(180);

    const r2 = parseMultilingualVoiceBill('Five Maggie two Colgate three Lux soap', TEST_CATALOG);
    expect(r2.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Dental Cream', 2],
      ['Lux Soap', 3],
    ]);

    const r3 = parseMultilingualVoiceBill('I need 2 kilograms of rice and 1 litre of oil', TEST_CATALOG);
    expect(r3.matched_items.map((m) => [m.name, m.quantity, m.unit])).toEqual([
      ['Basmati Rice', 2, 'kg'],
      ['Sunflower Cooking Oil', 1, 'L'],
    ]);

    const r4 = parseMultilingualVoiceBill('Give me three soaps four biscuits and two litres oil', TEST_CATALOG);
    expect(r4.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Lux Soap', 3],
      ['Parle-G', 4],
      ['Sunflower Cooking Oil', 2],
    ]);

    const bottleCatalog: Product[] = [
      ...TEST_CATALOG.filter((p) => p.id !== 'p-oil'),
      { id: 'p-oil-btl', name: 'Cooking Oil Bottle', category: 'Oils', price: 165, sellingPrice: 165, purchasePrice: 130, stock: 20, unit: 'bottle' },
    ];
    const r5 = parseMultilingualVoiceBill('Give me three soaps four biscuits and two bottles oil', bottleCatalog);
    expect(r5.matched_items.map((m) => [m.name, m.quantity, m.unit])).toEqual([
      ['Lux Soap', 3, 'pcs'],
      ['Parle-G', 4, 'packet'],
      ['Cooking Oil Bottle', 2, 'bottle'],
    ]);
  });

  it('does not confuse package size with purchase quantity', () => {
    const clauses = extractItemsFromClause(normalizeIndianSpeechNumbers('2 Maggie packets of 70 grams'), TEST_CATALOG);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].quantity).toBe(2);
    expect(clauses[0].unit).toBe('packet');
    expect(clauses[0].package_size).toBe('70g');

    const res = parseMultilingualVoiceBill('2 Maggie packets of 70 grams', TEST_CATALOG);
    expect(res.matched_items.map((m) => [m.name, m.quantity, m.package_size])).toEqual([
      ['Maggi Noodles', 2, '70g'],
    ]);
  });

  it('keeps valid items when one item in the utterance is unknown or unverified', () => {
    const catWithReview: Product[] = [
      ...TEST_CATALOG,
      {
        id: 'p-review',
        name: 'Unverified Dal',
        category: 'Pulses',
        price: 110,
        sellingPrice: 110,
        purchasePrice: 90,
        stock: 15,
        unit: 'kg',
        pricingStatus: 'NEEDS_REVIEW',
      },
    ];
    const res = parseMultilingualVoiceBill('5 Maggie 2 Colgate 1 UnknownProduct 2 kg Unverified Dal', catWithReview);
    expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Dental Cream', 2],
    ]);
    expect(res.unmatched_items.length).toBe(2);
  });

  it('accumulates consecutive utterances and supports preview/authoritative reconciliation + voice commands', () => {
    let draft = createEmptyVoiceBillDraft();

    // Utterance 1: "5 Maggie" (preview then authoritative)
    const u1 = parseMultilingualVoiceBill('5 Maggie', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 1, u1, { mode: 'preview' });
    draft = upsertVoiceUtteranceOutcome(draft, 1, u1, { mode: 'authoritative' }); // must NOT double to 10
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
    ]);

    // Utterance 2: "2 Colgate" -> must keep Maggie AND add Colgate
    const u2 = parseMultilingualVoiceBill('2 Colgate', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 2, u2, { mode: 'preview' });
    draft = upsertVoiceUtteranceOutcome(draft, 2, u2, { mode: 'authoritative' });
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Dental Cream', 2],
    ]);

    // Utterance 3: "Add two more Maggie" -> increments 5 + 2 = 7
    const u3 = parseMultilingualVoiceBill('Add two more Maggie', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 3, u3, { mode: 'authoritative' });
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 7],
      ['Colgate Dental Cream', 2],
    ]);

    // Utterance 4: "Make it 4 Maggie instead of 7"
    const u4 = parseMultilingualVoiceBill('Make it 4 Maggie instead of 7', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 4, u4, { mode: 'authoritative' });
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 4],
      ['Colgate Dental Cream', 2],
    ]);

    // Reprocess Utterance 4: "Make it 6 Maggie instead of 4" -> replaces entry 4 instead of duplicating
    const u4Edit = parseMultilingualVoiceBill('Make it 6 Maggie instead of 4', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 4, u4Edit, { replaceLast: true, mode: 'authoritative' });
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 6],
      ['Colgate Dental Cream', 2],
    ]);

    // Utterance 5: "Remove Colgate"
    const u5 = parseMultilingualVoiceBill('Remove Colgate', TEST_CATALOG);
    draft = upsertVoiceUtteranceOutcome(draft, 5, u5, { mode: 'authoritative' });
    expect(computeDraftMatchedItems(draft).map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 6],
    ]);

    // Flattening and manual deletion check
    draft = flattenDraftToBase(draft);
    expect(draft.entries).toHaveLength(0);
    expect(draft.baseItems).toHaveLength(1);
  });
});
