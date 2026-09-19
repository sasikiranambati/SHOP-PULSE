/**
 * @file productExtractor.ts
 * @description Robust product line item extraction and OCR error correction.
 * Extracts product name, quantity, unit, purchase price, line total, and confidence,
 * handling multiplier formats (e.g. MILK x2 ₹50) and common OCR digit artifacts.
 */

import type { TableRow } from './tableParser';
import type { InvoiceLineItem } from './invoiceScannerService';

export interface ExtractedProductItem extends InvoiceLineItem {
  confidence: number;
  lowConfidence: boolean;
}

export interface SupplierDetectionResult {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierConfidence: number;
  invoiceNoConfidence: number;
  dateConfidence: number;
}

/**
 * Normalizes common OCR misreadings in numeric and currency strings:
 * - 'O' or 'o' -> '0'
 * - 'l', 'I', '|' -> '1'
 * - 'S', 's' -> '5'
 * - Currency symbols (₹, Rs, RS, /-)
 */
export function cleanNumericString(raw: string): string {
  let cleaned = raw
    .replace(/[₹$€£]/g, '')
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    .replace(/\/[-=]/g, '')
    .trim();

  // If token is mostly digits with occasional OCR letter substitutions
  if (/^[lI|OSsbB\d.,]+$/.test(cleaned) && cleaned.length >= 2) {
    cleaned = cleaned
      .replace(/[lI|]/g, '1')
      .replace(/[Oo]/g, '0')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8');
  }

  return cleaned;
}

/**
 * Infers Kirana / Retail category based on product title keywords.
 */
export function inferProductCategory(name: string): string {
  const n = name.toLowerCase();
  if (/milk|butter|cheese|paneer|curd|dahi|ghee|cream|yogurt|lassi|chaas/i.test(n)) {
    return 'Dairy';
  }
  if (/tea|chai|coffee|juice|cola|pepsi|sprite|fanta|water|soda|drink|shake|syrup|rooh|red\s*bull|energy/i.test(n)) {
    return 'Beverages';
  }
  if (/biscuit|cookie|chips|namkeen|maggi|noodle|pasta|kurkure|lays|chocolate|candy|wafer|snack|bhujia|mixture|popcorn/i.test(n)) {
    return 'Snacks';
  }
  if (/soap|shampoo|paste|colgate|brush|cream|lotion|dettol|face|hair|perfume|deo|powder|talc|oil\s*hair/i.test(n)) {
    return 'Personal Care';
  }
  if (/surf|detergent|rin|vim|dish|cleaner|phenyl|harpic|agarbatti|match|mosquito|allout|goodnight|liquid|bleach|broom/i.test(n)) {
    return 'Household';
  }
  return 'Groceries';
}

/**
 * Parses a single table row into a structured line item.
 * Supports:
 * 1. Multiplier / inline format: "MILK x2 ₹50", "Amul Butter 100g 2 x 50 = 100"
 * 2. Rate format: "Sugar 5kg @ 42 = 210"
 * 3. Tabular format: "Tata Salt 1kg  24  22.00  528.00"
 */
