import { detectColumnsFromHeaderWords, mapWordsToColumns } from '../src/services/semanticColumnDetector';

// Simulate realistic OCR words across an invoice line of width 1200:
// S.No: 40-90
// Item Description: 100-350
// HSN/SAC: 380-460
// Qty: 480-530
// Unit: 540-600
// Rate: 620-680
// Discount: 700-790
// Tax: 810-860
// Amount: 900-990

const headerWords = [
  { text: "S.No.", confidence: 95, bbox: { x0: 40, y0: 100, x1: 90, y1: 120 } },
  { text: "Item", confidence: 95, bbox: { x0: 100, y0: 100, x1: 150, y1: 120 } },
  { text: "Description", confidence: 95, bbox: { x0: 160, y0: 100, x1: 300, y1: 120 } },
  { text: "HSN/SAC", confidence: 95, bbox: { x0: 380, y0: 100, x1: 460, y1: 120 } },
  { text: "Qty", confidence: 95, bbox: { x0: 480, y0: 100, x1: 520, y1: 120 } },
  { text: "Unit", confidence: 95, bbox: { x0: 540, y0: 100, x1: 590, y1: 120 } },
  { text: "Rate", confidence: 95, bbox: { x0: 620, y0: 100, x1: 670, y1: 120 } },
  { text: "Discount", confidence: 95, bbox: { x0: 700, y0: 100, x1: 780, y1: 120 } },
  { text: "Tax", confidence: 95, bbox: { x0: 810, y0: 100, x1: 850, y1: 120 } },
  { text: "Amount", confidence: 95, bbox: { x0: 900, y0: 100, x1: 980, y1: 120 } },
];

const cols = detectColumnsFromHeaderWords(headerWords, 1200);
console.log("=== DETECTED COLUMNS FROM WORDS ===");
cols.forEach(c => console.log(`${c.headerText} -> ${c.type} [minX=${c.minX}, maxX=${c.maxX}]`));

// Now simulate a data row:
// "1 Aashirvaad Atta 5 kg 1001 10 BAG 250 0 5% 2500"
// S.No: 1 (50-65)
// Product: Aashirvaad Atta 5 kg (100-340)
// HSN: 1001 (390-440)
// Qty: 10 (490-515)
// Unit: BAG (550-590)
// Rate: 250 (630-670)
// Discount: 0 (730-745)
// Tax: 5% (820-845)
// Amount: 2500 (915-965)
const rowWords = [
  { text: "1", confidence: 95, bbox: { x0: 50, y0: 150, x1: 65, y1: 170 } },
  { text: "Aashirvaad", confidence: 95, bbox: { x0: 100, y0: 150, x1: 190, y1: 170 } },
  { text: "Atta", confidence: 95, bbox: { x0: 200, y0: 150, x1: 240, y1: 170 } },
  { text: "5", confidence: 95, bbox: { x0: 250, y0: 150, x1: 265, y1: 170 } },
  { text: "kg", confidence: 95, bbox: { x0: 275, y0: 150, x1: 300, y1: 170 } },
  { text: "1001", confidence: 95, bbox: { x0: 390, y0: 150, x1: 440, y1: 170 } },
  { text: "10", confidence: 95, bbox: { x0: 490, y0: 150, x1: 515, y1: 170 } },
  { text: "BAG", confidence: 95, bbox: { x0: 550, y0: 150, x1: 590, y1: 170 } },
  { text: "250", confidence: 95, bbox: { x0: 630, y0: 150, x1: 670, y1: 170 } },
  { text: "0", confidence: 95, bbox: { x0: 730, y0: 150, x1: 745, y1: 170 } },
  { text: "5%", confidence: 95, bbox: { x0: 820, y0: 150, x1: 845, y1: 170 } },
  { text: "2500", confidence: 95, bbox: { x0: 915, y0: 150, x1: 965, y1: 170 } },
];

const mapped = mapWordsToColumns(rowWords, cols);
console.log("\n=== MAPPED ROW CELLS ===");
console.log(mapped);
