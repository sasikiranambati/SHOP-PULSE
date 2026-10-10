/**
 * @file invoiceNormalizer.ts
 * @description Canonical Normalization Layer for ShopPulse.
 * Transforms raw extracted OCR/layout candidate rows into validated CanonicalInvoice
 * and CanonicalInvoiceItem objects.
 *
 * Rules:
 * 1. Missing fields MUST remain null. NEVER invent values.
 * 2. Rate != Selling Price. Purchase price is wholesale purchase cost.
 * 3. Validates arithmetic relationships (qty * unitPrice ≈ lineTotal, discounts, taxes).
 * 4. Assigns confidence scores & levels (HIGH, MEDIUM, LOW).
 */

import type {
  CanonicalInvoice,
  CanonicalInvoiceItem,
  ConfidenceLevel,
  ExtractionMethod,
} from './invoiceTypes';
import type { RawExtractedItem } from './tableLayoutExtractor';
import { type ExtractedMetadata, isPlausibleProductName } from './sectionClassifier';

/**
 * Normalizes a raw extracted item into a canonical invoice item with validation.
 */
export function normalizeCanonicalItem(
  raw: RawExtractedItem,
  index: number
): CanonicalInvoiceItem {
  const issues: string[] = [];

  const productName = (raw.productName || '').trim();
  if (!productName || !isPlausibleProductName(productName)) {
    issues.push('Invalid or uncertain product name; manual verification required.');
  }
  // An unreadable quantity stays null instead of being assumed to be 1
  const quantity = typeof raw.quantity === 'number' && raw.quantity > 0 ? raw.quantity : null;
  const unit = raw.unit ? String(raw.unit).trim() : null;

  const rawRateVal = typeof raw.rawRate === 'number' ? raw.rawRate : (typeof raw.rate === 'number' ? raw.rate : null);
  const rawPurchaseVal = typeof raw.rawPurchasePrice === 'number' ? raw.rawPurchasePrice : (typeof raw.purchasePrice === 'number' ? raw.purchasePrice : null);
  const rawSellingVal = typeof raw.rawSellingPrice === 'number' ? raw.rawSellingPrice : (typeof raw.sellingPrice === 'number' ? raw.sellingPrice : null);
  const rawMrpVal = typeof raw.rawMrp === 'number' ? raw.rawMrp : (typeof raw.mrp === 'number' ? raw.mrp : null);

  const rate = typeof raw.rate === 'number' ? raw.rate : (typeof raw.purchasePrice === 'number' ? raw.purchasePrice : null);
  const purchasePrice = typeof raw.purchasePrice === 'number' ? raw.purchasePrice : (typeof raw.rate === 'number' ? raw.rate : null);
  const sellingPrice = typeof raw.sellingPrice === 'number' ? raw.sellingPrice : null;
  const mrp = typeof raw.mrp === 'number' ? raw.mrp : null;

  let lineTotal = typeof raw.lineTotal === 'number' ? raw.lineTotal : null;
  let lineTotalSource: 'INVOICE' | 'CALCULATED' | null = lineTotal !== null ? 'INVOICE' : null;

  // If Amount (lineTotal) is missing: lineTotal = quantity * purchasePrice ONLY when both quantity and purchasePrice are valid
  if (lineTotal === null && quantity !== null && purchasePrice !== null) {
    lineTotal = Math.round(quantity * purchasePrice * 100) / 100;
    lineTotalSource = 'CALCULATED';
  }
  if (quantity === null) {
    issues.push('Quantity could not be read; enter it manually.');
  }
  // Missing prices stay null: NEVER compute purchasePrice = lineTotal / quantity when no purchase column existed

  const discount = typeof raw.discount === 'number' && raw.discount >= 0 ? raw.discount : null;
  const taxableAmount = typeof raw.taxableAmount === 'number' && raw.taxableAmount > 0 ? raw.taxableAmount : null;
  const taxAmount = typeof raw.taxAmount === 'number' && raw.taxAmount > 0 ? raw.taxAmount : null;
  const gstRate = typeof raw.gstRate === 'number' && raw.gstRate > 0 ? raw.gstRate : null;
  const hsnCode = raw.hsnCode ? String(raw.hsnCode).trim() : null;

  // Arithmetic Validation
  let arithmeticStatus: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
  let numericScoreBonus = 0;
  const priceForCheck = purchasePrice ?? sellingPrice;

  if (priceForCheck !== null && lineTotal !== null && quantity !== null) {
    const rawExpectedTotal = quantity * priceForCheck;
    const discountVal = discount || 0;
    const taxVal = taxAmount || 0;

    // Check relationship with tolerance for rounding (+/- ₹2 or 2%)
    const diffStandard = Math.abs(rawExpectedTotal - lineTotal);
    const diffWithDiscount = Math.abs(rawExpectedTotal - discountVal - lineTotal);
    const diffWithTax = Math.abs(rawExpectedTotal + taxVal - lineTotal);
    const diffWithBoth = Math.abs(rawExpectedTotal - discountVal + taxVal - lineTotal);

    const matchesDirect = diffStandard < Math.max(2, lineTotal * 0.02);
    const matchesDiscount = diffWithDiscount < Math.max(2, lineTotal * 0.02);
    const matchesTax = diffWithTax < Math.max(2, lineTotal * 0.02);
    const matchesBoth = diffWithBoth < Math.max(2, lineTotal * 0.02);

    if (matchesDirect || matchesDiscount || matchesTax || matchesBoth) {
      numericScoreBonus = 15; // Math checks out!
      arithmeticStatus = 'VERIFIED';
    } else {
      issues.push(`Arithmetic discrepancy: ${quantity} × ₹${priceForCheck} = ₹${rawExpectedTotal} but Total is ₹${lineTotal}`);
      numericScoreBonus = -20;
      arithmeticStatus = 'MISMATCH';
    }
  } else {
    arithmeticStatus = 'INSUFFICIENT_DATA';
    if (purchasePrice === null && sellingPrice === null && lineTotal === null) {
      issues.push('Missing price and line total.');
      numericScoreBonus = -30;
    }
  }

  // Description length check
  if (productName.length < 3) {
    issues.push('Very short or uncertain product name.');
    numericScoreBonus -= 15;
  }

  // Base confidence from extraction method
  let baseConfidence = raw.confidence || 75;
  if (raw.extractionMethod === 'TABLE_STRUCTURED') baseConfidence = Math.max(baseConfidence, 88);
  else if (raw.extractionMethod === 'LAYOUT_SPATIAL') baseConfidence = Math.max(baseConfidence, 80);
  else if (raw.extractionMethod === 'TEXT_LINE_ITEM') baseConfidence = Math.max(baseConfidence, 78);
  else if (raw.extractionMethod === 'SEMANTIC_RECONSTRUCTION') baseConfidence = Math.max(baseConfidence, 72);

  const finalConfidence = Math.min(99, Math.max(20, Math.round(baseConfidence + numericScoreBonus)));

  let confidenceLevel: ConfidenceLevel = 'MEDIUM';
  if (finalConfidence >= 85 && issues.length === 0) {
    confidenceLevel = 'HIGH';
  } else if (finalConfidence < 65 || issues.length > 0) {
    confidenceLevel = 'LOW';
  }

  return {
    id: `canon_item_${Date.now().toString(36)}_${index}`,
    productName,
    quantity,
    unit,
    rate,
    purchasePrice,
    sellingPrice, // Preserves null if not present; NEVER invented or defaulted to zero
    mrp,
    rawRate: rawRateVal,
    rawPurchasePrice: rawPurchaseVal,
    rawSellingPrice: rawSellingVal,
    rawMrp: rawMrpVal,
    discount,
    taxableAmount,
    taxAmount,
    gstRate,
    hsnCode,
    lineTotal,
    lineTotalSource,
    arithmeticStatus,
    needsReview: issues.length > 0 || arithmeticStatus === 'MISMATCH' || quantity === null || purchasePrice === null,
    confidence: finalConfidence,
    confidenceLevel,
    sourceText: raw.sourceText || productName,
    extractionMethod: raw.extractionMethod,
    validationIssues: issues.length > 0 ? issues : undefined,
    rawLineIndex: raw.lineIndex,
  };
}