export function parseProductRow(row: TableRow): ExtractedProductItem | null {
  const rawText = row.text.trim();
  if (!rawText || rawText.length < 3) return null;

  let name = '';
  let quantity = 1;
  let unit = 'pcs';
  let purchasePrice = 0;
  let lineTotal = 0;
  let confidence = 85;

  // Average confidence from OCR words in this row
  if (row.words && row.words.length > 0) {
    const sumConf = row.words.reduce((acc, w) => acc + (w.confidence || 80), 0);
    confidence = Math.round(sumConf / row.words.length);
  }

  // --- Pattern 1: Multiplier / @ Format (e.g., "MILK x2 ₹50" or "Amul 2 x 45 = 90" or "Atta 5kg @ 220") ---
  const multiplierRegex = /^(.*?)(?:[xX*]|[@]\s*)(\d+(?:\.\d+)?)\s*(?:[xX*]|[@]\s*)?(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)(?:\s*(?:=|\bamt\b|\btotal\b)\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?))?/i;
  const multiMatch = rawText.match(multiplierRegex);

  if (multiMatch && multiMatch[1] && multiMatch[1].trim().length >= 2) {
    name = multiMatch[1].trim();
    quantity = Math.max(1, parseFloat(multiMatch[2]) || 1);
    purchasePrice = parseFloat(cleanNumericString(multiMatch[3])) || 0;
    if (multiMatch[4]) {
      lineTotal = parseFloat(cleanNumericString(multiMatch[4])) || 0;
    } else {
      lineTotal = Math.round(quantity * purchasePrice * 100) / 100;
    }
  }

  // --- Pattern 2: Tabular Space/Column Format ---
  if (!name || (purchasePrice <= 0 && lineTotal <= 0)) {
    // Detect package count units ("12 pcs", "20 packets", "5 boxes", "2 nos")
    const countUnitMatch = rawText.match(
      /(\d+(?:\.\d+)?)\s*(pcs|pc|nos|no|pkt|packet|packets|box|boxes|can|cans|bag|bags|ctn|carton)\b/i
    );
    // Detect weight / volume token ("1kg", "500g", "750ml", "1L")
    const weightUnitMatch = rawText.match(
      /(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ltr|ltrs|liter|litres|ml)\b/i
    );

    if (countUnitMatch) {
      quantity = Math.max(1, Math.round(parseFloat(countUnitMatch[1])));
      unit = countUnitMatch[2].toLowerCase();
    } else if (weightUnitMatch) {
      // Check if weight is the primary billing quantity (e.g. "Basmati Rice 5 kg 70 350")
      const isWeightBilled = /\b\d+\s*(kg|g|l|ltr)\s+(?:@\s*)?\d+/i.test(rawText);
      if (isWeightBilled) {
        quantity = parseFloat(weightUnitMatch[1]);
        unit = weightUnitMatch[2].toLowerCase();
      }
    }

    // Extract all numeric candidates in the row
    const tokens = rawText.split(/\s+/);
    const numericCandidates: number[] = [];

    for (const tok of tokens) {
      const cleaned = cleanNumericString(tok);
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0 && /^\d+(?:\.\d+)?$/.test(cleaned)) {
        numericCandidates.push(parsed);
      }
    }

    if (numericCandidates.length >= 3) {
      lineTotal = numericCandidates[numericCandidates.length - 1];
      purchasePrice = numericCandidates[numericCandidates.length - 2];
      if (!countUnitMatch && !weightUnitMatch) {
        quantity = Math.max(1, Math.round(numericCandidates[numericCandidates.length - 3]));
      }
    } else if (numericCandidates.length === 2) {
      lineTotal = numericCandidates[1];
      purchasePrice = numericCandidates[0];
      if (purchasePrice > lineTotal && quantity > 1) {
        // Swap if rate and total were reversed
        const tmp = lineTotal;
        lineTotal = purchasePrice;
        purchasePrice = tmp;
      }
    } else if (numericCandidates.length === 1) {
      purchasePrice = numericCandidates[0];
      lineTotal = Math.round(purchasePrice * quantity * 100) / 100;
    }

    // Isolate Product Name: filter out numeric tokens, unit tokens, and symbols
    const textTokens = tokens.filter((tok) => {
      if (countUnitMatch && countUnitMatch[0].toLowerCase().includes(tok.toLowerCase())) return false;
      if (weightUnitMatch && weightUnitMatch[0].toLowerCase().includes(tok.toLowerCase())) return false;
      const numCandidate = cleanNumericString(tok);
      if (/^\d+(?:\.\d+)?$/.test(numCandidate) && parseFloat(numCandidate) > 0) return false;
      if (/^(pcs|pc|nos|pkt|packet|packets|box|boxes|bag|bags|ctn|carton|rate|mrp|price|qty|amt|amount|total)$/i.test(tok)) return false;
      return true;
    });

    let cleanName = textTokens
      .join(' ')
      .replace(/^[0-9]+[.\-)]\s*/, '') // Remove leading serial number
      .replace(/₹|rs\.?/gi, '')
      .replace(/[|\-_*:=+]/g, ' ')
      .trim()
      .replace(/\s{2,}/g, ' ');

    // Reattach weight token neatly to product title (e.g. "Surf Excel Easy Wash 1kg")
    if (weightUnitMatch && !cleanName.toLowerCase().includes(weightUnitMatch[0].toLowerCase())) {
      cleanName = `${cleanName} ${weightUnitMatch[0]}`.trim();
    }

    name = cleanName;
  }

  // Sanity checks on parsed figures
  if (purchasePrice <= 0 && lineTotal > 0 && quantity > 0) {
    purchasePrice = Math.round((lineTotal / quantity) * 100) / 100;
  }
  if (lineTotal <= 0 && purchasePrice > 0) {
    lineTotal = Math.round(purchasePrice * quantity * 100) / 100;
  }

  // Filter out spurious 1-character names or non-product rows
  if (!name || name.length < 2 || (purchasePrice <= 0 && lineTotal <= 0)) {
    return null;
  }

  // Calculate default retail selling price (+20% margin or +₹5 minimum)
  const sellingPrice = Math.max(
    purchasePrice + 2,
    Math.round(purchasePrice * 1.2 * 10) / 10
  );

  const lowConfidence = confidence < 70 || purchasePrice <= 0 || name.length < 3;

  return {
    id: 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    name,
    category: inferProductCategory(name),
    quantity,
    unit,
    purchasePrice,
    sellingPrice,
    lineTotal,
    confidence,
    lowConfidence,
  };
}

