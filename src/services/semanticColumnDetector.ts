/**
 * @file semanticColumnDetector.ts
 * @description Semantic column identification and layout coordinate mapping for invoices.
 * Matches arbitrary column names, orders, and regional language headings without hardcoded
 * positional assumptions. Supports spatial coordinate alignment and delimiter/spacing alignment.
 */

import type { SemanticColumnType, DetectedColumn } from './invoiceTypes';
import type { OCRWord } from './ocrService';
import { cleanNumericToken } from './invoiceParser';

/**
 * Semantic aliases dictionary mapping semantic types to synonyms across English and Indian languages.
 */
export const COLUMN_SEMANTIC_ALIASES: Record<SemanticColumnType, string[]> = {
  serial: [
    's.no', 's.no.', 'sl no', 'sr no', 'sr.no', 'sl.no', 'sl.no.', 's no', 's no.', 'sr', 'sl', '#', 'item no',
    'serial', 's.n', 'sno', 'sno.', 'slno', 'slno.', 'क्र.सं.', 'క్ర.సంఖ్య', 'வரிசை எண்'
  ],
  productName: [
    'item description', 'description of goods', 'product description', 'item details',
    'product', 'item', 'item name', 'description', 'particulars',
    'goods', 'material', 'article', 'name', 'desc', 'items/desc',
    'commodity', 'items', 'product name', 'brand', 'prod name', 'title',
    // Common OCR typos/truncations:
    'tems', 'itms', 'tem', 'item/desc',
    // Regional languages:
    'विवरण', 'सामग्री', 'वस्तु', 'वस्तु विवरण', 'వస్తువు', 'వివరాలు', 'వివరణ',
    'பெயர்', 'பொருள்', 'பொருளின் பெயர்', 'ವಿವರ', 'ಹೆಸರು', 'ಇನಂ', 'नाव', 'পণ্য', 'নাম'
  ],
  hsn: [
    'hsn/sac code', 'hsn / sac code', 'hsn/sac', 'hsn / sac', 'hsn code', 'hsn', 'sac code', 'sac', 'hsncode',
    '[msn', 'msn', 'hsm', 'hsn.'
  ],
  quantity: [
    'billed qty', 'billed quantity', 'billed', 'qty', 'quantity', 'units', 'nos', 'no.', 'number', 'pieces', 'pcs',
    'count', 'qnty', 'qty.', 'qnt', 'vol', 'volume',
    // Common OCR typos for Qty:
    'ary.', 'ary', 'gty', 'qtv', 'oty', 'qy', 'qt.',
    // Regional languages:
    'मात्रा', 'संख्या', 'పరిమాణం', 'సంఖ్య', 'அளவு', 'எண்ணிக்கை', 'ಪ್ರಮಾಣ', 'ಸಂಖ್ಯೆ'
  ],
  unit: [
    'unit of measure', 'unit', 'uom', 'pack', 'packing', 'pkg', 'packaging', 'measure', 'type'
  ],
  unitPrice: [
    'unit rate', 'rate/unit', 'rate / unit', 'rate', 'unit price', 'price/unit', 'price / unit',
    'rate (₹)', 'rate(₹)', 'price (₹)', 'price(₹)', 'unit cost', 'cost/unit', 'cost / unit',
    'price', 'cost', 'item rate', 'item price', 'basic rate', 'basic price',
    // Regional languages:
    'दर', 'प्रति दर', 'ధర', 'రేటు', 'விலை', 'ದರ'
  ],
  purchasePrice: [
    'purchase price', 'purchase rate', 'buy rate', 'buying price', 'cost price',
    'dealer price', 'wholesale price', 'buy price', 'purch. rate', 'buying rate',
    'dealer rate', 'wholesale rate', 'purchase', 'dp', 'खपत दर', 'కొనుగోలు ధర'
  ],
  sellingPrice: [
    'selling price', 'selling rate', 'sale price', 'sale rate', 'sp', 'selling value',
    'retail rate', 'sales price', 'selling', 'sale', 'sale value', 'विक्रय मूल्य', 'అమ్మకపు ధర'
  ],
  mrp: [
    'maximum retail price', 'max retail price', 'retail price', 'maximum retail', 'max retail',
    'm.r.p.', 'm.r.p', 'mrp', 'एमआरपी', 'ఎం.ఆర్.పి'
  ],
  discount: [
    'trade disc', 'scheme disc', 'disc %', 'disc amt', 'dis %', 'dis. amt', 'disc', 'discount',
    'less', 'rebate', 'छूट', 'తగ్గింపు', 'தள்ளுபடி'
  ],
  taxableAmount: [
    'taxable amount', 'taxable value', 'basic amount', 'basic value', 'assessable amount', 'assessable value',
    'taxable amt', 'assessable amt', 'taxable val', 'basic val', 'taxable'
  ],
  tax: [
    'gst amount', 'tax amount', 'total tax', 'tax amt', 'tax value', 'gst', 'tax', 'cgst', 'sgst', 'igst', 'vat',
    'कर', 'పన్ను', 'வரி'
  ],
  gstRate: [
    'gst %', 'gst rate', 'tax %', 'tax rate', 'rate %', 'cgst %', 'sgst %', 'igst %',
    'gst percentage', 'tax percentage'
  ],
  total: [
    'total amount', 'line total', 'net amount', 'extended amount', 'item total', 'item amount',
    'final amount', 'net value', 'net amt', 'tot amt', 'line amt', 'net payable',
    'amount (₹)', 'amount(₹)', 'total (₹)', 'total(₹)',
    'amount', 'total', 'value', 'amt',
    'कुल', 'మొత్తం', 'தொகை', 'ఒట్టు', 'মোট'
  ],
  unknown: []
};

