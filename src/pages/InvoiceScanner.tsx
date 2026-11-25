import React, { useState, useRef, useCallback } from 'react';
import { 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  ArrowRight, 
  Download, 
  RotateCcw, 
  Trash2, 
  Plus, 
  Layers,
  Check,
  X,
  Camera,
  FileText,
  Scale,
  Settings2,
} from 'lucide-react';
import { detectIsLooseProduct, detectDefaultBasisUnit } from '../utils/looseProductPricing';
import { getAccessToken } from '../api/client';
import { documentPrepApi, type PhotoAssessment, type PrepExtractResult } from '../api/documentPrep';
import {
  applyLineEdit,
  calculatedFieldLabels,
  componentSummary,
  formatMoney,
  fractionalQuantityNotice,
  hasFractionalQuantity,
  hasFreeUnits,
  isCalculated,
  isPhotoFile,
  photoWarning,
  promoBreakdown,
  promoPayload,
  quantityProblem,
  reconciliationNotice,
  round3,
  unitBlockNotice,
  unitProblem,
  unitProblemText,
  type PhotoWarning,
  type TotalReconciliation,
} from '../utils/invoiceReliability';
import { DocumentPrepWorkflow } from '../components/invoice-capture/DocumentPrepWorkflow';
import { newProductsWithoutSellingPrice, packDisplay, packPayload, priceBasisFor, sellingPricePayload } from '../utils/invoicePack';
import { useUnitRegistry } from '../hooks/useUnitRegistry';
import {
  META_LABELS,
  confirmHeaderPayload,
  invoiceDateError,
  missingInvoiceDetails,
  normalizeInvoiceMetadata,
  type InvoiceMetaField,
  type InvoiceMetadata,
} from '../utils/invoiceMetadata';

export interface ExtractedItem {
  id: string;
  product_name: string;
  category?: string;
  quantity: number | null;
  unit: string;
  purchase_price: number | null;
  selling_price?: number | null;
  mrp: number | null;
  amount: number | null;
  confidence: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  needs_review: boolean;
  validation_issues?: string[];
  /** Possible corrections from the extraction (never applied automatically). */
  suggestions?: string[];
  suggested_rate?: number | null;
  /** Possible reading of a quantity whose decimal point was lost (never applied automatically). */
  suggested_quantity?: number | null;
  matched_product_id?: string | null;
  matched_product_name?: string | null;
  /** Fields calculated rather than read from the invoice (always reviewed). */
  derived_fields?: string[];
  /** Printed free / promotional line (rate 0.00), kept with its quantity. */
  is_free_item?: boolean;
  free_quantity?: number | null;
  paid_quantity?: number | null;
  /** Quantity as extracted, kept so a fractional reading (2.5 kg) stays visible while it is corrected. */
  extracted_quantity?: number | null;
  taxable_amount?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
  scheme_discount?: number | null;
  other_discount?: number | null;
  /** Product selling type: standard packaged unit vs loose/variable weight product */
  selling_type?: 'packaged' | 'loose';
  /** Reference quantity for selling price (e.g. 1 kg, 500 g, 100 g) */
  price_basis_quantity?: number | null;
  /** Canonical unit for selling price (e.g. kg, g, L, ml) */
  price_basis_unit?: string | null;
  /** Reference quantity for MRP */
  mrp_basis_quantity?: number | null;
  /** Canonical unit for MRP */
  mrp_basis_unit?: string | null;
  /** Physical inventory stock tracking unit (e.g. kg, L) */
  inventory_unit?: string | null;
  /** Conversion factor from invoice unit to inventory unit (e.g. 1 bag = 50 kg) */
  conversion_factor?: number | null;
  /** Pack size printed on the invoice: content of ONE purchase unit (e.g. 25 kg per bag). */
  pack_size?: number | null;
  pack_size_unit?: string | null;
  /** Purchase quantity x pack size (from the backend registry / pricing engine, e.g. 50 kg). */
  physical_quantity?: number | null;
  standard_unit?: string | null;
  /** Purchase cost per standard unit (e.g. Rs 94 per kg); never a selling price. */
  cost_per_standard_unit?: number | null;
  rate_basis_unit?: string | null;
  pack_conversion?: string | null;
  /** New products with a pack size: stock in purchase units (bags) or the physical unit (kg / L). */
  stock_mode?: 'purchase' | 'physical';
  /** Set when the reviewer typed a selling price; only then is it sent. */
  selling_price_edited?: boolean;
}

export interface ExtractedInvoice {
  id: string;
  /** Empty when not detected on the invoice; never filled with invented values. */
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  detected: InvoiceMetadata['detected'];
  total_amount: number;
  total_items: number;
  confidence_score: number;
  items: ExtractedItem[];
  excel_url?: string;
  /** Promotional bundle headings printed on the invoice (informational, never stock lines). */
  bundle_notes?: { text: string; quantity_text?: string | null }[];
  /** Line amounts vs the printed grand total (warning only). */
  total_reconciliation?: TotalReconciliation | null;
}

