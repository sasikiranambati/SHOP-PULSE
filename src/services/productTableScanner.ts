/**
 * @file productTableScanner.ts
 * @description Product Table-Only Scanning V2 Service for ShopPulse.
 * Processes cropped line-item tables with layout-aware column alignment,
 * robust packaging separation, strict validation, and conservative OCR heuristics.
 */

import type { Product } from '../types/product';
import type { 
  OCRLine, 
  OCRWord 
} from './ocrService';
import { performOCR } from './ocrService';
import type { 
  StructuredProductRow, 
  TableValidationStatus, 
  FieldConfidence, 
  DetectedColumn, 
  SemanticColumnType,
  InvoiceLineItem,
  ParsedInvoice
} from './invoiceTypes';
import { 
  isCandidateHeaderLine,
  detectColumnsFromHeaderWords
} from './semanticColumnDetector';
import { 
  cleanProductName, 
  isPlausibleProductName 
} from './sectionClassifier';
import { 
  cleanNumericToken, 
  normalizeUnit 
} from './invoiceParser';
import { 
  cropAndPreprocessTableImage, 
  type CropRegion 
} from './imagePreprocessor';

/**
 * Extracts product packaging size and unit from product title while keeping the title intact.
 * Distinguishes pack size (e.g. 400 in "FRUIT BISCUITS 400", 1 L in "Shampoo 1 L", 25 kg in "Rice 25 kg bag")
 * from the purchased quantity count.
 */
export function extractPackagingInfo(rawName: string): {
  packSize: number | null;
  packSizeUnit: string | null;
} {
  const name = cleanProductName(rawName);

  // 1. Explicit unit packaging (e.g. "1 L", "500 ml", "25 kg", "400 g", "240 gm")
  const explicitMatch = name.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|gm|gms|kg|kgs|l|ltr|ltrs|liter|litres)\b/i);
  if (explicitMatch) {
    const size = parseFloat(explicitMatch[1]);
    let unit = explicitMatch[2].toLowerCase();
    if (unit === 'gm' || unit === 'gms') unit = 'g';
    if (unit === 'kgs') unit = 'kg';
    if (unit === 'l' || unit === 'ltr' || unit === 'ltrs' || unit === 'liter' || unit === 'litres') unit = 'L';
    return {
      packSize: isNaN(size) ? null : size,
      packSizeUnit: unit,
    };
  }

  // 2. Numeric-only packaging suffix at end of product title (e.g. "FRUIT BISCUITS 400", "LUX 10")
  const numericSuffixMatch = name.match(/\b([A-Za-z\s]+?)\s+(\d{1,4})\s*(?:\(?[A-Za-z0-9]?\)?)?$/);
  if (numericSuffixMatch) {
    const num = parseFloat(numericSuffixMatch[2]);
    if (!isNaN(num) && num > 0) {
      return {
        packSize: num,
        packSizeUnit: null,
      };
    }
  }

  return { packSize: null, packSizeUnit: null };
}

/**
 * Parses smart quantity from text, separating purchased quantity count from unit.
 * E.g. "Qty 1 Nos" -> { qty: 1, unit: 'Nos' }
 *      "12 Nos" -> { qty: 12, unit: 'Nos' }
 *      "5 bags" -> { qty: 5, unit: 'bag' }
 *      "3 Nos" -> { qty: 3, unit: 'Nos' }
 */
export function parseQuantityAndUnit(token: string): {
  quantity: number | null;
  unit: string | null;
} {
  if (!token) return { quantity: null, unit: null };

  const clean = token.trim();
  // Strip common leading labels like "Qty:", "Quantity:", "Nos:"
  const stripped = clean.replace(/^(?:qty|quantity|count|nos|qnty)[:\s]*/i, '').trim();

  // Match number with unit suffix (e.g. "1 Nos", "12 pcs", "5 bags", "3 pkt", "2 box")
  const matchWithUnit = stripped.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (matchWithUnit) {
    const qty = parseFloat(matchWithUnit[1]);
    const rawUnit = matchWithUnit[2] ? matchWithUnit[2].trim() : null;
    const normalized = rawUnit
      ? (rawUnit.toLowerCase() === 'nos' ? 'Nos' : normalizeUnit(rawUnit) || rawUnit)
      : null;
    return {
      quantity: !isNaN(qty) && qty > 0 ? qty : null,
      unit: normalized,
    };
  }

  const num = parseFloat(cleanNumericToken(stripped));
  return {
    quantity: !isNaN(num) && num > 0 ? num : null,
    unit: null,
  };
}

