/**
 * @file InvoiceLineCells.tsx
 * @description Small display cells for scanned invoice lines: MRP origin/lookup status,
 * printed and calculated line amounts, read-only printed values (HSN, discount, tax),
 * review notes with an opt-in suggested purchase price, and the invoice totals check.
 */

import React from 'react';
import type { InvoiceLineItem, InvoiceTotals } from '../services/invoiceTypes';
import { describeMrp, formatMoney } from '../services/invoiceReview';

export const MrpStatus: React.FC<{ item: InvoiceLineItem }> = ({ item }) => {
  const d = describeMrp(item);
  const color = d.tone === 'ok' ? 'text-emerald-700' : d.tone === 'warn' ? 'text-amber-700' : 'text-slate-500';
  const lookup = item.mrpLookup;
  const providerValue =
    lookup?.status === 'FOUND' && lookup.mrp != null && item.mrpSource !== 'API' && lookup.mrp !== item.mrp
      ? ` · ${lookup.provider}: ₹${lookup.mrp}`
      : '';
  return (
    <p
      className={`text-[10px] mt-0.5 leading-tight ${color}`}
      title={lookup ? `${lookup.provider}: ${lookup.message}` : undefined}
    >
      {d.label}
      {providerValue}
    </p>
  );
};

/** The line amount printed on the invoice (or typed by the user). Missing stays "—". */
export const LineAmount: React.FC<{ item: InvoiceLineItem }> = ({ item }) => (
  <div className="text-right">
    {item.lineTotal !== null && item.lineTotal !== undefined ? (
      <span className="font-bold text-slate-900">{formatMoney(item.lineTotal)}</span>
    ) : (
      <span className="text-slate-400" title="No line amount printed on the invoice">—</span>
    )}
    {item.lineTotalSource === 'CALCULATED' && (
      <p className="text-[10px] text-slate-500 leading-tight" title="Not printed on the invoice; quantity × purchase price">
        calculated
      </p>
    )}
    {item.lineTotalSource === 'MANUAL' && <p className="text-[10px] text-slate-500 leading-tight">edited</p>}
  </div>
);

/** Expected amount from the arithmetic rule, with the difference to the printed amount. */
export const CalculatedAmount: React.FC<{ item: InvoiceLineItem }> = ({ item }) => {
  if (item.calculatedAmount === null || item.calculatedAmount === undefined) {
    return (
      <span className="text-slate-400" title={item.arithmeticExplanation || 'Quantity or rate missing'}>
        —
      </span>
    );
  }
  const diff = item.amountDifference;
  const mismatch = item.arithmeticStatus === 'MISMATCH';
  return (
    <div className="text-right" title={item.arithmeticExplanation || undefined}>
      <span className={mismatch ? 'font-bold text-rose-700' : 'text-slate-700'}>{formatMoney(item.calculatedAmount)}</span>
      {diff !== null && diff !== undefined && diff !== 0 && (
        <p className={`text-[10px] leading-tight ${mismatch ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
          diff {diff > 0 ? '+' : ''}
          {formatMoney(diff)}
          {mismatch ? '' : ' (rounding)'}
        </p>
      )}
    </div>
  );
};

/** The unit exactly as printed on the invoice, shown when it differs from the chosen stock unit. */
export const PrintedUnit: React.FC<{ item: InvoiceLineItem }> = ({ item }) => {
  if (!item.printedUnit || item.printedUnit.toLowerCase() === (item.unit || '').toLowerCase()) return null;
  return (
    <p className="text-[10px] text-slate-500 mt-0.5 leading-tight" title="Unit as printed on the invoice">
      Invoice: {item.printedUnit}
    </p>
  );
};

/** A printed money value with its optional printed percentage, e.g. ₹124.08 (3%). */
export const PrintedValue: React.FC<{ value?: number | null; pct?: number | null; emptyTitle: string }> = ({
  value,
  pct,
  emptyTitle,
}) => {
  if ((value === null || value === undefined) && (pct === null || pct === undefined)) {
    return (
      <span className="text-slate-400" title={emptyTitle}>
        —
      </span>
    );
  }
  return (
    <div className="text-right leading-tight">
      {value !== null && value !== undefined ? <span className="text-slate-700">{formatMoney(value)}</span> : null}
      {pct !== null && pct !== undefined && <p className="text-[10px] text-slate-500">({pct}%)</p>}
    </div>
  );
};

export const LineReviewNotes: React.FC<{ item: InvoiceLineItem; onApplyRate: () => void }> = ({ item, onApplyRate }) => {
  const issues = item.validationIssues ?? (item.validationWarning ? item.validationWarning.split('; ') : []);
  const notes = [...issues, ...(item.suggestions || [])];
  const showRate = item.suggestedRate != null && (item.purchasePrice === null || item.purchasePrice === undefined);
  if (notes.length === 0 && !showRate) return null;
  return (
    <div className="mt-1 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 space-y-0.5">
      {notes.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
      {showRate && (
        <button
          type="button"
          onClick={onApplyRate}
          className="font-bold text-emerald-700 hover:underline cursor-pointer"
        >
          Use ₹{item.suggestedRate} as purchase price
        </button>
      )}
    </div>
  );
};

const CHECK_STYLE: Record<string, string> = {
  MATCH: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ROUNDING: 'bg-slate-100 text-slate-700 border-slate-300',
  MISMATCH: 'bg-rose-100 text-rose-800 border-rose-200',
  NOT_PRINTED: 'bg-slate-50 text-slate-500 border-slate-200',
};
const CHECK_LABEL: Record<string, string> = {
  MATCH: 'Matches',
  ROUNDING: 'Rounding',
  MISMATCH: 'Mismatch',
  NOT_PRINTED: 'Not printed',
};

/** Printed invoice totals compared with the sums of the extracted lines. */
export const InvoiceTotalsCheck: React.FC<{ totals: InvoiceTotals }> = ({ totals }) => {
  if (!totals.checks.length) return null;
  const hasMismatch = totals.checks.some((c) => c.status === 'MISMATCH');
  return (
    <div
      className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
        hasMismatch ? 'bg-rose-50/60 border-rose-200' : 'bg-slate-50 border-slate-200'
      }`}
    >
      <p className="font-black text-slate-800 uppercase tracking-wider text-[11px]">Invoice totals check</p>
      <ul className="space-y-1">
        {totals.checks.map((c) => (
          <li key={c.field} className="flex items-start gap-2">
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-black ${CHECK_STYLE[c.status] || CHECK_STYLE.NOT_PRINTED}`}
            >
              {CHECK_LABEL[c.status] || c.status}
            </span>
            <span className="text-slate-700">{c.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
