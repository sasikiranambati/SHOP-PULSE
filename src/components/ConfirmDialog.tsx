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
        className="bg-white rounded-xl max-w-md w-full p-6 shadow-dropdown border border-[#E3E5DE] max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#E3E5DE]">
          <div className={`flex items-center gap-2.5 font-bold text-lg ${tone === 'danger' ? 'text-[#B93838]' : 'text-[#202923]'}`}>
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                tone === 'danger' ? 'bg-[#FDF2F2] text-[#B93838] border-[#B93838]/30' : 'bg-[#FEF9EB] text-[#A66A16] border-[#A66A16]/30'
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
            className="p-1.5 rounded-lg text-[#69736C] hover:text-[#202923] hover:bg-[#F7F5EF] cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div id={descriptionId} className="py-4 space-y-2.5 text-sm text-[#202923] font-medium leading-relaxed">
          <div>{message}</div>
          {warning && (
            <p className="text-xs font-semibold bg-[#FDF2F2] text-[#B93838] p-2.5 rounded-lg border border-[#B93838]/30 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#B93838]" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-3 p-3 rounded-lg bg-[#FDF2F2] border border-[#B93838]/40 text-[#B93838] text-xs font-bold">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-3 border-t border-[#E3E5DE]">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              if (!isBusy) void onConfirm();
            }}
            loading={isBusy}
            className="rounded-lg font-bold"
          >
            {isBusy ? busyLabel || 'Working…' : error ? `Try again: ${confirmLabel}` : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
