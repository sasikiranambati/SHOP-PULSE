/**
 * @file tableParser.ts
 * @description Layout-aware spatial table parser for invoices and receipts.
 * Clusters fragmented OCR words into coherent horizontal rows using geometric
 * bounding box baselines, detects columns, and isolates product lines.
 */

import type { OCRWord, BoundingBox } from './ocrService';

export interface TableRow {
  words: OCRWord[];
  text: string;
  bbox: BoundingBox;
  yCenter: number;
}

export interface ColumnDefinition {
  type: 'description' | 'quantity' | 'rate' | 'amount' | 'unknown';
  minX: number;
  maxX: number;
}

export interface DetectedTable {
  headerRow?: TableRow;
  columns: ColumnDefinition[];
  bodyRows: TableRow[];
}

/**
 * Clusters OCR words into visual horizontal rows using Y-overlap / baseline proximity.
 * Fixes the fragmented OCR text problem where words in the same table row
 * were placed on separate lines by Tesseract.
 */
export function clusterWordsIntoRows(words: OCRWord[]): TableRow[] {
  if (!words || words.length === 0) return [];

  // Filter out tiny punctuation or noise bounding boxes
  const validWords = words.filter(
    (w) => w.text.length > 0 && (w.bbox.x1 - w.bbox.x0 > 2) && (w.bbox.y1 - w.bbox.y0 > 2)
  );

  // Sort words vertically by top Y coordinate
  validWords.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const rows: TableRow[] = [];

  for (const word of validWords) {
    const wordYCenter = (word.bbox.y0 + word.bbox.y1) / 2;
    const wordHeight = Math.max(8, word.bbox.y1 - word.bbox.y0);

    // Find an existing row with matching vertical baseline (within 60% of word height)
    let matchedRow: TableRow | null = null;
    let minDistance = Infinity;

    for (const row of rows) {
      const rowHeight = Math.max(8, row.bbox.y1 - row.bbox.y0);
      const tolerance = Math.max(wordHeight, rowHeight) * 0.65;
      const dist = Math.abs(wordYCenter - row.yCenter);

      if (dist < tolerance && dist < minDistance) {
        minDistance = dist;
        matchedRow = row;
      }
    }

    if (matchedRow) {
      matchedRow.words.push(word);
      matchedRow.bbox.x0 = Math.min(matchedRow.bbox.x0, word.bbox.x0);
      matchedRow.bbox.y0 = Math.min(matchedRow.bbox.y0, word.bbox.y0);
      matchedRow.bbox.x1 = Math.max(matchedRow.bbox.x1, word.bbox.x1);
      matchedRow.bbox.y1 = Math.max(matchedRow.bbox.y1, word.bbox.y1);
      matchedRow.yCenter = (matchedRow.bbox.y0 + matchedRow.bbox.y1) / 2;
    } else {
      rows.push({
        words: [word],
        text: word.text,
        bbox: { ...word.bbox },
        yCenter: wordYCenter,
      });
    }
  }

  // Sort words in each row horizontally from left to right and compose line text
  for (const row of rows) {
    row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    row.text = row.words.map((w) => w.text).join(' ');
  }

  // Sort rows vertically top to bottom
  rows.sort((a, b) => a.yCenter - b.yCenter);

  return rows;
}

/**
 * Detects if a row represents a table header row (e.g. Product Qty Rate Amount).
 */
export function isTableHeaderRow(text: string): boolean {
  const t = text.toLowerCase();
  const keywords = ['particular', 'desc', 'item', 'product', 'qty', 'quantity', 'rate', 'price', 'mrp', 'amount', 'total', 'disc', 'hsn'];
  const matches = keywords.filter((k) => t.includes(k));
  return matches.length >= 2;
}

/**
 * Detects whether a row looks like a product item row (contains text and numbers).
 */
export function isCandidateItemRow(row: TableRow): boolean {
  const text = row.text.trim();
  if (!text || text.length < 3) return false;

  const lower = text.toLowerCase();

  // Exclude summary, tax, or footer rows
  const footerWords = [
    'grand total', 'sub total', 'subtotal', 'net amount', 'total amount',
    'total', 'cgst', 'sgst', 'igst', 'round off', 'round-off', 'cash tendered',
    'change due', 'thank you', 'terms and conditions', 'signature',
    'for ', 'authorized', 'taxable amount', 'balance'
  ];
  if (footerWords.some((fw) => lower.startsWith(fw) || lower === fw || lower.startsWith(fw + ':') || lower.startsWith(fw + ' '))) {
    return false;
  }

  // Exclude bill metadata rows (Invoice No, Date, Phone, GSTIN)
  const metaPrefixes = [
    'invoice no', 'inv no', 'bill no', 'memo no', 'date:', 'date :', 'dated',
    'gstin', 'gst no', 'phone', 'ph:', 'tel:', 'customer', 'buyer', 'address'
  ];
  if (metaPrefixes.some((mp) => lower.startsWith(mp))) {
    return false;
  }

  // Row must contain at least one number
  const hasNumber = /\d/.test(text);
  // Row must contain at least one alphabetic character
  const hasAlpha = /[a-zA-Z]/.test(text);

  return hasNumber && hasAlpha;
}

/**
 * Segregates invoice content into structured table sections.
 */
export function detectTableFromRows(rows: TableRow[]): DetectedTable {
  let headerIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (isTableHeaderRow(rows[i].text)) {
      headerIndex = i;
      break;
    }
  }

  const columns: ColumnDefinition[] = [];
  const bodyRows: TableRow[] = [];

  if (headerIndex !== -1) {
    const headerRow = rows[headerIndex];
    // Create columns from header words
    for (const w of headerRow.words) {
      const lower = w.text.toLowerCase();
      let type: ColumnDefinition['type'] = 'unknown';
      if (/item|particular|desc|product/i.test(lower)) type = 'description';
      else if (/qty|quantity|nos|count/i.test(lower)) type = 'quantity';
      else if (/rate|price|mrp|cost/i.test(lower)) type = 'rate';
      else if (/amount|total|val/i.test(lower)) type = 'amount';

      columns.push({
        type,
        minX: w.bbox.x0,
        maxX: w.bbox.x1,
      });
    }

    // Body rows are rows below header that match candidate item row criteria
    for (let i = headerIndex + 1; i < rows.length; i++) {
      if (isCandidateItemRow(rows[i])) {
        bodyRows.push(rows[i]);
      }
    }

    return {
      headerRow,
      columns,
      bodyRows,
    };
  }

  // Fallback for bills without explicit header row (e.g. thermal receipts, quick memos)
  for (const r of rows) {
    if (isCandidateItemRow(r)) {
      bodyRows.push(r);
    }
  }

  return {
    columns,
    bodyRows,
  };
}
