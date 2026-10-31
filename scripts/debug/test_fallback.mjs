import fs from 'fs';
import { parseProductLine } from '../src/services/invoiceParser.ts';

const data = JSON.parse(fs.readFileSync('scratch/sri_balaji_ocr.json', 'utf8'));

console.log("=== PARSING WITH parseProductLine ===");
for (const line of data.lines) {
  const p = parseProductLine(line.text, 80);
  if (p) {
    console.log(`Line: "${line.text}"`);
    console.log(`   -> Product: "${p.name}", Qty: ${p.quantity}, Unit: "${p.unit}", PurchasePrice: ${p.purchasePrice}, SellingPrice: ${p.sellingPrice}, LineTotal: ${p.lineTotal}`);
  }
}
