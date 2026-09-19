/**
 * @file invoiceParser.ts
 * @description Layout-Aware OCR Invoice & Bill Parser for ShopPulse.
 * Implements smart line classification (HEADER, PRODUCT, TOTAL, GST, FOOTER, SUPPLIER, DATE),
 * OCR mistake handling (0 <-> O, 1 <-> I, ₹ -> Rs, merged units), flexible multi-format product detection,
 * spatial table reconstruction, and automatic total calculations.
 */

import type { OCRWord, OCRLine, BoundingBox } from './ocrService';

export type LineClassification =
  | 'HEADER'
  | 'PRODUCT'
  | 'TOTAL'
  | 'GST'
  | 'FOOTER'
  | 'SUPPLIER'
  | 'DATE'
  | 'UNKNOWN';

export type ProductUnit = 'kg' | 'g' | 'L' | 'ml' | 'pcs' | 'pkt' | 'box' | 'bag';

export interface ExtractedProduct {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: ProductUnit;
  purchasePrice: number;
  sellingPrice: number;
  lineTotal: number;
  confidence: number;
  lowConfidence: boolean;
  rawLine: string;
}

export interface ClassifiedLine {
  text: string;
  classification: LineClassification;
  confidence: number;
  words?: OCRWord[];
  bbox?: BoundingBox;
}

export interface InvoiceParsingResult {
  supplierName: string;
  supplierConfidence: number;
  invoiceNumber: string;
  invoiceNoConfidence: number;
  invoiceDate: string;
  dateConfidence: number;
  items: ExtractedProduct[];
  totalAmount: number;
  totalUnits: number;
  totalItems: number;
  classifiedLines: ClassifiedLine[];
  overallConfidence: number;
}

// ---------------------------------------------------------------------------
// Step 4: OCR Mistake Handling & Token Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes common OCR misreadings in numeric and currency contexts:
 * - 'O', 'o' -> '0'
 * - 'I', 'l', '|', '!' -> '1'
 * - 'S', 's' -> '5'
 * - 'B' -> '8'
 * - Removes currency symbols ('₹', 'Rs', 'RS', 'INR', '/-', '=')
 */
export function cleanNumericToken(raw: string): string {
  if (!raw) return '';

  let cleaned = raw
    .replace(/[₹$€£]/g, '')
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    .replace(/\/[-=]/g, '')
    .trim();

  // If token is mostly digits with occasional letter confusions (e.g. "12OO", "2I6", "4S0", "B00")
  if (/^[lI|!OSsbB\d.,]+$/.test(cleaned) && cleaned.length >= 2) {
    cleaned = cleaned
      .replace(/[lI|!]/g, '1')
      .replace(/[Oo]/g, '0')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8');
  }

  return cleaned;
}

/**
 * Normalizes string units to the 8 supported core units:
 * kg, g, L, ml, pcs, pkt, box, bag
 */
export function normalizeUnit(rawUnit: string): ProductUnit {
  const u = (rawUnit || '').toLowerCase().replace(/[^a-z]/g, '');

  if (/^(kg|kgs|kilogram|kilograms)$/.test(u)) return 'kg';
  if (/^(g|gm|gms|gram|grams)$/.test(u)) return 'g';
  if (/^(l|ltr|ltrs|liter|liters|litre|litres)$/.test(u)) return 'L';
  if (/^(ml|mls|milli|milliliter|milliliters)$/.test(u)) return 'ml';
  if (/^(pkt|pkts|packet|packets|pack|packs|pouch|pouches)$/.test(u)) return 'pkt';
  if (/^(box|boxes|carton|cartons|ctn|tin|tins|can|cans)$/.test(u)) return 'box';
  if (/^(bag|bags|sack|sacks)$/.test(u)) return 'bag';
  return 'pcs';
}

/**
 * Splits merged words such as "25kg", "5L", "500ml", "10pcs", "3pkt", "2box", "1bag".
 */
export function splitMergedUnits(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|l|ltr|ltrs|liter|ml|pcs|pc|pkt|pkts|box|boxes|bag|bags|nos|ctn|tin)\b/gi, '$1 $2')
    .replace(/([xX*])(\d+)/g, '$1 $2')
    .replace(/(\d+)([xX*])/g, '$1 $2')
    .replace(/@(\d+)/g, '@ $1');
}

/**
 * Infers category for inventory matching based on product title keywords.
 */
