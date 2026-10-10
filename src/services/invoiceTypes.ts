/**
 * @file invoiceTypes.ts
 * @description Canonical Schema and Types for ShopPulse Flexible Multi-Format Invoice Extraction.
 * Implements canonical line-item schema, semantic column aliases, extraction method tiers,
 * confidence scoring levels, and inventory matching structures.
 */

import type { Product } from '../types/product';
import type { BoundingBox, OCRWord } from './ocrService';

/**
 * Standard supported inventory units.
 */
export type ProductUnit = 'kg' | 'g' | 'L' | 'ml' | 'pcs' | 'pkt' | 'box' | 'bag';

/**
 * Confidence level categories for extraction and inventory matching.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Multi-tier extraction strategy method used for each line or document.
 */
export type ExtractionMethod =
  | 'TABLE_STRUCTURED'
  | 'LAYOUT_SPATIAL'
  | 'TEXT_LINE_ITEM'
  | 'SEMANTIC_RECONSTRUCTION'
  | 'DIGITAL_PDF'
  | 'OCR_TABLE'
  | 'MANUAL_FALLBACK';

/**
 * Semantic column roles detected in an invoice table or row.
 */
export type SemanticColumnType =
  | 'serial'
  | 'productName'
  | 'hsn'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'purchasePrice'
  | 'sellingPrice'
  | 'mrp'
  | 'discount'
  | 'taxableAmount'
  | 'tax'
  | 'gstRate'
  | 'total'
  | 'unknown';

/**
 * Definition of a detected column in an invoice table.
 */
export interface DetectedColumn {
  type: SemanticColumnType;
  headerText: string;
  minX: number;
  maxX: number;
  confidence: number;
  leftX?: number;
  rightX?: number;
}

/**
 * Section classification in an invoice document.
 */
export type DocumentSectionType =
  | 'HEADER'
  | 'SUPPLIER_INFO'
  | 'CUSTOMER_INFO'
  | 'LINE_ITEMS'
  | 'TAX_SUMMARY'
  | 'TOTAL_SUMMARY'
  | 'FOOTER'
  | 'UNKNOWN';

/**
 * Classified line with spatial and structural context.
 */
export interface DocumentLine {
  text: string;
  section: DocumentSectionType;
  confidence: number;
  lineIndex: number;
  words?: OCRWord[];
  bbox?: BoundingBox;
}

/** Where a line's MRP came from. */
export type MrpSource = 'INVOICE' | 'API' | 'MANUAL' | 'STORE';

/**
 * Where a line's amount came from: printed on the invoice, typed in by the user, or
 * (in-browser engine only) calculated. Server results keep the calculation separately
 * in `calculatedAmount` and never put it in `lineTotal`.
 */
export type LineTotalSource = 'INVOICE' | 'CALCULATED' | 'MANUAL';

/** One comparison between a printed invoice total and the sum of the extracted lines. */
export interface InvoiceTotalCheck {
  field: 'quantity' | 'discount' | 'tax' | 'amount' | 'balance' | string;
  printed: number | null;
  calculated: number | null;
  difference: number | null;
  status: 'MATCH' | 'ROUNDING' | 'MISMATCH' | 'NOT_PRINTED' | string;
  message: string;
}

/** Totals printed on the invoice next to the sums of the extracted lines (server results). */
export interface InvoiceTotals {
  printedQuantity: number | null;
  printedDiscount: number | null;
  printedTax: number | null;
  printedAmount: number | null;
  subTotal: number | null;
  roundOff: number | null;
  grandTotal: number | null;
  received: number | null;
  balance: number | null;
  linesQuantity: number | null;
  linesDiscount: number | null;
  linesTax: number | null;
  linesAmount: number | null;
  linesWithoutAmount: number;
  checks: InvoiceTotalCheck[];
}

/** Result of the backend's external MRP lookup for one line. */
export interface MrpLookupInfo {
  status:
    | 'FOUND'
    | 'PRODUCT_NOT_FOUND'
    | 'MRP_UNAVAILABLE'
    | 'MANUAL_REVIEW_REQUIRED'
    | 'API_AUTHENTICATION_ERROR'
    | 'API_RATE_LIMITED'
    | 'API_TIMEOUT'
    | 'API_CONFIGURATION_ERROR'
    | 'API_ERROR'
    | 'SKIPPED'
    | string;
  provider: string;
  message: string;
  mrp?: number | null;
  matchedName?: string | null;
  matchConfidence?: number | null;
  lookedUpAt?: string | null;
}

/** Extraction evidence shared by canonical and UI line items. */
export interface LineEvidence {
  mrpSource?: MrpSource | null;
  invoiceMrp?: number | null;
  storeMrp?: number | null;
  mrpLookup?: MrpLookupInfo | null;
  lineTotalSource?: LineTotalSource | null;
  /** Expected amount from the arithmetic rule; never replaces the printed amount */
  calculatedAmount?: number | null;
  /** Printed amount minus calculated amount */
  amountDifference?: number | null;
  arithmeticStatus?: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  /** Plain-language result of the arithmetic check */
  arithmeticExplanation?: string | null;
  /** Unit exactly as printed on the invoice (e.g. BOR, PET); `unit` is the stock unit */
  printedUnit?: string | null;
  discountPct?: number | null;
  needsReview?: boolean;
  suggestions?: string[];
  suggestedRate?: number | null;
  rawCells?: Record<string, string>;
}