/**
 * Normalizes heading token string for comparison.
 */
export function cleanHeaderToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[₹$€£]/g, '')
    .replace(/[|()\[\]{}:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim();
}

/**
 * Checks if a token is a currency or per-unit modifier (e.g. (₹), (Rs.), (INR), ₹, /-)
 * that should attach to the preceding column header rather than becoming an unknown column.
 */
export function isCurrencyOrUnitModifier(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return /^[(\[{<]?(?:₹|rs\.?|inr|€|\$|£|[-=\/]|each|per\s*unit|\/unit)[)\]}>]?$/i.test(clean) ||
         /^[(\[{<](?:₹|rs\.?|inr|€|\$|£)[)\]}>]$/i.test(clean) ||
         /^[(\[{<]\s*(?:₹|rs\.?|inr|€|\$|£)\s*[)\]}>]$/i.test(clean) ||
         /^\((?:₹|rs\.?|inr|€|\$|£)\)$/i.test(clean);
}

/**
 * Classifies an individual column header phrase to its semantic type.
 */
export function identifyColumnType(headerText: string): SemanticColumnType {
  const clean = cleanHeaderToken(headerText);
  if (!clean || clean.length < 1) return 'unknown';

  // Check explicit percentage tax rate first
  if (clean.includes('%') || clean.includes('rate %')) {
    if (clean.includes('gst') || clean.includes('tax') || clean.includes('cgst') || clean.includes('sgst') || clean.includes('igst')) {
      return 'gstRate';
    }
    if (clean.includes('disc') || clean.includes('less')) {
      return 'discount';
    }
  }

  // 1. Exact match against known aliases
  for (const [type, aliases] of Object.entries(COLUMN_SEMANTIC_ALIASES)) {
    if (type === 'unknown') continue;
    if (aliases.some((alias) => alias === clean)) {
      return type as SemanticColumnType;
    }
  }

  // 2. Phrase contains check with word boundary priority
  // Check compound / multi-word types first
  const priorityTypes: SemanticColumnType[] = [
    'hsn',
    'gstRate',
    'taxableAmount',
    'purchasePrice',
    'sellingPrice',
    'mrp',
    'discount',
    'tax',
    'unitPrice',
    'quantity',
    'productName',
    'serial',
    'unit',
    'total'
  ];

  for (const type of priorityTypes) {
    const aliases = COLUMN_SEMANTIC_ALIASES[type];
    for (const alias of aliases) {
      // Use regex word boundary where possible
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
      if (regex.test(clean)) {
        return type;
      }
    }
  }

  // 3. Fallback partial containment checks
  if (clean.includes('hsn') || clean.includes('sac')) return 'hsn';
  if (clean.includes('taxable') || clean.includes('assessable')) return 'taxableAmount';
  if (clean.includes('mrp')) return 'mrp';
  if (clean.includes('disc') || clean.includes('less')) return 'discount';
  if (clean.includes('cgst') || clean.includes('sgst') || clean.includes('igst') || clean.includes('vat')) {
    return clean.includes('%') || clean.includes('rate') ? 'gstRate' : 'tax';
  }
  if (clean.includes('rate') || clean.includes('price') || clean.includes('cost')) {
    if (clean.includes('pur') || clean.includes('buy')) return 'purchasePrice';
    if (clean.includes('sell') || clean.includes('sale')) return 'sellingPrice';
    return 'unitPrice';
  }
  if (clean.includes('qty') || clean.includes('quantity') || clean.includes('qnty') || clean.includes('units') || clean.includes('nos')) {
    return 'quantity';
  }
  if (clean.includes('item') || clean.includes('desc') || clean.includes('partic') || clean.includes('prod') || clean.includes('goods')) {
    return 'productName';
  }
  if (clean.includes('amount') || clean.includes('total') || clean.includes('value') || clean.includes('amt')) {
    return 'total';
  }
  if (clean.includes('uom') || clean.includes('pack')) {
    return 'unit';
  }

  return 'unknown';
}

/**
 * Checks whether a line text looks like a table header.
 */
export function isCandidateHeaderLine(lineText: string): boolean {
  const lower = lineText.toLowerCase();

  // Exclude bill summary or customer details lines (e.g. "Grand Total: 5000", "Balance Due: 0", "Terms & Conditions")
  if (/^\s*(?:grand total|net amount|sub total|subtotal|balance due|bank details|terms &|terms and)\s*[:=0-9]/i.test(lower)) {
    return false;
  }
  if (/^(?:grand total|sub total|subtotal|balance due)\b/i.test(lower.trim())) {
    return false;
  }

  // Count matches across key invoice columns (English + Multilingual Indian languages)
  const essentialKeywords = [
    'item', 'items', 'tems', 'product', 'desc', 'particular', 'goods',
    'qty', 'ary', 'quantity', 'units', 'rate', 'price',
    'amount', 'total', 'hsn', 'msn', 'mrp', 'taxable', 'tax', 'sno',
    // Hindi
    'विवरण', 'मात्रा', 'दर', 'कुल', 'वस्तु', 'मूल्य',
    // Telugu
    'వివరణ', 'పరిమాణం', 'ధర', 'మొత్తం', 'వస్తువు',
    // Tamil
    'பொருட்கள்', 'அளவு', 'விலை', 'தொகை',
    // Kannada
    'ವಿವರ', 'ಪ್ರಮಾಣ', 'ದರ', 'ಮೊತ್ತ',
  ];

  let matches = 0;
  for (const kw of essentialKeywords) {
    if (lower.includes(kw)) matches++;
  }

  if (matches >= 2) return true;

  // Delimited candidate check (pipes, tabs, multiple spaces)
  if (lineText.includes('|') || lineText.includes('\t') || /\s{2,}/.test(lineText)) {
    const cols = detectColumnsFromHeaderText(lineText);
    const recognized = cols.filter((c) => c.type !== 'unknown');
    if (recognized.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Groups adjacent words in a header line into coherent column definitions.
 * Example: ["Item", "Description"] -> "Item Description" (productName)
 *          ["Unit", "Price"] -> "Unit Price" (unitPrice)
 *          ["Taxable", "Amount"] -> "Taxable Amount" (taxableAmount)
 */
export function detectColumnsFromHeaderWords(
  words: OCRWord[],
  lineWidth: number = 1000
): DetectedColumn[] {
  if (!words || words.length === 0) return [];

  // Sort words left to right
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);

  // Group nearby words into phrases based on horizontal gap
  const phrases: Array<{ text: string; words: OCRWord[]; minX: number; maxX: number }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (phrases.length === 0) {
      phrases.push({ text: cur.text, words: [cur], minX: cur.bbox.x0, maxX: cur.bbox.x1 });
      continue;
    }

    const last = phrases[phrases.length - 1];
    const gap = cur.bbox.x0 - last.maxX;
    const avgWordW = (last.maxX - last.minX) / last.words.length;

    // Filter out border pipe or punctuation noise from headers
    if (/^[|:;.\-_=~]+$/.test(cur.text)) {
      continue;
    }

    // Currency symbol modifier: e.g. "Rate" + "(₹)" or "Amount" + "(₹)" -> merge into "Rate (₹)"
    if (isCurrencyOrUnitModifier(cur.text) && gap < Math.max(60, avgWordW * 3)) {
      last.text = `${last.text} ${cur.text}`.trim();
      last.words.push(cur);
      last.maxX = Math.max(last.maxX, cur.bbox.x1);
      continue;
    }

    // Multi-token currency modifier: e.g. "Rate" + "(" + "₹)" -> merge into "Rate (₹)"
    if (cur.text === '(' && i + 1 < sorted.length && /^[₹$€£a-z0-9.]+[)\]}>]$/i.test(sorted[i + 1].text)) {
      const nextWord = sorted[i + 1];
      const gapToNext = nextWord.bbox.x0 - cur.bbox.x1;
      if (gapToNext < Math.max(40, avgWordW * 2)) {
        last.text = `${last.text} (${nextWord.text}`.trim();
        last.words.push(cur, nextWord);
        last.maxX = Math.max(last.maxX, nextWord.bbox.x1);
        i++; // skip nextWord
        continue;
      }
    }

    const candidateCombined = `${last.text} ${cur.text}`.trim();
    const combinedType = identifyColumnType(candidateCombined);

    const typeLast = identifyColumnType(last.text);
    const typeCur = identifyColumnType(cur.text);
    const isConflictingPair =
      (typeLast === 'unit' && (typeCur === 'unitPrice' || typeCur === 'purchasePrice')) ||
      (typeLast === 'quantity' && (typeCur === 'unit' || typeCur === 'unitPrice' || typeCur === 'purchasePrice')) ||
      (typeLast === 'tax' && typeCur === 'total') ||
      (typeLast === 'discount' && (typeCur === 'tax' || typeCur === 'gstRate' || typeCur === 'total')) ||
      (typeLast === 'unitPrice' && (typeCur === 'discount' || typeCur === 'tax' || typeCur === 'total' || typeCur === 'mrp' || typeCur === 'sellingPrice')) ||
      (typeLast === 'purchasePrice' && (typeCur === 'discount' || typeCur === 'tax' || typeCur === 'total' || typeCur === 'mrp' || typeCur === 'sellingPrice')) ||
      (typeLast === 'sellingPrice' && (typeCur === 'mrp' || typeCur === 'total' || typeCur === 'discount' || typeCur === 'tax')) ||
      (typeLast === 'mrp' && (typeCur === 'sellingPrice' || typeCur === 'total' || typeCur === 'discount' || typeCur === 'tax'));

    // Merge adjacent words into a compound header if the combination is a recognized multi-word alias
    // (e.g. "Item Description", "Unit Price", "Purchase Rate", "Line Total", "Net Amount", "Taxable Amount")
    const isMultiWordAlias =
      !isConflictingPair &&
      combinedType !== 'unknown' &&
      candidateCombined.includes(' ') &&
      (COLUMN_SEMANTIC_ALIASES[combinedType] || []).some(
        (alias) => alias.toLowerCase() === candidateCombined.toLowerCase() || alias.toLowerCase() === cleanHeaderToken(candidateCombined)
      );

    if (gap < Math.max(35, avgWordW * 2) && isMultiWordAlias) {
      last.text = candidateCombined;
      last.words.push(cur);
      last.maxX = Math.max(last.maxX, cur.bbox.x1);
    } else {
      phrases.push({ text: cur.text, words: [cur], minX: cur.bbox.x0, maxX: cur.bbox.x1 });
    }
  }

  const columns: DetectedColumn[] = [];

  const effectiveLineWidth = Math.max(lineWidth, ...words.map((w) => w.bbox.x1 + 100));

  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    const type = identifyColumnType(p.text);

    // Estimate column boundaries: midpoint between this column's maxX and next column's minX
    const prevMax = i > 0 ? (phrases[i - 1].maxX + p.minX) / 2 : 0;
    const nextMin = i < phrases.length - 1 ? (p.maxX + phrases[i + 1].minX) / 2 : effectiveLineWidth;

    columns.push({
      type,
      headerText: p.text,
      minX: prevMax,
      maxX: nextMin,
      confidence: type !== 'unknown' ? 95 : 40,
    });
  }

  // Post-processing: If productName is not recognized, but there is an unknown column
  // positioned between serial (or start of table) and quantity / rate / amount, that column is productName!
  const hasProductName = columns.some((c) => c.type === 'productName');
  if (!hasProductName) {
    const candidateIdx = columns.findIndex((c, idx) => {
      if (c.type !== 'unknown') return false;
      const followingHasRateOrQty = columns.slice(idx + 1).some((after) => 
        after.type === 'quantity' || after.type === 'unitPrice' || after.type === 'purchasePrice' || after.type === 'total'
      );
      return followingHasRateOrQty;
    });

    if (candidateIdx !== -1) {
      columns[candidateIdx].type = 'productName';
      columns[candidateIdx].confidence = 85;
    }
  }

  return columns;
}