export function inferProductCategory(name: string): string {
  const n = name.toLowerCase();
  if (/milk|butter|cheese|paneer|curd|dahi|ghee|cream|yogurt|lassi|chaas/i.test(n)) {
    return 'Dairy';
  }
  if (/tea|chai|coffee|juice|cola|pepsi|sprite|fanta|water|soda|drink|shake|syrup|energy/i.test(n)) {
    return 'Beverages';
  }
  if (/biscuit|cookie|chips|namkeen|maggi|noodle|pasta|kurkure|lays|chocolate|candy|wafer|snack|bhujia|mixture|popcorn/i.test(n)) {
    return 'Snacks';
  }
  if (/soap|shampoo|paste|colgate|brush|cream|lotion|dettol|face|hair|perfume|deo|powder|talc/i.test(n)) {
    return 'Personal Care';
  }
  if (/surf|detergent|rin|vim|dish|cleaner|phenyl|harpic|agarbatti|match|mosquito|allout|goodnight|liquid|bleach|broom/i.test(n)) {
    return 'Household';
  }
  return 'Groceries';
}

// ---------------------------------------------------------------------------
// Step 5: Smart Line Classification
// ---------------------------------------------------------------------------

/**
 * Header column keywords for layout-aware table detection.
 */
export const TABLE_HEADER_KEYWORDS = [
  'item',
  'product',
  'description',
  'particulars',
  'qty',
  'quantity',
  'rate',
  'price',
  'amount',
  'total',
  'gst',
  'hsn',
  'sac',
  'sr',
  'sl',
  'mrp',
  'disc',
  'unit',
];

/**
 * Total line keywords for bill summary detection.
 */
export const TOTAL_KEYWORDS = [
  'grand total',
  'net amount',
  'net payable',
  'bill amount',
  'total amount',
  'total bill',
  'total payable',
  'sub total',
  'subtotal',
  'amount payable',
  'balance due',
  'cash tendered',
  'change due',
  'total rs',
  'total:',
  'total -',
];

/**
 * GST / Tax line keywords.
 */
export const GST_KEYWORDS = [
  'cgst',
  'sgst',
  'igst',
  'taxable value',
  'taxable amount',
  'gstin',
  'tax amount',
  'input tax credit',
  'output gst',
  'total tax',
  'gst @',
  'gst% ',
  'cess',
];

/**
 * Footer keywords.
 */
export const FOOTER_KEYWORDS = [
  'thank you',
  'thanks',
  'visit again',
  'terms and conditions',
  'terms & conditions',
  'authorized signatory',
  'authorised signatory',
  'signature',
  'for ',
  'e.&o.e',
  'subject to',
  'jurisdiction',
  'bank details',
  'ifsc',
  'account no',
  'computer generated',
  'goods once sold',
];

/**
 * Supplier / Header metadata keywords.
 */
export const SUPPLIER_KEYWORDS = [
  'wholesale',
  'distributor',
  'distributors',
  'traders',
  'trading',
  'enterprise',
  'enterprises',
  'store',
  'stores',
  'kirana',
  'agencies',
  'agency',
  'pvt ltd',
  'ltd',
  'co.',
  'corporation',
  'supermarket',
  'mart',
  'cash & carry',
  'm/s',
  'provisions',
  'general store',
];

/**
 * Classifies an individual OCR line into one of 7 structured categories:
 * HEADER, PRODUCT, TOTAL, GST, FOOTER, SUPPLIER, DATE (or UNKNOWN).
 */
