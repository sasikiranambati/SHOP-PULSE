import { detectColumnsFromHeaderWords, mapWordsToColumns } from '../src/services/semanticColumnDetector.ts';

// In realistic OCR of a scanned bill:
// Column headers at line Y:
// S.No. (40-90)
// Item Description (100-350)
// HSN/SAC (380-460)
// Qty (480-530)
// Unit (540-600)
// Rate (620-670)
// (₹) (675-710)
// Discount (730-800)
// Tax (820-860)
// Amount (890-960)

const headerWords = [
  { text: "S.No.", confidence: 95, bbox: { x0: 40, y0: 100, x1: 90, y1: 120 } },
  { text: "Item", confidence: 95, bbox: { x0: 100, y0: 100, x1: 150, y1: 120 } },
  { text: "Description", confidence: 95, bbox: { x0: 160, y0: 100, x1: 300, y1: 120 } },
  { text: "HSN/SAC", confidence: 95, bbox: { x0: 380, y0: 100, x1: 460, y1: 120 } },
  { text: "Qty", confidence: 95, bbox: { x0: 480, y0: 100, x1: 520, y1: 120 } },
  { text: "Unit", confidence: 95, bbox: { x0: 540, y0: 100, x1: 590, y1: 120 } },
  { text: "Rate", confidence: 95, bbox: { x0: 620, y0: 100, x1: 670, y1: 120 } },
  { text: "(₹)", confidence: 95, bbox: { x0: 675, y0: 100, x1: 710, y1: 120 } },
  { text: "Discount", confidence: 95, bbox: { x0: 730, y0: 100, x1: 800, y1: 120 } },
  { text: "Tax", confidence: 95, bbox: { x0: 820, y0: 100, x1: 860, y1: 120 } },
  { text: "Amount", confidence: 95, bbox: { x0: 890, y0: 100, x1: 960, y1: 120 } },
];

const cols = detectColumnsFromHeaderWords(headerWords, 1200);
console.log("=== DETECTED COLUMNS FROM HEADER WORDS ===");
cols.forEach(c => console.log(`${c.headerText} -> ${c.type} [minX=${c.minX}, maxX=${c.maxX}]`));

// Now test mapping row words
const rowWords = [
  { text: "1", confidence: 95, bbox: { x0: 50, y0: 150, x1: 65, y1: 170 } },
  { text: "Aashirvaad", confidence: 95, bbox: { x0: 100, y0: 150, x1: 190, y1: 170 } },
  { text: "Atta", confidence: 95, bbox: { x0: 200, y0: 150, x1: 240, y1: 170 } },
  { text: "5", confidence: 95, bbox: { x0: 250, y0: 150, x1: 260, y1: 170 } },
  { text: "kg", confidence: 95, bbox: { x0: 265, y0: 150, x1: 285, y1: 170 } },
  { text: "1001", confidence: 95, bbox: { x0: 390, y0: 150, x1: 440, y1: 170 } },
  { text: "10", confidence: 95, bbox: { x0: 490, y0: 150, x1: 515, y1: 170 } },
  { text: "BAG", confidence: 95, bbox: { x0: 550, y0: 150, x1: 590, y1: 170 } },
  { text: "250.00", confidence: 95, bbox: { x0: 630, y0: 150, x1: 690, y1: 170 } },
  { text: "0", confidence: 95, bbox: { x0: 740, y0: 150, x1: 755, y1: 170 } },
  { text: "5%", confidence: 95, bbox: { x0: 830, y0: 150, x1: 855, y1: 170 } },
  { text: "2500.00", confidence: 95, bbox: { x0: 900, y0: 150, x1: 960, y1: 170 } },
];

const mapped = mapWordsToColumns(rowWords, cols);
console.log("\n=== MAPPED ROW CELLS ===");
console.log(mapped);
