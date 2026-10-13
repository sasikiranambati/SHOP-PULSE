import React, { useId, useMemo, useState } from 'react';
import { X, Save, Edit3, AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ProductFormFields } from './ProductFormFields';
import type { Product, ProductCategory } from '../types';
import { useDialog } from '../hooks/useDialog';
import { describeError } from '../utils/errorHandler';
import {
  isProductFormDirty,
  validateProductForm,
  type ProductFormField,
  type ProductFormValues,
} from '../utils/validators';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  /** Must resolve only after the update is saved, and reject if saving failed. */
  onUpdateProduct: (id: string, updates: Partial<Product>) => void | Promise<void>;
}

function toFormValues(product: Product): ProductFormValues {
  return {
    name: product.name || '',
    category: product.category || 'Dairy',
    sellingPrice: String(product.sellingPrice ?? product.price ?? ''),
    // A stored purchase price of 0 means "not recorded"; show it as empty rather than ₹0.
    purchasePrice: product.purchasePrice > 0 ? String(product.purchasePrice) : '',
    stock: String(product.stock ?? 0),
    minStock: String(product.reorderLevel ?? product.minStock ?? 10),
    unit: product.unit || 'units',
    barcode: product.barcode || '',
  };
}

/**
 * Render with `key={product.id}` so the form starts from the selected product's values.
 */
export const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product, onUpdateProduct }) => {
  const titleId = useId();
  const initialValues = useMemo(() => (product ? toFormValues(product) : null), [product]);
  const [values, setValues] = useState<ProductFormValues | null>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = Boolean(values && initialValues && isProductFormDirty(values, initialValues));

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const panelRef = useDialog<HTMLDivElement>({
    isOpen: isOpen && Boolean(product),
    onClose: requestClose,
    closeOnEscape: !isSubmitting && !confirmDiscard,
  });

  if (!isOpen || !product || !values) return null;

  const handleChange = (field: ProductFormField, value: string) => {
    setValues((prev) => (prev ? { ...prev, [field]: value } : prev));
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
      if (firstInvalid) document.getElementById(`edit-product-${firstInvalid}`)?.focus();
      return;
    }

    let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
    if (parsed.stock === 0) status = 'Out of Stock';
    else if (parsed.stock <= parsed.minStock) status = 'Low Stock';

    setIsSubmitting(true);
    try {
      const updates: Partial<Product> = {
        name: parsed.name,
        category: parsed.category as ProductCategory,
        stock: parsed.stock,
        minStock: parsed.minStock,
        reorderLevel: parsed.minStock,
        unit: parsed.unit,
        price: parsed.sellingPrice,
        sellingPrice: parsed.sellingPrice,
        barcode: parsed.barcode,
        status,
        updatedAt: new Date().toISOString(),
      };
      // An empty purchase price field leaves the stored value unchanged instead of writing ₹0.
      if (parsed.purchasePrice !== undefined) updates.purchasePrice = parsed.purchasePrice;
      await onUpdateProduct(product.id, updates);
      onClose();
    } catch (err) {
      setSubmitError(describeError(err, 'The product could not be updated. Please try again.'));
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
          <div className="flex items-center gap-2 text-slate-800 font-extrabold text-base sm:text-xl truncate">
            <Edit3 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
            <h2 id={titleId} className="truncate">Edit Product</h2>
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
              <strong className="font-black">Changes were not saved.</strong> {submitError}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3.5">
          <ProductFormFields
            idPrefix="edit-product"
            mode="edit"
            values={values}
            errors={errors}
            disabled={isSubmitting}
            onChange={handleChange}
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <Button type="button" variant="outline" onClick={requestClose} disabled={isSubmitting} className="rounded-xl min-h-[44px] px-4">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              icon={<Save className="w-4 h-4" />}
              className="rounded-xl font-bold min-h-[44px] px-5"
            >
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Discard your changes?"
        message={
          <>
            Your changes to <span className="font-extrabold text-slate-900">{product.name}</span> have not been saved.
          </>
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="default"
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
};
