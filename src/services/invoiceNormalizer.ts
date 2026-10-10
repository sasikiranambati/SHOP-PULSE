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
  ValidationState,
  FieldConfidence,
} from './invoiceTypes';
import { type RawExtractedItem, extractProductSizeAndTitle, extractUnitFromTitle } from './tableLayoutExtractor';
import { type ExtractedMetadata, isPlausibleProductName } from './sectionClassifier';

export interface ArithmeticValidationResult {
  status: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  state: ValidationState;
  warning?: string;
  diff?: number;
}

/**
 * Validates line item arithmetic across commercial pricing relationships.
 */
export function validateLineArithmetic(
  quantity: number | null,
  rate: number | null,
  lineTotal: number | null,
  discount?: number | null,
  gstRate?: number | null,
  taxAmount?: number | null
): ArithmeticValidationResult {
  if (rate === null || lineTotal === null || quantity === null) {
    const reasons: string[] = [];
    if (quantity === null) reasons.push('Quantity missing');
    if (rate === null) reasons.push('Rate missing');
    if (lineTotal === null) reasons.push('Line total missing');
    return {
      status: 'INSUFFICIENT_DATA',
      state: 'INSUFFICIENT_DATA',
      warning: reasons.join(', '),
    };
  }

  const rawExpectedTotal = quantity * rate;
  const discountVal = discount || 0;
  const taxVal = taxAmount || 0;
  const gstPercent = gstRate || 0;

  // Check relationship across standard commercial invoicing formats
  const diffStandard = Math.abs(rawExpectedTotal - lineTotal);
  const diffWithDiscount = Math.abs((rawExpectedTotal - discountVal) - lineTotal);
  const diffWithDiscountPct = discount ? Math.abs((rawExpectedTotal * (1 - discount / 100)) - lineTotal) : Infinity;
  const diffWithTax = Math.abs((rawExpectedTotal + taxVal) - lineTotal);
  const diffWithGst = gstPercent ? Math.abs((rawExpectedTotal * (1 + gstPercent / 100)) - lineTotal) : Infinity;
  const discountedAmount = rawExpectedTotal * (1 - (discount || 0) / 100);
  const diffWithBoth = Math.abs((discountedAmount * (1 + gstPercent / 100)) - lineTotal);

  const minDiff = Math.min(
    diffStandard,
    diffWithDiscount,
    diffWithDiscountPct,
    diffWithTax,
    diffWithGst,
    diffWithBoth
  );

  if (minDiff <= 0.05) {
    return {
      status: 'VERIFIED',
      state: 'EXACT_MATCH',
      diff: minDiff,
    };
  }

  if (minDiff <= Math.max(1.5, lineTotal * 0.015)) {
    return {
      status: 'VERIFIED',
      state: 'MATCH_WITH_ROUNDING',
      diff: minDiff,
    };
  }

  const actualDiff = Math.abs(rawExpectedTotal - lineTotal);
  return {
    status: 'MISMATCH',
    state: 'MISMATCH',
    diff: actualDiff,
    warning: `Arithmetic discrepancy: ${quantity} × ₹${rate} = ₹${rawExpectedTotal} but Total is ₹${lineTotal} (Diff: ₹${actualDiff.toFixed(2)})`,
  };
}

/**
 * Computes honest field-level and overall confidence scores.
 */