/**
 * Detects columns from a raw text header line when bounding boxes are not available.
 * Splits by `|`, tabs, or multiple spaces (>= 2).
 */
export function detectColumnsFromHeaderText(headerText: string): DetectedColumn[] {
  let chunks: string[] = [];

  if (headerText.includes('|')) {
    chunks = headerText.split('|').map((s) => s.trim()).filter(Boolean);
  } else if (headerText.includes('\t')) {
    chunks = headerText.split('\t').map((s) => s.trim()).filter(Boolean);
  } else {
    // Split by 2 or more spaces
    chunks = headerText.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    // If only single spaces were used, look for keyword boundaries
    if (chunks.length <= 1) {
      chunks = splitHeaderStringByKeywords(headerText);
    }
  }

  return chunks.map((chunk, idx) => ({
    type: identifyColumnType(chunk),
    headerText: chunk,
    minX: idx * 100,
    maxX: (idx + 1) * 100,
    confidence: identifyColumnType(chunk) !== 'unknown' ? 90 : 40,
  }));
}

/**
 * Splits a single-spaced header string by known column markers.
 * Uses greedy phrase matching (3 words -> 2 words -> 1 word) against semantic aliases.
 * Example: "S.No. Item Description HSN/SAC Qty Unit Rate Discount Tax Amount"
 * -> ["S.No.", "Item Description", "HSN/SAC", "Qty", "Unit", "Rate", "Discount", "Tax", "Amount"]
 */
