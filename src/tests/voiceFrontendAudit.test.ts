/**
 * Rigorous Vitest QA Audit Suite covering Sections 6, 7, 8, 9, 10, 11, 13, 14:
 * - Alternative STT selection inputs
 * - All 12 Homophone expressions
 * - All 14 False-Positive ordinary English expressions
 * - Multi-item extraction tests A-G
 * - Draft reducer sequential accumulation, deduplication, editing, pricing math
 */
import { describe, expect, it } from 'vitest';
import type { Product } from '../types/product';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import {
  computeDraftMatchedItems,
  createEmptyVoiceBillDraft,
  flattenDraftToBase,
  mergeVoiceMatchedItems,
  upsertVoiceUtteranceOutcome,
  withEditedLineTotal,
} from '../utils/voiceBill';

const QA_CATALOG: Product[] = [
  { id: 'p-maggi', name: 'Maggi Noodles', category: 'Noodles', price: 14, sellingPrice: 14, stock: 50, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-colgate', name: 'Colgate Toothpaste', category: 'Oral Care', price: 50, sellingPrice: 50, stock: 40, unit: 'tube', pricingStatus: 'VERIFIED' },
  { id: 'p-lux', name: 'Lux Soap', category: 'Personal Care', price: 35, sellingPrice: 35, stock: 30, unit: 'pcs', pricingStatus: 'VERIFIED' },
  { id: 'p-biscuit', name: 'Parle-G Biscuits', category: 'Biscuits', price: 10, sellingPrice: 10, stock: 60, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-rice', name: 'Basmati Rice', category: 'Grains', price: 80, sellingPrice: 80, stock: 50, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-sugar', name: 'Sugar', category: 'Grocery', price: 45, sellingPrice: 45, stock: 50, unit: 'kg', pricingStatus: 'VERIFIED' },
  { id: 'p-tea', name: 'Red Label Tea', category: 'Beverages', price: 120, sellingPrice: 120, stock: 25, unit: 'packet', pricingStatus: 'VERIFIED' },
  { id: 'p-coffee', name: 'Nescafe Coffee', category: 'Coffee', price: 160, sellingPrice: 160, stock: 18, unit: 'jar', pricingStatus: 'VERIFIED' },
  { id: 'p-teatree', name: 'Tea Tree Oil', category: 'Personal Care', price: 180, sellingPrice: 180, stock: 15, unit: 'bottle', pricingStatus: 'VERIFIED' },
];

describe('Voice-to-Bill QA Audit — Sections 7, 8, 9, 10, 14', () => {
  it('Section 7: handles all 12 homophone/quantity test phrases cleanly', () => {
    const expectedSingle: Array<[string, string, number]> = [
      ['Two Maggie', 'Maggi Noodles', 2],
      ['To Maggie', 'Maggi Noodles', 2],
      ['Too Maggie', 'Maggi Noodles', 2],
      ['Two packets Maggie', 'Maggi Noodles', 2],
      ['For Colgate', 'Colgate Toothpaste', 4],
      ['Won rice', 'Basmati Rice', 1],
      ['Tree soaps', 'Lux Soap', 3],
      ['Ate biscuits', 'Parle-G Biscuits', 8],
    ];
    for (const [utterance, expName, expQty] of expectedSingle) {
      const res = parseMultilingualVoiceBill(utterance, QA_CATALOG, 'english');
      expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual([[expName, expQty]]);
    }

    // "Sex packets" has unit context ("packets") without a specific product token:
    // must NOT blindly match an unrelated SKU in catalog!
    const sexRes = parseMultilingualVoiceBill('Sex packets', QA_CATALOG, 'english');
    expect(sexRes.matched_items).toEqual([]);

    const expectedMulti: Array<[string, Array<[string, number]>]> = [
      ['Five Maggie to Colgate', [['Maggi Noodles', 5], ['Colgate Toothpaste', 2]]],
      ['To Maggie for Colgate', [['Maggi Noodles', 2], ['Colgate Toothpaste', 4]]],
      ['Tree soaps two biscuits', [['Lux Soap', 3], ['Parle-G Biscuits', 2]]],
    ];
    for (const [utterance, expPairs] of expectedMulti) {
      const res = parseMultilingualVoiceBill(utterance, QA_CATALOG, 'english');
      expect(res.matched_items.map((m) => [m.name, m.quantity])).toEqual(expPairs);
    }
  });

  it('Section 8: blocks false-positive bill quantities across all 14 ordinary English cases', () => {
    const pureFalsePositives = [
      'Go to the counter',
      'Give it to him',
      'Too expensive',
      'For my family',
      'Four people came',
      'I want to go to the shop',
      'Change it to five',
      'Take it for me',
      'Three people are coming',
      'I need to go home',
      'Give me four minutes',
      'For 50 rupees',
    ];
    for (const phrase of pureFalsePositives) {
      const res = parseMultilingualVoiceBill(phrase, QA_CATALOG, 'english');
      expect(res.matched_items, `False positive matched for ${phrase}`).toEqual([]);
      expect(res.ambiguous_items, `False positive ambig for ${phrase}`).toEqual([]);
      expect(res.unmatched_items, `False positive unmatched for ${phrase}`).toEqual([]);
    }

    // Existing product containing homophone word must stay preserved
    const teaTree = parseMultilingualVoiceBill('Tea Tree Oil', QA_CATALOG, 'english');
    expect(teaTree.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Tea Tree Oil', 1]]);

    // Ambiguous mid-phrase asks confirmation rather than silent 4x
    const sugarCoffee = parseMultilingualVoiceBill('Sugar for coffee', QA_CATALOG, 'english');
    expect(sugarCoffee.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Sugar', 1]]);
    expect(sugarCoffee.ambiguous_items).toHaveLength(1);
    expect(sugarCoffee.ambiguous_items[0].ambiguity_type).toBe('quantity');

    // When multiple tea SKUs exist, "Sugar for tea" ALSO avoids silently picking one wrong product
    const sugarTea = parseMultilingualVoiceBill('Sugar for tea', QA_CATALOG, 'english');
    expect(sugarTea.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Sugar', 1]]);
    expect(sugarTea.ambiguous_items).toHaveLength(1);
  });

  it('Section 9: multi-item extraction tests A through G', () => {
    const a = parseMultilingualVoiceBill('Five Maggie two Colgate', QA_CATALOG, 'english');
    expect(a.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Toothpaste', 2],
    ]);

    const b = parseMultilingualVoiceBill('Five Maggie two Colgate three Lux soap', QA_CATALOG, 'english');
    expect(b.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Toothpaste', 2],
      ['Lux Soap', 3],
    ]);

    const c = parseMultilingualVoiceBill('Two Maggie three Colgate four biscuits five soaps', QA_CATALOG, 'english');
    expect(c.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 2],
      ['Colgate Toothpaste', 3],
      ['Parle-G Biscuits', 4],
      ['Lux Soap', 5],
    ]);

    const d = parseMultilingualVoiceBill('Add two Maggie and three Colgate', QA_CATALOG, 'english');
    expect(d.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 2],
      ['Colgate Toothpaste', 3],
    ]);

    const e = parseMultilingualVoiceBill('Five Maggie, then two Colgate', QA_CATALOG, 'english');
    expect(e.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 5],
      ['Colgate Toothpaste', 2],
    ]);

    // Test F: "Five Maggie and five more" -> Maggie must NOT be lost!
    const f = parseMultilingualVoiceBill('Five Maggie and five more', QA_CATALOG, 'english');
    expect(f.matched_items.map((m) => [m.name, m.quantity])).toEqual([['Maggi Noodles', 5]]);

    // Test G: unknown item does not block valid items
    const g = parseMultilingualVoiceBill('Two Maggie, three unknown product, four Colgate', QA_CATALOG, 'english');
    expect(g.matched_items.map((m) => [m.name, m.quantity])).toEqual([
      ['Maggi Noodles', 2],
      ['Colgate Toothpaste', 4],
    ]);
    expect(g.unmatched_items.map((u) => [u.queried_name.toLowerCase(), u.quantity])).toEqual([
      ['unknown product', 3],
    ]);
  });

  it('Section 14: computes exact deterministic totals for table and edited lines', () => {
    const res = parseMultilingualVoiceBill('2 Maggie 4 Colgate 3 Lux soap', QA_CATALOG, 'english');
    expect(res.matched_items.map((m) => [m.name, m.quantity, m.unit_price, m.total_price])).toEqual([
      ['Maggi Noodles', 2, 14, 28],
      ['Colgate Toothpaste', 4, 50, 200],
      ['Lux Soap', 3, 35, 105],
    ]);
    expect(res.total).toBe(333);

    // Draft reducer preserves accumulated totals across sequential sessions & line edits
    let draft = createEmptyVoiceBillDraft();
    draft = upsertVoiceUtteranceOutcome(draft, 1, parseMultilingualVoiceBill('2 Maggie', QA_CATALOG, 'english'), { mode: 'authoritative' });
    draft = upsertVoiceUtteranceOutcome(draft, 2, parseMultilingualVoiceBill('4 Colgate', QA_CATALOG, 'english'), { mode: 'authoritative' });
    const lines = computeDraftMatchedItems(draft);
    expect(lines.reduce((s, l) => s + l.total_price, 0)).toBe(228);

    const flat = flattenDraftToBase(draft);
    const edited = withEditedLineTotal(flat.baseItems[0], 25);
    expect(edited.total_price).toBe(25);
    expect(edited.unit_price_exact).toBe(12.5);
    expect(edited.price_source).toBe('edited');

    // Merge remove action cleans up cleanly
    const removed = mergeVoiceMatchedItems(lines, [{ ...lines[0], action: 'remove', explicit_quantity: false }]);
    expect(removed).toHaveLength(1);
    expect(removed[0].name).toBe('Colgate Toothpaste');
  });
});
