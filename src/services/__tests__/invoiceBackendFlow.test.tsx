/**
 * Frontend side of the invoice flow: upload request, backend response mapping,
 * review-table rules and what the MRP / line-amount cells display.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  invoiceApi,
  mapBackendItemToCanonical,
  mapBackendResponseToParsedInvoice,
  type BackendInvoiceExtractResponse,
} from '../../api/invoice';
import { validateInvoiceItems } from '../../pages/InvoiceScanner';
import { recalculateLineTotal, describeMrp } from '../invoiceReview';
import { MrpStatus, LineAmount } from '../../components/InvoiceLineCells';
import type { InvoiceLineItem } from '../invoiceTypes';
import type { Product } from '../../types/product';

const store: Product[] = [
  {
    id: 'p_salt', name: 'Tata Salt 1kg', category: 'Groceries', stock: 10, unit: 'pcs', sellingPrice: 26, price: 26,
    purchasePrice: 20, mrp: 27, reorderLevel: 5, minStock: 5, status: 'In Stock', createdAt: '', updatedAt: '',
  },
];

const backendResponse: BackendInvoiceExtractResponse = {
  id: 'inv_1',
  supplier_name: 'Sri Balaji Wholesale Traders',
  invoice_number: 'SBW-1021',
  invoice_date: '05/10/2026',
  invoice_total: 1878,
  confidence_score: 96,
  engine_used: 'backend_ocr_pipeline',
  status: 'needs_review',
  items: [
    {
      id: 'i1', product_name: 'Tata Salt 1kg', quantity: 24, unit: 'pcs', rate: 22, purchase_price: 22,
      selling_price: null, mrp: 28, mrp_source: 'INVOICE', invoice_mrp: 28, store_mrp: 27,
      mrp_lookup: { status: 'FOUND', provider: 'custom_http', message: 'ok', mrp: 28 },
      line_total: 528, line_total_source: 'INVOICE', arithmetic_status: 'VERIFIED', confidence: 97,
      confidence_level: 'HIGH', needs_review: false, matched_product_id: 'p_salt',
    },
    {
      id: 'i2', product_name: 'Coffee 200g', quantity: null, unit: null, rate: null, purchase_price: null,
      mrp: null, mrp_source: null,
      mrp_lookup: { status: 'MRP_UNAVAILABLE', provider: 'openmrp', message: 'OpenMRP does not publish MRP' },
      line_total: 500, line_total_source: 'INVOICE', arithmetic_status: 'INSUFFICIENT_DATA',
      confidence: 40, confidence_level: 'LOW', needs_review: true, suggested_rate: null,
      validation_issues: ['Quantity could not be read; enter it manually'],
    },
  ],
  diagnostics: { columns: [{ role: 'qty', header_text: 'Qty', x_start: 500, x_end: 600 }], warnings: [] },
};

afterEach(() => vi.unstubAllGlobals());

describe('upload request', () => {
  it('sends the file as multipart FormData without a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'x', items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    await invoiceApi.extractInvoice(new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/invoices/extract');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('backend response mapping', () => {
  it('keeps unread values null instead of defaulting them', () => {
    const coffee = mapBackendItemToCanonical(backendResponse.items[1]);
    expect(coffee.quantity).toBeNull();
    expect(coffee.purchasePrice).toBeNull();
    expect(coffee.mrp).toBeNull();
    expect(coffee.confidence).toBe(40);
    expect(coffee.confidenceLevel).toBe('LOW');
  });

  it('maps purchase price, line amount and MRP evidence separately', () => {
    const parsed = mapBackendResponseToParsedInvoice(backendResponse, store);
    const salt = parsed.items[0];
    expect(salt.purchasePrice).toBe(22);
    expect(salt.lineTotal).toBe(528);
    expect(salt.mrp).toBe(28);
    expect(salt.mrpSource).toBe('INVOICE');
    expect(salt.mrpLookup?.status).toBe('FOUND');
    expect(salt.sellingPrice).toBeNull();
    expect(salt.matchedProductId).toBe('p_salt');
    expect(salt.inventoryData?.storeMrp).toBe(27);
    expect(parsed.engineUsed).toBe('backend_ocr_pipeline');
    expect(parsed.totalAmount).toBe(1878);
    expect(parsed.diagnostics?.detectedColumnsList?.[0].type).toBe('qty');
  });
});

describe('review table rules', () => {
  const base = (): InvoiceLineItem => ({
    id: 'a', name: 'Tata Salt 1kg', category: 'Groceries', quantity: 24, unit: 'pcs', purchasePrice: 22,
    sellingPrice: null, mrp: null, lineTotal: 528, lineTotalSource: 'INVOICE', confidence: 90,
    confidenceLevel: 'HIGH', lowConfidence: false, matchedProductId: 'p_salt',
  });

  it('never overwrites a printed invoice amount when quantity or price is edited', () => {
    const item = { ...base(), purchasePrice: 21 };
    recalculateLineTotal(item);
    expect(item.lineTotal).toBe(528);
  });

  it('recalculates amounts that were themselves calculated', () => {
    const item = { ...base(), lineTotalSource: 'CALCULATED' as const, quantity: 10 };
    recalculateLineTotal(item);
    expect(item.lineTotal).toBe(220);
  });

  it('requires a purchase price, whole quantities and a selling price for new products', () => {
    const missingPrice = { ...base(), purchasePrice: null, rate: null };
    const fractional = { ...base(), id: 'b', quantity: 2.5 };
    const newProduct = { ...base(), id: 'c', name: 'Brand New Snack', matchedProductId: undefined };
    const errors = validateInvoiceItems([missingPrice, fractional, newProduct], store);
    expect(errors.find((e) => e.itemId === 'a')?.issues).toContain('Purchase price is required (it could not be read from the invoice)');
    expect(errors.find((e) => e.itemId === 'b')?.issues).toContain('Quantity must be a whole number of stock units');
    expect(errors.find((e) => e.itemId === 'c')?.issues).toContain('Selling price is required for a new product');
    expect(validateInvoiceItems([base()], store)).toHaveLength(0);
  });

  it('explains missing MRP using the lookup status', () => {
    const parsed = mapBackendResponseToParsedInvoice(backendResponse, store);
    expect(describeMrp(parsed.items[0]).label).toBe('From invoice');
    expect(describeMrp(parsed.items[1]).label).toBe('Provider has no MRP for this product');
    expect(describeMrp({ ...base(), mrp: 30, mrpSource: 'MANUAL' }).label).toBe('Entered manually');
  });
});

describe('displayed values', () => {
  it('renders the MRP status and line amount the backend returned', () => {
    const parsed = mapBackendResponseToParsedInvoice(backendResponse, store);
    const [salt, coffee] = parsed.items;
    expect(renderToStaticMarkup(<LineAmount item={salt} />)).toContain('₹528');
    expect(renderToStaticMarkup(<MrpStatus item={salt} />)).toContain('From invoice');
    const coffeeMrp = renderToStaticMarkup(<MrpStatus item={coffee} />);
    expect(coffeeMrp).toContain('Provider has no MRP');
    expect(coffeeMrp).toContain('OpenMRP does not publish MRP');
    expect(renderToStaticMarkup(<LineAmount item={{ ...salt, lineTotal: 220, lineTotalSource: 'CALCULATED' }} />)).toContain('calculated');
  });
});
