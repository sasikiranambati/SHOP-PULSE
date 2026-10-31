import { detectColumnsFromHeaderText, mapTokensToColumns } from '../src/services/semanticColumnDetector';
import { parseInvoiceWithFlexibleEngine } from '../src/services/invoiceScannerService';

const headerText = "S.No. Item Description HSN/SAC Qty Unit Rate Discount Tax Amount";
console.log("=== HEADER DETECTION ===");
const cols = detectColumnsFromHeaderText(headerText);
console.log("Detected columns from text:", cols.map(c => `${c.headerText} -> ${c.type}`));

const rowText = "1 Aashirvaad Atta 5 kg 1001 10 BAG 250 0 5% 2500";
console.log("\n=== TOKEN MAPPING ===");
const mapped = mapTokensToColumns(rowText, cols);
console.log("Mapped tokens:", mapped);