export function computeFieldConfidence(
  productName: string,
  quantity: number | null,
  unit: string | null,
  rate: number | null,
  lineTotal: number | null,
  validationState: ValidationState,
  isLiquidOrPersonalCare: boolean = false
): FieldConfidence & { overall: number; level: ConfidenceLevel } {
  const nameConfidence = !productName || productName.length < 2 ? 0 : isPlausibleProductName(productName) ? 95 : 40;
  const quantityConfidence = quantity === null || quantity <= 0 ? 0 : 92;
  const unitConfidence = !unit || (isLiquidOrPersonalCare && unit === 'kg') ? 40 : 90;
  const rateConfidence = rate === null ? 0 : validationState === 'EXACT_MATCH' ? 95 : validationState === 'MATCH_WITH_ROUNDING' ? 90 : 50;
  const lineTotalConfidence = lineTotal === null ? 0 : validationState === 'EXACT_MATCH' ? 95 : validationState === 'MATCH_WITH_ROUNDING' ? 90 : 50;

  const weightedConf =
    nameConfidence * 0.25 +
    quantityConfidence * 0.20 +
    unitConfidence * 0.10 +
    rateConfidence * 0.25 +
    lineTotalConfidence * 0.20;

  const finalConfidence = Math.min(99, Math.max(15, Math.round(weightedConf)));

  let level: ConfidenceLevel = 'MEDIUM';
  if (finalConfidence >= 85 && validationState === 'EXACT_MATCH') {
    level = 'HIGH';
  } else if (finalConfidence < 65 || validationState === 'MISMATCH' || validationState === 'INSUFFICIENT_DATA') {
    level = 'LOW';
  }

  return {
    name: nameConfidence,
    quantity: quantityConfidence,
    unit: unitConfidence,
    rate: rateConfidence,
    lineTotal: lineTotalConfidence,
    overall: finalConfidence,
    level,
  };
}

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
  const unit = raw.unit ? String(raw.unit).trim() : (extractUnitFromTitle(productName) || null);

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

  const priceForCheck = purchasePrice ?? sellingPrice;
  const arithmetic = validateLineArithmetic(quantity, priceForCheck, lineTotal, discount, gstRate, taxAmount);
  const arithmeticStatus = arithmetic.status;
  let validationState: ValidationState = arithmetic.state;
  if (arithmetic.warning) {
    issues.push(arithmetic.warning);
  }

  // Packaging separation & unit ambiguity checks
  let packSize = raw.packSize ?? null;
  let packSizeUnit = raw.packSizeUnit ?? null;
  if (packSize === null && packSizeUnit === null) {
    const sizeInfo = extractProductSizeAndTitle(productName, raw.sourceText);
    packSize = sizeInfo.packSize ?? null;
    packSizeUnit = sizeInfo.packSizeUnit ?? null;
  }

  const isLiquidOrPersonalCare = /soap|shampoo|paste|colgate|brush|cream|lotion|dettol|face|hair|surf|detergent|rin|vim|dish/i.test(productName);
  if (isLiquidOrPersonalCare && unit === 'kg') {
    issues.push('Packaging unit (kg) assigned to personal care/liquid product; please verify unit and count.');
    if (validationState === 'EXACT_MATCH') {
      validationState = 'NEEDS_REVIEW';
    }
  }

  const purchasedQuantity = raw.purchasedQuantity ?? quantity;
  const purchaseUnit = raw.purchaseUnit ?? unit;

  // Field-level honest confidence scoring
  const confResult = computeFieldConfidence(
    productName,
    quantity,
    unit,
    priceForCheck,
    lineTotal,
    validationState,
    isLiquidOrPersonalCare
  );

  const fieldConfidence: FieldConfidence = {
    name: confResult.name,
    quantity: confResult.quantity,
    unit: confResult.unit,
    rate: confResult.rate,
    lineTotal: confResult.lineTotal,
  };

  const finalConfidence = confResult.overall;
  let confidenceLevel: ConfidenceLevel = confResult.level;
  if (issues.length > 0 && confidenceLevel === 'HIGH') {
    confidenceLevel = 'MEDIUM';
  }

  const combinedReviewReasons = Array.from(new Set([...(raw.reviewReasons || []), ...issues]));

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
    validationState,
    fieldConfidence,
    purchasedQuantity,
    purchaseUnit,
    packSize,
    packSizeUnit,
    suggestedRate: raw.suggestedRate ?? null,
    reviewReasons: combinedReviewReasons.length > 0 ? combinedReviewReasons : undefined,
    needsReview: combinedReviewReasons.length > 0 || validationState !== 'EXACT_MATCH',
    confidence: finalConfidence,
    confidenceLevel,
    sourceText: raw.sourceText || productName,
    extractionMethod: raw.extractionMethod,
    validationIssues: combinedReviewReasons.length > 0 ? combinedReviewReasons : undefined,
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
