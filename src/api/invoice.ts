/**
 * @file invoice.ts
 * @description API client methods for Invoice Scanner backend endpoints and canonical response mapping.
 */

import { apiClient } from './client';
import type { Product } from '../types/product';
import type {
  CanonicalInvoiceItem,
  ConfidenceLevel,
  ExtractionMethod,
  InvoiceTotals,
  LineTotalSource,
  MrpLookupInfo,
  MrpSource,
  ParsedInvoice,
} from '../services/invoiceTypes';
import { matchCanonicalItemsWithInventory } from '../services/inventoryMatcher';

export interface BackendMrpLookup {
  status: string;
  provider: string;
  message: string;
  mrp?: number | null;
  matched_name?: string | null;
  brand?: string | null;
  barcode?: string | null;
  match_method?: string | null;
  match_confidence?: number | null;
  http_status?: number | null;
  looked_up_at?: string | null;
}

export interface BackendCanonicalInvoiceItem {
  id: string;
  product_name: string;
  quantity?: number | null;
  /** Unit exactly as printed on the invoice */
  unit?: string | null;
  /** Unit mapped through the server's explicit unit table; null for units such as BOR or PET */
  unit_normalized?: string | null;
  rate?: number | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  mrp?: number | null;
  mrp_source?: MrpSource | null;
  invoice_mrp?: number | null;
  store_mrp?: number | null;
  mrp_lookup?: BackendMrpLookup | null;
  discount?: number | null;
  discount_pct?: number | null;
  taxable_amount?: number | null;
  tax_amount?: number | null;
  gst_rate?: number | null;
  hsn_code?: string | null;
  barcode?: string | null;
  line_total?: number | null;
  amount?: number | null;
  line_total_source?: LineTotalSource | null;
  calculated_amount?: number | null;
  amount_difference?: number | null;
  arithmetic_status?: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  arithmetic_rule?: string | null;
  arithmetic_explanation?: string | null;
  confidence?: number;
  confidence_level?: string;
  needs_review?: boolean;
  source_text?: string;
  raw_cells?: Record<string, string>;
  extraction_method?: string;
  validation_issues?: string[];
  suggestions?: string[];
  suggested_rate?: number | null;
  matched_product_id?: string | null;
  matched_product_name?: string | null;
  match_score?: number | null;
}

export interface BackendDiagnostics {
  document_type?: string;
  engine_used?: string;
  header_text?: string | null;
  detected_columns?: string[];
  columns?: Array<{ role: string; header_text: string; x_start?: number | null; x_end?: number | null }>;
  rows?: Array<{ row_index: number; text: string; cells: Record<string, string>; is_item: boolean }>;
  warnings?: string[];
  mrp_provider?: string | null;
  deskew_angle?: number | null;
}

export interface BackendTotalCheck {
  field: string;
  printed?: number | null;
  calculated?: number | null;
  difference?: number | null;
  status: string;
  message: string;
}

export interface BackendInvoiceTotals {
  printed_quantity?: number | null;
  printed_discount?: number | null;
  printed_tax?: number | null;
  printed_taxable?: number | null;
  printed_amount?: number | null;
  sub_total?: number | null;
  round_off?: number | null;
  grand_total?: number | null;
  received?: number | null;
  balance?: number | null;
  lines_quantity?: number | null;
  lines_discount?: number | null;
  lines_tax?: number | null;
  lines_amount?: number | null;
  lines_without_amount?: number;
  checks?: BackendTotalCheck[];
}

export interface BackendInvoiceExtractResponse {
  id: string;
  supplier_name?: string | null;
  supplier_confidence?: number;
  invoice_number?: string | null;
  invoice_no_confidence?: number;
  invoice_date?: string | null;
  date_confidence?: number;
  gstin?: string | null;
  invoice_total?: number | null;
  total_amount?: number;
  total_units?: number;
  total_items?: number;
  confidence_score?: number;
  raw_ocr_text?: string;
  engine_used?: string;
  extraction_method?: string;
  items: BackendCanonicalInvoiceItem[];
  totals?: BackendInvoiceTotals | null;
  status?: string;
  reason?: string | null;
  diagnostics?: BackendDiagnostics | null;
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
    purchase_price: number;
    selling_price?: number | null;
    mrp?: number | null;
    mrp_source?: MrpSource | null;
    line_amount?: number | null;
    matched_product_id?: string;
  }>;
}

export interface BackendInvoiceConfirmResponse {
  purchase_id: string;
  shop_id: string;
  supplier_name?: string;
  invoice_number?: string | null;
  total_amount: number;
  total_units: number;
  items_restocked: number;
  items_created: number;
  created_at: string;
}

