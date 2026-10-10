/**
 * @file InvoiceLineCells.tsx
 * @description Small display cells for scanned invoice lines: MRP origin/lookup status,
 * line amount with its source, and review notes with an opt-in suggested purchase price.
 */

import React from 'react';
import type { InvoiceLineItem } from '../services/invoiceTypes';
import { describeMrp } from '../services/invoiceReview';

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

export const LineAmount: React.FC<{ item: InvoiceLineItem }> = ({ item }) => (
  <div className="text-right">
    {item.lineTotal !== null && item.lineTotal !== undefined ? (
      <span className="font-bold text-slate-900">₹{item.lineTotal.toLocaleString('en-IN')}</span>
    ) : (
      <span className="text-slate-400" title="Line amount not printed and could not be calculated">—</span>
    )}
    {item.lineTotalSource === 'CALCULATED' && (
      <p className="text-[10px] text-slate-500 leading-tight" title="Not printed on the invoice; quantity × purchase price">
        calculated
      </p>
    )}
    {item.lineTotalSource === 'MANUAL' && <p className="text-[10px] text-slate-500 leading-tight">edited</p>}
  </div>
);

export const LineReviewNotes: React.FC<{ item: InvoiceLineItem; onApplyRate: () => void }> = ({ item, onApplyRate }) => {
  const notes = [...(item.validationWarning ? item.validationWarning.split('; ') : []), ...(item.suggestions || [])];
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