function splitHeaderStringByKeywords(text: string): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let i = 0;

  const separateWordsSet = new Set(['unit rate', 'tax amount', 'rate tax', 'discount tax']);

  while (i < tokens.length) {
    // Check 3 tokens
    if (i + 2 < tokens.length) {
      const phrase3 = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      const type3 = identifyColumnType(phrase3);
      const typeA = identifyColumnType(tokens[i]);
      const typeB = identifyColumnType(tokens[i + 1]);
      const isConflicting3 =
        (typeA === 'unit' && (typeB === 'unitPrice' || typeB === 'purchasePrice')) ||
        (typeA === 'tax' && (typeB === 'total' || identifyColumnType(tokens[i + 2]) === 'total')) ||
        separateWordsSet.has(`${tokens[i]} ${tokens[i + 1]}`.toLowerCase());

      const isAlias3 = !isConflicting3 && type3 !== 'unknown' && Object.values(COLUMN_SEMANTIC_ALIASES).some(
        aliases => aliases.some(a => a.toLowerCase() === phrase3.toLowerCase() || a.toLowerCase() === cleanHeaderToken(phrase3))
      );
      if (isAlias3) {
        result.push(phrase3);
        i += 3;
        continue;
      }
    }

    // Check 2 tokens
    if (i + 1 < tokens.length) {
      const phrase2 = `${tokens[i]} ${tokens[i + 1]}`;
      const clean2 = phrase2.toLowerCase();
      const type2 = identifyColumnType(phrase2);

      // If second token is currency symbol modifier e.g. "Rate (₹)" or "Amount (₹)"
      if (isCurrencyOrUnitModifier(tokens[i + 1])) {
        result.push(phrase2);
        i += 2;
        continue;
      }

      const typeA = identifyColumnType(tokens[i]);
      const typeB = identifyColumnType(tokens[i + 1]);
      const isConflictingPair =
        (typeA === 'unit' && (typeB === 'unitPrice' || typeB === 'purchasePrice')) ||
        (typeA === 'tax' && typeB === 'total') ||
        (typeA === 'discount' && (typeB === 'tax' || typeB === 'gstRate')) ||
        (typeA === 'unitPrice' && (typeB === 'tax' || typeB === 'discount')) ||
        separateWordsSet.has(clean2);

      const isAlias2 = !isConflictingPair && type2 !== 'unknown' && Object.values(COLUMN_SEMANTIC_ALIASES).some(
        aliases => aliases.some(a => a.toLowerCase() === clean2 || a.toLowerCase() === cleanHeaderToken(phrase2))
      );

      if (isAlias2) {
        result.push(phrase2);
        i += 2;
        continue;
      }
    }

    // Check single token
    const singleType = identifyColumnType(tokens[i]);
    if (singleType !== 'unknown') {
      result.push(tokens[i]);
      i += 1;
      continue;
    }

    // Unmatched token
    if (result.length > 0 && identifyColumnType(result[result.length - 1]) === 'unknown') {
      result[result.length - 1] = `${result[result.length - 1]} ${tokens[i]}`;
    } else {
      result.push(tokens[i]);
    }
    i += 1;
  }

  return result.length > 0 ? result : [text];
}

