/**
 * @file invoice.ts
 * @description API client methods for Invoice Scanner backend endpoints and canonical response mapping.
 */

import { apiClient } from './client';
import type { Product } from '../types/product';
import type { CanonicalInvoiceItem, ParsedInvoice } from '../services/invoiceTypes';
import { matchCanonicalItemsWithInventory } from '../services/inventoryMatcher';

export interface BackendCanonicalInvoiceItem {
  id: string;
  product_name: string;
  quantity?: number | null;
  unit?: string | null;
  rate?: number | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  mrp?: number | null;
  discount?: number | null;
  taxable_amount?: number | null;
  tax_amount?: number | null;
  gst_rate?: number | null;
  hsn_code?: string | null;
  line_total?: number | null;
  amount?: number | null;
  purchasePrice?: number | null;
  confidence?: number;
  confidence_level?: string;
  source_text?: string;
  extraction_method?: string;
  validation_issues?: string[];
  matched_product_id?: string;
  matched_product_name?: string;
  match_score?: number;
}

export interface BackendInvoiceExtractResponse {
  id: string;
  supplier_name?: string | null;
  supplier_confidence?: number;
  invoice_number?: string | null;
  invoice_no_confidence?: number;
  invoice_date?: string | null;
  date_confidence?: number;
  total_amount?: number;
  total_units?: number;
  total_items?: number;
  confidence_score?: number;
  raw_ocr_text?: string;
  engine_used?: string;
  extraction_method?: string;
  items: BackendCanonicalInvoiceItem[];
  status?: string;
  reason?: string | null;
}

export interface BackendInvoiceConfirmRequest {
  supplier_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  items: Array<{
    name: string;
    category?: string;
    quantity: number;
    unit?: string;
    purchase_price?: number | null;
    selling_price?: number | null;
    mrp?: number | null;
    matched_product_id?: string;
  }>;
}

export interface BackendInvoiceConfirmResponse {
  purchase_id: string;
  shop_id: string;
  supplier_name?: string;
  total_amount: number;
  total_units: number;
  items_restocked: number;
  items_created: number;
  created_at: string;
}

/**
 * Explicit mapping between Backend API response schema and Frontend Canonical Schema.
 * Rules:
 * 1. backend 'rate' / 'purchase_price' -> frontend 'purchasePrice'
 * 2. backend 'rate' -> frontend 'rate'
 * 3. backend 'selling_price' -> frontend 'sellingPrice' (null if not in invoice, NEVER 0)
 * 4. backend 'mrp' -> frontend 'mrp' (null if not in invoice, NEVER 0)
 * 5. backend 'line_total' / 'amount' -> frontend 'lineTotal' (derived from quantity * purchasePrice only if missing)
 * 6. backend 'product_name' -> frontend 'productName'
 */
