import React, { useId, useMemo, useState } from 'react';
import { X, Save, Edit3, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ProductFormFields } from './ProductFormFields';
import type { Product } from '../types';
import { useDialog } from '../hooks/useDialog';
import { useUnitRegistry } from '../hooks/useUnitRegistry';
import { useShopRole } from '../hooks/useShopRole';
import { describeError } from '../utils/errorHandler';
import {
  isProductFormDirty,
  validateProductForm,
  type ProductFormField,
  type ProductFormValues,
} from '../utils/validators';
import {
  buildProductUpdatePayload,
  getInitialPricingBasisState,
  resolveUnitChange,
  validateEditPricingBasis,
  type PricingBasisFormState,
  type UnitTransitionResult,
} from '../utils/productEditPricing';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  /** Must resolve only after the update is saved, and reject if saving failed. */
  onUpdateProduct: (id: string, updates: Partial<Product>) => void | Promise<void>;
}

const inputBase =
  'w-full rounded-lg border border-[#E3E5DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#234B3A]/20 focus:border-[#234B3A] font-medium text-[#202923] disabled:bg-[#F7F5EF]/60 disabled:cursor-not-allowed transition-colors px-3 py-2 text-sm';
const labelBase = 'block text-[11px] font-semibold uppercase tracking-wider text-[#69736C] mb-1';

function toFormValues(product: Product): ProductFormValues {
  return {
    name: product.name || '',
    category: product.category || 'Dairy',
    sellingPrice: String(product.sellingPrice ?? product.price ?? ''),
    // A stored purchase price of 0 means "not recorded"; show it as empty rather than ₹0.
    purchasePrice: product.purchasePrice > 0 ? String(product.purchasePrice) : '',
    stock: String(product.stock ?? 0),
    minStock: String(product.reorderLevel ?? product.minStock ?? 10),
    unit: product.unit || 'pcs',
    barcode: product.barcode || '',
  };
}

function isBasisDirty(current: PricingBasisFormState, initial: PricingBasisFormState): boolean {
  return (
    current.priceBasisQuantity !== initial.priceBasisQuantity ||
    current.priceBasisUnit !== initial.priceBasisUnit ||
    current.mrp !== initial.mrp ||
    current.mrpBasisQuantity !== initial.mrpBasisQuantity ||
    current.mrpBasisUnit !== initial.mrpBasisUnit
  );
}

/**
 * Render with `key={product.id}` so the form starts from the selected product's values.
 */