export function classifyLine(lineText: string, lineIndex: number, totalLines: number): LineClassification {
  const clean = lineText.trim();
  if (!clean || clean.length < 2) return 'UNKNOWN';

  const lower = clean.toLowerCase();

  // 1. DATE: Matches explicit date prefixes or standalone standard date format
  const dateRegex = /(?:^|\b)(?:date|dt|dated)?[.:\s]*[0-3]?[0-9][\/\-.](?:[0-1]?[0-9]|[a-z]{3})[\/\-.](?:20)?[0-9]{2}\b/i;
  if (
    lower.startsWith('date:') ||
    lower.startsWith('date :') ||
    lower.startsWith('dated') ||
    (lower.length <= 25 && dateRegex.test(clean) && !/\d+\s*(?:kg|pcs|pkt|box|bag|l|ml)/i.test(clean))
  ) {
    return 'DATE';
  }

  // 2. TOTAL: Bill summary row
  const hasTotalWord = TOTAL_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasTotalWord && !lower.includes('hsn') && !lower.includes('item')) {
    return 'TOTAL';
  }

  // 3. GST: Tax breakdown row
  const hasGstWord = GST_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasGstWord && !(TABLE_HEADER_KEYWORDS.filter((k) => lower.includes(k)).length >= 3)) {
    return 'GST';
  }

  // 4. HEADER: Table column definition row (must contain at least 2 table header keywords)
  const headerMatches = TABLE_HEADER_KEYWORDS.filter((kw) => {
    const wordBoundaryRegex = new RegExp(`\\b${kw}\\b`, 'i');
    return wordBoundaryRegex.test(lower);
  });
  if (headerMatches.length >= 2 || /^(particulars|description of goods|item details)\b/i.test(lower)) {
    return 'HEADER';
  }

  // 5. FOOTER: Terms, greetings, signatures, bank details
  const hasFooterWord = FOOTER_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasFooterWord || (lineIndex > totalLines * 0.7 && /^(ph:|phone|tel|email|address):/i.test(lower))) {
    return 'FOOTER';
  }

  // 6. SUPPLIER: Header line with vendor title (top 5 lines of document)
  const cleanAlphaNum = lower.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();
  const isGenericDocLabel = /^(tax\s*invoice|cash\s*memo|retail\s*invoice|bill\s*of\s*supply|estimate|original|duplicate|invoice\s*no|date|gstin)/i.test(cleanAlphaNum);

  if (lineIndex <= 4 && !isGenericDocLabel) {
    if (SUPPLIER_KEYWORDS.some((kw) => lower.includes(kw)) || lineIndex === 0) {
      return 'SUPPLIER';
    }
  }

  // 7. PRODUCT: Any line with textual description and at least one numeric candidate
  const hasLetters = /[a-zA-Z]/.test(clean);
  const hasDigits = /\d/.test(clean);

  // Exclude standalone phone, GSTIN, invoice numbers, or serial numbers
  const isPureMetadata =
    /^(?:invoice|bill|challan|memo)\s*(?:no|#|num)?[:.\s-]*[a-z0-9\/-]+$/i.test(clean) ||
    /^(?:gstin|gst\s*no|cin)[:.\s-]*[a-z0-9]+$/i.test(clean) ||
    /^(?:phone|tel|mobile|ph)[:.\s-]*\d+$/i.test(clean);

  if (hasLetters && hasDigits && !isPureMetadata && !isGenericDocLabel) {
    return 'PRODUCT';
  }

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Step 3: Flexible Multi-Format Product Detection
// ---------------------------------------------------------------------------

/**
 * Extracts structured product fields from an OCR line.
 * Supports:
 * - "Rice 25kg 1200" -> name: "Rice", qty: 25, unit: "kg", purchasePrice: 1200
 * - "Sugar 10 450" -> name: "Sugar", qty: 10, unit: "pcs", purchasePrice: 450
 * - "Oil 5L 600" -> name: "Oil", qty: 5, unit: "L", purchasePrice: 600
 * - "Tata Salt 1kg 24 22 528" -> name: "Tata Salt 1kg", qty: 24, unit: "pcs", purchasePrice: 22, lineTotal: 528
 * - "MILK x2 ₹50" -> name: "MILK", qty: 2, unit: "pcs", purchasePrice: 50, lineTotal: 100
 * - "1. Basmati Rice 25kg 1006 1 BAG 1400 1400.00"
 */
export function parseProductLine(rawLine: string, initialConfidence: number = 85): ExtractedProduct | null {
  const line = rawLine.trim();
  if (!line || line.length < 2) return null;

  // Split merged units (e.g. 25kg -> 25 kg, 5L -> 5 L)
  const normalizedLine = splitMergedUnits(line);

  let name = '';
  let quantity = 1;
  let unit: ProductUnit = 'pcs';
  let purchasePrice = 0;
  let lineTotal = 0;
  let confidence = initialConfidence;
  let lowConfidence = false;

  // Clean leading serial number (e.g. "1.", "01)", "1 -", "#1") and table borders
  let cleanLine = normalizedLine
    .replace(/^[|#*.\-_=~]+\s*/, '')
    .replace(/[|#*.\-_=~]+$/, '')
    .replace(/^[#*.\-_=~|]*\s*(?:[0-9]{1,3}[.)\-]|\([0-9]{1,3}\))\s*/, '')
    .trim();

  // --- Pattern A1: Multiplier with Total (e.g. "Amul Milk 500ml 2 x 25 = 50" or "Good Day 3 * 20 = 60") ---
  const multiTotalRegex = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(?:[xX*]|[@])\s*(\d+(?:\.\d+)?)\s*(?:=|\bamt\b|\btotal\b)\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;
  const multiTotalMatch = cleanLine.match(multiTotalRegex);

  // --- Pattern A2: Multiplier with Price (e.g. "MILK x2 ₹50" or "Soap x 3 30") ---
  const multiRateRegex = /^(.*?)\s*(?:[xX*])\s*(\d+(?:\.\d+)?)\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)$/i;
  const multiRateMatch = cleanLine.match(multiRateRegex);

  // --- Pattern A3: Rate with @ (e.g. "Atta 5kg @ 220") ---
  const atRateRegex = /^(.*?)\s*[@]\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)$/i;
  const atRateMatch = cleanLine.match(atRateRegex);

  if (multiTotalMatch && multiTotalMatch[1] && multiTotalMatch[2] && multiTotalMatch[3] && multiTotalMatch[4]) {
    name = multiTotalMatch[1].trim();
    quantity = Math.max(1, parseFloat(cleanNumericToken(multiTotalMatch[2])) || 1);
    purchasePrice = parseFloat(cleanNumericToken(multiTotalMatch[3])) || 0;
    lineTotal = parseFloat(cleanNumericToken(multiTotalMatch[4])) || Math.round(quantity * purchasePrice * 100) / 100;

    const packUnitMatch = name.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pkt|box|bag)\b/i);
    if (packUnitMatch) {
      unit = normalizeUnit(packUnitMatch[2]);
    }
  } else if (multiRateMatch && multiRateMatch[1] && multiRateMatch[2] && multiRateMatch[3]) {
    name = multiRateMatch[1].trim();
    quantity = Math.max(1, parseFloat(cleanNumericToken(multiRateMatch[2])) || 1);
    purchasePrice = parseFloat(cleanNumericToken(multiRateMatch[3])) || 0;
    lineTotal = Math.round(quantity * purchasePrice * 100) / 100;

    const packUnitMatch = name.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pkt|box|bag)\b/i);
    if (packUnitMatch) {
      unit = normalizeUnit(packUnitMatch[2]);
    }
  } else if (atRateMatch && atRateMatch[1] && atRateMatch[2]) {
    name = atRateMatch[1].trim();
    quantity = 1;
    purchasePrice = parseFloat(cleanNumericToken(atRateMatch[2])) || 0;
    lineTotal = purchasePrice;

    const packUnitMatch = name.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pkt|box|bag)\b/i);
    if (packUnitMatch) {
      unit = normalizeUnit(packUnitMatch[2]);
    }
  }

  // --- Pattern B: General Token-Based Parser ---
  if (!name || (purchasePrice <= 0 && lineTotal <= 0)) {
    const tokens = cleanLine.split(/\s+/);

    // Detect explicit unit tokens with quantities: "25 kg", "10 pcs", "5 L", "1 bag", "2 box"
    const unitTokenRegex = /^(\d+(?:\.\d+)?)$/;
    const unitWordRegex = /^(kg|kgs|kilogram|g|gm|gms|l|ltr|ltrs|liter|ml|pcs|pc|nos|pkt|pkts|packet|box|boxes|bag|bags|ctn|tin)$/i;

    let detectedUnitIndex = -1;
    let explicitUnitQty = 0;
    let explicitUnit: ProductUnit = 'pcs';

    for (let i = 0; i < tokens.length - 1; i++) {
      if (unitTokenRegex.test(tokens[i]) && unitWordRegex.test(tokens[i + 1])) {
        explicitUnitQty = parseFloat(tokens[i]);
        explicitUnit = normalizeUnit(tokens[i + 1]);
        detectedUnitIndex = i;
        break;
      }
    }

    // Extract all numeric candidates with their token index
    interface NumCandidate {
      val: number;
      idx: number;
      isHsn: boolean;
    }

    const numCandidates: NumCandidate[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const cleaned = cleanNumericToken(tokens[i]);
      const parsed = parseFloat(cleaned);

      if (!isNaN(parsed) && parsed > 0 && /^\d+(?:\.\d+)?$/.test(cleaned)) {
        // HSN codes are typically 4 to 8 digits and placed in middle columns
        const isHsn = /^\d{4,8}$/.test(cleaned) && i > 0 && i < tokens.length - 2;
        numCandidates.push({ val: parsed, idx: i, isHsn });
      }
    }

    // Filter out HSN candidates from pricing candidates
    const priceCandidates = numCandidates.filter((nc) => !nc.isHsn);
    const remainingNums = priceCandidates.filter((nc) => nc.idx !== detectedUnitIndex);

    const isPackSizeInTitle = detectedUnitIndex !== -1 && remainingNums.length >= 3;

    if (detectedUnitIndex !== -1 && explicitUnitQty > 0) {
      if (remainingNums.length >= 3) {
        // Format: "Tata Salt 1kg 24 22 528"
        quantity = Math.max(1, remainingNums[remainingNums.length - 3].val);
        purchasePrice = remainingNums[remainingNums.length - 2].val;
        lineTotal = remainingNums[remainingNums.length - 1].val;
        unit = 'pcs';
      } else if (remainingNums.length === 2) {
        // Format: "Basmati Rice 25kg 48 1200"
        quantity = explicitUnitQty;
        unit = explicitUnit;
        lineTotal = remainingNums[remainingNums.length - 1].val;
        purchasePrice = remainingNums[remainingNums.length - 2].val;
      } else if (remainingNums.length === 1) {
        // Format: "Rice 25kg 1200" or "Oil 5L 600"
        quantity = explicitUnitQty;
        unit = explicitUnit;
        purchasePrice = remainingNums[0].val;
        lineTotal = remainingNums[0].val;
      }
    } else {
      // No explicit adjacent unit word (e.g. "Sugar 10 450")
      if (priceCandidates.length >= 3) {
        // Format: "Sugar 10 45 450" (Qty, Rate, Total)
        quantity = Math.max(1, priceCandidates[priceCandidates.length - 3].val);
        purchasePrice = priceCandidates[priceCandidates.length - 2].val;
        lineTotal = priceCandidates[priceCandidates.length - 1].val;
        unit = 'pcs';
      } else if (priceCandidates.length === 2) {
        // Format: "Sugar 10 450" (Qty, Total/PurchasePrice)
        quantity = Math.max(1, priceCandidates[0].val);
        purchasePrice = priceCandidates[1].val;
        lineTotal = priceCandidates[1].val;
        unit = 'pcs';
      } else if (priceCandidates.length === 1) {
        // Format: "Sugar 450" (Single price)
        quantity = 1;
        purchasePrice = priceCandidates[0].val;
        lineTotal = priceCandidates[0].val;
        unit = 'pcs';
      }
    }

    // Extract Product Title: filter out numeric tokens, units, and structural keywords
    const nameTokens: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const isPriceNum = priceCandidates.some((nc) => nc.idx === i);
      const isExplicitUnitWord =
        !isPackSizeInTitle && detectedUnitIndex !== -1 && (i === detectedUnitIndex || i === detectedUnitIndex + 1);

      // Check if token is in product title
      if (!isPriceNum && !isExplicitUnitWord) {
        // Filter out stray standalone HSN or invoice labels
        if (!/^(hsn|sac|mrp|rate|price|qty|amount|amt|total|sl|sr|no)$/i.test(tok) && !/^\d{4,8}$/.test(tok)) {
          nameTokens.push(tok);
        }
      }
    }

    let cleanName = nameTokens
      .join(' ')
      .replace(/[₹$€£]/g, '')
      .replace(/\b(?:rs|inr)\b\.?/gi, '')
      .replace(/[|\-_*:=+]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    name = cleanName;
  }

  // Ensure positive values
  if (purchasePrice <= 0 && lineTotal > 0 && quantity > 0) {
    purchasePrice = Math.round((lineTotal / quantity) * 100) / 100;
  }
  if (lineTotal <= 0 && purchasePrice > 0) {
    lineTotal = Math.round(purchasePrice * quantity * 100) / 100;
  }

  // Calculate default retail selling price (+20% margin or +₹2 minimum)
  const sellingPrice = Math.max(
    purchasePrice + 2,
    Math.round(purchasePrice * 1.2 * 10) / 10
  );

  // Flag low confidence for uncertain or estimated items
  if (confidence < 70 || purchasePrice <= 0 || name.length < 2) {
    lowConfidence = true;
  }

  // Clean name capitalization
  const formattedName = name
    .split(' ')
    .map((w) => (w.length > 1 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
    .trim();

  // If after parsing the name is still empty, fallback to candidate string
  const finalName = formattedName || 'Product Item';

  return {
    id: 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    name: finalName,
    category: inferProductCategory(finalName),
    quantity,
    unit,
    purchasePrice,
    sellingPrice,
    lineTotal,
    confidence: Math.round(confidence),
    lowConfidence,
    rawLine: line,
  };
}

// ---------------------------------------------------------------------------
// Step 2 & 6: Layout-Aware Table Parser & Automatic Total Calculation
// ---------------------------------------------------------------------------

/**
 * Parses OCR lines and spatial word groupings into a complete invoice structure.
 */
export function parseInvoiceDocument(
  lines: OCRLine[],
  words: OCRWord[],
  rawText: string
): InvoiceParsingResult {
  const classifiedLines: ClassifiedLine[] = [];

  // Determine line inputs: use Tesseract lines, or cluster words if lines are empty, or split raw text
  const textLines: Array<{ text: string; confidence: number; words?: OCRWord[]; bbox?: BoundingBox }> = [];

  if (lines && lines.length > 0) {
    for (const l of lines) {
      if (l.text && l.text.trim().length > 0) {
        textLines.push({
          text: l.text.trim(),
          confidence: l.confidence || 80,
          words: l.words,
          bbox: l.bbox,
        });
      }
    }
  } else if (words && words.length > 0) {
    // Layout-aware: group words into rows based on nearby vertical coordinates
    const sortedWords = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const rowGroups: OCRWord[][] = [];

    for (const w of sortedWords) {
      const yCenter = (w.bbox.y0 + w.bbox.y1) / 2;
      const height = Math.max(8, w.bbox.y1 - w.bbox.y0);
      let matched = false;

      for (const rg of rowGroups) {
        const rowYCenter = (rg[0].bbox.y0 + rg[0].bbox.y1) / 2;
        if (Math.abs(yCenter - rowYCenter) < height * 0.7) {
          rg.push(w);
          matched = true;
          break;
        }
      }

      if (!matched) {
        rowGroups.push([w]);
      }
    }

    for (const rg of rowGroups) {
      rg.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const lineText = rg.map((w) => w.text).join(' ');
      const avgConf = rg.reduce((acc, w) => acc + w.confidence, 0) / rg.length;
      textLines.push({
        text: lineText,
        confidence: Math.round(avgConf),
        words: rg,
      });
    }
  } else if (rawText) {
    const rawLines = rawText.split('\n');
    for (const rl of rawLines) {
      if (rl.trim().length > 0) {
        textLines.push({
          text: rl.trim(),
          confidence: 75,
        });
      }
    }
  }

  // Step 5: Classify every line
  for (let i = 0; i < textLines.length; i++) {
    const tl = textLines[i];
    const classification = classifyLine(tl.text, i, textLines.length);

    classifiedLines.push({
      text: tl.text,
      classification,
      confidence: tl.confidence,
      words: tl.words,
      bbox: tl.bbox,
    });
  }

  // Step 3: Only PRODUCT lines become inventory items
  const items: ExtractedProduct[] = [];

  for (const cl of classifiedLines) {
    if (cl.classification === 'PRODUCT') {
      const product = parseProductLine(cl.text, cl.confidence);
      if (product) {
        items.push(product);
      }
    }
  }

  // Fallback: If 0 items were detected from strict PRODUCT classification,
  // scan unclassified / unknown lines to never drop products
  if (items.length === 0) {
    for (const cl of classifiedLines) {
      if (cl.classification !== 'HEADER' && cl.classification !== 'TOTAL' && cl.classification !== 'GST' && cl.classification !== 'FOOTER') {
        const product = parseProductLine(cl.text, cl.confidence);
        if (product && product.purchasePrice > 0) {
          items.push(product);
        }
      }
    }
  }

  // Detect Supplier Name: prioritize explicit supplier titles in top lines
  let supplierName = '';
  let supplierConfidence = 80;

  for (let i = 0; i < Math.min(classifiedLines.length, 6); i++) {
    const cl = classifiedLines[i];
    const textLower = cl.text.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();
    const isDocLabel = /^(tax\s*invoice|cash\s*memo|retail\s*invoice|bill\s*of\s*supply|estimate|original|duplicate|invoice|date)/i.test(textLower);

    if (!isDocLabel && SUPPLIER_KEYWORDS.some((kw) => textLower.includes(kw))) {
      supplierName = cl.text.replace(/^[#*.\-_=~|]+\s*/, '').replace(/[#*.\-_=~|]+$/, '').trim();
      supplierConfidence = cl.confidence;
      break;
    }
  }

  if (!supplierName) {
    for (let i = 0; i < Math.min(classifiedLines.length, 5); i++) {
      const cl = classifiedLines[i];
      const textLower = cl.text.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();
      const isDocLabel = /^(tax\s*invoice|cash\s*memo|retail\s*invoice|bill\s*of\s*supply|estimate|original|duplicate|invoice|date)/i.test(textLower);

      if (!isDocLabel && cl.classification !== 'HEADER' && cl.classification !== 'DATE' && /[a-zA-Z]{3,}/.test(cl.text)) {
        supplierName = cl.text.replace(/^[#*.\-_=~|]+\s*/, '').replace(/[#*.\-_=~|]+$/, '').trim();
        supplierConfidence = 65;
        break;
      }
    }
  }

  if (!supplierName) {
    supplierName = 'Supplier Bill';
    supplierConfidence = 50;
  }

  if (!supplierName) {
    supplierName = 'Supplier Bill';
    supplierConfidence = 50;
  }

  // Detect Invoice Number
  let invoiceNumber = '';
  let invoiceNoConfidence = 60;
  const strictInvRegex = /(?:invoice\s*(?:no|num|#)|bill\s*(?:no|num|#)|inv\s*(?:no|num|#)|memo\s*(?:no|num|#)|receipt\s*(?:no|num|#))[.:\s\-]*([a-z0-9\-\/]{3,25})/i;

  for (const cl of classifiedLines) {
    const m = cl.text.match(strictInvRegex);
    if (m && m[1] && !/^(no|date|dt|tax|cash|retail|memo)$/i.test(m[1])) {
      invoiceNumber = m[1].toUpperCase();
      invoiceNoConfidence = 95;
      break;
    }
  }

  if (!invoiceNumber) {
    invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    invoiceNoConfidence = 50;
  }

  // Detect Invoice Date
  let invoiceDate = '';
  let dateConfidence = 60;
  const dateRegex = /(?:date|dt|dated)?[.:\s]*([0-3]?[0-9][\/\-.](?:[0-1]?[0-9]|[a-z]{3})[\/\-.](?:20)?[0-9]{2})/i;

  for (const cl of classifiedLines) {
    const m = cl.text.match(dateRegex);
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

  // Step 6: Extract Total or Automatic Total Calculation
  let totalAmount = 0;

  for (let i = classifiedLines.length - 1; i >= 0; i--) {
    if (classifiedLines[i].classification === 'TOTAL') {
      const tokens = classifiedLines[i].text.split(/\s+/);
      for (let j = tokens.length - 1; j >= 0; j--) {
        const cleaned = cleanNumericToken(tokens[j]);
        const val = parseFloat(cleaned);
        if (!isNaN(val) && val > 0 && /^\d+(?:\.\d+)?$/.test(cleaned)) {
          totalAmount = val;
          break;
        }
      }
      if (totalAmount > 0) break;
    }
  }

  // If invoice total is missing or 0, calculate sum(line totals)
  if (totalAmount <= 0) {
    totalAmount = Math.round(items.reduce((acc, item) => acc + (item.lineTotal || 0), 0) * 100) / 100;
  }

  // Calculate units and items summary
  const totalUnits = items.reduce((acc, item) => acc + (item.quantity || 0), 0);
  const totalItems = items.length;

  // Calculate overall confidence score
  const itemConfAvg = items.length > 0
    ? items.reduce((acc, it) => acc + it.confidence, 0) / items.length
    : 60;

  const overallConfidence = Math.min(
    98,
    Math.round(supplierConfidence * 0.25 + dateConfidence * 0.15 + itemConfAvg * 0.6)
  );

  return {
    supplierName,
    supplierConfidence,
    invoiceNumber,
    invoiceNoConfidence,
    invoiceDate,
    dateConfidence,
    items,
    totalAmount,
    totalUnits,
    totalItems,
    classifiedLines,
    overallConfidence,
  };
}
