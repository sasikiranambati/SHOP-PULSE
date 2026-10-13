import React from 'react';
import { AlertCircle } from 'lucide-react';
import { PRODUCT_CATEGORIES } from '../data/mockData';
import { useLanguage } from '../i18n/LanguageContext';
import type { ProductFormField, ProductFormValues } from '../utils/validators';

interface ProductFormFieldsProps {
  idPrefix: string;
  mode: 'add' | 'edit';
  values: ProductFormValues;
  errors: Partial<Record<ProductFormField, string>>;
  disabled?: boolean;
  onChange: (field: ProductFormField, value: string) => void;
}

const inputBase =
  'w-full rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium disabled:bg-slate-100 disabled:cursor-not-allowed';
const labelBase = 'block text-xs font-bold uppercase text-slate-600 mb-1';

/** Shared, labelled inputs for the add and edit product forms, with a message under each invalid field. */
export const ProductFormFields: React.FC<ProductFormFieldsProps> = ({
  idPrefix,
  mode,
  values,
  errors,
  disabled = false,
  onChange,
}) => {
  const { t } = useLanguage();
  const id = (field: ProductFormField) => `${idPrefix}-${field}`;
  const errorId = (field: ProductFormField) => `${idPrefix}-${field}-error`;

  const fieldProps = (field: ProductFormField) => ({
    id: id(field),
    value: values[field],
    disabled,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(field, e.target.value),
  });

  const fieldError = (field: ProductFormField) =>
    errors[field] ? (
      <p id={errorId(field)} className="mt-1 text-xs font-bold text-rose-700 flex items-start gap-1">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span>{errors[field]}</span>
      </p>
    ) : null;

  return (
    <>
      <div>
        <label htmlFor={id('name')} className={labelBase}>
          {mode === 'add' ? t('addProductModal.productName') : 'Product Name *'}
        </label>
        <input
          type="text"
          required
          autoComplete="off"
          placeholder={mode === 'add' ? t('addProductModal.namePlaceholder') : undefined}
          className={`${inputBase} px-3.5 py-2.5 text-sm sm:text-base`}
          {...fieldProps('name')}
        />
        {fieldError('name')}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('category')} className={labelBase}>
            {t('addProductModal.category')}
          </label>
          <select className={`${inputBase} px-3 py-2.5 text-sm sm:text-base bg-white`} {...fieldProps('category')}>
            {PRODUCT_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
            {values.category && !PRODUCT_CATEGORIES.includes(values.category) && (
              <option value={values.category}>{values.category}</option>
            )}
          </select>
        </div>

        <div>
          <label htmlFor={id('sellingPrice')} className={labelBase}>
            Selling Price (₹) *
          </label>
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder={mode === 'add' ? '28' : undefined}
            className={`${inputBase} px-3.5 py-2.5 text-sm sm:text-base`}
            {...fieldProps('sellingPrice')}
          />
          {fieldError('sellingPrice')}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('purchasePrice')} className={labelBase}>
            Purchase Price (₹)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder={mode === 'add' ? 'Optional' : 'Not set'}
            className={`${inputBase} px-3.5 py-2.5 text-sm sm:text-base`}
            {...fieldProps('purchasePrice')}
          />
          {fieldError('purchasePrice')}
        </div>

        <div>
          <label htmlFor={id('barcode')} className={labelBase}>
            Barcode / SKU
          </label>
          <input
            type="text"
            autoComplete="off"
            placeholder="Optional (e.g. 8901030...)"
            className={`${inputBase} px-3.5 py-2.5 text-sm sm:text-base`}
            {...fieldProps('barcode')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xs:grid-cols-3 gap-2.5 sm:gap-3">
        <div>
          <label htmlFor={id('stock')} className={`${labelBase} text-[11px] sm:text-xs`}>
            {mode === 'add' ? t('addProductModal.initialStock') : 'Stock *'}
          </label>
          <input
            type="number"
            required
            min="0"
            step="1"
            inputMode="numeric"
            placeholder={mode === 'add' ? '50' : undefined}
            className={`${inputBase} px-3 py-2.5 text-base sm:text-sm`}
            {...fieldProps('stock')}
          />
          {fieldError('stock')}
        </div>

        <div>
          <label htmlFor={id('minStock')} className={`${labelBase} text-[11px] sm:text-xs`}>
            {t('addProductModal.minStockAlert')}
          </label>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="10"
            className={`${inputBase} px-3 py-2.5 text-base sm:text-sm`}
            {...fieldProps('minStock')}
          />
          {fieldError('minStock')}
        </div>

        <div>
          <label htmlFor={id('unit')} className={`${labelBase} text-[11px] sm:text-xs`}>
            {t('addProductModal.unit')}
          </label>
          <input
            type="text"
            placeholder="pkts / kg"
            className={`${inputBase} px-3 py-2.5 text-base sm:text-sm`}
            {...fieldProps('unit')}
          />
        </div>
      </div>
    </>
  );
};