/**
 * Cleans a numeric price token conservatively without dropping decimal values.
 */
export function parsePriceToken(token: string): number | null {
  if (!token) return null;
  const cleaned = cleanNumericToken(token);
  const num = parseFloat(cleaned);
  return !isNaN(num) && num >= 0 ? num : null;
}

/**
 * Detects table column boundaries from OCR header words.
 */
export function detectTableColumnsFromHeaders(
  headerLine: OCRLine,
  tableWidth: number
): DetectedColumn[] {
  const words = headerLine.words || [];
  if (words.length === 0) return [];

  // Group adjacent words using proven semantic column detector
  const detected = detectColumnsFromHeaderWords(words, tableWidth);
  const recognized = detected.filter((c) => c.type !== 'unknown');
  return recognized;
}

/**
 * Infers table columns using spatial alignment when header row is missing or faint.
 * In typical bills: product names are left-aligned; quantities, rates, and amounts form right-aligned numeric clusters.
 */
export function inferColumnsFromSpatialLayout(
  lines: OCRLine[],
  tableWidth: number
): DetectedColumn[] {
  // Candidate numeric items on the right side
  const allWords = lines.flatMap((l) => l.words || []);
  if (allWords.length === 0) return [];

  const numWords = allWords.filter((w) => /^[\d₹,.]+$/.test(cleanNumericToken(w.text)));
  // Cluster numeric words by x-center
  const xCoords = numWords.map((w) => (w.bbox.x0 + w.bbox.x1) / 2).sort((a, b) => a - b);

  const clusters: number[] = [];
  for (const x of xCoords) {
    if (x < tableWidth * 0.3) continue; // Skip numbers in left description zone
    const existing = clusters.find((c) => Math.abs(c - x) < tableWidth * 0.08);
    if (!existing) {
      clusters.push(x);
    }
  }

  clusters.sort((a, b) => a - b);

  const cols: DetectedColumn[] = [];

  // 1. Product Name column (left zone)
  const firstCluster = clusters.length > 0 ? clusters[0] : tableWidth * 0.5;
  cols.push({
    type: 'productName',
    headerText: 'Product',
    minX: 0,
    maxX: Math.round(firstCluster * 0.85),
    leftX: 0,
    rightX: Math.round(firstCluster * 0.85),
    confidence: 65,
  });

  // Assign numeric clusters:
  if (clusters.length === 1) {
    // Only one number cluster -> assume it's Total
    cols.push({
      type: 'total',
      headerText: 'Amount',
      minX: Math.round(firstCluster * 0.85),
      maxX: tableWidth,
      leftX: Math.round(firstCluster * 0.85),
      rightX: tableWidth,
      confidence: 60,
    });
  } else if (clusters.length === 2) {
    // Two clusters -> Quantity and Amount (or Rate and Amount)
    const midSplit = Math.round((clusters[0] + clusters[1]) / 2);
    cols.push({
      type: 'quantity',
      headerText: 'Qty',
      minX: cols[0].rightX!,
      maxX: midSplit,
      leftX: cols[0].rightX!,
      rightX: midSplit,
      confidence: 60,
    });
    cols.push({
      type: 'total',
      headerText: 'Amount',
      minX: midSplit,
      maxX: tableWidth,
      leftX: midSplit,
      rightX: tableWidth,
      confidence: 60,
    });
  } else if (clusters.length >= 3) {
    // 3 or more clusters: Quantity, Rate, Amount
    const qSplit = Math.round((clusters[0] + clusters[1]) / 2);
    const rSplit = Math.round((clusters[1] + clusters[2]) / 2);

    cols.push({
      type: 'quantity',
      headerText: 'Qty',
      minX: cols[0].rightX!,
      maxX: qSplit,
      leftX: cols[0].rightX!,
      rightX: qSplit,
      confidence: 65,
    });
    cols.push({
      type: 'unitPrice',
      headerText: 'Rate',
      minX: qSplit,
      maxX: rSplit,
      leftX: qSplit,
      rightX: rSplit,
      confidence: 65,
    });
    cols.push({
      type: 'total',
      headerText: 'Amount',
      minX: rSplit,
      maxX: tableWidth,
      leftX: rSplit,
      rightX: tableWidth,
      confidence: 65,
    });
  }

  return cols;
}