/**
 * Canonical Invoice Line Item schema.
 * Missing fields remain null. No fabricated values.
 */
export interface CanonicalInvoiceItem extends LineEvidence {
  id: string;
  productName: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
  mrp: number | null;
  discount: number | null;
  taxableAmount: number | null;
  taxAmount: number | null;
  gstRate: number | null;
  hsnCode: string | null;
  lineTotal: number | null;
  confidence: number; // 0 to 100
  confidenceLevel: ConfidenceLevel;
  sourceText: string;
  extractionMethod: ExtractionMethod;
  validationIssues?: string[];
  rawLineIndex?: number;
  rawRate?: number | null;
  rawPurchasePrice?: number | null;
  rawSellingPrice?: number | null;
  rawMrp?: number | null;
}

/**
 * Result of inventory matching against existing store products.
 */
export interface InventoryMatchResult {
  itemId: string;
  matchedProductId?: string;
  matchedProductName?: string;
  suggestedProducts: Array<{ product: Product; score: number; reason: string }>;
  matchScore: number; // 0 to 1
  matchLevel: ConfidenceLevel;
  isConfirmed: boolean;
}

/**
 * UI-ready line item extending the canonical item with store stock info.
 */
export interface InvoiceLineItem extends LineEvidence {
  id: string;
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
  rate?: number | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
  mrp?: number | null;
  lineTotal: number | null;
  discount?: number | null;
  taxableAmount?: number | null;
  taxAmount?: number | null;
  gstRate?: number | null;
  hsnCode?: string | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  lowConfidence: boolean;
  matchedProductId?: string;
  currentStock?: number;
  suggestedMatch?: {
    id: string;
    name: string;
    stock: number;
    sellingPrice?: number;
  };
  isMatchConfirmed?: boolean;
  /** Review notes joined for tooltips; `validationIssues` holds them one by one */
  validationWarning?: string;
  validationIssues?: string[];
  sourceText?: string;
  extractionMethod?: ExtractionMethod;
  rawRate?: number | null;
  rawPurchasePrice?: number | null;
  rawSellingPrice?: number | null;
  rawMrp?: number | null;
  inventoryData?: {
    id?: string;
    name?: string;
    stock?: number;
    purchasePrice?: number | null;
    sellingPrice?: number | null;
    mrp?: number | null;
    storePurchasePrice?: number | null;
    storeSellingPrice?: number | null;
    storeMrp?: number | null;
    currentStock?: number;
  };
}

/**
 * Complete Canonical Invoice Document representation.
 */
export interface CanonicalInvoice {
  id: string;
  supplierName: string | null;
  supplierConfidence: number;
  invoiceNumber: string | null;
  invoiceNoConfidence: number;
  invoiceDate: string | null;
  dateConfidence: number;
  gstin: string | null;
  customerName: string | null;
  items: CanonicalInvoiceItem[];
  subtotal: number | null;
  taxAmount: number | null;
  discount: number | null;
  roundOff: number | null;
  totalAmount: number | null;
  confidenceScore: number;
  rawOcrText: string;
  engineUsed: 'gemini' | 'tesseract' | 'pdf_direct' | 'sample';
  extractionMethod: ExtractionMethod;
  imagePreviewUrl?: string;
  detectedSections: {
    headerLines: string[];
    supplierLines: string[];
    customerLines: string[];
    itemLines: string[];
    taxLines: string[];
    totalLines: string[];
    footerLines: string[];
  };
}

/**
 * High-level parsed invoice result consumed by UI.
 */
export interface ParsedInvoice {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  gstin?: string;
  items: InvoiceLineItem[];
  totalAmount: number;
  totalUnits?: number;
  totalItems?: number;
  subtotal?: number;
  taxAmount?: number;
  discount?: number;
  confidenceScore: number;
  imagePreviewUrl?: string;
  rawOcrText?: string;
  engineUsed?:
    | 'gemini'
    | 'tesseract'
    | 'pdf_direct'
    | 'sample'
    | 'backend_ocr_pipeline'
    | 'backend_pdf_direct'
    | 'backend_pdf_ocr_scanned'
    | 'backend_text_direct';
  extractionMethod?: ExtractionMethod;
  supplierConfidence?: number;
  invoiceNoConfidence?: number;
  dateConfidence?: number;
  canonical?: CanonicalInvoice;
  detectedSections?: {
    headerLines: string[];
    supplierLines: string[];
    customerLines: string[];
    itemLines: string[];
    taxLines: string[];
    totalLines: string[];
    footerLines: string[];
  };
  documentType?: 'pdf' | 'image' | 'sample';
  status?: 'success' | 'needs_review' | 'error';
  reason?: string | null;
  detectedColumns?: DetectedColumn[];
  rawLines?: DocumentLine[];
  validationWarnings?: string[];
  diagnostics?: {
    totalRawLines?: number;
    totalRawWords?: number;
    headerDetected?: boolean;
    detectedColumns?: string[];
    detectedSections?: string[];
    warnings?: string[];
    rawWords?: OCRWord[];
    detectedColumnsList?: DetectedColumn[];
    detectedRows?: Array<{ productName: string; quantity: string; unit: string; rate: string; discount: string; tax: string; amount: string }>;
    rawApiResponse?: any;
    mrpProvider?: string | null;
    backendError?: string | null;
  };
  /** Shown above the review table, e.g. when the server could not be used */
  notices?: string[];
  /** Printed totals and their comparison with the lines (server results) */
  totals?: InvoiceTotals | null;
}