export const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product, onUpdateProduct }) => {
  const titleId = useId();
  const { index: unitIndex } = useUnitRegistry();
  const { isCashier } = useShopRole();

  const initialValues = useMemo(() => (product ? toFormValues(product) : null), [product]);
  const initialBasis = useMemo(() => (product ? getInitialPricingBasisState(product) : null), [product]);

  const [values, setValues] = useState<ProductFormValues | null>(initialValues);
  const [basis, setBasis] = useState<PricingBasisFormState | null>(initialBasis);
  const [basisManuallyEdited, setBasisManuallyEdited] = useState(false);
  const [showBasisEditor, setShowBasisEditor] = useState(false);
  const [unitTransition, setUnitTransition] = useState<UnitTransitionResult | null>(null);
  const [basisConfirmed, setBasisConfirmed] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [basisErrors, setBasisErrors] = useState<{
    priceBasisQuantity?: string;
    priceBasisUnit?: string;
    mrp?: string;
    mrpBasisQuantity?: string;
    mrpBasisUnit?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = Boolean(
    values &&
      initialValues &&
      basis &&
      initialBasis &&
      (isProductFormDirty(values, initialValues) || isBasisDirty(basis, initialBasis)),
  );

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

  if (!isOpen || !product || !values || !basis || !initialValues || !initialBasis) return null;

  const allowFractionalStock = Boolean(unitIndex?.allowsFraction(values.unit));

  const unitChanged = Boolean(unitTransition && unitTransition.kind !== 'unchanged');
  const basisChanged =
    basis.priceBasisQuantity !== initialBasis.priceBasisQuantity ||
    basis.priceBasisUnit !== initialBasis.priceBasisUnit ||
    basis.mrpBasisQuantity !== initialBasis.mrpBasisQuantity ||
    basis.mrpBasisUnit !== initialBasis.mrpBasisUnit;
  const requiresBasisConfirmation = unitChanged || basisChanged;

  const liveSellingPrice = Number(values.sellingPrice.trim());
  const liveBasisCheck = validateEditPricingBasis(
    values.unit,
    Number.isFinite(liveSellingPrice) ? liveSellingPrice : undefined,
    basis,
    unitIndex,
  );

  const isBasisEditorOpen =
    showBasisEditor ||
    unitChanged ||
    Boolean(
      basisErrors.priceBasisQuantity ||
        basisErrors.priceBasisUnit ||
        basisErrors.mrp ||
        basisErrors.mrpBasisQuantity ||
        basisErrors.mrpBasisUnit,
    );

  const handleChange = (field: ProductFormField, value: string) => {
    setValues((prev) => (prev ? { ...prev, [field]: value } : prev));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));

    if (field === 'unit') {
      const transition = resolveUnitChange(product, value, basis, unitIndex, basisManuallyEdited);
      setBasis(transition.nextBasis);
      setUnitTransition(transition.kind === 'unchanged' ? null : transition);
      setBasisConfirmed(false);
      setBasisErrors({});
      setSubmitError(null);
    }
  };

  const handleBasisChange = (field: keyof PricingBasisFormState, value: string) => {
    setBasisManuallyEdited(true);
    setBasis((prev) => (prev ? { ...prev, [field]: value } : prev));
    setBasisConfirmed(false);
    setSubmitError(null);
    if (field in basisErrors) {
      setBasisErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);

    const { errors: fieldErrors, parsed } = validateProductForm(values, {
      allowFractionalStock,
    });
    const basisValidation = validateEditPricingBasis(
      values.unit,
      parsed?.sellingPrice ?? (Number.isFinite(liveSellingPrice) ? liveSellingPrice : undefined),
      basis,
      unitIndex,
    );

    const mergedFieldErrors: Partial<Record<ProductFormField, string>> = {
      ...fieldErrors,
      ...(basisValidation.unitError ? { unit: basisValidation.unitError } : {}),
    };
    setErrors(mergedFieldErrors);
    setBasisErrors({
      priceBasisQuantity: basisValidation.priceBasisQuantityError,
      priceBasisUnit: basisValidation.priceBasisUnitError,
      mrp: basisValidation.mrpError,
      mrpBasisQuantity: basisValidation.mrpBasisQuantityError,
      mrpBasisUnit: basisValidation.mrpBasisUnitError,
    });

    if (!parsed || !basisValidation.isValid || !basisValidation.parsed) {
      const firstInvalid = Object.keys(mergedFieldErrors)[0];
      if (firstInvalid) document.getElementById(`edit-product-${firstInvalid}`)?.focus();
      return;
    }

    if (requiresBasisConfirmation && !basisConfirmed) {
      setSubmitError('Please confirm the pricing basis for this unit change before saving.');
      return;
    }

    const updates = buildProductUpdatePayload(product, parsed, basisValidation.parsed, unitIndex);

    setIsSubmitting(true);
    try {
      await onUpdateProduct(product.id, updates);
      onClose();
    } catch (err) {
      setSubmitError(describeError(err, 'The product could not be updated. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const pricingBadgeStyle =
    product.pricingStatus === 'VERIFIED'
      ? 'bg-[#E5EEE6] text-[#18382B] border-[#52745D]/30'
      : product.pricingStatus === 'NEEDS_REVIEW'
      ? 'bg-[#FEF9EB] text-[#A66A16] border-[#A66A16]/30'
      : 'bg-[#F7F5EF] text-[#69736C] border-[#E3E5DE]';

  const hasCompatibilityBlockingError = Boolean(
    liveBasisCheck.unitError || liveBasisCheck.priceBasisUnitError || liveBasisCheck.mrpBasisUnitError,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#141E18]/60 backdrop-blur-xs"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-t-2xl sm:rounded-xl max-w-md w-full p-5 sm:p-6 max-h-[90dvh] overflow-y-auto shadow-2xl border border-[#E3E5DE] animate-slide-up sm:animate-fade-in pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3.5 border-b border-[#E3E5DE]">
          <div className="flex items-center gap-2.5 text-[#202923] font-bold text-base sm:text-lg min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <Edit3 className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate">Edit Product</h2>
              {product.pricingStatus && (
                <span
                  data-testid="edit-pricing-status-badge"
                  className={`inline-flex items-center gap-1 mt-0.5 font-bold rounded-full text-[10px] px-2 py-0.5 uppercase tracking-wide border ${pricingBadgeStyle}`}
                >
                  {product.pricingStatus === 'VERIFIED' ? (
                    <>
                      <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                      Verified Pricing
                    </>
                  ) : (
                    product.pricingStatus.replace(/_/g, ' ')
                  )}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#69736C] hover:text-[#202923] hover:bg-[#F7F5EF] cursor-pointer transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isCashier && product.pricingStatus === 'VERIFIED' && (
          <div
            data-testid="cashier-verified-hint"
            className="mt-3 p-2.5 rounded-lg bg-[#FEF9EB] border border-[#A66A16]/25 text-[#7C4D0E] text-xs font-medium"
          >
            Prices, MRP, and units on verified items require a Manager or Owner to update. Stock and name edits remain allowed.
          </div>
        )}

        {submitError && (
          <div role="alert" className="mt-3 p-3 bg-[#FDF2F2] border border-[#B93838]/25 text-[#B93838] text-xs font-semibold rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong className="font-bold">Changes were not saved.</strong> {submitError}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3.5">
          <ProductFormFields
            idPrefix="edit-product"
            mode="edit"
            values={values}
            errors={{ ...errors, ...(unitChanged && liveBasisCheck.unitError ? { unit: liveBasisCheck.unitError } : {}) }}
            disabled={isSubmitting}
            allowFractionalStock={allowFractionalStock}
            onChange={handleChange}
          />

          {/* Compact Pricing & MRP Basis summary + expandable controls */}
          <div className="rounded-lg border border-[#E3E5DE] bg-[#F7F5EF]/70 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[#202923] min-w-0">
                <span className="font-semibold">Price basis:</span>{' '}
                <span className="font-bold text-[#234B3A]" data-testid="edit-basis-summary">
                  per {basis.priceBasisQuantity || '1'} {basis.priceBasisUnit || values.unit}
                </span>
                {basis.mrp && (
                  <span className="text-[#69736C] ml-2">
                    • MRP ₹{basis.mrp} per {basis.mrpBasisQuantity || '1'} {basis.mrpBasisUnit || basis.priceBasisUnit}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowBasisEditor((prev) => !prev)}
                aria-expanded={isBasisEditorOpen}
                className="text-xs font-bold text-[#234B3A] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {isBasisEditorOpen ? 'Hide basis' : 'Edit basis / MRP'}
                {isBasisEditorOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {isBasisEditorOpen && (
              <div className="pt-2 border-t border-[#E3E5DE] space-y-3">
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="edit-product-priceBasisQuantity" className={labelBase}>
                      Selling Price Per Qty *
                    </label>
                    <input
                      id="edit-product-priceBasisQuantity"
                      type="number"
                      min="0.001"
                      step="any"
                      inputMode="decimal"
                      disabled={isSubmitting}
                      value={basis.priceBasisQuantity}
                      onChange={(e) => handleBasisChange('priceBasisQuantity', e.target.value)}
                      className={inputBase}
                    />
                    {(basisErrors.priceBasisQuantity || liveBasisCheck.priceBasisQuantityError) && (
                      <p className="mt-1 text-xs font-bold text-[#B93838]">
                        {basisErrors.priceBasisQuantity || liveBasisCheck.priceBasisQuantityError}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="edit-product-priceBasisUnit" className={labelBase}>
                      Selling Price Basis Unit *
                    </label>
                    <input
                      id="edit-product-priceBasisUnit"
                      type="text"
                      disabled={isSubmitting}
                      value={basis.priceBasisUnit}
                      onChange={(e) => handleBasisChange('priceBasisUnit', e.target.value)}
                      list={unitIndex ? 'edit-product-unit-options' : undefined}
                      className={inputBase}
                    />
                    {(basisErrors.priceBasisUnit || liveBasisCheck.priceBasisUnitError) && (
                      <p className="mt-1 text-xs font-bold text-[#B93838]">
                        {basisErrors.priceBasisUnit || liveBasisCheck.priceBasisUnitError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 xs:grid-cols-3 gap-2.5">
                  <div>
                    <label htmlFor="edit-product-mrp" className={labelBase}>
                      MRP (₹)
                    </label>
                    <input
                      id="edit-product-mrp"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Optional"
                      disabled={isSubmitting}
                      value={basis.mrp}
                      onChange={(e) => handleBasisChange('mrp', e.target.value)}
                      className={inputBase}
                    />
                    {(basisErrors.mrp || liveBasisCheck.mrpError) && (
                      <p className="mt-1 text-xs font-bold text-[#B93838]">{basisErrors.mrp || liveBasisCheck.mrpError}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="edit-product-mrpBasisQuantity" className={labelBase}>
                      MRP Basis Qty
                    </label>
                    <input
                      id="edit-product-mrpBasisQuantity"
                      type="number"
                      min="0.001"
                      step="any"
                      inputMode="decimal"
                      disabled={isSubmitting}
                      value={basis.mrpBasisQuantity}
                      onChange={(e) => handleBasisChange('mrpBasisQuantity', e.target.value)}
                      className={inputBase}
                    />
                    {(basisErrors.mrpBasisQuantity || liveBasisCheck.mrpBasisQuantityError) && (
                      <p className="mt-1 text-xs font-bold text-[#B93838]">
                        {basisErrors.mrpBasisQuantity || liveBasisCheck.mrpBasisQuantityError}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="edit-product-mrpBasisUnit" className={labelBase}>
                      MRP Basis Unit
                    </label>
                    <input
                      id="edit-product-mrpBasisUnit"
                      type="text"
                      disabled={isSubmitting}
                      value={basis.mrpBasisUnit}
                      onChange={(e) => handleBasisChange('mrpBasisUnit', e.target.value)}
                      list={unitIndex ? 'edit-product-unit-options' : undefined}
                      className={inputBase}
                    />
                    {(basisErrors.mrpBasisUnit || liveBasisCheck.mrpBasisUnitError) && (
                      <p className="mt-1 text-xs font-bold text-[#B93838]">
                        {basisErrors.mrpBasisUnit || liveBasisCheck.mrpBasisUnitError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {requiresBasisConfirmation && (
            <div
              data-testid="unit-change-warning"
              className={`rounded-lg border p-3 text-xs space-y-2 ${
                hasCompatibilityBlockingError
                  ? 'bg-[#FDF2F2] border-[#B93838]/30 text-[#B93838]'
                  : 'bg-[#FEF9EB] border-[#A66A16]/30 text-[#7C4D0E]'
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-bold">
                    {unitTransition?.noticeTitle || 'Pricing basis updated'}
                  </p>
                  <p className="leading-relaxed">
                    {unitTransition?.noticeMessage ||
                      'Changing the inventory unit or pricing basis affects how purchase price, selling price, and MRP are calculated. Confirm the pricing basis before saving.'}
                  </p>
                </div>
              </div>

              {!hasCompatibilityBlockingError && liveBasisCheck.isValid && (
                <label className="flex items-start gap-2 pt-1 font-semibold text-[#202923] cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="confirm-pricing-basis"
                    checked={basisConfirmed}
                    onChange={(e) => {
                      setBasisConfirmed(e.target.checked);
                      if (e.target.checked) setSubmitError(null);
                    }}
                    className="mt-0.5 rounded border-[#A66A16] text-[#234B3A] focus:ring-[#234B3A]"
                  />
                  <span>
                    I confirm the selling price (₹{values.sellingPrice || '0'}) applies per {basis.priceBasisQuantity || '1'}{' '}
                    {basis.priceBasisUnit || values.unit}.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E3E5DE] mt-5">
            <Button type="button" variant="outline" onClick={requestClose} disabled={isSubmitting} className="rounded-lg min-h-[42px] px-4 font-bold border-[#E3E5DE] text-[#202923] hover:bg-[#F7F5EF]">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={isSubmitting || (requiresBasisConfirmation && (hasCompatibilityBlockingError || !liveBasisCheck.isValid || !basisConfirmed))}
              icon={<Save className="w-4 h-4" />}
              className="rounded-lg font-bold min-h-[42px] px-5"
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
