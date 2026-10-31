import fs from 'fs';
import { isCandidateHeaderLine, detectColumnsFromHeaderWords, mapWordsToColumns } from './src/services/semanticColumnDetector';
import { cleanNumericToken, normalizeUnit } from './src/services/invoiceParser';
import { cleanProductName, resolveItemArithmetic } from './src/services/tableLayoutExtractor';

const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));
const lines = [];

data.blocks.forEach((b) => {
  if (b.paragraphs) {
    b.paragraphs.forEach((p) => {
      if (p.lines) {
        p.lines.forEach((l) => {
          const words = (l.words || []).map((w) => ({
            text: (w.text || '').trim(),
            confidence: w.confidence || 80,
            bbox: w.bbox || l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
          })).filter(w => w.text);
          words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
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

let headerIdx = -1;
let cols = [];
for (let i = 0; i < Math.min(lines.length, 15); i++) {
  if (isCandidateHeaderLine(lines[i].text)) {
    const maxW = Math.max(1600, ...lines.flatMap((ln) => ln.words.map((w) => w.bbox.x1)));
    cols = detectColumnsFromHeaderWords(lines[i].words, maxW);
    headerIdx = i;
    break;
  }
}

console.log(`Header found at line ${headerIdx}:`, cols.map(c => `${c.headerText} -> ${c.type} [${Math.round(c.minX)}-${Math.round(c.maxX)}]`));

function parseSmartQuantity(raw) {
  if (!raw) return null;
  let clean = raw.replace(/[₹$€£]/g, '').trim();
  // Strip known unit suffixes
  clean = clean.replace(/(?:pcs|pc|pkt|box|bag|bor|pet|kg|g|gm|l|ltr|can|tin|fc|fcs|rcs|orcs)$/i, '').trim();
  // Clean OCR letter confusions
  clean = clean.replace(/[lI|!]/g, '1')
               .replace(/[Oo]/g, '0')
               .replace(/[Ss]/g, '5')
               .replace(/[Bb]/g, '8');
  const num = parseFloat(clean);
  return !isNaN(num) && num > 0 ? num : null;
}

function parseSmartPrice(raw) {
  if (!raw) return null;
  let clean = raw.replace(/[₹$€£]/g, '').replace(/\b(?:rs|inr)\b\.?/gi, '').trim();
  clean = clean.replace(/[lI|!]/g, '1')
               .replace(/[Oo]/g, '0')
               .replace(/[Ss]/g, '5')
               .replace(/[Bb]/g, '8');
  const num = parseFloat(clean);
  return !isNaN(num) && num > 0 ? num : null;
}

const items = [];
let pending = null;

for (let i = headerIdx + 1; i < lines.length; i++) {
  const l = lines[i];
  if (/grand total|net amount|balance amount|received amount|payment qr|terms and|hsn\/sac/i.test(l.text)) {
    if (pending) items.push(pending);
    break;
  }

  const cv = mapWordsToColumns(l.words, cols);
  const rawName = cv.productName || '';
  const parsedQty = parseSmartQuantity(cv.quantity);
  const parsedRate = parseSmartPrice(cv.unitPrice || cv.purchasePrice);
  const parsedTotal = parseSmartPrice(cv.total || cv.taxableAmount);
  const parsedTax = parseSmartPrice(cv.tax);
  const hasNumbers = parsedQty !== null || parsedRate !== null || parsedTotal !== null;

  if (rawName && !hasNumbers) {
    if (!pending) {
      pending = { name: cleanProductName(rawName), qty: null, rate: null, total: null, tax: null };
    } else {
      if (pending.rate !== null || pending.total !== null) {
        items.push(pending);
        pending = { name: cleanProductName(rawName), qty: null, rate: null, total: null, tax: null };
      } else {
        pending.name = `${pending.name} ${cleanProductName(rawName)}`.trim();
      }
    }
    continue;
  }

  if (hasNumbers) {
    const res = resolveItemArithmetic(parsedQty, parsedRate, parsedTotal, parsedTax);
    if (pending && pending.rate === null && pending.total === null) {
      const mergedName = rawName ? `${pending.name} ${cleanProductName(rawName)}`.trim() : pending.name;
      pending.name = mergedName;
      pending.qty = res.quantity;
      pending.rate = res.purchasePrice;
      pending.total = res.lineTotal;
      pending.tax = parsedTax;
    } else {
      if (pending) items.push(pending);
      pending = {
        name: cleanProductName(rawName),
        qty: res.quantity,
        rate: res.purchasePrice,
        total: res.lineTotal,
        tax: parsedTax,
      };
    }
  }
}

console.log(`\n=== EXTRACTED ITEMS COUNT: ${items.length} ===`);
let sumUnits = 0;
let sumTotal = 0;
items.forEach((it, idx) => {
  console.log(`Item [${idx + 1}]: "${it.name}" | Qty: ${it.qty} | Rate: ₹${it.rate} | Tax: ₹${it.tax || 0} | Total: ₹${it.total}`);
  sumUnits += (it.qty || 0);
  sumTotal += (it.total || 0);
});
console.log(`\nTotal Units: ${sumUnits} (Expected: 187)`);
console.log(`Grand Total: ₹${sumTotal} (Expected: ₹132,765)`);
