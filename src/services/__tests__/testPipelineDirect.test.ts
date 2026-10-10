import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { isCandidateHeaderLine, detectColumnsFromHeaderWords, mapWordsToColumns } from '../semanticColumnDetector';
import { extractLineItemsFlexible } from '../tableLayoutExtractor';

describe('Direct Pipeline Test with Exact Reconciled Arithmetic', () => {
  it('extracts all 11 items and matches 187 units and 132765 grand total', () => {
    const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));
    const lines: any[] = [];

    data.blocks.forEach((b: any) => {
      if (b.paragraphs) {
        b.paragraphs.forEach((p: any) => {
          if (p.lines) {
            p.lines.forEach((l: any) => {
              const words = (l.words || []).map((w: any) => ({
                text: (w.text || '').trim(),
                confidence: w.confidence || 80,
                bbox: w.bbox || l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
              })).filter((w: any) => w.text);
              words.sort((a: any, b: any) => a.bbox.x0 - b.bbox.x0);
              lines.push({
                text: (l.text || '').trim(),
                confidence: l.confidence || 80,
                bbox: l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
                words,
              });
            });
          }
        });
      }
    });
    lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

    const { items, methodUsed } = extractLineItemsFlexible(lines, [], '');

    console.log(`\n=== METHOD USED: ${methodUsed} | EXTRACTED ITEMS COUNT: ${items.length} ===`);
    let sumUnits = 0;
    let sumTotal = 0;
    items.forEach((it, idx) => {
      console.log(`Item [${idx + 1}]: "${it.productName}" | Qty: ${it.quantity} | Rate: ₹${it.purchasePrice} | Tax: ₹${it.taxAmount || 0} | Total: ₹${it.lineTotal}`);
      sumUnits += (it.quantity || 0);
      sumTotal += (it.lineTotal || 0);
    });
    console.log(`\nTotal Units: ${sumUnits} (Expected: 187)`);
    console.log(`Grand Total: ₹${sumTotal} (Expected: ₹132,765)`);

    expect(items.length).toBe(11);
    expect(sumUnits).toBe(187);
    expect(Math.abs(sumTotal - 132765)).toBeLessThanOrEqual(2);
  });
});
