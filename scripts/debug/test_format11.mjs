import { parseInvoiceWithFlexibleEngine } from '../src/services/invoiceScannerService.ts';

const noisyPhotoText = `
*# CASH MEMO #*
GUPTA PROVISIONS STORE
Date: 10-09-2026
Invoice No: GPS-102
| 1 | Surf Excel 1kg | 1 | 14O | 14O |
| 2 | Parle-G Biscuit | 1O | 1O | 1OO |
| Total: 240 |
`.trim();

const parsed = parseInvoiceWithFlexibleEngine([], [], noisyPhotoText, 'tesseract', []);
console.log("Method:", parsed.extractionMethod);
console.log("Items:", parsed.items.map(it => ({ name: it.name, qty: it.quantity, rate: it.rate, price: it.purchasePrice, total: it.lineTotal })));
