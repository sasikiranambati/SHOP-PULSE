/**
 * @file invoiceReview.ts
 * @description Rules used by the invoice review table: how the expected line amount is
 * recalculated after an edit, and how a line's MRP origin (or the reason it is missing) is described.
 */

import type { InvoiceLineItem } from './invoiceTypes';
import { checkLineArithmetic, formatMoney } from './lineArithmetic';

export { formatMoney };

// Review notes that describe the old arithmetic result and are replaced after an edit
const ARITHMETIC_NOTE = /does not match quantity × rate|Line amount not printed|calculated amount is|Arithmetic discrepancy/;

/**
 * Recomputes the expected amount after an edit with the same rule as the server
 * (lineArithmetic.ts). The printed (or user-typed) line amount is never changed; the
 * difference stays visible. Only an amount that was itself a calculation (in-browser
 * engine) follows the edit.
 */
export function recalculateAmounts(item: InvoiceLineItem): void {
  const current = item.validationIssues ?? (item.validationWarning ? item.validationWarning.split('; ') : []);
  const notes = current.filter((n) => n && !ARITHMETIC_NOTE.test(n));
  const isCalculation = item.lineTotalSource === 'CALCULATED';
  const result = checkLineArithmetic({
    quantity: item.quantity,
    rate: item.purchasePrice ?? item.rate,
    amount: isCalculation ? null : item.lineTotal,
    discount: item.discount,
    discountPct: item.discountPct,
    taxAmount: item.taxAmount,
    gstRate: item.gstRate,
    amountLabel: item.lineTotalSource === 'MANUAL' ? 'Entered amount' : 'Printed amount',
  });
  item.calculatedAmount = result.calculatedAmount;
  item.amountDifference = result.difference;
  item.arithmeticStatus = result.status;
  item.arithmeticExplanation = result.explanation;
  if (isCalculation && result.calculatedAmount !== null) {
    item.lineTotal = result.calculatedAmount;
  }
  if (result.issue) notes.push(result.issue);
  item.validationIssues = notes;
  item.validationWarning = notes.length ? notes.join('; ') : undefined;
}

/** The amount used for purchase totals: printed (or typed) amount, else the calculated one. */
export function effectiveLineAmount(item: InvoiceLineItem): number | null {
  return item.lineTotal ?? item.calculatedAmount ?? null;
}

/** Short text describing where the line's MRP came from, or why there is none. */
export function describeMrp(item: InvoiceLineItem): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  switch (item.mrpSource) {
    case 'INVOICE':
      return { label: 'From invoice', tone: 'ok' };
    case 'API':
      return { label: `From ${item.mrpLookup?.provider || 'provider'}`, tone: 'ok' };
    case 'MANUAL':
      return { label: 'Entered manually', tone: 'muted' };
    case 'STORE':
      return { label: 'From store record', tone: 'muted' };
  }
  const lookup = item.mrpLookup;
  if (!lookup) return { label: 'Not on invoice', tone: 'muted' };
  const reasons: Record<string, string> = {
    PRODUCT_NOT_FOUND: 'Product not found at MRP provider',
    MRP_UNAVAILABLE: 'Provider has no MRP for this product',
    MANUAL_REVIEW_REQUIRED: 'Several possible matches — enter MRP',
    API_AUTHENTICATION_ERROR: 'MRP provider rejected credentials',
    API_RATE_LIMITED: 'MRP provider rate limit reached',
    API_TIMEOUT: 'MRP provider timed out',
    API_CONFIGURATION_ERROR: 'MRP lookup not configured',
    API_ERROR: 'MRP provider error',
    SKIPPED: 'MRP lookup skipped',
  };
  return { label: reasons[lookup.status] || 'MRP not available', tone: 'warn' };
}