/**
 * Assigns OCR words on a data row to detected table columns using horizontal X coordinates.
 */
export function mapWordsToColumns(
  words: OCRWord[],
  columns: DetectedColumn[]
): Record<SemanticColumnType, string> {
  const cellMap: Partial<Record<SemanticColumnType, string[]>> = {};

  for (const col of columns) {
    cellMap[col.type] = [];
  }

  for (const word of words) {
    if (/^[|:;.\-_=~]+$/.test(word.text)) {
      continue; // Skip pure border/separator noise
    }

    const xCenter = (word.bbox.x0 + word.bbox.x1) / 2;

    // Find the best matching column whose [minX, maxX] covers xCenter
    let matchedCol: DetectedColumn | null = null;
    let minDistance = Infinity;

    for (const col of columns) {
      if (xCenter >= col.minX && xCenter <= col.maxX) {
        matchedCol = col;
        break;
      }
      const dist = Math.min(Math.abs(xCenter - col.minX), Math.abs(xCenter - col.maxX));
      const colWidth = col.maxX - col.minX;
      if (dist < minDistance && dist <= Math.max(60, colWidth * 0.6)) {
        minDistance = dist;
        matchedCol = col;
      }
    }

    if (matchedCol) {
      let targetType = matchedCol.type;

      // Special rule: Serial column guard
      // If matchedCol is 'serial', but word has 2+ letters (e.g. "OL", "WHITE", "PARLE"),
      // it is NOT a serial number! Reassign to 'productName' if present.
      if (targetType === 'serial') {
        const isSerialChar = /^([0-9]{1,3}|[#*.]|[0-9]{1,3}[.)]|s|a|\d\?)$/i.test(word.text.trim());
        if (!isSerialChar && /[a-zA-Z]{2,}/.test(word.text)) {
          const prodCol = columns.find((c) => c.type === 'productName');
          if (prodCol) {
            targetType = 'productName';
          }
        }
      }

      // Special rule: Unit vs Price/Qty cross-boundary guard
      // Packaging units like BAG, PKT, PCS, KG must not append to price columns
      const isKnownUnitWord = /^(?:pcs|pc|pkt|pkts|box|boxes|bag|bags|pet|bor|tin|ctn|kg|kgs|g|gm|l|ltr|ml|nos|units?)$/i.test(word.text.trim());
      if (isKnownUnitWord && (targetType === 'unitPrice' || targetType === 'purchasePrice' || targetType === 'total' || targetType === 'sellingPrice' || targetType === 'mrp')) {
        const unitCol = columns.find((c) => c.type === 'unit');
        if (unitCol) {
          targetType = 'unit';
        }
      }

      // Size unit guard: 'ml', 'g', 'kg', 'l' must never be the quantity
      const isSizeUnitWord = /^(?:kg|kgs|g|gm|gms|l|ltr|ltrs|ml|milli)$/i.test(word.text.trim());
      if (isSizeUnitWord && targetType === 'quantity') {
        const unitCol = columns.find((c) => c.type === 'unit');
        if (unitCol) {
          targetType = 'unit';
        } else {
          targetType = 'productName';
        }
      }

      if (!cellMap[targetType]) {
        cellMap[targetType] = [];
      }
      cellMap[targetType]!.push(word.text);
    }
  }

  // Special rule: If quantity has multiple numbers and one is a pack size matching productName
  if (cellMap['quantity'] && cellMap['quantity']!.length > 1) {
    const qTokens = cellMap['quantity']!;
    const nameText = (cellMap['productName'] || []).join(' ');
    const sizeMatch = nameText.match(/\b(\d+(?:\.\d+)?)\s*(?:ml|g|gm|kg|l|ltr)\b/i);
    if (sizeMatch) {
      const sizeVal = sizeMatch[1];
      const actualQtyTokens = qTokens.filter((t) => t !== sizeVal);
      if (actualQtyTokens.length > 0) {
        cellMap['quantity'] = actualQtyTokens;
      }
    }
  }

  // Special rule: HSN column overflow to ProductName
  if (cellMap['hsn'] && cellMap['hsn']!.length > 0) {
    const hsnTokens = cellMap['hsn']!;
    const remainingHsn: string[] = [];
    const overflowToName: string[] = [];

    for (const tok of hsnTokens) {
      const cleanDigits = tok.replace(/[^\d]/g, '');
      if (cleanDigits.length >= 4 && cleanDigits.length <= 8) {
        remainingHsn.push(cleanDigits);
      } else if (/[a-zA-Z&]/.test(tok)) {
        overflowToName.push(tok);
      }
    }

    cellMap['hsn'] = remainingHsn;
    if (overflowToName.length > 0) {
      if (!cellMap['productName']) cellMap['productName'] = [];
      cellMap['productName']!.push(...overflowToName);
    }
  }

  const result: Record<SemanticColumnType, string> = {
    serial: '',
    productName: '',
    hsn: '',
    quantity: '',
    unit: '',
    unitPrice: '',
    purchasePrice: '',
    sellingPrice: '',
    mrp: '',
    discount: '',
    taxableAmount: '',
    tax: '',
    gstRate: '',
    total: '',
    unknown: '',
  };

  for (const [type, tokenArr] of Object.entries(cellMap)) {
    result[type as SemanticColumnType] = (tokenArr || []).join(' ').trim();
  }

  return result;
}

/**
 * Maps delimited or space-separated tokens in a text line to detected columns by index.
 */
export function mapTokensToColumns(
  lineText: string,
  columns: DetectedColumn[]
): Record<SemanticColumnType, string> {
  let tokens: string[] = [];
  const knownUnits = /^(bag|bags|pkt|pkts|packet|box|boxes|btl|bottle|bottles|pcs|pc|nos|no|kg|kgs|g|gm|gms|l|ltr|ltrs|ml|pet|bor|tin|ctn)$/i;

  if (lineText.includes('|')) {
    tokens = lineText.split('|').map((s) => s.trim());
    // Strip leading/trailing empty cells from border pipes
    if (tokens.length > 0 && tokens[0] === '') tokens.shift();
    if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();
  } else if (lineText.includes('\t')) {
    tokens = lineText.split('\t').map((s) => s.trim());
  } else if (/\s{2,}/.test(lineText)) {
    tokens = lineText.split(/\s{2,}/).map((s) => s.trim());
  } else {
    // Single-spaced line: align text name and trailing numbers/units to columns
    const allWords = lineText.split(/\s+/).filter(Boolean);
    const prodColIdx = columns.findIndex((c) => c.type === 'productName');

    if (prodColIdx === columns.length - 1 && prodColIdx > 0 && allWords.length > prodColIdx) {
      // Product Name is at the END of the row (e.g. "Amount Rate Qty Item")
      const dataVals = allWords.slice(0, prodColIdx);
      const nameWords = allWords.slice(prodColIdx).join(' ');
      tokens = [...dataVals, nameWords];
    } else {
      const hasSerial = columns.length > 0 && columns[0].type === 'serial';
      let startIdx = 0;
      let serialToken = '';
      if (hasSerial && allWords.length > 0 && /^[#*.\-_=~]*\s*\d{1,4}[.)\-]?$/.test(allWords[0])) {
        serialToken = allWords[0].replace(/[^\d]/g, '');
        startIdx = 1;
      }

      // Scan backwards from end to find where product description ends and data tokens begin
      let dataIdx = allWords.length;
      const expectedDataCols = Math.max(2, columns.filter((c) => c.type !== 'productName' && c.type !== 'serial').length);

      for (let j = allWords.length - 1; j >= startIdx; j--) {
        const w = allWords[j];
        const cl = cleanHeaderToken(w);
        const isNum = /^[lI|!OSsbB\d.,%₹]+$/.test(cl) && /\d/.test(cl.replace(/[lI|!OSsbB]/g, '1'));
        const isUnit = knownUnits.test(w);
        const isDash = /^[-—–.]+$/.test(w);
        const isPackUnit = /^(\d+(?:\.\d+)?)\s*(?:kg|kgs|g|gm|gms|l|ltr|ml|pcs|pc|pkt|pkts|box|boxes|bag|bags)\b/i.test(w);
        const tokensToRight = allWords.length - 1 - j;

        // If we already collected the expected number of data columns from the right, stop absorbing
        if (tokensToRight >= expectedDataCols) {
          break;
        }

        // Liquid / weight pack unit (e.g. 500ml, 400g, 1kg) in product title:
        // If this token is a pack size and we already have 2+ data tokens to the right and no unit column:
        const hasUnitCol = columns.some((c) => c.type === 'unit');
        if (isPackUnit && tokensToRight >= 2 && !hasUnitCol) {
          break;
        }
        if (isUnit && j > startIdx && /^\d+(?:\.\d+)?$/.test(cleanHeaderToken(allWords[j - 1])) && !hasUnitCol && tokensToRight >= 2) {
          break;
        }

        if (isNum || isUnit || isDash || isPackUnit) {
          dataIdx = j;
        } else {
          break;
        }
      }

      const nameWords = allWords.slice(startIdx, dataIdx).join(' ');
      const dataVals = allWords.slice(dataIdx);

      if (serialToken) {
        tokens = [serialToken, nameWords, ...dataVals];
      } else {
        tokens = [nameWords, ...dataVals];
      }
    }
  }

  const result: Record<SemanticColumnType, string> = {
    serial: '',
    productName: '',
    hsn: '',
    quantity: '',
    unit: '',
    unitPrice: '',
    purchasePrice: '',
    sellingPrice: '',
    mrp: '',
    discount: '',
    taxableAmount: '',
    tax: '',
    gstRate: '',
    total: '',
    unknown: '',
  };

  if (tokens.length === columns.length) {
    for (let i = 0; i < columns.length; i++) {
      result[columns[i].type] = tokens[i];
    }
    return result;
  }

  // Intelligent alignment when tokens count differs from columns count
  const hasSerial = columns.length > 0 && columns[0].type === 'serial';
  const isToken0Serial =
    hasSerial && tokens.length > 0 && /^[#*.\-_=~]*\s*\d{1,4}[.)\-]?$/.test(tokens[0].trim());

  let tokenIdx = 0;
  if (hasSerial && isToken0Serial) {
    result['serial'] = tokens[0].replace(/[^\d]/g, '');
    tokenIdx = 1;
  }

  const remainingTokens = tokens.slice(tokenIdx);
  const nonSerialCols = hasSerial ? columns.slice(1) : columns;

  if (nonSerialCols.length > 0 && remainingTokens.length > 0) {
    let nameToken = '';
    // Determine the position of productName in nonSerialCols
    const prodColIdx = nonSerialCols.findIndex((c) => c.type === 'productName');

    // Check if remainingTokens[0] is a product name or purely a numeric/unit data cell
    const tok0Clean = cleanHeaderToken(remainingTokens[0]);
    const tok0IsPureData =
      (/^[lI|!OSsbB\d.,%₹]+$/.test(tok0Clean) && /\d/.test(tok0Clean.replace(/[lI|!OSsbB]/g, '1'))) ||
      knownUnits.test(remainingTokens[0]) ||
      /^[-—–]+$/.test(remainingTokens[0]);

    let dataCols: DetectedColumn[] = [];
    let dataTokens: string[] = [];

    if (prodColIdx === 0 && !tok0IsPureData) {
      const expectedDataCount = nonSerialCols.length - 1;
      const splitIdx = Math.max(1, remainingTokens.length - expectedDataCount);
      nameToken = remainingTokens.slice(0, splitIdx).join(' ');
      dataTokens = remainingTokens.slice(splitIdx);
      dataCols = nonSerialCols.slice(1);
    } else if (prodColIdx === nonSerialCols.length - 1 && prodColIdx > 0 && remainingTokens.length >= prodColIdx) {
      // Product Name is the LAST column
      nameToken = remainingTokens.slice(prodColIdx).join(' ');
      dataTokens = remainingTokens.slice(0, prodColIdx);
      dataCols = nonSerialCols.slice(0, prodColIdx);
    } else {
      nameToken = '';
      dataTokens = remainingTokens;
      dataCols = nonSerialCols.filter((c) => c.type !== 'productName');
    }

    result['productName'] = nameToken;

    // Classify data tokens semantically
    const unassignedTokens: string[] = [];
    let detectedUnit: string | null = null;
    let detectedHsn: string | null = null;

    for (let tIdx = 0; tIdx < dataTokens.length; tIdx++) {
      const tok = dataTokens[tIdx];
      const cl = cleanHeaderToken(tok);

      // 1. Packaging unit
      if (knownUnits.test(tok) && !detectedUnit) {
        detectedUnit = tok;
        continue;
      }

      // Check if token has embedded quantity + unit (e.g. "25kg", "5L")
      const qtyUnitMatch = tok.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
      if (qtyUnitMatch && knownUnits.test(qtyUnitMatch[2])) {
        if (!detectedUnit) detectedUnit = qtyUnitMatch[2];
        unassignedTokens.push(qtyUnitMatch[1]);
        continue;
      }

      // 2. HSN code (4-8 digits) in first 2 positions if HSN column exists
      const hasHsnCol = dataCols.some((c) => c.type === 'hsn');
      if (hasHsnCol && !detectedHsn && tIdx <= 1 && /^\d{4,8}$/.test(cl)) {
        detectedHsn = cl;
        continue;
      }

      // 3. Skip pure dash tokens for missing columns (e.g. "-" for HSN or Tax)
      if (/^[-—–]+$/.test(tok.trim())) {
        continue;
      }

      unassignedTokens.push(tok);
    }

    if (detectedUnit) result['unit'] = detectedUnit;
    if (detectedHsn) result['hsn'] = detectedHsn;

    // Filter data columns to numeric price/qty columns
    const numCols = dataCols.filter((c) => c.type !== 'hsn' && c.type !== 'unit');
    const hasRate = numCols.some((c) => c.type === 'unitPrice' || c.type === 'purchasePrice');
    const hasTotal = numCols.some((c) => c.type === 'total');
    const hasQty = numCols.some((c) => c.type === 'quantity');

    // Parse numeric candidate values
    const numVals: Array<{ raw: string; val: number }> = [];
    for (const t of unassignedTokens) {
      const c = cleanNumericToken(t);
      const n = parseFloat(c);
      if (!isNaN(n)) {
        numVals.push({ raw: t, val: n });
      }
    }

    if (numVals.length === numCols.length) {
      for (let i = 0; i < numCols.length; i++) {
        result[numCols[i].type] = numVals[i].raw;
      }
    } else if (numVals.length === 3 && hasQty && hasRate && hasTotal) {
      result['quantity'] = numVals[0].raw;
      const rateCol = numCols.find((c) => c.type === 'purchasePrice') ? 'purchasePrice' : 'unitPrice';
      result[rateCol] = numVals[1].raw;
      result['total'] = numVals[2].raw;
    } else if (numVals.length === 2) {
      if (hasRate && hasTotal && (nameToken === '' || (numVals[1].val >= numVals[0].val * 1.5 && numVals[0].val > 50))) {
        // Line has Rate and Total (e.g. "250 2500", "70 1400")
        const rateCol = numCols.find((c) => c.type === 'purchasePrice') ? 'purchasePrice' : 'unitPrice';
        result[rateCol] = numVals[0].raw;
        result['total'] = numVals[1].raw;
      } else if (hasQty && (hasRate || hasTotal)) {
        result['quantity'] = numVals[0].raw;
        if (hasRate) {
          const rateCol = numCols.find((c) => c.type === 'purchasePrice') ? 'purchasePrice' : 'unitPrice';
          result[rateCol] = numVals[1].raw;
        } else if (hasTotal) {
          result['total'] = numVals[1].raw;
        }
      } else {
        let uIdx = unassignedTokens.length - 1;
        for (let cIdx = numCols.length - 1; cIdx >= 0 && uIdx >= 0; cIdx--) {
          result[numCols[cIdx].type] = unassignedTokens[uIdx];
          uIdx--;
        }
      }
    } else if (numVals.length === 1) {
      if (hasQty && numCols[0]?.type === 'quantity') {
        result['quantity'] = numVals[0].raw;
      } else if (hasTotal) {
        result['total'] = numVals[0].raw;
      } else if (hasRate) {
        const rateCol = numCols.find((c) => c.type === 'purchasePrice') ? 'purchasePrice' : 'unitPrice';
        result[rateCol] = numVals[0].raw;
      }
    } else {
      // Default: align unassigned from right to remaining columns
      let uIdx = unassignedTokens.length - 1;
      for (let cIdx = numCols.length - 1; cIdx >= 0 && uIdx >= 0; cIdx--) {
        result[numCols[cIdx].type] = unassignedTokens[uIdx];
        uIdx--;
      }
    }
  } else {
    for (let i = 0; i < Math.min(tokens.length, columns.length); i++) {
      result[columns[i].type] = tokens[i];
    }
  }

  return result;
}
