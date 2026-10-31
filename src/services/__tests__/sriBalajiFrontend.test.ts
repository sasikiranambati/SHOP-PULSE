import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { mapBackendResponseToParsedInvoice } from '../../api/invoice';
import type { OCRLine, OCRWord } from '../ocrService';

function loadSriBalajiOcrData(): { lines: OCRLine[]; words: OCRWord[]; rawText: string } {
  const p = fs.existsSync('tests/fixtures/ocr/sri_balaji_ocr_words.json')
    ? 'tests/fixtures/ocr/sri_balaji_ocr_words.json'
    : 'scratch/sri_balaji_ocr_words.json';
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    lines: data.lines || [],
    words: data.words || [],
    rawText: data.text || '',
  };
}

describe('Sri Balaji Frontend Pipeline Diagnostics', () => {
  it('extracts Sri Balaji invoice in frontend flexible engine and inspects all prices', () => {
    const { lines, words, rawText } = loadSriBalajiOcrData();
    const result = parseInvoiceWithFlexibleEngine(lines, words, rawText, 'tesseract', []);
    
    console.log('=== METHOD USED:', result.extractionMethod, '| EXTRACTED ITEMS COUNT:', result.items.length);
    console.log('=== DETECTED COLUMNS:', JSON.stringify(result.diagnostics?.detectedColumnsList, null, 2));
    for (let i = 0; i < result.items.length; i++) {
      const it = result.items[i];
      console.log(
        `Item [${i + 1}]: "${it.name}" | Qty: ${it.quantity} ${it.unit} | Purch: ${it.purchasePrice} | Sell: ${it.sellingPrice} | MRP: ${it.mrp} | Total: ${it.lineTotal}`
      );
    }

    expect(result.items.length).toBeGreaterThanOrEqual(10);
    const chana = result.items.find((i) => i.name.toUpperCase().includes('CHANA'));
    expect(chana).toBeDefined();
    console.log('CHANA ITEM DETAILS:', JSON.stringify(chana, null, 2));
  });

  it('maps backend response through mapBackendResponseToParsedInvoice and verifies prices', () => {
    const p = fs.existsSync('tests/fixtures/ocr/sri_balaji_backend_resp.json')
      ? 'tests/fixtures/ocr/sri_balaji_backend_resp.json'
      : 'scratch/sri_balaji_backend_resp.json';
    const backendData = JSON.parse(fs.readFileSync(p, 'utf8'));
    const parsed = mapBackendResponseToParsedInvoice(backendData, []);
    
    console.log('=== BACKEND MAPPED ITEMS COUNT:', parsed.items.length);
    for (let i = 0; i < parsed.items.length; i++) {
      const it = parsed.items[i];
      console.log(
        `Backend Mapped [${i + 1}]: "${it.name}" | Qty: ${it.quantity} ${it.unit} | Purch: ${it.purchasePrice} | Sell: ${it.sellingPrice} | MRP: ${it.mrp} | Total: ${it.lineTotal}`
      );
    }

    const chana = parsed.items.find((i) => i.name.toUpperCase().includes('CHANA'));
    expect(chana).toBeDefined();
    expect(chana!.purchasePrice).toBe(2760);
    expect(chana!.sellingPrice).toBe(2950);
    expect(chana!.mrp).toBe(3200);
    expect(chana!.lineTotal).toBe(2760);
  });
});