export const InvoiceScanner: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStage, setProgressStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedInvoice | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [confirmedProducts, setConfirmedProducts] = useState<any[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  // 'camera': capture/prepare photos first (recommended); 'file': send a file straight to OCR
  const [inputMode, setInputMode] = useState<'camera' | 'file'>('camera');
  const [preparation, setPreparation] = useState<PrepExtractResult['preparation'] | null>(null);
  const [workflowKey, setWorkflowKey] = useState(0);
  // Header details still empty when the user pressed Confirm (they must acknowledge them once)
  const [missingAtConfirm, setMissingAtConfirm] = useState<InvoiceMetaField[]>([]);
  // Quality warning for a photo sent straight to OCR (the camera flow shows its own)
  const [directPhotoWarning, setDirectPhotoWarning] = useState<PhotoWarning | null>(null);
  // Lines with free / promotional units awaiting the user's confirmation before stock is posted
  const [freeUnitsToConfirm, setFreeUnitsToConfirm] = useState<string[]>([]);
  // Confirm was blocked because a selected line's quantity does not suit its unit (never rounded)
  const [fractionalBlocked, setFractionalBlocked] = useState(false);
  // Confirm was blocked because a selected line's unit is missing or not registered (never assumed)
  const [unitBlocked, setUnitBlocked] = useState(false);
  // Canonical unit registry (GET /api/v1/units): the only source of units and fraction rules
  const { index: unitIndex, status: unitStatus } = useUnitRegistry();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelected = (selectedFile: File) => {
    setError(null);
    setConfirmSuccess(null);
    setExtractedData(null);

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(jpg|jpeg|png|webp|pdf)$/i)) {
      setError('Please select a valid image (JPG, PNG, WEBP) or PDF invoice.');
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('File size exceeds 20MB limit.');
      return;
    }

    setFile(selectedFile);
    if (selectedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(selectedFile);
      setFilePreview(url);
    } else {
      setFilePreview(null);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  /** Shared by direct uploads and prepared scans: both return the /invoices/extract body. */
  const applyExtraction = (data: any) => {
    const normalizedItems: ExtractedItem[] = (data.items || []).map((item: any, idx: number) => {
      const pName = item.product_name || item.raw_description || 'Grocery Item';
      const rawUnit = typeof item.unit === 'string' ? item.unit.trim() : '';
      const isLoose = detectIsLooseProduct(pName, rawUnit);
      const defaultBasisUnit = detectDefaultBasisUnit(rawUnit, isLoose);

      return {
        id: item.id || `item_${idx}_${Date.now()}`,
        product_name: pName,
        category: item.category || 'Grocery',
        quantity: typeof item.quantity === 'number' ? item.quantity : null,
        // As extracted; a missing unit stays empty for the user to select (never defaulted to pcs)
        unit: rawUnit,
        purchase_price: typeof item.purchase_price === 'number' ? item.purchase_price : (item.rate ?? null),
        selling_price: typeof item.selling_price === 'number' ? item.selling_price : null,
        mrp: typeof item.mrp === 'number' ? item.mrp : null,
        amount: typeof item.amount === 'number' ? item.amount : (item.line_total ?? null),
        confidence: item.confidence ?? 85,
        confidence_level: item.confidence_level || (item.confidence >= 80 ? 'HIGH' : item.confidence >= 60 ? 'MEDIUM' : 'LOW'),
        needs_review: item.needs_review ?? false,
        validation_issues: item.validation_issues || [],
        suggestions: item.suggestions || [],
        suggested_rate: typeof item.suggested_rate === 'number' ? item.suggested_rate : null,
        suggested_quantity: typeof item.suggested_quantity === 'number' ? item.suggested_quantity : null,
        matched_product_id: item.matched_product_id || null,
        matched_product_name: item.matched_product_name || null,
        derived_fields: Array.isArray(item.derived_fields) ? item.derived_fields : [],
        is_free_item: Boolean(item.is_free_item),
        free_quantity: typeof item.free_quantity === 'number' ? item.free_quantity : null,
        paid_quantity: typeof item.paid_quantity === 'number' ? item.paid_quantity : null,
        extracted_quantity: typeof item.quantity === 'number' ? item.quantity : null,
        taxable_amount: typeof item.taxable_amount === 'number' ? item.taxable_amount : null,
        cgst_amount: typeof item.cgst_amount === 'number' ? item.cgst_amount : null,
        sgst_amount: typeof item.sgst_amount === 'number' ? item.sgst_amount : null,
        igst_amount: typeof item.igst_amount === 'number' ? item.igst_amount : null,
        scheme_discount: typeof item.scheme_discount === 'number' ? item.scheme_discount : null,
        other_discount: typeof item.other_discount === 'number' ? item.other_discount : null,
        selling_type: isLoose ? 'loose' : 'packaged',
        price_basis_quantity: 1,
        price_basis_unit: defaultBasisUnit,
        mrp_basis_quantity: 1,
        mrp_basis_unit: defaultBasisUnit,
        inventory_unit: defaultBasisUnit,
        conversion_factor: 1,
        pack_size: typeof item.pack_size === 'number' ? item.pack_size : null,
        pack_size_unit: item.pack_size_unit || null,
        physical_quantity: typeof item.physical_quantity === 'number' ? item.physical_quantity : null,
        standard_unit: item.standard_unit || null,
        cost_per_standard_unit: typeof item.cost_per_standard_unit === 'number' ? item.cost_per_standard_unit : null,
        rate_basis_unit: item.rate_basis_unit || null,
        pack_conversion: item.pack_conversion || null,
        stock_mode: 'purchase',
        selling_price_edited: false,
      };
    });

    setMissingAtConfirm([]);
    setFreeUnitsToConfirm([]);
    setFractionalBlocked(false);
    setUnitBlocked(false);
    setExtractedData({
      id: data.id,
      // Only what OCR found; missing details stay empty for the user to fill in
      ...normalizeInvoiceMetadata(data),
      total_amount: data.total_amount || 0,
      total_items: normalizedItems.length,
      confidence_score: data.confidence_score || 90,
      items: normalizedItems,
      excel_url: data.excel_url || `/api/v1/invoices/${data.id}/excel`,
      bundle_notes: Array.isArray(data.bundle_notes) ? data.bundle_notes : [],
      total_reconciliation: data.total_reconciliation ?? null,
    });
    setSelectedItemIds(new Set(normalizedItems.map((i) => i.id)));
    setConfirmedProducts([]);
  };

  const startExtraction = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setProgressStage('Preparing invoice document for intelligence pipeline...');

    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const formData = new FormData();
    formData.append('file', file);

    // A photo sent straight to OCR gets the same quality check as the camera flow (in parallel;
    // a failed check never blocks the extraction)
    setDirectPhotoWarning(null);
    const assessment: Promise<PhotoAssessment | null> = isPhotoFile(file)
      ? documentPrepApi.assess(file, file.name).catch(() => null)
      : Promise.resolve(null);

    try {
      setProgressStage('Reading the invoice: preprocessing, OCR and table reconstruction...');
      const response = await fetch('/api/v1/invoices/extract', {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        let errMessage = 'Failed to extract invoice data.';
        try {
          const errBody = await response.json();
          errMessage = errBody.detail || errMessage;
        } catch {
          // ignore json parse error
        }
        throw new Error(errMessage);
      }

      setProgressStage('Validating price hierarchy & mathematical consistency...');
      const data = await response.json();
      applyExtraction(data);
      setPreparation(null);
      setDirectPhotoWarning(photoWarning(await assessment));
    } catch (err: any) {
      console.error('Invoice scanning error:', err);
      setError(err.message || 'Invoice extraction failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setProgressStage('');
    }
  };

  const handleUpdateItem = (id: string, field: keyof ExtractedItem, value: any) => {
    if (!extractedData) return;
    setExtractedData((prev) => {
      if (!prev) return null;
      const updatedItems = prev.items.map((item) => {
        if (item.id === id) {
          // Recalculates the amount from the paid units when qty or rate changes (free units stay as printed)
          const edited = applyLineEdit(item, field, value);
          return field === 'selling_price' ? { ...edited, selling_price_edited: true } : edited;
        }
        return item;
      });
      const newTotal = updatedItems.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      return {
        ...prev,
        items: updatedItems,
        total_amount: round3(newTotal),
      };
    });
  };

  const handleDeleteItem = (id: string) => {
    if (!extractedData) return;
    setExtractedData((prev) => {
      if (!prev) return null;
      const updatedItems = prev.items.filter((i) => i.id !== id);
      const newTotal = updatedItems.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      return {
        ...prev,
        items: updatedItems,
        total_items: updatedItems.length,
        total_amount: round3(newTotal),
      };
    });
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleAddItem = () => {
    if (!extractedData) return;
    // A manual line starts empty: every value is typed by the reviewer (nothing is invented) and the
    // usual checks (name, quantity, rate, registered unit, selling price for a new product) apply.
    const newItem: ExtractedItem = {
      id: `manual_${Date.now()}`,
      product_name: '',
      category: 'Groceries',
      quantity: null,
      unit: '',
      purchase_price: null,
      selling_price: null,
      mrp: null,
      amount: null,
      confidence: 0,
      confidence_level: 'LOW',
      needs_review: true,
      validation_issues: ['Added manually: enter the values printed on the invoice.'],
      selling_type: 'packaged',
      price_basis_quantity: 1,
      price_basis_unit: null,
      mrp_basis_quantity: 1,
      mrp_basis_unit: null,
      inventory_unit: null,
      conversion_factor: 1,
      stock_mode: 'purchase',
      selling_price_edited: false,
    };
    setExtractedData((prev) => {
      if (!prev) return null;
      const updatedItems = [...prev.items, newItem];
      return {
        ...prev,
        items: updatedItems,
        total_items: updatedItems.length,
        total_amount: prev.total_amount + 100,
      };
    });
    setSelectedItemIds((prev) => new Set([...prev, newItem.id]));
  };

  const handleToggleSelect = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (!extractedData) return;
    if (selectedItemIds.size === extractedData.items.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(extractedData.items.map((i) => i.id)));
    }
  };

  const handleMetaChange = (field: InvoiceMetaField, value: string) => {
    setMissingAtConfirm([]);
    setExtractedData((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleConfirmToInventory = async (acceptMissingDetails = false, acceptFreeUnits = false) => {
    if (!extractedData || extractedData.items.length === 0) return;
    const selectedItems = extractedData.items.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) {
      setError('Please select at least one item to confirm into inventory.');
      return;
    }

    // Comprehensive validation before submitting to backend
    const invalidItems = selectedItems.filter((i) => {
      const hasName = Boolean(i.product_name && i.product_name.trim());
      const hasValidQty = typeof i.quantity === 'number' && i.quantity > 0;
      // A printed free item keeps its printed rate of 0.00 (never discarded for being free)
      const hasValidPrice = typeof i.purchase_price === 'number' && (i.purchase_price > 0 || (Boolean(i.is_free_item) && i.purchase_price === 0));
      return !hasName || !hasValidQty || !hasValidPrice;
    });

    if (invalidItems.length > 0) {
      setError(
        `Cannot confirm: ${invalidItems.length} selected item(s) have missing required fields (Product Name, Quantity > 0, or Purchase Rate > 0). Please correct or deselect them.`
      );
      return;
    }

    // New products need a selling price from the reviewer: purchase cost and MRP are never used instead
    const newWithoutPrice = newProductsWithoutSellingPrice(selectedItems);
    if (newWithoutPrice.length > 0) {
      setError(
        `Cannot confirm: enter a selling price for ${newWithoutPrice.length} new product(s) (` +
        newWithoutPrice.map((i) => `'${i.product_name}'`).join(', ') +
        `). Purchase cost and MRP are not used as a selling price.`
      );
      return;
    }

    // A new loose product needs its selling price per standard unit; an existing product keeps its own
    const looseWithoutPrice = selectedItems.filter(
      (i) => i.selling_type === 'loose' && !i.matched_product_id && (typeof i.selling_price !== 'number' || i.selling_price <= 0)
    );
    if (looseWithoutPrice.length > 0) {
      setError(
        `Cannot confirm: ${looseWithoutPrice.length} loose product(s) (` +
        looseWithoutPrice.map((i) => `'${i.product_name}'`).join(', ') +
        `) require a selling price per standard unit before saving to inventory. Please configure their selling price.`
      );
      return;
    }

    // Every line needs a registered unit (a missing one is never assumed), and fractions are accepted only
    // for units the registry marks as fractional (kg, g, L, ml). Nothing is rounded and nothing is posted
    // for the invoice until the user corrects or deselects the line.
    const unitIssue = unitBlockNotice(selectedItems, unitIndex) !== null;
    const quantityIssue = selectedItems.some((i) => quantityProblem(i, unitIndex) !== null);
    if (unitIssue || quantityIssue) {
      setMissingAtConfirm([]);
      setFreeUnitsToConfirm([]);
      setUnitBlocked(unitIssue);
      setFractionalBlocked(quantityIssue);
      return;
    }
    setUnitBlocked(false);
    setFractionalBlocked(false);

    const dateProblem = invoiceDateError(extractedData.invoice_date);
    if (dateProblem) {
      setError(`Invoice date: ${dateProblem}`);
      return;
    }
    const missing = missingInvoiceDetails(extractedData);
    if (missing.length > 0 && !acceptMissingDetails) {
      // Not blocking: the user can fill them in, or confirm that the invoice does not show them
      setMissingAtConfirm(missing);
      return;
    }
    setMissingAtConfirm([]);
    const freeLines = selectedItems.filter((i) => hasFreeUnits(i));
    if (freeLines.length > 0 && !acceptFreeUnits) {
      // Free units are posted only after the user confirms them explicitly
      setFreeUnitsToConfirm(freeLines.map((i) => `${i.product_name}: ${promoBreakdown(i) ?? `${i.quantity} units`}`));
      return;
    }
    setFreeUnitsToConfirm([]);

    setIsConfirming(true);
    setError(null);
    setConfirmSuccess(null);

    try {
      const token = getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const payload = {
        // Empty header details are left out (stored as unknown), never replaced
        ...confirmHeaderPayload(extractedData),
        ...(freeLines.length > 0 ? { confirm_free_units: true } : {}),
        items: selectedItems.map((i) => {
          const purchasePrice = Number(i.purchase_price);
          const isLoose = i.selling_type === 'loose';
          const storageUnit = (isLoose && i.inventory_unit ? i.inventory_unit : i.unit).trim();


          // The basis must suit the line's unit (the API reads it as the purchase-rate basis)
          const basis = priceBasisFor(i, Number(i.price_basis_quantity || 1.0), (i.price_basis_unit || storageUnit).trim(), unitIndex);
          const basisQty = basis.quantity;
          const basisUnit = basis.unit;
          const mrpBasis = priceBasisFor(i, Number(i.mrp_basis_quantity || basisQty), (i.mrp_basis_unit || basisUnit).trim(), unitIndex);
          const mrpBasisQty = mrpBasis.quantity;
          const mrpBasisUnit = mrpBasis.unit;

          return {
            name: i.product_name.trim(),
            product_name: i.product_name.trim(),
            category: i.category || 'Groceries',
            // Checked against the unit above; sent as entered, never rounded or truncated
            quantity: Number(i.quantity),
            // A registered unit (checked above), as printed or as selected by the user
            unit: i.unit.trim(),
            purchase_price: purchasePrice,
            // Only a selling price the reviewer entered (or printed for a new product) is sent
            ...sellingPricePayload(i),
            mrp: typeof i.mrp === 'number' && i.mrp > 0 ? i.mrp : undefined,
            mrp_source: typeof i.mrp === 'number' && i.mrp > 0 ? 'INVOICE' : undefined,
            // Printed amount as printed; otherwise paid units x rate kept to 3 decimals (never paise)
            line_amount:
              typeof i.amount === 'number' && (i.amount > 0 || i.is_free_item)
                ? i.amount
                : round3(purchasePrice * Number(promoPayload(i).paid_quantity ?? i.quantity)),
            matched_product_id: i.matched_product_id || undefined,
            price_basis_quantity: basisQty,
            price_basis_unit: basisUnit,
            mrp_basis_quantity: mrpBasisQty,
            mrp_basis_unit: mrpBasisUnit,
            // Printed pack size: the backend converts stock and cost through its unit registry
            ...packPayload(i, unitIndex),
            ...promoPayload(i),
          };
        }),
      };

      const res = await fetch('/api/v1/invoices/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = 'Failed to confirm stock updates.';
        try {
          const b = await res.json();
          msg = b.detail || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const resData = await res.json();
      const restocked = resData.items_restocked ?? 0;
      const created = resData.items_created ?? 0;
      const totalUnits = resData.total_units ?? 0;
      const totalAmt = resData.total_amount ?? 0;

      setConfirmSuccess(
        `Successfully confirmed ${selectedItems.length} items to your shelves (${restocked} restocked, ${created} newly created)! Total: ${formatMoney(totalAmt)} (${totalUnits} units).`
      );

      if (Array.isArray(resData.saved_products)) {
        setConfirmedProducts(resData.saved_products);
      }

      // Trigger global inventory change notification so other views sync
      window.dispatchEvent(new CustomEvent('shelfora_inventory_changed'));
      window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
    } catch (err: any) {
      console.error('Invoice confirmation failed:', err);
      setError(err.message || 'Failed to update inventory.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handlePreparedExtraction = (result: PrepExtractResult) => {
    setError(null);
    setConfirmSuccess(null);
    applyExtraction(result.extraction);
    setPreparation(result.preparation);
    setDirectPhotoWarning(null);
  };

  const [isRetryingOriginal, setIsRetryingOriginal] = useState(false);
  const retryWithOriginalPhotos = async () => {
    if (!preparation) return;
    setIsRetryingOriginal(true);
    setError(null);
    try {
      handlePreparedExtraction(await documentPrepApi.extract(preparation.session_id, 'original'));
    } catch (err: any) {
      setError(err?.message || 'Reading the original photos failed.');
    } finally {
      setIsRetryingOriginal(false);
    }
  };

  const resetAll = () => {
    setPreparation(null);
    setWorkflowKey((k) => k + 1);
    setFile(null);
    setFilePreview(null);
    setExtractedData(null);
    setSelectedItemIds(new Set());
    setConfirmedProducts([]);
    setError(null);
    setConfirmSuccess(null);
    setMissingAtConfirm([]);
    setFreeUnitsToConfirm([]);
    setFractionalBlocked(false);
    setUnitBlocked(false);
  };

  const metaField = (field: InvoiceMetaField, placeholder: string, extraError?: string | null) => {
    const value = extractedData ? extractedData[field] : '';
    const notDetected = extractedData ? !extractedData.detected[field] : false;
    const flagged = missingAtConfirm.includes(field) && !value.trim();
    return (
      <div className="min-w-0">
        <input
          type="text"
          value={value}
          onChange={(e) => handleMetaChange(field, e.target.value)}
          placeholder={placeholder}
          aria-label={META_LABELS[field]}
          aria-invalid={Boolean(extraError) || undefined}
          className={`w-full px-2 py-1 rounded-md border text-sm font-bold focus:outline-none focus:border-[#153D32] focus:bg-white ${
            extraError || flagged
              ? 'border-[#EF806D] bg-[#FDF1EF] text-[#B4483A]'
              : notDetected && !value
              ? 'border-dashed border-[#D6AE62] bg-[#FBF4E7]/60 text-[#153D32]'
              : 'border-transparent hover:border-[#DDE9DF] text-[#153D32]'
          }`}
        />
        {extraError ? (
          <span className="text-[10px] text-[#B4483A] font-semibold block px-2 mt-0.5">{extraError}</span>
        ) : notDetected && !value ? (
          <span className="text-[10px] text-[#8A6420] font-medium block px-2 mt-0.5">Not detected – enter manually</span>
        ) : null}
      </div>
    );
  };

  // Shown after a blocked confirm while a selected line still has a quantity that does not suit its unit,
  // or a missing / unregistered unit; each disappears once the user corrects or deselects the line
  const selectedForNotice = extractedData ? extractedData.items.filter((i) => selectedItemIds.has(i.id)) : [];
  const fractionalNotice = fractionalBlocked ? fractionalQuantityNotice(selectedForNotice, unitIndex) : null;
  const unitNotice = !unitBlocked
    ? null
    : !unitIndex && unitStatus === 'loading'
    ? 'The unit list is still loading, so the units cannot be checked yet. Nothing has been added to stock. Try again in a moment.'
    : unitBlockNotice(selectedForNotice, unitIndex);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#DDE9DF] shadow-card">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#FAF8F2] border border-[#DDE9DF] flex items-center justify-center text-[#153D32]">
            <Layers className="w-6 h-6 text-[#23866A]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-[#153D32] tracking-tight">
                Invoice Intelligence Scanner
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#D6AE62]/20 text-[#A07828] border border-[#D6AE62]/40">
                Phase 2 Engine
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#5E6C64] mt-0.5">
              Upload supplier invoices to extract grocery line items, multi-tier prices, and update your shelves automatically.
            </p>
          </div>
        </div>

        {extractedData && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DDE9DF] bg-[#FAF8F2] hover:bg-[#F3EFE3] text-xs font-semibold text-[#252D29] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#5E6C64]" />
              Scan Another
            </button>
            <a
              href={`/api/v1/invoices/${extractedData.id}/excel`}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DDE9DF] bg-white hover:bg-[#FAF8F2] text-xs font-semibold text-[#153D32] transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-[#23866A]" />
              Export Excel
            </a>
          </div>
        )}
      </div>

      {/* Error or Success Alerts */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[#FDF1EF] border border-[#EF806D]/30 text-[#EF806D] text-xs sm:text-sm font-medium animate-in fade-in">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {confirmSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[#E7F6F1] border border-[#23866A]/30 text-[#23866A] text-xs sm:text-sm font-semibold animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="flex-1">{confirmSuccess}</span>
          <button type="button" onClick={() => setConfirmSuccess(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input mode: photograph / prepare pages, or send a file directly */}
      {!extractedData && (
        <div className="flex rounded-xl border border-[#DDE9DF] p-1 bg-white w-full sm:w-fit" role="tablist" aria-label="How to add the invoice">
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'camera'}
            onClick={() => setInputMode('camera')}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg text-sm font-semibold cursor-pointer ${
              inputMode === 'camera' ? 'bg-[#153D32] text-white' : 'text-[#5E6C64] hover:bg-[#FAF8F2]'
            }`}
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
            Scan photos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'file'}
            onClick={() => setInputMode('file')}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg text-sm font-semibold cursor-pointer ${
              inputMode === 'file' ? 'bg-[#153D32] text-white' : 'text-[#5E6C64] hover:bg-[#FAF8F2]'
            }`}
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            Upload PDF or file
          </button>
        </div>
      )}

      {!extractedData && inputMode === 'camera' && (
        <DocumentPrepWorkflow
          key={workflowKey}
          onExtracted={handlePreparedExtraction}
          onUseDirectUpload={() => setInputMode('file')}
        />
      )}

      {/* Upload Zone & Document Inspector (When no extracted data) */}
      {!extractedData && inputMode === 'file' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Upload Dropzone */}
          <div className="lg:col-span-8">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 bg-white ${
                isDragging
                  ? 'border-[#23866A] bg-[#E7F3EE]/50 scale-[0.99]'
                  : file
                  ? 'border-[#23866A] bg-[#FAF8F2]'
                  : 'border-[#DDE9DF] hover:border-[#23866A]/60 hover:bg-[#FAF8F2]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelected(e.target.files[0]);
                  }
                }}
              />

              <div className="max-w-md mx-auto flex flex-col items-center">
                <div className="w-16 h-16 rounded-2xl bg-[#E7F3EE] flex items-center justify-center text-[#153D32] mb-4 shadow-xs">
                  <Upload className="w-8 h-8 text-[#23866A]" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-[#153D32]">
                  {file ? file.name : 'Upload your paper invoice or PDF'}
                </h3>
                <p className="text-xs sm:text-sm text-[#5E6C64] mt-1 max-w-sm">
                  {file
                    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to analyze`
                    : 'Drag & drop image or PDF invoice here, or click to browse'}
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#FAF8F2] border border-[#DDE9DF] text-[#5E6C64]">
                    JPG / PNG / WEBP
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#FAF8F2] border border-[#DDE9DF] text-[#5E6C64]">
                    Multi-page PDF
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#FAF8F2] border border-[#DDE9DF] text-[#5E6C64]">
                    Max 20MB
                  </span>
                </div>

                {file && !isProcessing && (
                  <div className="mt-8 flex gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startExtraction();
                      }}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#153D32] hover:bg-[#0F2D25] text-white text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-[#D6AE62]" />
                      Extract Line Items
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        setFilePreview(null);
                      }}
                      className="px-4 py-2.5 rounded-xl border border-[#DDE9DF] bg-white hover:bg-[#FAF8F2] text-xs font-semibold text-[#5E6C64] cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                )}

                {/* Progress Animation State */}
                {isProcessing && (
                  <div className="mt-8 w-full max-w-sm bg-white p-4 rounded-xl border border-[#DDE9DF] shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-[#153D32] mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-[#23866A] border-t-transparent rounded-full animate-spin" />
                        <span>Processing with Shelfora Engine</span>
                      </div>
                      <span className="text-[#23866A]">Active</span>
                    </div>
                    <div className="w-full bg-[#FAF8F2] h-2 rounded-full overflow-hidden border border-[#DDE9DF]">
                      <div className="bg-[#23866A] h-full rounded-full animate-pulse w-3/4" />
                    </div>
                    <p className="text-[11px] text-[#5E6C64] text-left mt-2">
                      {progressStage}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Intelligence Capabilities Sidebar */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-[#DDE9DF] shadow-card">
              <h3 className="text-sm font-bold text-[#153D32] mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#D6AE62]" />
                Shelfora Extraction Features
              </h3>
              <ul className="space-y-3 text-xs text-[#5E6C64]">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#23866A] shrink-0 mt-0.5" />
                  <span><strong>Multi-Price Separation:</strong> Isolates Rate, Purchase Price, Selling Price, and MRP with spatial boundary verification.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#23866A] shrink-0 mt-0.5" />
                  <span><strong>OCR Error Repair:</strong> Corrects common digit and character noise (e.g. `I` → `1`, `O` → `0`) while preserving precision.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#23866A] shrink-0 mt-0.5" />
                  <span><strong>Mathematical Audit:</strong> Verifies Quantity × Rate = Line Total with Decimal precision.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#23866A] shrink-0 mt-0.5" />
                  <span><strong>Direct Inventory Restock:</strong> Updates existing stock and registers newly discovered grocery brands.</span>
                </li>
              </ul>
            </div>

            {/* Thumbnail Preview if Image Selected */}
            {filePreview && (
              <div className="bg-white p-4 rounded-2xl border border-[#DDE9DF] shadow-card">
                <p className="text-xs font-bold text-[#153D32] mb-2 flex items-center justify-between">
                  <span>Document Preview</span>
                  <span className="text-[10px] text-[#5E6C64] font-normal">Original upload</span>
                </p>
                <div className="max-h-56 overflow-hidden rounded-xl border border-[#DDE9DF] bg-[#FAF8F2] flex items-center justify-center">
                  <img src={filePreview} alt="Invoice preview" className="w-full object-contain max-h-56" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extracted Structured Results Grid */}
      {extractedData && (
        <div className="space-y-6">
          {preparation && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-white border border-[#DDE9DF] shadow-card">
              <Camera className="w-5 h-5 text-[#23866A] shrink-0" aria-hidden="true" />
              <p className="flex-1 text-xs sm:text-sm text-[#252D29]">
                {preparation.source === 'processed'
                  ? `Read from ${preparation.page_count} prepared page${preparation.page_count > 1 ? 's' : ''} (turned upright, straightened and cleaned). Original photos are kept.`
                  : `Read from the ${preparation.page_count} original photo${preparation.page_count > 1 ? 's' : ''} without corrections.`}
              </p>
              {preparation.source === 'processed' && (
                <button
                  type="button"
                  onClick={retryWithOriginalPhotos}
                  disabled={isRetryingOriginal}
                  className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl border border-[#DDE9DF] bg-[#FAF8F2] hover:bg-[#F3EFE3] text-xs font-semibold text-[#153D32] cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  {isRetryingOriginal ? 'Reading original photos…' : 'Results look wrong? Read the original photos'}
                </button>
              )}
            </div>
          )}
          {/* Invoice Summary Ribbon */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-[#DDE9DF] shadow-card">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#5E6C64] uppercase tracking-wider">Supplier</p>
              {metaField('supplier_name', 'Supplier name')}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#5E6C64] uppercase tracking-wider">Invoice # / Date</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {metaField('invoice_number', 'Invoice no.')}
                {metaField('invoice_date', 'DD/MM/YYYY', invoiceDateError(extractedData.invoice_date))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#5E6C64] uppercase tracking-wider">Line Items</p>
              <p className="text-sm font-bold text-[#153D32]">{extractedData.total_items} items</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#5E6C64] uppercase tracking-wider">Total Value</p>
              <p className="text-sm font-black text-[#23866A]">
                {formatMoney(extractedData.total_amount)}
              </p>
            </div>
          </div>

          {missingAtConfirm.length > 0 && (
            <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-[#FBF4E7] border border-[#D6AE62]/50 text-[#8A6420] text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                {missingAtConfirm.map((f) => META_LABELS[f]).join(', ')} not entered.
                {missingAtConfirm.includes('invoice_number')
                  ? ' Without an invoice number this invoice cannot be checked for duplicates.'
                  : ''}{' '}
                Enter {missingAtConfirm.length > 1 ? 'them' : 'it'} above, or add to stock if the invoice does not show {missingAtConfirm.length > 1 ? 'them' : 'it'}.
              </span>
              <button
                type="button"
                onClick={() => handleConfirmToInventory(true)}
                disabled={isConfirming}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#D6AE62]/60 bg-white hover:bg-[#FAF8F2] text-xs font-bold text-[#153D32] cursor-pointer disabled:opacity-50"
              >
                Add to stock without {missingAtConfirm.length > 1 ? 'them' : 'it'}
              </button>
            </div>
          )}

          {unitNotice && (
            <div role="alert" data-testid="unit-block" className="flex items-start gap-3 p-4 rounded-xl bg-[#FDF1EF] border border-[#EF806D]/50 text-[#9A3B2B] text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 break-words">{unitNotice}</span>
            </div>
          )}

          {fractionalNotice && (
            <div role="alert" data-testid="fractional-quantity-block" className="flex items-start gap-3 p-4 rounded-xl bg-[#FDF1EF] border border-[#EF806D]/50 text-[#9A3B2B] text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 break-words">{fractionalNotice}</span>
            </div>
          )}

          {freeUnitsToConfirm.length > 0 && (
            <div role="alert" data-testid="free-units-confirm" className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-[#E7F6F1] border border-[#23866A]/30 text-[#16704F] text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                Free / promotional units will be added to stock: {freeUnitsToConfirm.join('; ')}. The printed rate and
                amount are kept; no cost is spread over the free units. Please confirm.
              </span>
              <button
                type="button"
                onClick={() => handleConfirmToInventory(true, true)}
                disabled={isConfirming}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-[#23866A]/50 bg-white hover:bg-[#FAF8F2] text-xs font-bold text-[#153D32] cursor-pointer disabled:opacity-50"
              >
                Add to stock including free units
              </button>
            </div>
          )}

          {/* Interactive Itemized Table */}
          <div className="bg-white rounded-2xl border border-[#DDE9DF] shadow-card overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#DDE9DF] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF8F2]/60">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-[#153D32]">Extracted Grocery Line Items</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#E7F6F1] text-[#23866A] border border-[#23866A]/20">
                    {selectedItemIds.size} of {extractedData.items.length} selected
                  </span>
                </div>
                <p className="text-xs text-[#5E6C64] mt-0.5">
                  Select items to restock, verify prices, and edit fields before saving into your catalog.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DDE9DF] bg-white hover:bg-[#FAF8F2] text-xs font-semibold text-[#153D32] transition-colors cursor-pointer shadow-3xs"
                >
                  <Plus className="w-3.5 h-3.5 text-[#23866A]" />
                  Add Item
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmToInventory()}
                  disabled={isConfirming || selectedItemIds.size === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#153D32] hover:bg-[#0F2D25] text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#D6AE62]" />
                  {isConfirming
                    ? 'Updating Shelves...'
                    : `Confirm ${selectedItemIds.size} Items to Inventory`}
                </button>
              </div>
            </div>

            {directPhotoWarning && (
              <div
                role="alert"
                data-testid="direct-photo-warning"
                className="mx-4 mt-3 rounded-xl border border-[#E8C88A] bg-[#FBF4E7] px-4 py-3 text-xs text-[#8A6420]"
              >
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  {directPhotoWarning.title}
                </div>
                <ul className="mt-1 list-disc pl-6 space-y-0.5">
                  {directPhotoWarning.messages.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                {directPhotoWarning.retake && (
                  <button
                    type="button"
                    onClick={() => {
                      setExtractedData(null);
                      setDirectPhotoWarning(null);
                      setInputMode('camera');
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-lg border border-[#8A6420]/40 bg-white font-bold text-[#8A6420] cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Retake the photo
                  </button>
                )}
              </div>
            )}

            {(() => {
              const notice = reconciliationNotice(extractedData.total_reconciliation);
              if (!notice) return null;
              const tone = notice.tone === 'warn'
                ? 'border-[#E8C88A] bg-[#FBF4E7] text-[#8A6420]'
                : notice.tone === 'ok'
                ? 'border-[#23866A]/30 bg-[#E7F6F1] text-[#16704F]'
                : 'border-[#DDE9DF] bg-[#FAF8F2] text-[#5E6C64]';
              return (
                <div data-testid="total-reconciliation" role={notice.tone === 'warn' ? 'alert' : 'status'}
                     className={`mx-4 mt-3 rounded-xl border px-4 py-2 text-xs ${tone}`}>
                  <span className="font-bold">Invoice total check: </span>{notice.text}
                </div>
              );
            })()}

            {extractedData.bundle_notes && extractedData.bundle_notes.length > 0 && (
              <div data-testid="bundle-notes" className="mx-4 mt-3 rounded-xl border border-[#DDE9DF] bg-[#FAF8F2] px-4 py-2 text-[11px] text-[#5E6C64]">
                <span className="font-bold text-[#153D32]">Promotional bundles on this invoice (not stock lines): </span>
                {extractedData.bundle_notes.map((b) => `${b.text}${b.quantity_text ? ` (${b.quantity_text})` : ''}`).join('; ')}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DDE9DF] bg-[#FAF8F2] text-[#5E6C64] font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedItemIds.size > 0 && selectedItemIds.size === extractedData.items.length}
                        onChange={handleToggleSelectAll}
                        className="rounded border-[#DDE9DF] text-[#153D32] focus:ring-[#23866A] cursor-pointer"
                        title="Select/Deselect all"
                        aria-label="Select all items"
                      />
                    </th>
                    <th className="py-3 px-3 w-8">#</th>
                    <th className="py-3 px-4 min-w-[200px]">Product Name</th>
                    <th className="py-3 px-3 w-20">Qty</th>
                    <th className="py-3 px-3 w-16">Unit</th>
                    <th className="py-3 px-3 w-24">Invoice Rate</th>
                    <th className="py-3 px-3 w-24">Selling Price</th>
                    <th className="py-3 px-3 w-24">MRP</th>
                    <th className="py-3 px-3 w-24">Line Total</th>
                    <th className="py-3 px-3 text-center w-20">Confidence</th>
                    <th className="py-3 px-3 text-right w-12">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE9DF]">
                  {extractedData.items.map((item, idx) => {
                    const isSelected = selectedItemIds.has(item.id);
                    const isNameInvalid = !item.product_name || !item.product_name.trim();
                    const unitIssue = unitIndex ? unitProblem(item.unit, unitIndex) : null;
                    const canonicalUnit = unitIndex?.normalize(item.unit) ?? null;
                    const fractionAllowed = canonicalUnit ? unitIndex?.allowsFraction(canonicalUnit) === true : false;
                    const qtyProblem = quantityProblem(item, unitIndex);
                    const isQtyInvalid = item.quantity === null || item.quantity === undefined || item.quantity <= 0 || qtyProblem !== null;
                    const rowNeedsReview = item.needs_review || unitIssue !== null;
                    // A fractional reading stays visible once the user has changed the quantity
                    const extractedFractional =
                      typeof item.extracted_quantity === 'number' &&
                      hasFractionalQuantity({ quantity: item.extracted_quantity }) &&
                      item.quantity !== item.extracted_quantity;
                    const isPriceInvalid =
                      item.purchase_price === null ||
                      item.purchase_price === undefined ||
                      (item.purchase_price <= 0 && !(item.is_free_item && item.purchase_price === 0));

                    return (
                      <React.Fragment key={item.id}>
                        <tr 
                          className={`transition-colors ${
                            !isSelected
                              ? 'opacity-60 bg-gray-50/50'
                              : rowNeedsReview
                              ? 'bg-[#FBF4E7]/30 hover:bg-[#FBF4E7]/50'
                              : 'hover:bg-[#FAF8F2]/60'
                          }`}
                        >
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="rounded border-[#DDE9DF] text-[#153D32] focus:ring-[#23866A] cursor-pointer"
                            aria-label={`Select ${item.product_name}`}
                          />
                        </td>
                        <td className="py-3 px-3 text-[#5E6C64] font-medium">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <input
                            type="text"
                            aria-label={`Product name, row ${idx + 1}`}
                            placeholder="Product name"
                            value={item.product_name}
                            onChange={(e) => handleUpdateItem(item.id, 'product_name', e.target.value)}
                            className={`w-full px-2 py-1 rounded-md border text-xs font-semibold focus:outline-none ${
                              isNameInvalid
                                ? 'border-[#EF806D] bg-[#FDF1EF] text-[#EF806D]'
                                : 'border-transparent hover:border-[#DDE9DF] focus:border-[#153D32] focus:bg-white text-[#153D32]'
                            }`}
                          />
                          {isNameInvalid && (
                            <span className="text-[10px] text-[#EF806D] font-bold block px-2 mt-0.5">
                              Product name is required
                            </span>
                          )}
                          {item.matched_product_name && (
                            <span className="text-[10px] text-[#23866A] font-medium block px-2">
                              Matches: {item.matched_product_name}
                            </span>
                          )}
                          {/* Pack size -> physical quantity -> purchase cost per standard unit (kg / L) */}
                          {(() => {
                            const purchaseKind = unitIndex?.get(item.unit)?.kind;
                            if (!item.pack_size && purchaseKind !== 'package') return null;
                            const pd = packDisplay(item, unitIndex);
                            const measureUnits = (unitIndex?.units ?? []).filter((u) => u.kind === 'measure' && u.factor_to_base <= 1000);
                            return (
                              <div data-testid="pack-info" className="mt-1 mx-2 px-2 py-1.5 rounded-md bg-[#F2F7F4] border border-[#DDE9DF] text-[10px] text-[#3E4A43] space-y-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="font-bold text-[#153D32]">Pack size</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    aria-label={`Pack size for ${item.product_name}`}
                                    value={item.pack_size ?? ''}
                                    onChange={(e) => {
                                      const v = parseFloat(e.target.value);
                                      handleUpdateItem(item.id, 'pack_size', Number.isFinite(v) && v > 0 ? v : null);
                                    }}
                                    placeholder="per unit"
                                    className="w-16 px-1 py-0.5 rounded border border-[#DDE9DF] bg-white text-[10px] font-semibold"
                                  />
                                  <select
                                    aria-label={`Pack size unit for ${item.product_name}`}
                                    value={unitIndex?.normalize(item.pack_size_unit) ?? item.pack_size_unit ?? ''}
                                    onChange={(e) => handleUpdateItem(item.id, 'pack_size_unit', e.target.value || null)}
                                    className="px-1 py-0.5 rounded border border-[#DDE9DF] bg-white text-[10px]"
                                  >
                                    <option value="">unit</option>
                                    {measureUnits.map((u) => (
                                      <option key={u.id} value={u.id}>{u.id}</option>
                                    ))}
                                  </select>
                                  <span>{item.unit ? `per ${item.unit}` : 'per purchase unit (unit missing)'}</span>
                                </div>
                                {pd.physicalQuantity !== null && (
                                  <div data-testid="physical-quantity">
                                    Physical: {item.quantity} {item.unit} × {item.pack_size} {unitIndex?.normalize(item.pack_size_unit) ?? item.pack_size_unit} ={' '}
                                    <strong>{pd.physicalQuantity} {pd.standardUnit}</strong>
                                  </div>
                                )}
                                {pd.costPerStandardUnit !== null && (
                                  <div data-testid="cost-per-standard-unit">
                                    Purchase cost: <strong>{formatMoney(pd.costPerStandardUnit)} per {pd.standardUnit}</strong>
                                    <span className="text-[#5E6C64]"> (invoice rate ÷ pack size; not a selling price)</span>
                                  </div>
                                )}
                                {item.rate_basis_unit && unitIndex?.normalize(item.rate_basis_unit) !== unitIndex?.normalize(item.unit) && (
                                  <div className="text-[#8A6420] font-semibold">Rate is per {item.rate_basis_unit}, not per {item.unit}</div>
                                )}
                                {pd.convertible && !item.matched_product_id && pd.physicalQuantity !== null && (
                                  <div role="group" aria-label={`Stock ${item.product_name} as`} className="flex items-center gap-1">
                                    <span>Stock as:</span>
                                    {(['purchase', 'physical'] as const).map((mode) => (
                                      <button
                                        key={mode}
                                        type="button"
                                        aria-pressed={(item.stock_mode ?? 'purchase') === mode}
                                        onClick={() => handleUpdateItem(item.id, 'stock_mode', mode)}
                                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                                          (item.stock_mode ?? 'purchase') === mode
                                            ? 'bg-[#153D32] text-white border-[#153D32]'
                                            : 'bg-white text-[#153D32] border-[#DDE9DF]'
                                        }`}
                                      >
                                        {mode === 'purchase' ? `${item.quantity ?? ''} ${item.unit}` : `${pd.physicalQuantity} ${pd.standardUnit}`}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!item.pack_size && (
                                  <div className="text-[#8A6420]">No pack size printed: enter it to convert {item.unit} into kg / L stock.</div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Selling Type Selector & Loose Config Toggle */}
                          <div className="mt-1.5 px-2 flex flex-wrap items-center gap-1.5">
                            <div className="inline-flex rounded-lg border border-[#DDE9DF] p-0.5 bg-[#FAF8F2] text-[10px]">
                              <button
                                type="button"
                                onClick={() => handleUpdateItem(item.id, 'selling_type', 'packaged')}
                                className={`px-2 py-0.5 rounded-md font-semibold transition-all ${
                                  item.selling_type !== 'loose'
                                    ? 'bg-white text-[#153D32] shadow-sm'
                                    : 'text-[#5E6C64] hover:text-[#153D32]'
                                }`}
                              >
                                Packaged
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleUpdateItem(item.id, 'selling_type', 'loose');
                                  if (!item.price_basis_unit) {
                                    handleUpdateItem(item.id, 'price_basis_unit', item.unit?.toLowerCase().includes('l') ? 'L' : 'kg');
                                  }
                                  if (!item.inventory_unit) {
                                    handleUpdateItem(item.id, 'inventory_unit', item.unit?.toLowerCase().includes('l') ? 'L' : 'kg');
                                  }
                                }}
                                className={`px-2 py-0.5 rounded-md font-semibold transition-all ${
                                  item.selling_type === 'loose'
                                    ? 'bg-[#E7F6F1] text-[#16704F] shadow-sm font-bold'
                                    : 'text-[#5E6C64] hover:text-[#153D32]'
                                }`}
                              >
                                Loose
                              </button>
                            </div>
                            {item.selling_type === 'loose' && (
                              <button
                                type="button"
                                onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FAF8F2] hover:bg-[#F3EFE3] text-[10px] font-bold text-[#23866A] border border-[#DDE9DF] cursor-pointer"
                                title="Configure loose product standard selling unit & storage"
                              >
                                <Settings2 className="w-3 h-3" />
                                <span>{expandedItemId === item.id ? 'Hide Config' : 'Configure Loose'}</span>
                              </button>
                            )}
                          </div>
                          {(item.is_free_item || calculatedFieldLabels(item).length > 0) && (
                            <div className="mt-1 px-2 flex flex-wrap gap-1">
                              {item.is_free_item && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#E7F6F1] text-[#16704F]">
                                  Free item
                                </span>
                              )}
                              {calculatedFieldLabels(item).map((f) => (
                                <span key={f} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FBF4E7] text-[#8A6420]">
                                  {f} calculated, not read
                                </span>
                              ))}
                            </div>
                          )}
                          {componentSummary(item) && (
                            <span className="text-[10px] text-[#5E6C64] block px-2 mt-0.5">{componentSummary(item)}</span>
                          )}
                          {item.needs_review && (item.validation_issues?.length || item.suggestions?.length) ? (
                            <div className="mt-1 px-2 space-y-1">
                              {(item.validation_issues || []).slice(0, 2).map((issue) => (
                                <span key={issue} className="text-[10px] text-[#8A6420] block">
                                  {issue}
                                </span>
                              ))}
                              {(item.suggestions || []).map((sugg) => (
                                <span key={sugg} className="text-[10px] text-[#153D32] font-semibold block">
                                  {sugg}
                                </span>
                              ))}
                              {typeof item.suggested_rate === 'number' && item.suggested_rate !== item.purchase_price && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateItem(item.id, 'purchase_price', item.suggested_rate)}
                                  className="mt-0.5 inline-flex items-center px-2 py-1 rounded-md border border-[#23866A]/40 bg-[#E7F6F1] text-[10px] font-bold text-[#16704F] cursor-pointer"
                                >
                                  Use {formatMoney(item.suggested_rate)} as rate
                                </button>
                              )}
                              {typeof item.suggested_quantity === 'number' && item.suggested_quantity !== item.quantity && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateItem(item.id, 'quantity', item.suggested_quantity)}
                                  className="mt-0.5 ml-1 inline-flex items-center px-2 py-1 rounded-md border border-[#23866A]/40 bg-[#E7F6F1] text-[10px] font-bold text-[#16704F] cursor-pointer"
                                >
                                  Use {item.suggested_quantity} as quantity
                                </button>
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            step={fractionAllowed ? '0.001' : '1'}
                            min={fractionAllowed ? '0.001' : '1'}
                            aria-label={`Quantity for ${item.product_name}`}
                            value={item.quantity ?? ''}
                            onChange={(e) => handleUpdateItem(item.id, 'quantity', parseFloat(e.target.value) || null)}
                            className={`w-full px-2 py-1 rounded-md border text-xs font-semibold focus:outline-none ${
                              isQtyInvalid
                                ? 'border-[#EF806D] bg-[#FDF1EF] text-[#EF806D]'
                                : 'border-transparent hover:border-[#DDE9DF] focus:border-[#153D32] focus:bg-white text-[#252D29]'
                            }`}
                          />
                          {isQtyInvalid && (
                            <span className="text-[10px] text-[#EF806D] font-bold block px-1 mt-0.5">
                              {qtyProblem === 'whole_only'
                                ? 'Whole units only'
                                : qtyProblem === 'too_many_decimals'
                                ? `Max ${unitIndex?.maxFractionDigits ?? 3} decimals`
                                : 'Qty > 0'}
                            </span>
                          )}
                          {extractedFractional && (
                            <span data-testid="extracted-quantity" className="text-[10px] text-[#8A6420] font-semibold block px-1 mt-0.5">
                              Read as {item.extracted_quantity}{item.unit ? ` ${item.unit}` : ''}
                            </span>
                          )}
                          {isCalculated(item, 'quantity') && (
                            <span className="text-[10px] text-[#8A6420] font-semibold block px-1 mt-0.5">calculated</span>
                          )}
                          {promoBreakdown(item) && (
                            <span className="text-[10px] text-[#16704F] font-semibold block px-1 mt-0.5">{promoBreakdown(item)}</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {/* Registered units only (canonical registry); a missing or unknown unit must be selected */}
                          <select
                            value={canonicalUnit ?? (item.unit.trim() ? '__unregistered' : '')}
                            onChange={(e) => handleUpdateItem(item.id, 'unit', e.target.value)}
                            disabled={!unitIndex}
                            aria-label={`Unit for ${item.product_name}`}
                            aria-invalid={unitIssue !== null || undefined}
                            data-testid="unit-select"
                            className={`w-full min-w-[4.5rem] px-1.5 py-1 rounded-md border text-xs font-semibold focus:outline-none ${
                              unitIssue
                                ? 'border-[#EF806D] bg-[#FDF1EF] text-[#B4483A]'
                                : 'border-[#DDE9DF] bg-white focus:border-[#153D32] text-[#5E6C64]'
                            }`}
                          >
                            {!canonicalUnit && !item.unit.trim() && (
                              <option value="" disabled>
                                Select unit
                              </option>
                            )}
                            {!canonicalUnit && item.unit.trim() && (
                              <option value="__unregistered" disabled>
                                {item.unit.trim()} (not registered)
                              </option>
                            )}
                            {(unitIndex?.units ?? []).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.label}
                              </option>
                            ))}
                          </select>
                          {unitIssue && (
                            <span data-testid="unit-warning" role="status" className="text-[10px] text-[#B4483A] font-bold block px-1 mt-0.5">
                              Needs review: {unitProblemText(item.unit, unitIssue)}
                            </span>
                          )}
                          {!unitIndex && (
                            <span className="text-[10px] text-[#8A6420] font-semibold block px-1 mt-0.5">
                              {unitStatus === 'error' ? 'Unit list unavailable: reload to check units' : 'Loading units…'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1 text-[#5E6C64]">₹</span>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              aria-label={`Rate for ${item.product_name || `row ${idx + 1}`}`}
                              value={item.purchase_price ?? ''}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                handleUpdateItem(item.id, 'purchase_price', Number.isFinite(v) ? v : null);
                              }}
                              className={`w-full pl-5 pr-1 py-1 rounded-md border text-xs font-bold focus:outline-none ${
                                isPriceInvalid
                                  ? 'border-[#EF806D] bg-[#FDF1EF] text-[#EF806D]'
                                  : 'border-transparent hover:border-[#DDE9DF] focus:border-[#153D32] focus:bg-white text-[#153D32]'
                              }`}
                            />
                          </div>
                          {isPriceInvalid && (
                            <span className="text-[10px] text-[#EF806D] font-bold block px-1 mt-0.5">
                              Rate required
                            </span>
                          )}
                          {isCalculated(item, 'purchase_price') && (
                            <span className="text-[10px] text-[#8A6420] font-semibold block px-1 mt-0.5">calculated</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1 text-[#5E6C64]">₹</span>
                            <input
                              type="number"
                              step="0.001"
                              placeholder={item.matched_product_id ? 'Keep current' : 'Required'}
                              aria-label={`Selling price for ${item.product_name}`}
                              value={item.selling_price ?? ''}
                              onChange={(e) => handleUpdateItem(item.id, 'selling_price', parseFloat(e.target.value) || null)}
                              className={`w-full pl-5 pr-1 py-1 rounded-md border text-xs font-bold focus:outline-none ${
                                !item.matched_product_id && (!item.selling_price || item.selling_price <= 0)
                                  ? 'border-[#D6AE62] bg-[#FBF4E7] text-[#8A6420]'
                                  : 'border-transparent hover:border-[#DDE9DF] focus:border-[#153D32] focus:bg-white text-[#252D29]'
                              }`}
                            />
                          </div>
                          {item.selling_type === 'loose' ? (
                            <span className="text-[10px] font-semibold text-[#23866A] block px-1 mt-0.5">
                              per {item.price_basis_quantity || 1} {item.price_basis_unit || 'kg'}
                            </span>
                          ) : (
                            item.mrp && <span className="text-[10px] text-[#5E6C64] block px-1 mt-0.5">per {item.unit || 'pc'}</span>
                          )}
                          {!item.matched_product_id && (!item.selling_price || item.selling_price <= 0) && (
                            <span data-testid="selling-price-required" className="text-[10px] text-[#8A6420] font-bold block px-1 mt-0.5">
                              Price required
                            </span>
                          )}
                          {item.matched_product_id && !item.selling_price_edited && (
                            <span className="text-[10px] text-[#5E6C64] block px-1 mt-0.5">Current price kept</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1 text-[#5E6C64]">₹</span>
                            <input
                              type="number"
                              step="0.001"
                              aria-label={`MRP for ${item.product_name || `row ${idx + 1}`}`}
                              value={item.mrp ?? ''}
                              onChange={(e) => handleUpdateItem(item.id, 'mrp', parseFloat(e.target.value) || null)}
                              className="w-full pl-5 pr-1 py-1 rounded-md border border-transparent hover:border-[#DDE9DF] focus:border-[#153D32] focus:bg-white focus:outline-none font-medium text-[#252D29]"
                            />
                          </div>
                          {item.selling_type === 'loose' && item.mrp && (
                            <span className="text-[10px] text-[#5E6C64] block px-1 mt-0.5">
                              per {item.price_basis_quantity || 1} {item.price_basis_unit || 'kg'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-extrabold text-[#23866A] px-2 block">
                            {formatMoney(item.amount ?? (item.quantity && item.purchase_price ? round3(item.quantity * item.purchase_price) : 0))}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span 
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.confidence >= 80 
                                ? 'bg-[#E7F6F1] text-[#23866A]' 
                                : item.confidence >= 60 
                                ? 'bg-[#FBF4E7] text-[#D6AE62]' 
                                : 'bg-[#FDF1EF] text-[#EF806D]'
                            }`}
                          >
                            {Math.round(item.confidence)}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1.5 rounded-lg text-[#5E6C64] hover:text-[#EF806D] hover:bg-[#FDF1EF] transition-colors cursor-pointer"
                            title="Delete row"
                            aria-label={`Delete row ${idx + 1}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Loose Product Selling Configuration Panel */}
                      {item.selling_type === 'loose' && expandedItemId === item.id && (
                        <tr className="bg-[#FAF8F2]/90 border-b border-[#DDE9DF]">
                          <td colSpan={11} className="p-4">
                            <div className="bg-white rounded-xl border border-[#23866A]/30 p-4 shadow-sm space-y-4">
                              <div className="flex items-center justify-between border-b border-[#DDE9DF] pb-2">
                                <div className="flex items-center gap-2">
                                  <Scale className="w-4 h-4 text-[#23866A]" />
                                  <span className="text-xs font-bold text-[#153D32]">
                                    Loose Product Selling Configuration — {item.product_name}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedItemId(null)}
                                  className="text-xs text-[#5E6C64] hover:text-[#153D32] font-semibold cursor-pointer"
                                >
                                  Close
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                {/* Box 1: Original OCR Procurement Info */}
                                <div className="bg-[#FAF8F2] p-3 rounded-lg border border-[#DDE9DF] space-y-1.5">
                                  <span className="text-[11px] font-bold text-[#5E6C64] uppercase tracking-wider block">
                                    Invoice Procurement (Wholesale)
                                  </span>
                                  <div className="flex justify-between text-[#252D29]">
                                    <span className="text-[#5E6C64]">Purchased Qty:</span>
                                    <span className="font-semibold">{item.quantity ?? '-'} {item.unit}</span>
                                  </div>
                                  <div className="flex justify-between text-[#252D29]">
                                    <span className="text-[#5E6C64]">Invoice Rate:</span>
                                    <span className="font-semibold">{item.purchase_price ? formatMoney(item.purchase_price) : '-'} / {item.unit}</span>
                                  </div>
                                  <div className="flex justify-between text-[#252D29]">
                                    <span className="text-[#5E6C64]">Line Total:</span>
                                    <span className="font-bold text-[#23866A]">{item.amount ? formatMoney(item.amount) : '-'}</span>
                                  </div>
                                  <p className="text-[10px] text-[#5E6C64] pt-1 border-t border-[#DDE9DF]/60">
                                    Raw invoice procurement values are strictly preserved.
                                  </p>
                                </div>

                                {/* Box 2: Retail Standard Selling Unit & Price */}
                                <div className="p-3 rounded-lg border border-[#DDE9DF] space-y-2">
                                  <span className="text-[11px] font-bold text-[#153D32] uppercase tracking-wider block">
                                    Retail Selling Price Configuration
                                  </span>
                                  <div>
                                    <label className="text-[10px] font-semibold text-[#5E6C64] block mb-1">
                                      Standard Selling Unit Presets
                                    </label>
                                    <div className="flex flex-wrap gap-1">
                                      {[
                                        { label: '1 kg', qty: 1, unit: 'kg' },
                                        { label: '500 g', qty: 500, unit: 'g' },
                                        { label: '100 g', qty: 100, unit: 'g' },
                                        { label: '1 L', qty: 1, unit: 'L' },
                                        { label: '500 ml', qty: 500, unit: 'ml' },
                                      ].map((preset) => (
                                        <button
                                          key={preset.label}
                                          type="button"
                                          onClick={() => {
                                            handleUpdateItem(item.id, 'price_basis_quantity', preset.qty);
                                            handleUpdateItem(item.id, 'price_basis_unit', preset.unit);
                                          }}
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                                            item.price_basis_quantity === preset.qty && item.price_basis_unit === preset.unit
                                              ? 'bg-[#23866A] text-white border-[#23866A]'
                                              : 'bg-[#FAF8F2] text-[#153D32] border-[#DDE9DF] hover:bg-[#F3EFE3]'
                                          }`}
                                        >
                                          {preset.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 pt-1">
                                    <div>
                                      <label className="text-[10px] font-semibold text-[#5E6C64] block">Selling Price (₹)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="e.g. 60"
                                        value={item.selling_price ?? ''}
                                        onChange={(e) => handleUpdateItem(item.id, 'selling_price', parseFloat(e.target.value) || null)}
                                        className="w-full px-2 py-1 rounded border border-[#DDE9DF] text-xs font-bold text-[#153D32] focus:border-[#23866A] focus:outline-none"
                                      />
                                      <span className="text-[10px] text-[#5E6C64]">
                                        per {item.price_basis_quantity || 1} {item.price_basis_unit || 'kg'}
                                      </span>
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-semibold text-[#5E6C64] block">MRP (₹, Optional)</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="e.g. 65"
                                        value={item.mrp ?? ''}
                                        onChange={(e) => handleUpdateItem(item.id, 'mrp', parseFloat(e.target.value) || null)}
                                        className="w-full px-2 py-1 rounded border border-[#DDE9DF] text-xs font-semibold text-[#252D29] focus:border-[#23866A] focus:outline-none"
                                      />
                                      <span className="text-[10px] text-[#5E6C64]">
                                        per {item.price_basis_quantity || 1} {item.price_basis_unit || 'kg'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Box 3: Inventory Storage & Conversion */}
                                <div className="p-3 rounded-lg border border-[#DDE9DF] space-y-2">
                                  <span className="text-[11px] font-bold text-[#153D32] uppercase tracking-wider block">
                                    Inventory Storage & Conversion
                                  </span>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] font-semibold text-[#5E6C64] block">Storage Unit</label>
                                      <select
                                        value={item.inventory_unit || (item.unit?.toLowerCase().includes('l') ? 'L' : 'kg')}
                                        onChange={(e) => handleUpdateItem(item.id, 'inventory_unit', e.target.value)}
                                        className="w-full px-2 py-1 rounded border border-[#DDE9DF] text-xs font-semibold text-[#252D29] bg-white focus:outline-none"
                                      >
                                        <option value="kg">kg (Kilograms)</option>
                                        <option value="g">g (Grams)</option>
                                        <option value="L">L (Liters)</option>
                                        <option value="ml">ml (Milliliters)</option>
                                        <option value="pcs">pcs (Pieces)</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-semibold text-[#5E6C64] block">
                                        1 {item.unit} = [Units]
                                      </label>
                                      <input
                                        type="number"
                                        step="0.001"
                                        min="0.001"
                                        value={item.conversion_factor ?? 1}
                                        onChange={(e) => handleUpdateItem(item.id, 'conversion_factor', parseFloat(e.target.value) || 1)}
                                        className="w-full px-2 py-1 rounded border border-[#DDE9DF] text-xs font-semibold text-[#252D29] focus:border-[#23866A] focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  <div className="bg-[#E7F6F1] p-2 rounded text-[11px] text-[#16704F] font-medium">
                                    Physical stock added:{' '}
                                    <strong>
                                      {round3(Number(item.quantity || 0) * Number(item.conversion_factor || 1))}{' '}
                                      {item.inventory_unit || (item.unit?.toLowerCase().includes('l') ? 'L' : 'kg')}
                                    </strong>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-4 bg-[#FAF8F2] border-t border-[#DDE9DF] flex flex-col sm:flex-row sm:items-center justify-between text-xs text-[#5E6C64] gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#23866A]" />
                <span>Verified by Shelfora Mathematical Reconciliation</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-[#5E6C64] mr-2">Grand Total:</span>
                <span className="text-base font-black text-[#153D32]">
                  {formatMoney(extractedData.total_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Recently Confirmed Inventory Products Summary */}
          {confirmedProducts.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#23866A]/30 p-5 shadow-card animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#DDE9DF] mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-[#23866A]" />
                  <h4 className="text-sm font-bold text-[#153D32]">
                    Confirmed Inventory Records ({confirmedProducts.length} items)
                  </h4>
                </div>
                <span className="text-xs font-semibold text-[#23866A] bg-[#E7F6F1] px-2.5 py-1 rounded-full border border-[#23866A]/20">
                  Synced to Database
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {confirmedProducts.map((p: any) => (
                  <div key={p.id} className="p-3 rounded-xl bg-[#FAF8F2] border border-[#DDE9DF] text-xs">
                    <p className="font-bold text-[#153D32] truncate">{p.name}</p>
                    <div className="flex justify-between items-center text-[#5E6C64] mt-1.5">
                      <span>Stock: <strong>{p.current_stock} {p.unit || 'pcs'}</strong></span>
                      <span className="font-semibold text-[#23866A]">₹{p.selling_price?.toFixed(2)}</span>
                    </div>
                    <p className="text-[10px] text-[#5E6C64]/70 mt-1 truncate">ID: {p.id}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InvoiceScanner;

