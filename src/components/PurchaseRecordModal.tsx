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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#141E18]/60 backdrop-blur-xs" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-xl shadow-2xl border border-[#E3E5DE] flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-[#E3E5DE]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id={titleId} className="font-bold text-[#202923] text-base sm:text-lg truncate">
              Purchase invoice {purchase?.invoice_number ? `#${purchase.invoice_number}` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-[#69736C] hover:text-[#202923] hover:bg-[#F7F5EF] cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {loading && (
            <p role="status" className="py-10 text-center text-sm font-bold text-[#69736C] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#234B3A]" aria-hidden="true" /> Loading purchase record…
            </p>
          )}

          {error && !loading && (
            <div role="alert" className="p-4 rounded-xl bg-[#FDF2F2] border border-[#B93838]/25 text-[#B93838] text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[#B93838]" aria-hidden="true" />
                <span>{error}</span>
              </span>
              <Button variant="outline" size="sm" onClick={retry} icon={<RefreshCw className="w-4 h-4" />} className="rounded-lg border-[#E3E5DE] text-[#202923]">
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
                  <div key={label} className="p-3 rounded-xl bg-[#F7F5EF] border border-[#E3E5DE] min-w-0">
                    <dt className="font-bold uppercase text-[10px] text-[#69736C]">{label}</dt>
                    <dd className="font-bold text-[#202923] mt-0.5 break-words">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="overflow-auto max-h-[50dvh] border border-[#E3E5DE] rounded-xl">
                <table className="w-full text-left text-xs sm:text-sm">
                  <caption className="sr-only">Purchase invoice lines</caption>
                  <thead className="sticky top-0 z-10 bg-[#F7F5EF] text-[11px] uppercase font-bold text-[#69736C] border-b border-[#E3E5DE]">
                    <tr>
                      <th scope="col" className="py-2.5 px-3">Product</th>
                      <th scope="col" className="py-2.5 px-3 text-right">Qty</th>
                      <th scope="col" className="py-2.5 px-3 text-right whitespace-nowrap">Purchase price</th>
                      <th scope="col" className="py-2.5 px-3 text-right">MRP</th>
                      <th scope="col" className="py-2.5 px-3 text-right whitespace-nowrap">Line amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E5DE]/40">
                    {purchase.items.map((item) => (
                      <tr key={item.id} className="hover:bg-[#F7F5EF]/60">
                        <td className="py-2.5 px-3 font-semibold text-[#202923] min-w-[10rem]">
                          {item.product_name || <span className="text-[#69736C] font-medium">Product no longer in catalog</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {item.quantity} {item.product_unit || ''}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{money(item.purchase_price)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{money(item.mrp)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap font-bold text-[#202923]">{money(item.line_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#69736C]">"—" means the value was not recorded on this purchase.</p>
            </>
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-[#E3E5DE] flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-lg border-[#E3E5DE] text-[#202923] hover:bg-[#F7F5EF]">
            Close
          </Button>
          <Button variant="primary" disabled={!purchase} onClick={() => window.print()} icon={<Printer className="w-4 h-4" />} className="rounded-lg">
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
