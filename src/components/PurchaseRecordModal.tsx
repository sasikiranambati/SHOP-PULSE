import React, { useEffect, useId, useState } from 'react';
import { X, Printer, FileText, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { PrintPortal } from './PrintPortal';
import { PurchaseRecordDocument } from './PrintDocuments';
import { useDialog } from '../hooks/useDialog';
import { purchasesApi, type PurchaseBackend } from '../api/purchases';
import { describeError } from '../utils/errorHandler';
import { formatCurrency } from '../utils/formatCurrency';

interface PurchaseRecordModalProps {
  purchaseId: string | null;
  shopName: string;
  onClose: () => void;
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : formatCurrency(Number(value));

/** Read-only view of a recorded supplier invoice, with a print layout. Render with `key={purchaseId}`. */
export const PurchaseRecordModal: React.FC<PurchaseRecordModalProps> = ({ purchaseId, shopName, onClose }) => {
  const titleId = useId();
  const [purchase, setPurchase] = useState<PurchaseBackend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(purchaseId));
  const [attempt, setAttempt] = useState(0);
  const isOpen = Boolean(purchaseId);
  const panelRef = useDialog<HTMLDivElement>({ isOpen, onClose });

  useEffect(() => {
    if (!purchaseId) return;
    let cancelled = false;
    purchasesApi.getPurchase(purchaseId).then(
      (data) => {
        if (cancelled) return;
        setPurchase(data);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setPurchase(null);
        setError(describeError(err, 'The purchase record could not be loaded.'));
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [purchaseId, attempt]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (!isOpen || !purchaseId) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
            <h2 id={titleId} className="font-black text-slate-900 text-base sm:text-lg truncate">
              Purchase invoice {purchase?.invoice_number ? `#${purchase.invoice_number}` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {loading && (
            <p role="status" className="py-10 text-center text-sm font-bold text-slate-600 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading purchase record…
            </p>
          )}

          {error && !loading && (
            <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
                <span>{error}</span>
              </span>
              <Button variant="outline" size="sm" onClick={retry} icon={<RefreshCw className="w-4 h-4" />}>
                Retry
              </Button>
            </div>
          )}

          {purchase && !loading && (
            <>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {[
                  ['Supplier', purchase.supplier_name || '—'],
                  ['Invoice No.', purchase.invoice_number || '—'],
                  ['Invoice Date', purchase.invoice_date || '—'],
                  ['Recorded total', money(purchase.total_amount)],
                ].map(([label, value]) => (
                  <div key={label} className="p-3 rounded-xl bg-slate-50 border border-slate-200 min-w-0">
                    <dt className="font-bold uppercase text-[10px] text-slate-500">{label}</dt>
                    <dd className="font-extrabold text-slate-900 mt-0.5 break-words">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="overflow-auto max-h-[50dvh] border border-slate-200 rounded-2xl">
                <table className="w-full text-left text-xs sm:text-sm">
                  <caption className="sr-only">Purchase invoice lines</caption>
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase font-extrabold text-slate-600 shadow-[inset_0_-1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th scope="col" className="py-2.5 px-3">Product</th>
                      <th scope="col" className="py-2.5 px-3 text-right">Qty</th>
                      <th scope="col" className="py-2.5 px-3 text-right whitespace-nowrap">Purchase price</th>
                      <th scope="col" className="py-2.5 px-3 text-right">MRP</th>
                      <th scope="col" className="py-2.5 px-3 text-right whitespace-nowrap">Line amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchase.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 px-3 font-bold text-slate-900 min-w-[10rem]">
                          {item.product_name || <span className="text-slate-500 font-medium">Product no longer in catalog</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {item.quantity} {item.product_unit || ''}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{money(item.purchase_price)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{money(item.mrp)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap font-bold">{money(item.line_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">"—" means the value was not recorded on this purchase.</p>
            </>
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-slate-100 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled={!purchase} onClick={() => window.print()} icon={<Printer className="w-4 h-4" />}>
            Print
          </Button>
        </div>
      </div>

      {purchase && (
        <PrintPortal label="Purchase record print view">
          <PurchaseRecordDocument purchase={purchase} shopName={shopName} />
        </PrintPortal>
      )}
    </div>
  );
};
