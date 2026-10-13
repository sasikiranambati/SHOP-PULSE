import React, { useId, useState } from 'react';
import { X, Plus, PackageCheck, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ProductFormFields } from './ProductFormFields';
import type { Product } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useDialog } from '../hooks/useDialog';
import { describeError } from '../utils/errorHandler';
import {
  isProductFormDirty,
  validateProductForm,
  type ProductFormField,
  type ProductFormValues,
} from '../utils/validators';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Must resolve only after the product is saved, and reject if saving failed. */
  onAddProduct: (product: Omit<Product, 'id'>) => void | Promise<void>;
}

const EMPTY_FORM: ProductFormValues = {
  name: '',
  category: 'Dairy',
  sellingPrice: '',
  purchasePrice: '',
  stock: '',
  minStock: '10',
  unit: 'pkts',
  barcode: '',
};

export const AddProductModal: React.FC<AddProductModalProps> = ({ isOpen, onClose, onAddProduct }) => {
  const { t } = useLanguage();
  const titleId = useId();
  const [values, setValues] = useState<ProductFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const resetAndClose = () => {
    setValues(EMPTY_FORM);
    setErrors({});
    setSubmitError(null);
    setConfirmDiscard(false);
    onClose();
  };

  // Closing with typed data asks first, so a stray tap or Escape does not lose the form.
  const requestClose = () => {
    if (isSubmitting) return;
    if (isProductFormDirty(values, EMPTY_FORM)) {
      setConfirmDiscard(true);
    } else {
      resetAndClose();
    }
  };

  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose: requestClose,
    closeOnEscape: !isSubmitting && !confirmDiscard,
  });

  if (!isOpen) return null;

  const handleChange = (field: ProductFormField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);

    const { errors: fieldErrors, parsed } = validateProductForm(values);
    setErrors(fieldErrors);
    if (!parsed) {
      const firstInvalid = Object.keys(fieldErrors)[0];
      if (firstInvalid) document.getElementById(`add-product-${firstInvalid}`)?.focus();
      return;
    }

    let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
    if (parsed.stock === 0) status = 'Out of Stock';
    else if (parsed.stock <= parsed.minStock) status = 'Low Stock';

    const timestamp = new Date().toISOString();
    setIsSubmitting(true);
    try {
      await onAddProduct({
        name: parsed.name,
        category: parsed.category,
        stock: parsed.stock,
        minStock: parsed.minStock,
        reorderLevel: parsed.minStock,
        unit: parsed.unit,
        price: parsed.sellingPrice,
        sellingPrice: parsed.sellingPrice,
        // Left undefined when blank: the purchase price is never estimated from the selling price.
        purchasePrice: parsed.purchasePrice as number,
        barcode: parsed.barcode,
        status,
        lastRestocked: 'Just now',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      resetAndClose();
    } catch (err) {
      // Keep everything the user typed so they can fix the problem and retry.
      setSubmitError(describeError(err, 'The product could not be saved. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-up sm:animate-fade-in pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-base sm:text-xl truncate">
            <PackageCheck className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" aria-hidden="true" />
            <h2 id={titleId} className="truncate">{t('addProductModal.title')}</h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitError && (
          <div role="alert" className="mt-3 p-3 bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-black">Product could not be saved.</strong> {submitError}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3.5">
          <ProductFormFields
            idPrefix="add-product"
            mode="add"
            values={values}
            errors={errors}
            disabled={isSubmitting}
            onChange={handleChange}
          />

          <p className="text-[11px] text-slate-500">Fields marked * are required. Leave purchase price empty if you do not know it.</p>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <Button type="button" variant="outline" onClick={requestClose} disabled={isSubmitting} className="rounded-xl min-h-[44px] px-4">
              {t('addProductModal.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              icon={<Plus className="w-5 h-5" />}
              className="rounded-xl font-bold min-h-[44px] px-5"
            >
              {isSubmitting ? 'Saving…' : t('addProductModal.submit')}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Discard this product?"
        message="You have typed product details that are not saved yet. Discard them and close the form?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="default"
        onConfirm={resetAndClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
};