export function mapBackendItemToCanonical(item: BackendCanonicalInvoiceItem | any): CanonicalInvoiceItem {
  const toNum = (val: any): number | null => {
    if (typeof val === 'number') return isNaN(val) ? null : val;
    if (typeof val === 'string' && val.trim() !== '') {
      const cleaned = val.replace(/[₹$€£,]/g, '').trim();
      const n = Number(cleaned);
      return isNaN(n) ? null : n;
    }
    return null;
  };

  const rawPurchasePrice = toNum(item.raw_purchase_price ?? item.rawPurchasePrice);
  const rawSellingPrice = toNum(item.raw_selling_price ?? item.rawSellingPrice);
  const rawMrp = toNum(item.raw_mrp ?? item.rawMrp);
  const rawRate = toNum(item.raw_rate ?? item.rawRate);

  const itemRate = toNum(item.rate);
  const itemPurchasePrice = toNum(item.purchase_price) ?? toNum(item.purchasePrice);
  const itemSellingPrice = toNum(item.selling_price) ?? toNum(item.sellingPrice);
  const itemMrp = toNum(item.mrp);

  // Rate: preserve original extracted rate from Rate column
  const rate = itemRate !== null ? itemRate : itemPurchasePrice;

  // Purchase Price: in stock-intake rules, extracted Rate is used as Purchase Price
  const purchasePrice = itemPurchasePrice !== null
    ? itemPurchasePrice
    : (itemRate !== null ? itemRate : null);

  // Selling Price and MRP must remain null unless explicitly provided in invoice
  const sellingPrice = itemSellingPrice !== null ? itemSellingPrice : null;
  const mrp = itemMrp !== null ? itemMrp : null;

  const rawQty = toNum(item.quantity);
  const quantity = rawQty !== null && rawQty > 0 ? rawQty : 1;

  // Line Total: check line_total, lineTotal, amount
  let lineTotal = toNum(item.line_total) ?? toNum(item.lineTotal) ?? toNum(item.amount);

  // If Amount (lineTotal) is missing: lineTotal = quantity * purchasePrice ONLY when both quantity and purchasePrice are valid
  if (lineTotal === null && quantity > 0 && purchasePrice !== null) {
    lineTotal = Math.round(quantity * purchasePrice * 100) / 100;
  }

  return {
    id: item.id || `item_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`,
    productName: item.product_name || item.productName || item.name || 'Unlabeled Item',
    quantity,
    unit: item.unit ?? null,
    rate,
    purchasePrice,
    sellingPrice,
    mrp,
    rawRate: rawRate ?? rate,
    rawPurchasePrice: rawPurchasePrice ?? purchasePrice,
    rawSellingPrice: rawSellingPrice ?? sellingPrice,
    rawMrp: rawMrp ?? mrp,
    discount: item.discount ?? null,
    taxableAmount: item.taxable_amount ?? item.taxableAmount ?? null,
    taxAmount: item.tax_amount ?? item.taxAmount ?? null,
    gstRate: item.gst_rate ?? item.gstRate ?? null,
    hsnCode: item.hsn_code ?? item.hsnCode ?? null,
    lineTotal,
    confidence: item.confidence ?? 85,
    confidenceLevel: (item.confidence_level || item.confidenceLevel || 'HIGH') as any,
    sourceText: item.source_text || item.sourceText || '',
    extractionMethod: (item.extraction_method || item.extractionMethod || 'TABLE_STRUCTURED') as any,
    validationIssues: item.validation_issues || item.validationIssues || [],
  };
}

/**
 * Maps a full backend InvoiceExtractResponse into a UI-ready ParsedInvoice.
 */
export function mapBackendResponseToParsedInvoice(
  res: BackendInvoiceExtractResponse,
  existingProducts: Product[] = []
): ParsedInvoice {
  const canonicalItems = (res.items || []).map((it) => mapBackendItemToCanonical(it));
  const matchedItems = matchCanonicalItemsWithInventory(canonicalItems, existingProducts);

  const totalUnits = matchedItems.reduce((acc, it) => acc + (it.quantity || 0), 0);
  const totalAmount = res.total_amount || matchedItems.reduce((acc, it) => acc + (it.lineTotal || 0), 0);

  return {
    id: res.id || `inv_${Date.now().toString(36)}`,
    supplierName: res.supplier_name || '',
    invoiceNumber: res.invoice_number || '',
    invoiceDate: res.invoice_date || '',
    items: matchedItems,
    totalAmount,
    totalUnits,
    totalItems: matchedItems.length,
    confidenceScore: res.confidence_score || 85,
    rawOcrText: res.raw_ocr_text || '',
    engineUsed: (res.engine_used as any) || 'backend_engine',
    extractionMethod: (res.extraction_method as any) || 'TABLE_STRUCTURED',
    supplierConfidence: res.supplier_confidence || 80,
    invoiceNoConfidence: res.invoice_no_confidence || 80,
    dateConfidence: res.date_confidence || 80,
    status: matchedItems.length > 0 ? 'success' : 'needs_review',
    reason: res.reason || null,
    diagnostics: {
      totalRawLines: (res.raw_ocr_text || '').split('\n').filter(Boolean).length,
      totalRawWords: (res.raw_ocr_text || '').split(/\s+/).filter(Boolean).length,
      headerDetected: Boolean(res.supplier_name || res.invoice_number),
      detectedColumns: [],
      detectedSections: [],
      warnings: res.reason ? [res.reason] : [],
      rawApiResponse: res,
    },
  };
}

export const invoiceApi = {
  /**
   * Upload an invoice file to the backend extraction endpoint.
   */
  extractInvoice: async (file: File): Promise<BackendInvoiceExtractResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<BackendInvoiceExtractResponse>('/api/v1/invoices/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /**
   * Confirm invoice line items on the backend, updating database stock
   * and logging a comprehensive purchase transaction.
   */
  confirmInvoice: async (
    payload: BackendInvoiceConfirmRequest
  ): Promise<BackendInvoiceConfirmResponse> => {
    return apiClient.post<BackendInvoiceConfirmResponse>('/api/v1/invoices/confirm', payload);
  },
};