/**
 * Validates a structured row using arithmetic and consistency checks.
 * States: EXACT_MATCH, MATCH_WITH_ROUNDING, MISMATCH, INSUFFICIENT_DATA, NEEDS_REVIEW.
 * Does NOT increase confidence score merely because arithmetic matches.
 */
export function validateStructuredRow(row: StructuredProductRow): StructuredProductRow {
  const issues: string[] = [...row.reviewReasons];
  const { purchasedQuantity, purchaseRate, lineTotal, discount, taxRate } = row;

  let validationStatus: TableValidationStatus = 'NEEDS_REVIEW';

  // 1. Check for required values
  if (purchasedQuantity === null || purchaseRate === null || lineTotal === null) {
    validationStatus = 'INSUFFICIENT_DATA';
    if (purchasedQuantity === null) issues.push('Quantity could not be determined.');
    if (purchaseRate === null) issues.push('Purchase rate is missing.');
    if (lineTotal === null) issues.push('Line total is missing.');
  } else {
    // 2. Arithmetic check: quantity * rate = lineTotal (accounting for discount & tax)
    const baseExpected = purchasedQuantity * purchaseRate;
    const discountAmt = discount ? (discount > 1 ? discount : baseExpected * (discount / 100)) : 0;
    const afterDiscount = baseExpected - discountAmt;
    const taxAmt = taxRate ? afterDiscount * (taxRate / 100) : 0;
    const expectedTotal = Math.round((afterDiscount + taxAmt) * 100) / 100;

    const diff = Math.abs(expectedTotal - lineTotal);
    const directDiff = Math.abs(baseExpected - lineTotal);

    if (diff < 0.005 || directDiff < 0.005) {
      // Exact calculation match
      validationStatus = issues.length > 0 ? 'NEEDS_REVIEW' : 'EXACT_MATCH';
    } else if (diff <= 1.0 || directDiff <= 1.0) {
      // Small rounding difference
      validationStatus = 'MATCH_WITH_ROUNDING';
    } else {
      // Clear mathematical discrepancy
      validationStatus = 'MISMATCH';
      issues.push(
        `Arithmetic discrepancy: ${purchasedQuantity} × ₹${purchaseRate} = ₹${baseExpected.toFixed(2)}, but Amount is ₹${lineTotal}`
      );
    }
  }

  // 3. Product name plausibility
  if (!row.productName || !isPlausibleProductName(row.productName) || row.productName.length < 2) {
    issues.push('Invalid or uncertain product name.');
    if (validationStatus === 'EXACT_MATCH') validationStatus = 'NEEDS_REVIEW';
  }

  // 4. Packaging vs Quantity check
  if (row.packSize !== null && !row.purchaseUnit) {
    issues.push('Purchase unit not established on invoice; please verify if pieces or packs.');
    if (validationStatus === 'EXACT_MATCH') validationStatus = 'NEEDS_REVIEW';
  }

  return {
    ...row,
    validationStatus,
    reviewReasons: Array.from(new Set(issues)),
  };
}

/**
 * Extracts structured product rows from OCR lines and detected columns.
 */
