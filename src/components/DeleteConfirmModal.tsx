import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  productName: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isDeleting?: boolean;
  /** Message from a failed delete; the dialog stays open so the user can retry or cancel. */
  error?: string | null;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  productName,
  onClose,
  onConfirm,
  isDeleting = false,
  error = null,
}) => (
  <ConfirmDialog
    isOpen={isOpen}
    title="Delete product?"
    message={
      <>
        Delete <span className="font-extrabold text-slate-900">"{productName}"</span> from your stock catalog?
      </>
    }
    warning="This permanently removes the product and its stock count from your catalog. It cannot be undone."
    confirmLabel="Delete product"
    busyLabel="Deleting…"
    tone="danger"
    isBusy={isDeleting}
    error={error}
    onConfirm={onConfirm}
    onCancel={onClose}
  />
);
