import { parseInvoiceWithFlexibleEngine } from '../src/services/invoiceScannerService';
import { detectColumnsFromHeaderText, detectColumnsFromHeaderWords, mapTokensToColumns } from '../src/services/semanticColumnDetector';

const headerText = "S.No. Item Description HSN/SAC Qty Unit Rate Discount Tax Amount";
console.log("=== HEADER DETECTION ===");
const cols = detectColumnsFromHeaderText(headerText);
console.log("Detected columns from text:", cols.map(c => `${c.headerText} -> ${c.type}`));

const rowText = "1 Aashirvaad Atta 5 kg 1001 10 BAG 250 0 5% 2500";
console.log("\n=== TOKEN MAPPING ===");
const mapped = mapTokensToColumns(rowText, cols);
console.log("Mapped tokens:", mapped);

const demoInvoiceRaw = `
S.No. Item Description HSN/SAC Qty Unit Rate Discount Tax Amount
1 Aashirvaad Atta 5 kg 1001 10 BAG 250 0 5% 2500
2 Tata Salt 1 kg 2501 20 PKT 25 0 0% 500
3 Fortune Sunflower Oil 1 L 1512 10 BTL 150 0 5% 1500
4 Parle-G Biscuit 800 g 1905 30 PKT 60 0 0% 1800
5 Britannia Marie Gold 800 g 1905 20 PKT 70 0 0% 1400
6 Surf Excel 1 kg 3402 5 PKT 200 0 18% 1000
7 Colgate Toothpaste 200 g 3306 24 PKT 85 0 12% 2040
8 Dettol Soap 125 g 3401 36 PKT 35 0 18% 1260
9 Sugar 1 kg 1701 50 PKT 40 0 5% 2000
10 Masoor Dal 1 kg 0713 25 PKT 120 0 0% 3000
Subtotal: 17000.00
Grand Total: 17000.00
`;

console.log("\n=== FLEXIBLE ENGINE RESULT ===");
const parsed = parseInvoiceWithFlexibleEngine([], [], demoInvoiceRaw, 'tesseract', []);
console.log("Method used:", parsed.extractionMethod);
console.log("Items count:", parsed.items.length);
parsed.items.forEach((it, idx) => {
  console.log(`[${idx+1}] Name: "${it.name}" | Qty: ${it.quantity} | Unit: ${it.unit} | Rate: ${it.rate} | Purch: ${it.purchasePrice} | Sell: ${it.sellingPrice} | MRP: ${it.mrp} | Total: ${it.lineTotal}`);
});