export function extractStructuredProductRows(
  lines: OCRLine[],
  columns: DetectedColumn[],
  isHeaderInferred: boolean = false
): StructuredProductRow[] {
  if (lines.length === 0 || columns.length === 0) return [];

  const rows: StructuredProductRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const text = l.text.trim();
    if (!text) continue;

    // Skip candidate header lines
    if (isCandidateHeaderLine(text)) continue;

    // Skip summary / footer / border rows
    if (/^[|\s.:\-_=~]+$/.test(text)) continue;
    if (
      /grand total|sub\s*total|bill\s*total|net amount|total\s*amount|total\s*value|taxable\s*value|round\s*off|balance amount|received amount|payment|terms and|authorized\s*signatory|authorised\s*signature/i.test(
        text
      )
    ) {
      continue;
    }

    // Map words to columns using horizontal boundary spans
    const words = l.words || [];
    const cellWords: Record<SemanticColumnType, OCRWord[]> = {
      serial: [],
      productName: [],
      hsn: [],
      quantity: [],
      unit: [],
      unitPrice: [],
      purchasePrice: [],
      sellingPrice: [],
      mrp: [],
      discount: [],
      taxableAmount: [],
      tax: [],
      gstRate: [],
      total: [],
      unknown: [],
    };

    if (words.length > 0) {
      for (const w of words) {
        const midX = (w.bbox.x0 + w.bbox.x1) / 2;
        const matchingCol = columns.find(
          (c) => midX >= (c.leftX ?? c.minX) && midX <= (c.rightX ?? c.maxX)
        );
        if (matchingCol) {
          cellWords[matchingCol.type].push(w);
        } else {
          // If word is to the left of all columns, assign to productName
          if (midX < (columns[0].leftX ?? columns[0].minX)) {
            cellWords.productName.push(w);
          } else {
            cellWords.total.push(w);
          }
        }
      }
    } else {
      // Fallback: tokenize text by pipes or whitespace
      const tokens = text.split(/[|\t]+/).map((t) => t.trim()).filter(Boolean);
      if (tokens.length >= 1 && cellWords.productName.length === 0) {
        cellWords.productName.push({
          text: tokens[0],
          confidence: 70,
          bbox: { x0: 0, y0: l.bbox.y0, x1: 100, y1: l.bbox.y1 }
        });
      }
    }

    const nameText = cellWords.productName.map((w) => w.text).join(' ').trim();
    const qtyText = cellWords.quantity.map((w) => w.text).join(' ').trim();
    const unitText = cellWords.unit.map((w) => w.text).join(' ').trim();
    const rateText = (
      cellWords.unitPrice.length > 0 ? cellWords.unitPrice : cellWords.purchasePrice
    )
      .map((w) => w.text)
      .join(' ')
      .trim();
    const mrpText = cellWords.mrp.map((w) => w.text).join(' ').trim();
    const discText = cellWords.discount.map((w) => w.text).join(' ').trim();
    const taxText = (
      cellWords.gstRate.length > 0 ? cellWords.gstRate : cellWords.tax
    )
      .map((w) => w.text)
      .join(' ')
      .trim();
    const totalText = cellWords.total.map((w) => w.text).join(' ').trim();

    // Check if line contains either text or numbers
    if (!nameText && !qtyText && !rateText && !totalText) continue;

    // 1. Product Name and Packaging Extraction
    const cleanedTitle = cleanProductName(nameText || text);
    const { packSize, packSizeUnit } = extractPackagingInfo(cleanedTitle);

    // 2. Quantity & Unit
    let { quantity: parsedQty, unit: parsedUnit } = parseQuantityAndUnit(qtyText);
    if (!parsedUnit && unitText) {
      parsedUnit = normalizeUnit(unitText) || unitText;
    }

    // Critical Rule: If unit equals packSizeUnit (e.g. 'g', 'ml', 'kg', 'L'), clear purchaseUnit!
    if (packSizeUnit && parsedUnit && parsedUnit.toLowerCase() === packSizeUnit.toLowerCase()) {
      parsedUnit = null;
    }

    // 3. Rate & MRP (strictly separated!)
    const parsedRate = parsePriceToken(rateText);
    const parsedMrp = parsePriceToken(mrpText);
    const parsedDiscount = parsePriceToken(discText);
    const parsedTaxRate = parsePriceToken(taxText);
    const parsedTotal = parsePriceToken(totalText);

    // Calculate field-level confidences
    const avgConf = (wList: OCRWord[]) =>
      wList.length > 0
        ? Math.round(wList.reduce((acc, w) => acc + (w.confidence || 80), 0) / wList.length)
        : 0;

    const confidence: FieldConfidence = {
      productName: avgConf(cellWords.productName) || Math.round(l.confidence || 80),
      quantity: parsedQty !== null ? avgConf(cellWords.quantity) || 85 : 0,
      unit: parsedUnit ? avgConf(cellWords.unit) || 85 : 0,
      rate: parsedRate !== null ? avgConf(cellWords.unitPrice) || 85 : 0,
      lineTotal: parsedTotal !== null ? avgConf(cellWords.total) || 85 : 0,
    };

    const reviewReasons: string[] = [];
    if (isHeaderInferred) {
      reviewReasons.push('Table header row was missing; columns inferred from spatial alignment.');
    }

    const rowObj: StructuredProductRow = {
      productName: cleanedTitle,
      purchasedQuantity: parsedQty,
      purchaseUnit: parsedUnit,
      packSize,
      packSizeUnit,
      mrp: parsedMrp,
      purchaseRate: parsedRate,
      sellingPrice: null, // Strictly null; NEVER set to purchaseRate
      discount: parsedDiscount,
      taxRate: parsedTaxRate,
      lineTotal: parsedTotal,
      confidence,
      validationStatus: 'NEEDS_REVIEW',
      reviewReasons,
      sourceRowText: text,
      sourceText: text,
    };

    const validatedRow = validateStructuredRow(rowObj);
    rows.push(validatedRow);
  }

  return rows;
}

