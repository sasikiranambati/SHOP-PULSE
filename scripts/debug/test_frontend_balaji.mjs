import fs from 'fs';
import { extractLineItemsFlexible } from '../src/services/tableLayoutExtractor.ts';

const data = JSON.parse(fs.readFileSync('scratch/sri_balaji_ocr.json', 'utf8'));

const lines = [];
for (const b of data.blocks || []) {
  for (const p of b.paragraphs || []) {
    for (const l of p.lines || []) {
      const words = (l.words || []).map((w) => ({
        text: (w.text || '').trim(),
        confidence: w.confidence || 80,
        bbox: w.bbox || l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
      })).filter((w) => w.text);
      words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      lines.push({
        text: (l.text || '').trim(),
        confidence: l.confidence || 80,
        bbox: l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
        words,
      });
    }
  }
}
lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);

const { items, methodUsed } = extractLineItemsFlexible(lines, [], '');

console.log(`=== METHOD USED: ${methodUsed} | EXTRACTED ITEMS: ${items.length} ===`);
items.forEach((it, idx) => {
  console.log(`[${idx + 1}] "${it.productName}" | Qty: ${it.quantity} | Unit: ${it.unit} | Rate: ${it.purchasePrice} | Total: ${it.lineTotal}`);
});
