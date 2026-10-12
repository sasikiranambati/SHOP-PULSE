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
  | 'PRODUCT_TABLE_ONLY'
  | 'MANUAL_FALLBACK';

/**
 * Validation states for table row verification.
 */
export type TableValidationStatus =
  | 'EXACT_MATCH'
  | 'MATCH_WITH_ROUNDING'
  | 'MISMATCH'
  | 'INSUFFICIENT_DATA'
  | 'NEEDS_REVIEW';

export interface FieldConfidence {
  productName: number;
  quantity: number;
  unit: number;
  rate: number;
  lineTotal: number;
}

export interface StructuredProductRow {
  productName: string;
  purchasedQuantity: number | null;
  purchaseUnit: string | null;
  packSize: number | null;
  packSizeUnit: string | null;
  mrp: number | null;
  purchaseRate: number | null;
  sellingPrice: number | null;
  discount: number | null;
  taxRate: number | null;
  taxAmount?: number | null;
  lineTotal: number | null;
  confidence: FieldConfidence;
  validationStatus: TableValidationStatus;
  reviewReasons: string[];
  sourceRowText?: string;
  sourceText?: string;
  hsnCode?: string | null;
  matchedProductId?: string;
  isMatchConfirmed?: boolean;
}

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

/** Where a line's amount came from: printed on the invoice, calculated (qty × rate) or typed in. */
export type LineTotalSource = 'INVOICE' | 'CALCULATED' | 'MANUAL';

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
  arithmeticStatus?: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
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
  purchasedQuantity?: number | null;
  purchaseUnit?: string | null;
  packSize?: number | null;
  packSizeUnit?: string | null;
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
  validationStatus?: TableValidationStatus;
  reviewReasons?: string[];
  fieldConfidence?: FieldConfidence;
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
  purchasedQuantity?: number | null;
  purchaseUnit?: string | null;
  packSize?: number | null;
  packSizeUnit?: string | null;
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
  validationWarning?: string;
  sourceText?: string;
  extractionMethod?: ExtractionMethod;
  rawRate?: number | null;
  rawPurchasePrice?: number | null;
  rawSellingPrice?: number | null;
  rawMrp?: number | null;
  validationStatus?: TableValidationStatus;
  reviewReasons?: string[];
  fieldConfidence?: FieldConfidence;
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
}