/**
 * Converts structured product rows into InvoiceLineItems for the review table.
 */
export function convertStructuredRowsToLineItems(
  rows: StructuredProductRow[],
  existingProducts: Product[] = []
): InvoiceLineItem[] {
  return rows.map((row, idx) => {
    const id = `tbl_item_${Date.now().toString(36)}_${idx}`;
    const name = row.productName;

    // Check inventory match
    const matched = existingProducts.find(
      (p) => p.name.toLowerCase().trim() === name.toLowerCase().trim()
    );

    const isMatchConfirmed = Boolean(
      matched &&
      row.purchaseRate !== null &&
      row.purchaseRate > 0 &&
      row.purchasedQuantity !== null &&
      row.purchasedQuantity > 0
    );

    const confScore = Math.round(
      (row.confidence.productName * 0.4) +
      (row.confidence.quantity * 0.2) +
      (row.confidence.rate * 0.2) +
      (row.confidence.lineTotal * 0.2)
    );

    return {
      id,
      name,
      category: matched?.category || 'Groceries',
      quantity: row.purchasedQuantity,
      unit: row.purchaseUnit || '',
      purchasedQuantity: row.purchasedQuantity,
      purchaseUnit: row.purchaseUnit,
      packSize: row.packSize,
      packSizeUnit: row.packSizeUnit,
      rate: row.purchaseRate,
      purchasePrice: row.purchaseRate,
      sellingPrice: matched?.sellingPrice || matched?.price || null,
      mrp: row.mrp || matched?.mrp || null,
      lineTotal: row.lineTotal,
      discount: row.discount,
      taxRate: row.taxRate,
      taxAmount: row.taxAmount,
      confidence: confScore,
      confidenceLevel: confScore >= 85 && row.validationStatus === 'EXACT_MATCH' ? 'HIGH' : confScore >= 65 ? 'MEDIUM' : 'LOW',
      lowConfidence: confScore < 70 || row.validationStatus === 'MISMATCH' || row.validationStatus === 'INSUFFICIENT_DATA',
      matchedProductId: matched?.id,
      currentStock: matched?.stock,
      isMatchConfirmed,
      validationWarning: row.reviewReasons.length > 0 ? row.reviewReasons[0] : undefined,
      validationStatus: row.validationStatus,
      reviewReasons: row.reviewReasons,
      fieldConfidence: row.confidence,
      sourceText: row.sourceRowText,
      extractionMethod: 'PRODUCT_TABLE_ONLY',
      inventoryData: matched ? {
        id: matched.id,
        name: matched.name,
        stock: matched.stock,
        storePurchasePrice: matched.purchasePrice,
        storeSellingPrice: matched.sellingPrice || matched.price,
        storeMrp: matched.mrp,
      } : undefined,
    };
  });
}