/**
 * Extracts supplier header information with confidence scores.
 */
export function extractSupplierInfo(rows: TableRow[]): SupplierDetectionResult {
  let supplierName = '';
  let invoiceNumber = '';
  let invoiceDate = '';

  let supplierConfidence = 85;
  let invoiceNoConfidence = 60;
  let dateConfidence = 60;

  // 1. Supplier Name from top 6 lines
  const genericHeaders = /^(tax\s*invoice|cash\s*memo|retail\s*invoice|bill\s*of\s*supply|estimate|original|duplicate|gstin|phone|tel|address|date|inv|sl\.?\s*no)/i;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const text = rows[i].text.trim();
    if (text.length >= 3 && !genericHeaders.test(text) && !/^\d+$/.test(text)) {
      supplierName = text.replace(/^[#*.\-_=~|]+\s*/, '').trim();
      supplierConfidence = rows[i].words.reduce((sum, w) => sum + (w.confidence || 80), 0) / Math.max(1, rows[i].words.length);
      break;
    }
  }
  if (!supplierName) {
    supplierName = 'Supplier Bill';
    supplierConfidence = 50;
  }

  // 2. Invoice Number
  const strictInvRegex = /(?:invoice\s*(?:no|num|#)|bill\s*(?:no|num|#)|inv\s*(?:no|num|#)|memo\s*(?:no|num|#)|receipt\s*(?:no|num|#)|challan\s*(?:no|num|#))[.:\s\-]*([a-z0-9\-\/]{3,25})/i;
  for (const r of rows) {
    const m = r.text.match(strictInvRegex);
    if (m && m[1] && !/^(no|date|dt|tax|cash|retail|memo)$/i.test(m[1])) {
      invoiceNumber = m[1].toUpperCase();
      invoiceNoConfidence = 95;
      break;
    }
  }
  if (!invoiceNumber) {
    const fallbackInvRegex = /(?:invoice|inv|bill|memo|receipt)[.:#\s\-]+([a-z0-9\-\/]{3,25})/i;
    for (const r of rows) {
      const m = r.text.match(fallbackInvRegex);
      if (m && m[1] && !/^(no|date|dt|tax|cash|retail|memo|supply|original)$/i.test(m[1])) {
        invoiceNumber = m[1].toUpperCase();
        invoiceNoConfidence = 80;
        break;
      }
    }
  }
  if (!invoiceNumber) {
    invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    invoiceNoConfidence = 50;
  }

  // 3. Invoice Date
  const dateRegex = /(?:date|dt|dated)?[.:\s]*([0-3]?[0-9][\/\-.](?:[0-1]?[0-9]|[a-z]{3})[\/\-.](?:20)?[0-9]{2})/i;
  for (const r of rows) {
    const m = r.text.match(dateRegex);
    if (m && m[1]) {
      invoiceDate = m[1];
      dateConfidence = 95;
      break;
    }
  }
  if (!invoiceDate) {
    invoiceDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    dateConfidence = 50;
  }

  return {
    supplierName,
    invoiceNumber,
    invoiceDate,
    supplierConfidence: Math.round(supplierConfidence),
    invoiceNoConfidence,
    dateConfidence,
  };
}

/**
 * Extracts the grand total from rows or calculates sum of line items.
 */
export function extractGrandTotal(rows: TableRow[], items: ExtractedProductItem[]): number {
  const totalKeywords = ['grand total', 'net amount', 'bill amount', 'total amount', 'amount payable', 'subtotal', 'total'];

  for (let i = rows.length - 1; i >= 0; i--) {
    const text = rows[i].text;
    const lower = text.toLowerCase();
    const hasTotalWord = totalKeywords.some((kw) => lower.includes(kw));

    if (hasTotalWord) {
      // Find the last numeric candidate in this row
      const tokens = text.split(/\s+/);
      for (let j = tokens.length - 1; j >= 0; j--) {
        const cleaned = cleanNumericString(tokens[j]);
        const val = parseFloat(cleaned);
        if (!isNaN(val) && val > 0 && /^\d+(?:\.\d+)?$/.test(cleaned)) {
          return val;
        }
      }
    }
  }

  // Fallback to sum of parsed line items
  return Math.round(items.reduce((acc, it) => acc + (it.lineTotal || 0), 0) * 100) / 100;
}

