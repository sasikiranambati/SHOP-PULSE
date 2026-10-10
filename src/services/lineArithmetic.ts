/**
 * @file lineArithmetic.ts
 * @description The line arithmetic rule, identical to the server's (backend/services/invoice_table.py):
 *
 *   expected amount = quantity × rate − discount + tax
 *
 * using the printed discount and tax amounts, or their printed percentages when no amount is
 * printed. Suppliers whose rate already includes tax or discount are covered by also checking
 * quantity × rate − discount, quantity × rate + tax and quantity × rate. Tolerance for paise
 * rounding: ₹0.005 × quantity + ₹0.02. Printed values are never changed by this check.
 */

export interface LineArithmeticInput {
  quantity: number | null | undefined;
  rate: number | null | undefined;
  /** Printed (or user-typed) line amount */
  amount: number | null | undefined;
  discount?: number | null;
  discountPct?: number | null;
  taxAmount?: number | null;
  gstRate?: number | null;
  /** How the amount is described in messages */
  amountLabel?: string;
}

export interface LineArithmeticResult {
  status: 'VERIFIED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  calculatedAmount: number | null;
  /** amount − calculated */
  difference: number | null;
  explanation: string;
  /** Set for MISMATCH: the review note shown to the user */
  issue: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const formatMoney = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const amountTolerance = (qty: number) => Math.abs(qty) * 0.005 + 0.02;

export function checkLineArithmetic(input: LineArithmeticInput): LineArithmeticResult {
  const { quantity, rate, amount } = input;
  if (quantity === null || quantity === undefined || rate === null || rate === undefined) {
    return {
      status: 'INSUFFICIENT_DATA',
      calculatedAmount: null,
      difference: null,
      explanation: 'Quantity or rate missing, so the amount cannot be checked',
      issue: null,
    };
  }
  const qty = Number(quantity);
  const r = Number(rate);
  const gross = qty * r;
  const disc = input.discount ?? (input.discountPct != null ? (gross * input.discountPct) / 100 : null);
  const net = gross - (disc || 0);
  const tax = input.taxAmount ?? (input.gstRate != null ? (net * input.gstRate) / 100 : null);

  const label = (withDisc: boolean, withTax: boolean) =>
    `${qty} × ${formatMoney(r)}` +
    (withDisc && disc ? ` − ${formatMoney(disc)} discount` : '') +
    (withTax && tax ? ` + ${formatMoney(tax)} tax` : '');

  const conventions: Array<[string, number]> = [[label(true, true), net + (tax || 0)]];
  if (tax) conventions.push([`${label(true, false)} (tax included in rate)`, net]);
  if (disc) conventions.push([`${label(false, true)} (discount already in rate)`, gross + (tax || 0)]);
  if (disc || tax) conventions.push([label(false, false), gross]);

  if (amount === null || amount === undefined) {
    const [text, value] = conventions[0];
    return {
      status: 'INSUFFICIENT_DATA',
      calculatedAmount: round2(value),
      difference: null,
      explanation: `No line amount printed. Calculated: ${text} = ${formatMoney(value)}`,
      issue: null,
    };
  }

  const what = input.amountLabel || 'Printed amount';
  const tol = amountTolerance(qty);
  for (const [text, value] of conventions) {
    const diff = amount - value;
    if (Math.abs(diff) <= tol + 1e-9) {
      const note = round2(diff) === 0 ? '' : ` (rounding difference ${formatMoney(round2(diff))})`;
      return {
        status: 'VERIFIED',
        calculatedAmount: round2(value),
        difference: round2(diff),
        explanation: `${what} ${formatMoney(amount)} = ${text}${note}`,
        issue: null,
      };
    }
  }
  const [text, value] = conventions.reduce((best, c) => (Math.abs(amount - c[1]) < Math.abs(amount - best[1]) ? c : best));
  const diff = round2(amount - value);
  const issue =
    `${what} ${formatMoney(amount)} does not match quantity × rate: ${text} = ${formatMoney(value)} ` +
    `(difference ${formatMoney(diff)}). The printed value is kept. Check the invoice.`;
  return { status: 'MISMATCH', calculatedAmount: round2(value), difference: diff, explanation: issue, issue };
}