/**
 * Main Product Table Scanner Pipeline.
 * 1. Crops the selected table region with full text resolution.
 * 2. Runs Tesseract OCR on table area.
 * 3. Identifies columns and groups physical rows.
 * 4. Extracts structured rows with packaging separation and arithmetic validation.
 * 5. Returns UI-ready ParsedInvoice.
 */
export async function parseProductTableFromImage(
  source: File | string,
  cropRegion?: CropRegion,
  onProgress?: (progress: number, statusText: string) => void,
  existingProducts: Product[] = []
): Promise<ParsedInvoice> {
  if (onProgress) {
    onProgress(15, 'Cropping product table with high resolution...');
  }

  // 1. Crop & conservative enhancement
  const preprocessed = await cropAndPreprocessTableImage(source, cropRegion);

  if (onProgress) {
    onProgress(35, 'Running Table-Only OCR on cropped area...');
  }

  // 2. Perform OCR on cropped table
  const ocrResult = await performOCR(preprocessed.processedDataUrl, (prog, text) => {
    if (onProgress) {
      onProgress(35 + Math.round(prog * 0.45), text);
    }
  }, '6'); // PSM 6: Uniform single block of table text

  if (onProgress) {
    onProgress(85, 'Inferring column alignment & separating packaging sizes...');
  }

  const tableWidth = preprocessed.width || 1200;

  // 3. Locate header line and detect columns
  let columns: DetectedColumn[] = [];
  let headerLineIndex = -1;
  let isHeaderInferred = false;

  for (let i = 0; i < Math.min(ocrResult.lines.length, 6); i++) {
    const line = ocrResult.lines[i];
    if (isCandidateHeaderLine(line.text)) {
      const cols = detectTableColumnsFromHeaders(line, tableWidth);
      if (cols.length >= 2) {
        columns = cols;
        headerLineIndex = i;
        break;
      }
    }
  }

  if (columns.length === 0) {
    // Headers missing or cropped away by user
    columns = inferColumnsFromSpatialLayout(ocrResult.lines, tableWidth);
    isHeaderInferred = true;
  }

  // 4. Extract structured rows
  const linesToProcess = headerLineIndex >= 0 ? ocrResult.lines.slice(headerLineIndex + 1) : ocrResult.lines;
  const structuredRows = extractStructuredProductRows(linesToProcess, columns, isHeaderInferred);

  // 5. Convert to UI line items
  const items = convertStructuredRowsToLineItems(structuredRows, existingProducts);

  const totalAmount = items.reduce((acc, it) => acc + (it.lineTotal || 0), 0);
  const totalUnits = items.reduce((acc, it) => acc + (it.quantity || 0), 0);

  const parsedInvoice: ParsedInvoice = {
    id: `inv_table_${Date.now().toString(36)}`,
    supplierName: '',
    invoiceNumber: '',
    invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    items,
    totalAmount,
    totalUnits,
    totalItems: items.length,
    confidenceScore: items.length > 0 ? Math.round(items.reduce((acc, it) => acc + it.confidence, 0) / items.length) : 0,
    rawOcrText: ocrResult.text,
    engineUsed: 'tesseract',
    extractionMethod: 'PRODUCT_TABLE_ONLY',
    imagePreviewUrl: preprocessed.originalDataUrl,
    detectedColumns: columns,
    status: items.length > 0 ? 'success' : 'needs_review',
    reason: items.length > 0 ? null : 'No product rows detected in cropped table.',
    notices: isHeaderInferred
      ? ['Table headers were not detected in the cropped area. Column boundaries were inferred from layout alignment. Please review all fields.']
      : undefined,
  };

  if (onProgress) {
    onProgress(100, 'Product table extraction complete!');
  }

  return parsedInvoice;
}
