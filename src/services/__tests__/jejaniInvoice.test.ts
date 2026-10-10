import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { isCandidateHeaderLine, detectColumnsFromHeaderWords, mapWordsToColumns } from '../semanticColumnDetector';
import type { OCRLine, OCRWord } from '../ocrService';

function loadOcr3xData(): { lines: OCRLine[]; words: OCRWord[]; rawText: string } {
  if (!fs.existsSync('scratch/ocr_output_3x.json')) {
    return { lines: [], words: [], rawText: '' };
  }
  const data = JSON.parse(fs.readFileSync('scratch/ocr_output_3x.json', 'utf8'));
  const rawWords: OCRWord[] = [];
  const rawLines: OCRLine[] = [];

  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      if (Array.isArray(block.paragraphs)) {
        for (const para of block.paragraphs) {
          if (Array.isArray(para.lines)) {
            for (const line of para.lines) {
              const lineText = (line.text || '').trim();
              if (!lineText) continue;

              const lineBbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
              const lineWords: OCRWord[] = [];

              if (Array.isArray(line.words) && line.words.length > 0) {
                for (const w of line.words) {
                  const wt = (w.text || '').trim();
                  if (!wt) continue;
                  const wordObj: OCRWord = {
                    text: wt,
                    confidence: w.confidence || 80,
                    bbox: w.bbox || { ...lineBbox },
                  };
                  lineWords.push(wordObj);
                  rawWords.push(wordObj);
                }
              }
              lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);

              rawLines.push({
                text: lineText,
                confidence: line.confidence || 80,
                bbox: lineBbox,
                words: lineWords,
              });
            }
          }
        }
      }
    }
  }

  rawLines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  return { lines: rawLines, words: rawWords, rawText: data.text || '' };
}

describe('Jejani Kirana Real-World Invoice Test', () => {
  it('extracts all items, supplier, date, and totals from Jejani Kirana invoice', () => {
    const { lines, words, rawText } = loadOcr3xData();
    if (lines.length === 0) {
      console.warn('Skipping test: scratch/ocr_output_3x.json not present on disk');
      return;
    }
    console.log(`Loaded ${lines.length} lines, ${words.length} words from OCR 3x data.`);

    let detectedCols: any[] = [];
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      if (isCandidateHeaderLine(lines[i].text)) {
        const maxW = Math.max(1600, ...lines.flatMap((ln) => (ln.words || []).map((w) => w.bbox.x1)));
        detectedCols = detectColumnsFromHeaderWords(lines[i].words || [], maxW);
        console.log(`Detected columns on Line ${i}:`, detectedCols.map(c => `${c.headerText} -> ${c.type} [${Math.round(c.minX)}-${Math.round(c.maxX)}]`));
        break;
      }
    }

    if (detectedCols.length > 0) {
      console.log('\n--- Mapped line items (Lines 10 - 26) ---');
      for (let i = 10; i <= 26; i++) {
        const vals = (lines[i].words && lines[i].words.length > 0) ? mapWordsToColumns(lines[i].words, detectedCols) : {};
        console.log(`Line [${i}]: serial="${vals.serial}" name="${vals.productName}" qty="${vals.quantity}" rate="${vals.unitPrice}" tax="${vals.tax}" total="${vals.total}"`);
      }
    }

    const parsed = parseInvoiceWithFlexibleEngine(lines, words, rawText, 'tesseract', []);
    console.log('--- PARSED RESULT ---');
    console.log('Supplier:', parsed.supplierName);
    console.log('Invoice No:', parsed.invoiceNumber);
    console.log('Invoice Date:', parsed.invoiceDate);
    console.log('Total Amount:', parsed.totalAmount);
    console.log('Total Units:', parsed.totalUnits);
    console.log('Extracted Items Count:', parsed.items.length);
    console.log('Items:\n', JSON.stringify(parsed.items.map(i => ({
      name: i.name,
      qty: i.quantity,
      unit: i.unit,
      price: i.purchasePrice,
      total: i.lineTotal,
      tax: i.taxAmount,
      method: i.extractionMethod
    })), null, 2));

    expect(parsed.supplierName).toBe('Jejani Kirana');
    expect(parsed.invoiceDate).toBe('10-09-2021');
    expect(parsed.items.length).toBe(11);
    expect(parsed.totalUnits).toBe(187);
    expect(Math.abs(parsed.totalAmount - 132765)).toBeLessThanOrEqual(2);

    const firstItem = parsed.items[0];
    expect(firstItem.name.toLowerCase()).toContain('fortune besan');
    expect(firstItem.quantity).toBe(20);
    expect(firstItem.purchasePrice).toBe(70);
    expect(firstItem.lineTotal).toBe(1400);

    const secondItem = parsed.items[1];
    expect(secondItem.quantity).toBe(10);
    expect(secondItem.purchasePrice).toBe(30);
    expect(secondItem.lineTotal).toBe(300);

    const thirdItem = parsed.items[2];
    expect(thirdItem.name.toLowerCase()).toContain('can');
    expect(thirdItem.quantity).toBe(36);
    expect(thirdItem.purchasePrice).toBe(1975);
    expect(thirdItem.lineTotal).toBe(71100);

    const seventhItem = parsed.items[6];
    expect(seventhItem.name.toLowerCase()).toContain('chana');
    expect(seventhItem.quantity).toBe(50);
    expect(seventhItem.purchasePrice).toBe(129.46);
    expect(seventhItem.taxAmount).toBe(776.79);
    expect(seventhItem.lineTotal).toBe(7250);

    const lastItem = parsed.items[10];
    expect(lastItem.name.toLowerCase()).toContain('fortune oil');
    expect(lastItem.quantity).toBe(2);
    expect(lastItem.purchasePrice).toBe(2660);
    expect(lastItem.lineTotal).toBe(5320);
  });
});
