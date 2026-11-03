/**
 * @file WarningPopover.tsx
 * @description Compact per-row warning indicator for the invoice review desktop table.
 * Shows a small badge with warning count; clicking opens an inline popover listing
 * all unique deduplicated issues with visual severity states.
 *
 * States:
 *   VERIFIED       — emerald check
 *   FIX_REQUIRED   — rose (validation error or arithmetic mismatch)
 *   NEEDS_REVIEW   — amber (low confidence or uncertainty)
 *   MISSING_INFO   — slate (missing optional fields)
 *   OK             — no badge shown
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { InvoiceLineItem } from '../services/invoiceTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'fix' | 'review' | 'missing' | 'ok';

interface IssueEntry {
  text: string;
  severity: Severity;
}

interface ValidationError {
  itemId: string;
  issues: string[];
}

interface Props {
  item: InvoiceLineItem;
  validationError?: ValidationError;
  onApplyRate?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectIssues(
  item: InvoiceLineItem,
  validationError?: ValidationError,
): IssueEntry[] {
  const entries: IssueEntry[] = [];

  // Hard validation errors (Fix required)
  if (validationError) {
    for (const issue of validationError.issues) {
      entries.push({ text: issue, severity: 'fix' });
    }
  }

  // Arithmetic mismatch
  if (item.arithmeticStatus === 'MISMATCH') {
    const msg = item.validationWarning || 'Qty × rate does not equal the printed line total';
    if (!entries.some((e) => e.text === msg)) {
      entries.push({ text: msg, severity: 'fix' });
    }
  }

  // Validation warnings (semicolon-separated)
  if (item.validationWarning && item.arithmeticStatus !== 'MISMATCH') {
    for (const part of item.validationWarning.split(';')) {
      const t = part.trim();
      if (t && !entries.some((e) => e.text === t)) {
        entries.push({ text: t, severity: 'review' });
      }
    }
  }

  // Review reasons
  for (const r of item.reviewReasons || []) {
    const t = r.trim();
    if (t && !entries.some((e) => e.text === t)) {
      entries.push({ text: t, severity: 'review' });
    }
  }

  // Validation issues list
  for (const vi of (item as any).validationIssues || []) {
    const t = typeof vi === 'string' ? vi.trim() : String(vi).trim();
    if (t && !entries.some((e) => e.text === t)) {
      entries.push({ text: t, severity: 'review' });
    }
  }

  // Suggestions (informational)
  for (const s of item.suggestions || []) {
    const t = s.trim();
    if (t && !entries.some((e) => e.text === t)) {
      entries.push({ text: t, severity: 'missing' });
    }
  }

  // Missing fields
  if (item.purchasePrice === null || item.purchasePrice === undefined) {
    const t = 'Purchase price missing';
    if (!entries.some((e) => e.text === t)) {
      entries.push({ text: t, severity: 'missing' });
    }
  }

  return entries;
}

function overallSeverity(issues: IssueEntry[]): Severity {
  if (issues.some((i) => i.severity === 'fix')) return 'fix';
  if (issues.some((i) => i.severity === 'review')) return 'review';
  if (issues.some((i) => i.severity === 'missing')) return 'missing';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Severity colours
// ---------------------------------------------------------------------------

const SEVERITY_BADGE: Record<Severity, string> = {
  fix: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-200/80',
  review: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200/80',
  missing: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200/80',
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  fix: 'Fix required',
  review: 'Needs review',
  missing: 'Missing info',
  ok: 'Verified',
};

const SEVERITY_DOT: Record<Severity, string> = {
  fix: 'bg-rose-500',
  review: 'bg-amber-400',
  missing: 'bg-slate-400',
  ok: 'bg-emerald-500',
};

const SEVERITY_ICON: Record<Severity, string> = {
  fix: '✕',
  review: '⚠',
  missing: '?',
  ok: '✓',
};

const SEVERITY_ROW_CLASS: Record<Severity, string> = {
  fix: 'text-rose-800',
  review: 'text-amber-800',
  missing: 'text-slate-600',
  ok: 'text-emerald-700',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WarningPopover: React.FC<Props> = ({ item, validationError, onApplyRate }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const issues = collectIssues(item, validationError);
  const severity = overallSeverity(issues);

  // Verified with no issues at all
  if (item.isVerified && issues.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap select-none"
        title="This item has been verified"
      >
        ✓ Verified
      </span>
    );
  }

  if (issues.length === 0) return null;

  const closePopover = useCallback(() => setOpen(false), []);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closePopover]);

  const badgeClass = SEVERITY_BADGE[severity];

  const showApplyRate =
    onApplyRate != null &&
    item.suggestedRate != null &&
    (item.purchasePrice === null || item.purchasePrice === undefined);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${issues.length} issue${issues.length !== 1 ? 's' : ''} — click to view`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-extrabold whitespace-nowrap select-none cursor-pointer transition-opacity hover:opacity-80 ${badgeClass}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[severity]} inline-block`}
        />
        <span>{SEVERITY_ICON[severity]} {issues.length === 1 ? SEVERITY_LABEL[severity] : `${issues.length} issues`}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-6 left-0 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-2 text-[11px]"
          role="dialog"
          aria-label="Item issues"
        >
          <div className="px-3 py-1 border-b border-slate-100 flex items-center justify-between">
            <span className="font-extrabold text-slate-700 text-[11px]">
              {issues.length} Issue{issues.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={closePopover}
              className="text-slate-400 hover:text-slate-700 text-[13px] leading-none cursor-pointer"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <ul className="divide-y divide-slate-50 max-h-48 overflow-y-auto">
            {issues.map((issue, idx) => (
              <li key={idx} className={`px-3 py-1.5 flex items-start gap-2 ${SEVERITY_ROW_CLASS[issue.severity]}`}>
                <span className={`w-1.5 h-1.5 mt-1 rounded-full shrink-0 ${SEVERITY_DOT[issue.severity]}`} />
                <span className="leading-tight">{issue.text}</span>
              </li>
            ))}
          </ul>

          {showApplyRate && (
            <div className="px-3 pt-1.5 pb-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { onApplyRate!(); closePopover(); }}
                className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                Use ₹{item.suggestedRate} as purchase price
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

