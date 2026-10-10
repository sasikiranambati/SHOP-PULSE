/**
 * Reference invoice regression (S.No. | ITEMS | HSN | QTY. | RATE | DISC. | TAX | AMOUNT, 13 rows).
 *
 * - In-browser engine (offline demo / explicit "read in this browser") on real Tesseract output
 *   of the replica invoice rendered by backend/tests/fixtures/reference_invoice.py.
 * - Mapping and display of the server response: printed unit vs stock unit, printed vs
 *   calculated amount, discount / tax with percentages, invoice totals check.
 *
 * Expected values are the printed invoice values; they exist only in this test.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import clean from './fixtures/referenceInvoiceOcr.clean.json';
import photo from './fixtures/referenceInvoiceOcr.photo.json';
import { parseInvoiceWithFlexibleEngine } from '../invoiceScannerService';
import { parseSmartQuantity, resolveItemArithmetic, splitQuantityCell } from '../tableLayoutExtractor';
import {
  mapBackendResponseToParsedInvoice,
  type BackendCanonicalInvoiceItem,
  type BackendInvoiceExtractResponse,
} from '../../api/invoice';
import { CalculatedAmount, InvoiceTotalsCheck, LineAmount, PrintedUnit, PrintedValue } from '../../components/InvoiceLineCells';
import type { InvoiceLineItem } from '../invoiceTypes';

// product, hsn, qty, unit (printed), rate, disc, disc %, tax, tax %, amount
type Row = [string, string | null, number, string, number, number, number | null, number, number | null, number];
const ROWS: Row[] = [
  ['CHANA 50 KG', null, 1, 'BOR', 2760, 0, null, 0, null, 2760],
  ['FORTUNE BESAN 500 GM', null, 10, 'PCS', 70, 0, null, 0, null, 700],
  ['FORTUNE OIL 1 KG', null, 3, 'PET', 1378.62, 124.08, 3, 4.01, 0.1, 4015.8],
  ['HELLO ORGANIC CHANA DAL 1 KG', '30', 5, 'PCS', 129.46, 0, null, 77.68, 12, 725],
  ['MASOOR DAL 50 KG', null, 1, 'BOR', 4825, 0, null, 0, null, 4825],
  ['OIL CAN 10', null, 10, 'PCS', 1975, 0, null, 0, null, 19750],
  ['SUGAR', null, 2, 'PCS', 1925, 0, null, 0, null, 3850],
  ['SOYABEAN CHUNKS 15 KG', null, 2, 'BOR', 1230, 0, null, 0, null, 2460],
  ['SONAL SABUDANA KHICHDI 500 GM', '30', 25, 'KGS', 40.18, 0, null, 120.54, 12, 1125],
  ['SABUDANA 30 KG', null, 1, 'KGS', 1336.66, 0, null, 3.34, 0.25, 1340],
  ['UDAD DAL 1 KG', null, 20, 'KGS', 47.95, 0, null, 0.96, 0.1, 960],
  ['RAJAMM', null, 25, 'KGS', 44.96, 0, null, 1.12, 0.1, 1125],
  ['PARLE-G', null, 5, 'PET', 648.38, 0, null, 8.1, 0.25, 3250],
];
const STOCK_UNIT: Record<string, string | null> = { PCS: 'pcs', KGS: 'kg', BOR: null, PET: null };
const squash = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function rowErrors(it: InvoiceLineItem, row: Row): string[] {
  const [name, , qty, unit, rate, , , , , amount] = row;
  const errors: string[] = [];
  if (squash(it.name) !== squash(name)) errors.push(`name ${it.name}`);
  if (it.quantity !== qty) errors.push(`qty ${it.quantity}`);
  if (it.printedUnit !== unit) errors.push(`printed unit ${it.printedUnit}`);
  if ((it.unit || null) !== STOCK_UNIT[unit]) errors.push(`stock unit ${it.unit}`);
  if (it.purchasePrice !== rate) errors.push(`rate ${it.purchasePrice}`);
  if (it.lineTotal !== amount) errors.push(`amount ${it.lineTotal}`);
  return errors;
}

describe('in-browser engine on the reference invoice', () => {
  it('reads all 13 rows of the clean scan exactly, without the TOTAL row', () => {
    const r = parseInvoiceWithFlexibleEngine(clean.lines, clean.words, clean.text, 'tesseract', []);
    expect(r.items).toHaveLength(13);
    r.items.forEach((it, i) => expect(rowErrors(it, ROWS[i]), ROWS[i][0]).toEqual([]));
    expect(r.items.some((it) => /total/i.test(it.name))).toBe(false);
  });

  it('never takes the quantity or unit from the product name', () => {
    const r = parseInvoiceWithFlexibleEngine(clean.lines, clean.words, clean.text, 'tesseract', []);
    const chana = r.items[0];
    expect([chana.quantity, chana.printedUnit, chana.unit || null]).toEqual([1, 'BOR', null]);
    expect(chana.validationWarning || '').not.toContain('50 ×');
    const oil = r.items[2];
    expect([oil.quantity, oil.purchasePrice]).toEqual([3, 1378.62]);
  });

  it('on the photo, every row is either exact or flagged for review', () => {
    const r = parseInvoiceWithFlexibleEngine(photo.lines, photo.words, photo.text, 'tesseract', []);
    expect(r.items).toHaveLength(13);
    let exact = 0;
    r.items.forEach((it, i) => {
      const errors = rowErrors(it, ROWS[i]).filter((e) => !e.startsWith('name'));
      if (errors.length === 0) exact++;
      else expect(it.lowConfidence || Boolean(it.validationWarning), `${ROWS[i][0]}: ${errors}`).toBe(true);
    });
    expect(exact).toBeGreaterThanOrEqual(11);
  });

  it('keeps printed values when the arithmetic does not add up', () => {
    expect(resolveItemArithmetic(200, 70, 1400)).toEqual({ quantity: 200, rate: 70, purchasePrice: 70, lineTotal: 1400 });
    expect(resolveItemArithmetic(1, 48250, 4825)).toEqual({ quantity: 1, rate: 48250, purchasePrice: 48250, lineTotal: 4825 });
    expect(resolveItemArithmetic(10, null, 2500).purchasePrice).toBeNull(); // never derived from the amount
  });

  it('reads the quantity and its printed unit separately', () => {
    expect(splitQuantityCell('1.0 BOR')).toEqual({ value: 1, unit: 'BOR' });
    expect(splitQuantityCell('2.0BOR')).toEqual({ value: 2, unit: 'BOR' });
    expect(splitQuantityCell('25.0KGS')).toEqual({ value: 25, unit: 'KGS' });
    expect(parseSmartQuantity('1O')).toBe(10);
    expect(parseSmartQuantity('so')).toBeNull(); // no guessed numbers
  });
});

describe('server response for the reference invoice', () => {
  const items: BackendCanonicalInvoiceItem[] = ROWS.map(([name, hsn, qty, unit, rate, disc, discPct, tax, taxPct, amount], i) => ({
    id: `i${i}`,
    product_name: name,
    hsn_code: hsn,
    quantity: qty,
    unit,
    unit_normalized: STOCK_UNIT[unit],
    rate,
    purchase_price: rate,
    discount: disc,
    discount_pct: discPct,
    tax_amount: tax,
    gst_rate: taxPct,
    line_total: amount,
    line_total_source: 'INVOICE',
    calculated_amount: name === 'RAJAMM' ? 1125.12 : amount,
    amount_difference: name === 'RAJAMM' ? -0.12 : 0,
    arithmetic_status: 'VERIFIED',
    arithmetic_explanation: name === 'RAJAMM' ? 'Printed amount ₹1,125.00 = 25 × ₹44.96 + ₹1.12 tax (rounding difference ₹-0.12)' : null,
    mrp: null,
    mrp_lookup: { status: 'MRP_UNAVAILABLE', provider: 'openmrp', message: 'OpenMRP does not publish MRP' },
    confidence: 95,
    confidence_level: 'HIGH',
    needs_review: true,
  }));
  const response: BackendInvoiceExtractResponse = {
    id: 'inv_ref',
    invoice_total: 46885.8,
    engine_used: 'backend_pdf_direct',
    items,
    totals: {
      printed_quantity: 110, printed_discount: 124.08, printed_tax: 215.76, printed_amount: 46885.8,
      received: 0, balance: 46885.8, lines_quantity: 110, lines_discount: 124.08, lines_tax: 215.75,
      lines_amount: 46885.8, lines_without_amount: 0,
      checks: [
        { field: 'quantity', printed: 110, calculated: 110, difference: 0, status: 'MATCH', message: 'Quantity: printed total 110, lines add up to 110 — matches.' },
        { field: 'tax', printed: 215.76, calculated: 215.75, difference: 0.01, status: 'ROUNDING', message: 'Tax: printed total ₹215.76, lines add up to ₹215.75 — differs by ₹0.01, within per-line paise rounding.' },
      ],
    },
  };
  const parsed = mapBackendResponseToParsedInvoice(response, []);

  it('maps every field separately and keeps the printed unit', () => {
    expect(parsed.items).toHaveLength(13);
    parsed.items.forEach((it, i) => {
      const [name, hsn, qty, unit, rate, disc, discPct, tax, taxPct, amount] = ROWS[i];
      expect(it.name).toBe(name);
      expect(it.hsnCode).toBe(hsn);
      expect(it.quantity).toBe(qty);
      expect(it.printedUnit).toBe(unit);
      expect(it.unit || null).toBe(STOCK_UNIT[unit]); // BOR / PET: the user chooses the stock unit
      expect(it.purchasePrice).toBe(rate);
      expect([it.discount, it.discountPct, it.taxAmount, it.gstRate]).toEqual([disc, discPct, tax, taxPct]);
      expect([it.lineTotal, it.lineTotalSource]).toEqual([amount, 'INVOICE']);
    });
    expect(parsed.totalAmount).toBe(46885.8);
    expect(parsed.totals?.checks.map((c) => c.status)).toEqual(['MATCH', 'ROUNDING']);
  });

  it('shows the printed amount, the calculated amount and the rounding difference', () => {
    const rajamm = parsed.items[11];
    expect(renderToStaticMarkup(<LineAmount item={rajamm} />)).toContain('₹1,125.00');
    const calc = renderToStaticMarkup(<CalculatedAmount item={rajamm} />);
    expect(calc).toContain('₹1,125.12');
    expect(calc).toContain('(rounding)');
    expect(calc).toContain('rounding difference');
  });

  it('shows discount and tax with their printed percentages, and the printed unit', () => {
    const oil = parsed.items[2];
    const disc = renderToStaticMarkup(<PrintedValue value={oil.discount} pct={oil.discountPct} emptyTitle="none" />);
    expect(disc).toContain('₹124.08');
    expect(disc).toContain('(3%)');
    expect(renderToStaticMarkup(<PrintedUnit item={oil} />)).toContain('Invoice: PET');
    expect(renderToStaticMarkup(<PrintedValue value={null} pct={null} emptyTitle="No discount printed" />)).toContain('—');
  });

  it('renders the invoice totals check', () => {
    const html = renderToStaticMarkup(<InvoiceTotalsCheck totals={parsed.totals!} />);
    expect(html).toContain('Invoice totals check');
    expect(html).toContain('Rounding');
    expect(html).toContain('differs by ₹0.01');
  });

  it('keeps a missing amount empty and reports the calculation separately', () => {
    const missing = mapBackendResponseToParsedInvoice(
      { ...response, items: [{ ...items[6], line_total: null, line_total_source: null, calculated_amount: 3850, arithmetic_status: 'INSUFFICIENT_DATA' }] },
      []
    ).items[0];
    expect(missing.lineTotal).toBeNull();
    expect(missing.lineTotalSource).toBeNull();
    expect(missing.calculatedAmount).toBe(3850);
    expect(renderToStaticMarkup(<LineAmount item={missing} />)).toContain('—');
  });
});
