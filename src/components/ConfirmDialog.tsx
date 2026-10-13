import React, { useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';
import { useDialog } from '../hooks/useDialog';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** What will happen, in plain words. */
  message: React.ReactNode;
  /** Optional extra warning shown in a highlighted box. */
  warning?: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** True while the confirmed operation runs: buttons are disabled and Escape is ignored. */
  isBusy?: boolean;
  /** Error from a failed attempt, shown inside the dialog so the user can retry or cancel. */
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog. Cancel is focused first so pressing Enter or Escape
 * never triggers the destructive action by accident.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  warning,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  isBusy = false,
  error,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose: onCancel,
    closeOnEscape: !isBusy,
    initialFocusRef: cancelRef,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60"
      onClick={(e) => {
        // Do not let the click reach a parent dialog's backdrop.
        e.stopPropagation();
        if (!isBusy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className={`flex items-center gap-2.5 font-extrabold text-lg ${tone === 'danger' ? 'text-rose-700' : 'text-slate-900'}`}>
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                tone === 'danger' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-amber-50 text-amber-600 border-amber-200'
              }`}
            >
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            aria-label="Close dialog"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id={descriptionId} className="py-4 space-y-2.5 text-sm text-slate-700 font-medium leading-relaxed">
          <div>{message}</div>
          {warning && (
            <p className="text-xs font-semibold bg-rose-50/80 text-rose-800 p-2.5 rounded-xl border border-rose-200/80 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-bold">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-3 border-t border-slate-100">
          <Button ref={cancelRef} type="button" variant="outline" onClick={onCancel} disabled={isBusy} className="rounded-xl">
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              if (!isBusy) void onConfirm();
            }}
            loading={isBusy}
            className="rounded-xl"
          >
            {isBusy ? busyLabel || 'Working…' : error ? `Try again: ${confirmLabel}` : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