/**
 * Normalizes the full invoice into a CanonicalInvoice object.
 */
export function normalizeCanonicalInvoice(
  metadata: ExtractedMetadata,
  rawItems: RawExtractedItem[],
  rawText: string,
  engineUsed: 'gemini' | 'tesseract' | 'pdf_direct' | 'sample',
  extractionMethod: ExtractionMethod,
  sectionLines: {
    headerLines: string[];
    supplierLines: string[];
    customerLines: string[];
    itemLines: string[];
    taxLines: string[];
    totalLines: string[];
    footerLines: string[];
  }
): CanonicalInvoice {
  const items = rawItems.map((raw, idx) => normalizeCanonicalItem(raw, idx));

  // Compute calculated subtotal from items if missing
  const sumLineTotals = items.reduce((acc, it) => acc + (it.lineTotal || 0), 0);
  const roundedSum = Math.round(sumLineTotals * 100) / 100;

  let totalAmount = metadata.grandTotal;
  if (totalAmount === null || totalAmount <= 0) {
    totalAmount = roundedSum;
  } else if (items.length > 0 && Math.abs(totalAmount - roundedSum) > Math.max(3, totalAmount * 0.03)) {
    // Show a review warning rather than silently forcing a match
    const warning = `Invoice total (₹${totalAmount}) does not match the sum of extracted line items (₹${roundedSum}). Please verify line items.`;
    if (!sectionLines.totalLines.includes(warning)) {
      sectionLines.totalLines.push(warning);
    }
  }

  // Overall confidence score based on item average, metadata confidence, and errors
  const avgItemConf =
    items.length > 0
      ? items.reduce((acc, it) => acc + it.confidence, 0) / items.length
      : 50;

  const overallConfidence = Math.min(
    99,
    Math.round(
      metadata.supplierConfidence * 0.2 +
      metadata.dateConfidence * 0.1 +
      metadata.invoiceNoConfidence * 0.1 +
      avgItemConf * 0.6
    )
  );

  return {
    id: `inv_canon_${Date.now().toString(36)}`,
    supplierName: metadata.supplierName || null,
    supplierConfidence: metadata.supplierConfidence,
    invoiceNumber: metadata.invoiceNumber || null,
    invoiceNoConfidence: metadata.invoiceNoConfidence,
    invoiceDate: metadata.invoiceDate || null,
    dateConfidence: metadata.dateConfidence,
    gstin: metadata.gstin,
    customerName: metadata.customerName,
    items,
    subtotal: metadata.subtotal,
    taxAmount: metadata.taxAmount,
    discount: metadata.discount,
    roundOff: metadata.roundOff,
    totalAmount,
    confidenceScore: overallConfidence,
    rawOcrText: rawText,
    engineUsed,
    extractionMethod,
    detectedSections: sectionLines,
  };
}