const toNum = (val: unknown): number | null => {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val.replace(/[₹$€£,]/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function mapMrpLookup(l: BackendMrpLookup | null | undefined): MrpLookupInfo | null {
  if (!l) return null;
  return {
    status: l.status,
    provider: l.provider,
    message: l.message,
    mrp: l.mrp ?? null,
    matchedName: l.matched_name ?? null,
    matchConfidence: l.match_confidence ?? null,
    lookedUpAt: l.looked_up_at ?? null,
  };
}

export function mapBackendTotals(t: BackendInvoiceTotals | null | undefined): InvoiceTotals | null {
  if (!t) return null;
  return {
    printedQuantity: toNum(t.printed_quantity),
    printedDiscount: toNum(t.printed_discount),
    printedTax: toNum(t.printed_tax),
    printedAmount: toNum(t.printed_amount),
    subTotal: toNum(t.sub_total),
    roundOff: toNum(t.round_off),
    grandTotal: toNum(t.grand_total),
    received: toNum(t.received),
    balance: toNum(t.balance),
    linesQuantity: toNum(t.lines_quantity),
    linesDiscount: toNum(t.lines_discount),
    linesTax: toNum(t.lines_tax),
    linesAmount: toNum(t.lines_amount),
    linesWithoutAmount: t.lines_without_amount ?? 0,
    checks: (t.checks || []).map((c) => ({
      field: c.field,
      printed: toNum(c.printed),
      calculated: toNum(c.calculated),
      difference: toNum(c.difference),
      status: c.status,
      message: c.message,
    })),
  };
}

/**
 * Explicit mapping between the backend response and the frontend canonical item.
 * Values the backend could not read stay null here too: no default quantity,
 * no default prices, no default confidence. `lineTotal` is only ever the printed
 * amount; the backend's calculation goes to `calculatedAmount`.
 */
export function mapBackendItemToCanonical(item: BackendCanonicalInvoiceItem): CanonicalInvoiceItem {
  const rate = toNum(item.rate);
  const purchasePrice = toNum(item.purchase_price) ?? rate;
  const rawQty = toNum(item.quantity);
  const quantity = rawQty !== null && rawQty > 0 ? rawQty : null;
  const lineTotal = toNum(item.line_total) ?? toNum(item.amount);
  const level = (item.confidence_level || 'LOW').toUpperCase();
  // Stock unit only through the server's explicit mapping (PCS -> pcs, KGS -> kg);
  // a unit such as BOR or PET is shown as printed and the stock unit is left for the user.
  const stockUnit = item.unit_normalized !== undefined ? item.unit_normalized : item.unit;

  return {
    id: item.id || `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    productName: item.product_name || 'Unlabeled Item',
    quantity,
    unit: stockUnit ?? null,
    printedUnit: item.unit ?? null,
    rate,
    purchasePrice,
    sellingPrice: toNum(item.selling_price),
    mrp: toNum(item.mrp),
    mrpSource: item.mrp_source ?? null,
    invoiceMrp: toNum(item.invoice_mrp),
    storeMrp: toNum(item.store_mrp),
    mrpLookup: mapMrpLookup(item.mrp_lookup),
    rawRate: rate,
    rawPurchasePrice: purchasePrice,
    rawSellingPrice: toNum(item.selling_price),
    rawMrp: toNum(item.invoice_mrp),
    discount: toNum(item.discount),
    discountPct: toNum(item.discount_pct),
    taxableAmount: toNum(item.taxable_amount),
    taxAmount: toNum(item.tax_amount),
    gstRate: toNum(item.gst_rate),
    hsnCode: item.hsn_code ?? null,
    lineTotal,
    lineTotalSource: lineTotal !== null ? item.line_total_source ?? 'INVOICE' : null,
    calculatedAmount: toNum(item.calculated_amount),
    amountDifference: toNum(item.amount_difference),
    arithmeticStatus: item.arithmetic_status,
    arithmeticExplanation: item.arithmetic_explanation ?? null,
    needsReview: item.needs_review ?? true,
    suggestions: item.suggestions || [],
    suggestedRate: toNum(item.suggested_rate),
    rawCells: item.raw_cells || {},
    confidence: typeof item.confidence === 'number' ? item.confidence : 0,
    confidenceLevel: (['HIGH', 'MEDIUM', 'LOW'].includes(level) ? level : 'LOW') as ConfidenceLevel,
    sourceText: item.source_text || '',
    extractionMethod: (item.extraction_method || 'TABLE_STRUCTURED') as ExtractionMethod,
    validationIssues: item.validation_issues || [],
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
  const matchedItems = matchCanonicalItemsWithInventory(canonicalItems, existingProducts).map((it, idx) => {
    // The backend matched by barcode/SKU or an unambiguous name; prefer it when the product is loaded
    const backendId = res.items[idx]?.matched_product_id;
    const prod = backendId ? existingProducts.find((p) => p.id === backendId) : undefined;
    if (!prod) return it;
    return {
      ...it,
      matchedProductId: prod.id,
      isMatchConfirmed: true,
      currentStock: prod.stock,
      unit: it.unit || prod.unit || '',
      inventoryData: {
        id: prod.id,
        name: prod.name,
        currentStock: prod.stock,
        storePurchasePrice: prod.purchasePrice,
        storeSellingPrice: prod.sellingPrice ?? prod.price,
        storeMrp: prod.mrp,
      },
    };
  });

  const totalUnits = matchedItems.reduce((acc, it) => acc + (it.quantity || 0), 0);
  const lineSum = matchedItems.reduce((acc, it) => acc + (it.lineTotal ?? it.calculatedAmount ?? 0), 0);
  const diag = res.diagnostics || undefined;

  return {
    id: res.id || `inv_${Date.now().toString(36)}`,
    supplierName: res.supplier_name || '',
    invoiceNumber: res.invoice_number || '',
    invoiceDate: res.invoice_date || '',
    gstin: res.gstin || undefined,
    items: matchedItems,
    totalAmount: res.invoice_total ?? lineSum,
    totalUnits,
    totalItems: matchedItems.length,
    confidenceScore: Math.round(res.confidence_score ?? 0),
    rawOcrText: res.raw_ocr_text || '',
    engineUsed: (res.engine_used as ParsedInvoice['engineUsed']) || 'backend_ocr_pipeline',
    extractionMethod: (res.extraction_method as ExtractionMethod) || 'TABLE_STRUCTURED',
    supplierConfidence: res.supplier_confidence ?? 0,
    invoiceNoConfidence: res.invoice_no_confidence ?? 0,
    dateConfidence: res.date_confidence ?? 0,
    documentType: diag?.document_type === 'pdf' ? 'pdf' : 'image',
    status: matchedItems.length > 0 ? (res.status === 'success' ? 'success' : 'needs_review') : 'needs_review',
    reason: res.reason || null,
    diagnostics: {
      totalRawLines: (res.raw_ocr_text || '').split('\n').filter(Boolean).length,
      totalRawWords: (res.raw_ocr_text || '').split(/\s+/).filter(Boolean).length,
      headerDetected: Boolean(diag?.header_text),
      detectedColumns: diag?.detected_columns || [],
      detectedSections: [],
      warnings: diag?.warnings || [],
      detectedColumnsList: (diag?.columns || []).map((c) => ({
        type: c.role as any,
        headerText: c.header_text,
        minX: c.x_start ?? 0,
        maxX: c.x_end ?? 0,
        confidence: 100,
      })),
      detectedRows: (diag?.rows || [])
        .filter((r) => r.is_item)
        .map((r) => ({
          productName: r.cells.product || '',
          quantity: r.cells.qty || '',
          unit: r.cells.unit || '',
          rate: r.cells.purchase_price || r.cells.rate || '',
          discount: r.cells.discount || r.cells.discount_pct || '',
          tax: r.cells.tax_amount || r.cells.gst_rate || '',
          amount: r.cells.total || r.cells.taxable || '',
        })),
      rawApiResponse: res,
      mrpProvider: diag?.mrp_provider ?? null,
    },
    // Totals mismatches are shown in the totals check; list every other warning once
    notices: (diag?.warnings || []).filter((w) => !(res.totals?.checks || []).some((c) => c.message === w)),
    totals: mapBackendTotals(res.totals),
  };
}

export const invoiceApi = {
  /**
   * Upload an invoice file to the backend extraction endpoint (multipart; the browser sets the boundary).
   */
  extractInvoice: async (file: File): Promise<BackendInvoiceExtractResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<BackendInvoiceExtractResponse>('/api/v1/invoices/extract', formData);
  },

  /**
   * Confirm invoice line items on the backend. One transaction updates stock,
   * creates new products, stores MRPs with their source and records the purchase.
   */
  confirmInvoice: async (
    payload: BackendInvoiceConfirmRequest
  ): Promise<BackendInvoiceConfirmResponse> => {
    return apiClient.post<BackendInvoiceConfirmResponse>('/api/v1/invoices/confirm', payload);
  },
};
