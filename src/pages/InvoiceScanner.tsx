import React, { useState, useRef, useEffect, useId } from 'react';
import { 
  Camera, 
  Upload, 
  CheckCircle2, 
  Info, 
  Check, 
  RefreshCw, 
  Trash2, 
  Plus, 
  ArrowRight, 
  X, 
  Layers,
  Receipt,
  ScanLine,
  Settings,
  Eye,
  EyeOff,
  FileText,
  AlertTriangle,
  AlertCircle,
  Cpu,
  Edit3,
  Search,
  Package,
  Loader2
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useLanguage } from '../i18n/LanguageContext';
import type { PageRoute, Product } from '../types';
import { 
  parseInvoiceFile, 
  SAMPLE_INVOICES, 
  matchItemsWithInventory,
  getGeminiApiKey,
  setGeminiApiKey,
  getPreferredOcrEngine,
  setPreferredOcrEngine,
  type ParsedInvoice, 
  type InvoiceLineItem 
} from '../services/invoiceScannerService';
import { createAlert } from '../services/alertService';
import { clearAnalyticsCache } from '../services/analyticsService';
import { getActiveUserId } from '../services/authService';
import { db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { invoiceApi, mapBackendResponseToParsedInvoice } from '../api/invoice';
import { getAccessToken } from '../api/client';
import {
  recalculateLineTotal,
  summarizeExtractionIssues,
  describeScanCompletion,
  applyStoreMatch,
  copyStorePrices,
  setPackSizeText,
  formatPackSize,
  knownStorePrice,
} from '../services/invoiceReview';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useDialog } from '../hooks/useDialog';
import { useToast } from '../hooks/useToast';
import { describeError } from '../utils/errorHandler';
import type { ApiError } from '../api/client';
import { MrpStatus, LineAmount, LineReviewNotes, ValidationStatusBadge } from '../components/InvoiceLineCells';
import { ImageTableCropper } from '../components/ImageTableCropper';
import { parseProductTableFromImage } from '../services/productTableScanner';
import type { CropRegion } from '../services/imagePreprocessor';

const ENGINE_LABELS: Record<string, string> = {
  backend_ocr_pipeline: 'Server OCR',
  backend_pdf_direct: 'Server PDF text',
  backend_pdf_ocr_scanned: 'Server OCR (scanned PDF)',
  backend_text_direct: 'Server text',
  gemini: 'In-browser Gemini',
  tesseract: 'In-browser OCR',
  pdf_direct: 'In-browser PDF text',
  product_table_only: 'Table-Only Scan',
  sample: 'Sample bill',
};

export const COMMON_UNITS = [
  'pcs',
  'kg',
  'g',
  'gm',
  'l',
  'ltr',
  'ml',
  'bag',
  'box',
  'pkt',
  'can',
  'tin',
  'ctn',
  'set',
  'pair',
  'dozen',
];

export interface ValidationError {
  itemId: string;
  itemName: string;
  issues: string[];
}

export interface StockSuccessStats {
  processedCount: number;
  restockedCount: number;
  newCount: number;
  unitsAdded: number;
  purchaseValue: number;
  invoiceNumber?: string;
}

const newSampleInvoiceId = () => 'inv_' + Date.now().toString(36);

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && isNaN(v));

/**
 * Checks every line before stock is changed. Prices that could not be read are never
 * assumed: the purchase price must be entered, and a new product needs a selling price.
 */
export const validateInvoiceItems = (items: InvoiceLineItem[], products: Product[] = []): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (const item of items) {
    const issues: string[] = [];
    const trimmedName = (item.name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      issues.push('Product name is required (min 2 characters)');
    }
    const qty = Number(item.quantity);
    if (isBlank(item.quantity) || isNaN(qty) || qty <= 0) {
      issues.push('Quantity must be greater than 0');
    } else if (!Number.isInteger(qty)) {
      issues.push('Quantity must be a whole number of stock units');
    }
    if (!item.unit || item.unit.trim() === '') {
      issues.push('Unit is required');
    }
    if (isBlank(item.purchasePrice) && isBlank(item.rate)) {
      issues.push('Purchase price is required (it could not be read from the invoice)');
    } else if (!isBlank(item.purchasePrice)) {
      const pur = Number(item.purchasePrice);
      if (isNaN(pur) || pur < 0) {
        issues.push('Purchase price cannot be negative');
      }
    }
    const existsInStore =
      Boolean(item.matchedProductId) ||
      products.some((p) => p.name.toLowerCase().trim() === trimmedName.toLowerCase());
    if (!existsInStore && isBlank(item.sellingPrice)) {
      issues.push('Selling price is required for a new product');
    }
    if (item.sellingPrice !== null && item.sellingPrice !== undefined) {
      const sell = Number(item.sellingPrice);
      if (isNaN(sell) || sell < 0) {
        issues.push('Selling price cannot be negative');
      }
    }
    if (item.mrp !== null && item.mrp !== undefined) {
      const mrpVal = Number(item.mrp);
      if (isNaN(mrpVal) || mrpVal < 0) {
        issues.push('MRP cannot be negative');
      }
    }
    if (item.discount !== null && item.discount !== undefined) {
      const disc = Number(item.discount);
      if (isNaN(disc) || disc < 0) {
        issues.push('Discount cannot be negative');
      }
    }
    if (item.gstRate !== null && item.gstRate !== undefined) {
      const gst = Number(item.gstRate);
      if (isNaN(gst) || gst < 0) {
        issues.push('GST % cannot be negative');
      }
    }
    if (issues.length > 0) {
      errors.push({
        itemId: item.id,
        itemName: trimmedName || 'Unnamed Item',
        issues,
      });
    }
  }
  return errors;
};

interface InvoiceScannerProps {
  products?: Product[];
  onAddProduct?: (newProd: Omit<Product, 'id'>) => Promise<void>;
  onRestock?: (id: string, amount: number, purchasePrice?: number, sellingPrice?: number, mrp?: number) => Promise<void>;
  setActivePage?: (page: PageRoute) => void;
}

export const InvoiceScanner: React.FC<InvoiceScannerProps> = ({
  products = [],
  onAddProduct,
  onRestock,
  setActivePage,
}) => {
  const { t } = useLanguage();
  
  const toast = useToast();

  // Scanning state. Stages are reported only when they are actually known:
  // 'uploading' carries the real percentage of bytes sent, 'processing' has no invented percentage.
  const [scanPhase, setScanPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [scanStatusText, setScanStatusText] = useState('');
  const [scanError, setScanError] = useState<{ title: string; message: string; retry?: () => void } | null>(null);
  const [confirmDiscardReview, setConfirmDiscardReview] = useState(false);
  const scanInFlightRef = useRef(false);
  const isScanning = scanPhase !== 'idle';
  const [invoiceData, setInvoiceData] = useState<ParsedInvoice | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [stockSuccessData, setStockSuccessData] = useState<StockSuccessStats | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scanWarning, setScanWarning] = useState<string | null>(null);

  // Workflow mode: Table Crop V2 vs Full Invoice
  const [scanWorkflow, setScanWorkflow] = useState<'table' | 'full'>('table');
  const [cropperImageUrl, setCropperImageUrl] = useState<string | null>(null);
  const [isCroppingOpen, setIsCroppingOpen] = useState(false);

  // Review, Validation & Editing state
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceLineItem | null>(null);
  const [matchingPickerItem, setMatchingPickerItem] = useState<InvoiceLineItem | null>(null);
  const [matchingSearch, setMatchingSearch] = useState('');
  const [stockUpdateError, setStockUpdateError] = useState<string | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  
  // Settings & Engine state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => getGeminiApiKey());
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<'auto' | 'gemini' | 'tesseract'>(() => getPreferredOcrEngine());
  const [isRawTextOpen, setIsRawTextOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [debugTab, setDebugTab] = useState<'overview' | 'raw_ocr' | 'detected_words' | 'columns_rows' | 'objects_api'>('overview');
  
  // Camera modal state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);

  // Keyboard/focus behaviour for the scanner's dialogs (Escape closes the top-most one).
  const confirmTitleId = useId();
  const editTitleId = useId();
  const pickerTitleId = useId();
  const cameraTitleId = useId();
  const settingsTitleId = useId();
  const debugTitleId = useId();
  const confirmModalRef = useDialog<HTMLDivElement>({
    isOpen: isConfirmModalOpen && Boolean(invoiceData),
    onClose: () => setIsConfirmModalOpen(false),
    closeOnEscape: !isSaving,
  });
  const editModalRef = useDialog<HTMLDivElement>({ isOpen: Boolean(editingItem), onClose: () => setEditingItem(null) });
  const pickerModalRef = useDialog<HTMLDivElement>({ isOpen: Boolean(matchingPickerItem), onClose: () => setMatchingPickerItem(null) });
  const cameraModalRef = useDialog<HTMLDivElement>({ isOpen: isCameraOpen, onClose: () => closeCamera() });
  const settingsModalRef = useDialog<HTMLDivElement>({ isOpen: isSettingsOpen, onClose: () => setIsSettingsOpen(false) });
  const debugModalRef = useDialog<HTMLDivElement>({ isOpen: isDebugOpen && Boolean(invoiceData), onClose: () => setIsDebugOpen(false) });

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Drag & drop highlight
  const [isDragging, setIsDragging] = useState(false);

  // Stop camera when modal unmounts or closes
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setCameraError('Camera access not permitted or unavailable. You can upload an invoice photo directly.');
      // Fallback to native camera input
      if (cameraInputRef.current) {
        cameraInputRef.current.click();
      }
    }
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhotoFromCamera = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      closeCamera();
      if (scanWorkflow === 'table') {
        setCropperImageUrl(dataUrl);
        setIsCroppingOpen(true);
      } else {
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'camera_invoice.jpg', { type: 'image/jpeg' });
            processUploadedFile(file);
          }
        }, 'image/jpeg');
      }
    }
  };

  /** Shows a finished scan and reports completion only once the extracted lines are on screen. */
  const showScanResult = (parsed: ParsedInvoice, emptyWarning: string) => {
    setInvoiceData(parsed);
    if (parsed.items.length === 0) {
      setScanWarning(emptyWarning);
    } else {
      const done = describeScanCompletion(parsed.items);
      toast[done.tone](done.title, { description: done.description });
    }
  };

  const handleConfirmCropAndScan = async (cropRegion: CropRegion) => {
    if (!cropperImageUrl || scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setIsCroppingOpen(false);
    setScanPhase('processing');
    setUploadPercent(null);
    setScanStatusText('Cropping the table area…');
    setSuccessMessage(null);
    setScanWarning(null);
    setScanError(null);

    try {
      const parsed = await parseProductTableFromImage(
        cropperImageUrl,
        cropRegion,
        (_progress, statusText) => setScanStatusText(statusText),
        products
      );
      showScanResult(
        parsed,
        'No product rows could be detected in the cropped table area. Try clicking "Recrop Table" or add items manually.'
      );
    } catch (err: any) {
      console.error('Failed to parse product table:', err);
      setScanError({
        title: 'OCR extraction failed',
        message: describeError(err, 'The text in the cropped table could not be read. Try a sharper, well-lit photo.'),
        retry: () => void handleConfirmCropAndScan(cropRegion),
      });
    } finally {
      setScanPhase('idle');
      scanInFlightRef.current = false;
    }
  };

  const processUploadedFile = async (file: File) => {
    // One scan at a time: a second drop or tap while a bill is being read is ignored.
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setSuccessMessage(null);
    setScanWarning(null);
    setScanError(null);
    setUploadPercent(null);

    try {
      let serverNotice: string | null = null;
      if (getAccessToken()) {
        try {
          setScanPhase('uploading');
          setScanStatusText('Uploading invoice…');
          const backendResp = await invoiceApi.extractInvoice(file, {
            onUploadProgress: ({ percent }) => setUploadPercent(percent),
            onUploadComplete: () => {
              setScanPhase('processing');
              setUploadPercent(null);
              setScanStatusText('Processing on the server: reading text, checking prices and looking up MRP…');
            },
          });
          if (backendResp && backendResp.items && backendResp.items.length > 0) {
            setScanStatusText('Matching items with your inventory…');
            const parsed = mapBackendResponseToParsedInvoice(backendResp, products);
            showScanResult(parsed, '');
            return;
          }
          serverNotice = `The server found no product rows (${backendResp?.reason || 'no table detected'}).`;
        } catch (apiErr: any) {
          console.warn('Backend invoice extraction failed:', apiErr);
          const status = (apiErr as ApiError)?.status;
          // The server rejected the file itself (empty, unreadable or unsupported). Reading it in the
          // browser would fail the same way, so show the server's reason instead of a generic error.
          if (status === 400 || status === 413 || status === 415) {
            setScanError({
              title: 'Invoice upload failed',
              message: describeError(apiErr, 'This file could not be used. Upload a PDF or a photo of the invoice.'),
            });
            return;
          }
          serverNotice =
            status === 0
              ? 'Invoice upload failed: the ShopPulse server could not be reached.'
              : status === 503
              ? 'The server OCR engine is unavailable.'
              : `Server extraction failed: ${describeError(apiErr, 'unknown error')}.`;
        }
      } else {
        serverNotice = 'Not signed in to the ShopPulse server.';
      }

      setScanPhase('processing');
      setUploadPercent(null);
      setScanStatusText('Reading the invoice in this browser…');
      const parsed = await parseInvoiceFile(file, products, (_progress, statusText) => {
        setScanStatusText(statusText);
      });
      parsed.notices = [
        `${serverNotice} This invoice was read with in-browser OCR instead; no MRP lookup was performed. Check every value.`,
        ...(parsed.notices || []),
      ];
      parsed.diagnostics = { ...(parsed.diagnostics || {}), backendError: serverNotice };
      showScanResult(
        parsed,
        'No product rows could be detected in this bill. Add items with "+ Add Item" or check the extracted text below.'
      );
    } catch (err: any) {
      console.error('Failed to parse invoice:', err);
      setScanError({
        title: 'OCR extraction failed',
        message: describeError(err, 'The invoice could not be read. Try a clearer photo or a PDF.'),
        retry: () => void processUploadedFile(file),
      });
    } finally {
      setScanPhase('idle');
      setUploadPercent(null);
      scanInFlightRef.current = false;
    }
  };

  // Sample bills are bundled with the app, so they load instantly with no simulated progress.
  const loadSampleInvoice = (sampleIndex: number) => {
    if (scanInFlightRef.current) return;
    setSuccessMessage(null);
    setScanError(null);
    setScanWarning(null);
    const sample = SAMPLE_INVOICES[sampleIndex].invoice;
    setInvoiceData({
      ...sample,
      id: newSampleInvoiceId(),
      items: matchItemsWithInventory(sample.items, products),
    });
  };

  const handleUploadedFile = (file: File) => {
    if (scanInFlightRef.current) return;
    if (scanWorkflow === 'table') {
      const reader = new FileReader();
      reader.onload = () => {
        setCropperImageUrl(reader.result as string);
        setIsCroppingOpen(true);
      };
      reader.readAsDataURL(file);
    } else {
      processUploadedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUploadedFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUploadedFile(file);
    }
  };

  // Editable item handlers
  const handleItemChange = (id: string, field: keyof InvoiceLineItem, value: any) => {
    if (!invoiceData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.map((item) => {
        if (item.id !== id) return item;
        if (field === 'packSize') return setPackSizeText(item, String(value ?? ''));
        const updated = { ...item, [field]: value };
        // Auto-detect store match on name change if not user-confirmed
        if (field === 'name' && !item.isMatchConfirmed) {
          const found = products.find(
            (p) => p.name.toLowerCase().trim() === String(value).toLowerCase().trim()
          );
          if (found) {
            const linked = applyStoreMatch(updated, found);
            updated.matchedProductId = linked.matchedProductId;
            updated.inventoryData = linked.inventoryData;
          } else {
            updated.matchedProductId = undefined;
            updated.inventoryData = undefined;
          }
        }
        if (field === 'purchasePrice') {
          updated.rate = value;
        }
        if (field === 'mrp') {
          updated.mrpSource = value === null ? null : 'MANUAL';
        }
        if (field === 'quantity' || field === 'purchasePrice') {
          recalculateLineTotal(updated);
        }
        return updated;
      }),
    });
    if (validationErrors.length > 0) {
      setValidationErrors((prev) => prev.filter((e) => e.itemId !== id));
    }
  };

  const handleSaveEditingItem = (savedItem: InvoiceLineItem) => {
    if (!invoiceData) return;
    const original = invoiceData.items.find((it) => it.id === savedItem.id);
    const finalItem = { ...savedItem };
    if (finalItem.purchasePrice !== null && finalItem.purchasePrice !== undefined) {
      finalItem.rate = finalItem.purchasePrice;
    }
    if (original && finalItem.mrp !== original.mrp) {
      finalItem.mrpSource = finalItem.mrp === null || finalItem.mrp === undefined ? null : 'MANUAL';
    }
    if (original && finalItem.lineTotal !== original.lineTotal) {
      finalItem.lineTotalSource = finalItem.lineTotal === null ? null : 'MANUAL';
    } else if (
      original &&
      (finalItem.quantity !== original.quantity || finalItem.purchasePrice !== original.purchasePrice)
    ) {
      recalculateLineTotal(finalItem);
    }
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.map((it) => (it.id === finalItem.id ? finalItem : it)),
    });
    setEditingItem(null);
    if (validationErrors.length > 0) {
      setValidationErrors((prev) => prev.filter((e) => e.itemId !== finalItem.id));
    }
  };

  /** Copies the stored product's known prices into the line; a copied MRP is marked STORE. */
  const applyStorePrices = (item: InvoiceLineItem) => {
    if (!invoiceData || !item.inventoryData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.map((it) => (it.id === item.id ? copyStorePrices(it) : it)),
    });
  };

  /** Applies amount ÷ quantity as the purchase price, only when the user asks for it. */
  const applySuggestedRate = (item: InvoiceLineItem) => {
    if (item.suggestedRate == null) return;
    handleItemChange(item.id, 'purchasePrice', item.suggestedRate);
  };

  const handleSelectMatchProduct = (itemId: string, selectedProduct: Product | null) => {
    if (!invoiceData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.map((it) => (it.id === itemId ? applyStoreMatch(it, selectedProduct) : it)),
    });
    // When the picker was opened from the edit dialog, update the dialog's copy as well;
    // otherwise saving the dialog would overwrite the link that was just chosen.
    setEditingItem((current) => (current && current.id === itemId ? applyStoreMatch(current, selectedProduct) : current));
    setMatchingPickerItem(null);
  };

  const discardReview = () => {
    setInvoiceData(null);
    setValidationErrors([]);
    setStockUpdateError(null);
    setScanWarning(null);
    setConfirmDiscardReview(false);
  };

  // Discarding a reviewed invoice loses every correction, so it is confirmed first.
  const requestDiscardReview = () => {
    if (invoiceData && invoiceData.items.length > 0) setConfirmDiscardReview(true);
    else discardReview();
  };

  const handleRemoveItem = (id: string) => {
    if (!invoiceData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.filter((item) => item.id !== id),
    });
    if (validationErrors.length > 0) {
      setValidationErrors((prev) => prev.filter((e) => e.itemId !== id));
    }
  };

  const handleAddItem = () => {
    if (!invoiceData) return;
    // A manually added line starts empty: every value is typed in by the user
    const newItem: InvoiceLineItem = {
      id: 'item_' + Date.now().toString(36),
      name: '',
      category: 'Groceries',
      quantity: null,
      unit: '',
      purchasePrice: null,
      sellingPrice: null,
      mrp: null,
      mrpSource: null,
      lineTotal: null,
      lineTotalSource: null,
      confidence: 100,
      confidenceLevel: 'HIGH',
      lowConfidence: false,
    };
    setInvoiceData({
      ...invoiceData,
      items: [...invoiceData.items, newItem],
    });
  };

  const extractionIssues = invoiceData ? summarizeExtractionIssues(invoiceData.items) : [];

  // Calculate live total
  const calculatedTotal = invoiceData?.items.reduce((acc, item) => acc + (item.lineTotal || 0), 0) || 0;
  const totalUnits = invoiceData?.items.reduce((acc, item) => acc + (item.quantity || 0), 0) || 0;

  // Step 1: Validate items and trigger confirmation modal
  const handleInitiateAddToStock = () => {
    if (!invoiceData || invoiceData.items.length === 0) return;
    setStockUpdateError(null);
    const errors = validateInvoiceItems(invoiceData.items, products);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setIsConfirmModalOpen(true);
  };

  // Step 2: Atomic execution after user explicitly confirms in modal
  const handleConfirmAddToStock = async () => {
    if (isSubmittingRef.current || !invoiceData || invoiceData.items.length === 0) return;
    
    // Strict re-validation safeguard
    const errors = validateInvoiceItems(invoiceData.items, products);
    if (errors.length > 0) {
      setValidationErrors(errors);
      setIsConfirmModalOpen(false);
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    setStockUpdateError(null);

    let addedCount = 0;
    let restockedCount = 0;
    const priceOf = (it: InvoiceLineItem) => Number(it.purchasePrice ?? it.rate);
    const optional = (v: number | null | undefined) => (v === null || v === undefined ? undefined : Number(v));

    try {
      if (getAccessToken()) {
        // One server transaction does everything: restock or create products, store MRPs
        // with their source and record the purchase. It rejects an invoice confirmed twice.
        const backendResp = await invoiceApi.confirmInvoice({
          supplier_name: invoiceData.supplierName || undefined,
          invoice_number: invoiceData.invoiceNumber || undefined,
          invoice_date: invoiceData.invoiceDate || undefined,
          items: invoiceData.items.map((it) => ({
            name: it.name.trim(),
            category: it.category,
            quantity: Number(it.quantity),
            unit: it.unit,
            purchase_price: priceOf(it),
            selling_price: optional(it.sellingPrice),
            mrp: optional(it.mrp),
            mrp_source: it.mrp !== null && it.mrp !== undefined ? it.mrpSource || 'MANUAL' : undefined,
            line_amount: optional(it.lineTotal),
            matched_product_id: it.matchedProductId,
          })),
        });
        addedCount = backendResp.items_created;
        restockedCount = backendResp.items_restocked;
        window.dispatchEvent(new CustomEvent('shoppulse_inventory_changed'));
      } else {
        // No server session: apply through the inventory callbacks, merging duplicate lines first
        const mergedBatch: InvoiceLineItem[] = [];
        for (const item of invoiceData.items) {
          const trimmedName = item.name.toLowerCase().trim();
          const existing = mergedBatch.find(
            (m) =>
              (m.matchedProductId && m.matchedProductId === item.matchedProductId) ||
              m.name.toLowerCase().trim() === trimmedName
          );
          if (existing) {
            existing.quantity = Number(existing.quantity) + Number(item.quantity);
            existing.lineTotal =
              existing.lineTotal !== null && item.lineTotal !== null ? existing.lineTotal + item.lineTotal : null;
            existing.sellingPrice = existing.sellingPrice ?? item.sellingPrice;
            existing.mrp = existing.mrp ?? item.mrp;
          } else {
            mergedBatch.push({ ...item });
          }
        }

        for (const item of mergedBatch) {
          const purPrice = priceOf(item);
          const sellPrice = optional(item.sellingPrice);
          const mrpPrice = optional(item.mrp);
          const existingInStore =
            item.matchedProductId ||
            products.find((p) => p.name.toLowerCase().trim() === item.name.toLowerCase().trim())?.id;

          if (existingInStore && onRestock) {
            await onRestock(existingInStore, Number(item.quantity), purPrice, sellPrice, mrpPrice);
            restockedCount++;
          } else if (onAddProduct && sellPrice !== undefined) {
            const now = new Date().toISOString();
            await onAddProduct({
              name: item.name.trim(),
              category: item.category || 'Groceries',
              stock: Number(item.quantity),
              unit: item.unit,
              purchasePrice: purPrice,
              sellingPrice: sellPrice,
              price: sellPrice,
              mrp: mrpPrice,
              reorderLevel: 10,
              minStock: 10,
              status: 'In Stock',
              createdAt: now,
              updatedAt: now,
            });
            addedCount++;
          }
        }

        const currentUid = getActiveUserId();
        if (currentUid) {
          try {
            await addDoc(collection(db, 'users', currentUid, 'purchases'), {
              supplierName: invoiceData.supplierName,
              invoiceNumber: invoiceData.invoiceNumber,
              invoiceDate: invoiceData.invoiceDate,
              totalAmount: calculatedTotal,
              totalUnits,
              totalItems: mergedBatch.length,
              items: mergedBatch.map((it) => ({
                name: it.name.trim(),
                category: it.category,
                quantity: Number(it.quantity),
                unit: it.unit,
                purchasePrice: priceOf(it),
                sellingPrice: it.sellingPrice ?? null,
                mrp: it.mrp ?? null,
                mrpSource: it.mrp != null ? it.mrpSource || 'MANUAL' : null,
                lineTotal: it.lineTotal,
              })),
              createdAt: new Date().toISOString(),
            });
          } catch (pErr) {
            console.warn('Could not record purchase record in Firestore workspace:', pErr);
          }
        }
      }

      // Invalidate analytics caches so profit margins and inventory valuation update immediately
      clearAnalyticsCache();

      // Record smart alert
      try {
        await createAlert({
          type: 'system',
          priority: 'low',
          productName: invoiceData.supplierName || 'Supplier Invoice',
          message: `📦 Restocked ${totalUnits} units across ${restockedCount + addedCount} items (Total: ₹${calculatedTotal.toLocaleString('en-IN')}) from Bill #${invoiceData.invoiceNumber || 'N/A'}.`,
        });
      } catch (alertErr) {
        console.warn('Could not post restock alert:', alertErr);
      }

      // Success notification only after atomic database success
      setIsConfirmModalOpen(false);
      setStockSuccessData({
        processedCount: restockedCount + addedCount,
        restockedCount,
        newCount: addedCount,
        unitsAdded: totalUnits,
        purchaseValue: calculatedTotal,
        invoiceNumber: invoiceData.invoiceNumber,
      });
      setSuccessMessage(null);
      setValidationErrors([]);
      setInvoiceData(null);
    } catch (err: any) {
      console.error('Error adding invoice items to stock:', err);
      setIsConfirmModalOpen(false);
      // The server applies everything or nothing, so on failure stock is unchanged
      setStockUpdateError('Stock was not updated: ' + describeError(err, 'please try again.'));
      // Keep invoiceData intact so user doesn't lose their edits!
    } finally {
      setIsSaving(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      
      {/* Hidden File & Camera Inputs */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*,application/pdf" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
      />

      {/* Header */}
      <PageHeader
        title={t('scanner.title')}
        description={t('scanner.description')}
      />

      {/* Engine status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5">
          <ScanLine className="w-5 h-5 text-slate-600 shrink-0" />
          <div>
            <p className="font-bold text-slate-900">
              {getAccessToken()
                ? 'Server OCR with price checks and MRP lookup'
                : apiKeyInput && selectedEngine !== 'tesseract'
                ? 'In-browser scanning (Gemini)'
                : 'In-browser scanning (Tesseract)'}
            </p>
            <p className="text-xs text-slate-500">
              {getAccessToken()
                ? 'Falls back to in-browser OCR if the server is unavailable. Every value can be reviewed before stock is updated.'
                : 'Sign in with your ShopPulse account for server-side extraction and MRP lookup.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {invoiceData && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDebugOpen(true)}
              icon={<Cpu className="w-4 h-4" />}
              className="text-xs font-bold py-1 px-3 bg-white"
            >
              OCR Details
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            icon={<Settings className="w-4 h-4" />}
            className="text-xs font-bold py-1 px-3 bg-white"
          >
            Engine Settings
          </Button>
        </div>
      </div>

      {/* OCR Extraction Alert / Advice */}
      {scanWarning && (
        <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-400 text-amber-900 shadow-sm flex items-start gap-3 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm">
            <p className="font-extrabold">{scanWarning}</p>
            <p className="text-slate-600 mt-0.5">Tip: Flatten the paper bill, ensure bright ambient light, avoid shadows, and keep the phone camera parallel to the invoice.</p>
          </div>
        </div>
      )}

      {/* Scan failure: the file or crop can be retried without choosing it again */}
      {scanError && !invoiceData && (
        <div role="alert" className="p-4 bg-rose-50 rounded-2xl border-2 border-rose-400 text-rose-950 shadow-sm flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-black">{scanError.title}</p>
              <p className="text-xs text-rose-800 mt-0.5">{scanError.message}</p>
              <p className="text-xs text-rose-800 mt-0.5">Stock has not been changed.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scanError.retry && (
              <Button variant="primary" size="sm" onClick={scanError.retry} icon={<RefreshCw className="w-4 h-4" />}>
                Retry
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setScanError(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Stock Update Success Modal / Card (Section 21) */}
      {stockSuccessData && (
        <Card className="border-2 border-emerald-500 bg-white shadow-xl p-6 sm:p-8 rounded-3xl text-center space-y-4 animate-in fade-in zoom-in-95">
          <div className="w-16 h-16 rounded-2xl bg-emerald-600 text-white mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              ✓ Stock Updated Successfully
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              Your inventory has been verified and successfully updated with supplier bill #{stockSuccessData.invoiceNumber || 'N/A'}.
            </p>
            <div className="flex items-center justify-center gap-2 sm:gap-3 text-xs sm:text-sm text-slate-600 font-bold flex-wrap pt-1">
              <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                {stockSuccessData.processedCount} products processed ({stockSuccessData.restockedCount} restocked, {stockSuccessData.newCount} new)
              </span>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                {stockSuccessData.unitsAdded} units added to inventory
              </span>
              <span className="px-3 py-1 rounded-full bg-teal-100 text-teal-800 border border-teal-200">
                Total purchase value: ₹{stockSuccessData.purchaseValue.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 pt-3">
            {setActivePage && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  setStockSuccessData(null);
                  setActivePage('inventory');
                }}
                icon={<ArrowRight className="w-5 h-5" />}
                className="font-black px-6"
              >
                View Inventory
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              onClick={() => setStockSuccessData(null)}
              className="font-bold px-6 border-slate-300"
            >
              Done
            </Button>
          </div>
        </Card>
      )}

      {/* Stock Update Failure Error Banner */}
      {stockUpdateError && (
        <div role="alert" className="p-4 bg-rose-50 rounded-2xl border-2 border-rose-500 text-rose-950 shadow-md flex items-start justify-between gap-3 animate-in fade-in">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-sm">{stockUpdateError}</p>
              <p className="text-xs text-rose-800 mt-0.5">Your edited invoice items are preserved below. Please review them and try again.</p>
              {invoiceData && invoiceData.items.length > 0 && (
                <button
                  type="button"
                  onClick={handleInitiateAddToStock}
                  disabled={isSaving}
                  className="mt-2 text-xs font-black text-rose-800 underline underline-offset-2 hover:text-rose-950 cursor-pointer"
                >
                  Try adding to stock again
                </button>
              )}
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setStockUpdateError(null)} 
            className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* General Success Notification */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 rounded-2xl border-2 border-emerald-500 text-emerald-900 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <p className="text-sm font-extrabold">{successMessage}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {setActivePage && (
              <Button 
                variant="primary" 
                size="sm" 
                onClick={() => setActivePage('inventory')}
                icon={<ArrowRight className="w-4 h-4" />}
                className="font-black"
              >
                View Stock Catalog
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setSuccessMessage(null)}
              className="font-bold"
            >
              Scan Another
            </Button>
          </div>
        </div>
      )}

      {/* Interactive Product Table Cropper Modal */}
      {isCroppingOpen && cropperImageUrl && (
        <ImageTableCropper
          imageUrl={cropperImageUrl}
          onConfirmCrop={handleConfirmCropAndScan}
          onCancel={() => setIsCroppingOpen(false)}
          onRetake={() => {
            setIsCroppingOpen(false);
            setCropperImageUrl(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      )}

      {/* Workflow Mode Selector */}
      {!invoiceData && (
        <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit mb-2">
          <button
            type="button"
            onClick={() => setScanWorkflow('table')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
              scanWorkflow === 'table'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ScanLine className="w-4 h-4 text-emerald-600" />
            Scan Product Table (Recommended)
          </button>
          <button
            type="button"
            onClick={() => setScanWorkflow('full')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
              scanWorkflow === 'full'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-blue-600" />
            Full Invoice Scan
          </button>
        </div>
      )}

      {/* Main Upload Dropzone & Controls (When no invoice parsed) */}
      {!invoiceData && (
        <Card className="text-center p-6 sm:p-10 border-2 border-dashed border-emerald-300 bg-emerald-50/20">
          <div className="max-w-md mx-auto space-y-6">
            
            {/* Big Scanner Icon Area */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-emerald-600 text-white mx-auto flex items-center justify-center relative group">
              <Camera className="w-10 h-10 sm:w-12 sm:h-12 group-hover:scale-110 transition-transform" />
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-teal-500 border-2 border-white flex items-center justify-center text-white">
                <ScanLine className="w-3.5 h-3.5" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-black text-slate-900">
                {scanWorkflow === 'table' ? 'Scan & Crop Product Table' : t('scanner.heading')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed font-semibold">
                {scanWorkflow === 'table'
                  ? 'Take a photo or upload an invoice, then crop ONLY the line-items table. Eliminates header/footer OCR errors.'
                  : t('scanner.subheading')}
              </p>
            </div>

            {/* Supported Information Badges */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 text-xs text-left space-y-2 shadow-2xs">
              <p className="font-extrabold text-slate-900 uppercase tracking-wider mb-1">{t('scanner.supportedHeading')}</p>
              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t('scanner.supportedNames')}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t('scanner.supportedQty')}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t('scanner.supportedPrice')}</span>
              </div>
            </div>

            {/* Scanning Progress Bar */}
            {isScanning ? (
              <div className="p-5 bg-white rounded-2xl border border-emerald-300 shadow-sm space-y-3 text-left" aria-live="polite">
                {/* Stage list: only stages the app can actually detect are shown */}
                <ol className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide" aria-label="Scan progress">
                  {[
                    { key: 'uploading', label: 'Uploading' },
                    { key: 'processing', label: 'Processing' },
                    { key: 'review', label: 'Review' },
                  ].map((step, idx) => {
                    const order = { uploading: 0, processing: 1, review: 2 } as const;
                    const current = order[scanPhase as 'uploading' | 'processing'];
                    const state = idx < current ? 'done' : idx === current ? 'active' : 'todo';
                    return (
                      <li
                        key={step.key}
                        aria-current={state === 'active' ? 'step' : undefined}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
                          state === 'active'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                            : state === 'done'
                            ? 'bg-white border-slate-200 text-slate-500'
                            : 'bg-white border-slate-200 text-slate-400'
                        }`}
                      >
                        {state === 'done' ? (
                          <Check className="w-3 h-3" aria-hidden="true" />
                        ) : state === 'active' ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : null}
                        <span>{step.label}</span>
                        <span className="sr-only">{state === 'done' ? '(done)' : state === 'active' ? '(in progress)' : '(not started)'}</span>
                      </li>
                    );
                  })}
                </ol>

                <p role="status" className="text-xs font-bold text-slate-800 flex items-start gap-2">
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" aria-hidden="true" />
                  <span>
                    {scanStatusText}
                    {scanPhase === 'uploading' && uploadPercent !== null ? ` ${uploadPercent}%` : ''}
                  </span>
                </p>

                {scanPhase === 'uploading' && uploadPercent !== null && (
                  <div
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadPercent}
                    className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"
                  >
                    <div className="h-full bg-emerald-600 rounded-full transition-[width] duration-200" style={{ width: `${uploadPercent}%` }} />
                  </div>
                )}
                <p className="text-[11px] text-slate-500 font-medium">
                  {scanPhase === 'uploading'
                    ? 'Sending the file to the ShopPulse server.'
                    : 'This can take up to a minute for photos. Nothing is added to stock until you review and confirm.'}
                </p>
              </div>
            ) : (
              /* Drag & Drop Box */
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`p-6 sm:p-8 bg-white rounded-2xl border-2 transition-all cursor-pointer shadow-2xs flex flex-col items-center gap-2.5 group active:scale-[0.99] ${
                  isDragging ? 'border-emerald-500 bg-emerald-50/50 scale-[1.01]' : 'border-slate-300 hover:border-emerald-500'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-extrabold text-slate-800">
                  {t('scanner.dragDrop')}
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  {t('scanner.supportsFormat')}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                disabled={isScanning}
                onClick={() => fileInputRef.current?.click()}
                icon={<Upload className="w-5 h-5" />}
                className="font-black py-3.5 shadow-sm"
              >
                {t('scanner.uploadPhoto')}
              </Button>
              
              <Button
                variant="outline"
                size="lg"
                disabled={isScanning}
                onClick={startCamera}
                icon={<Camera className="w-5 h-5" />}
                className="font-black py-3.5"
              >
                {t('scanner.openCamera')}
              </Button>
            </div>

            {/* Quick Sample Invoices for Instant 1-Click Demo */}
            <div className="pt-4 border-t border-slate-200">
              <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2.5">
                Try One-Click Sample Invoices:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SAMPLE_INVOICES.map((sample, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isScanning}
                    onClick={() => loadSampleInvoice(idx)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 hover:border-emerald-500 transition-colors text-xs font-bold shadow-2xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{sample.label}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </Card>
      )}

      {/* Interactive Review & Confirmation Screen */}
      {invoiceData && (
        <Card className="border-2 border-emerald-400 bg-white shadow-lg space-y-6">
          
          {/* Scanned Header Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                    {invoiceData.supplierName && invoiceData.supplierName.trim() !== ''
                      ? invoiceData.supplierName
                      : 'Supplier could not be detected'}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 text-[10px] font-black border border-slate-300">
                    OCR Quality: {invoiceData.confidenceScore}%
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-300">
                    Line Extraction: {invoiceData.items.length} items
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-black border border-blue-300">
                    Inventory Match: {invoiceData.items.filter((i) => i.matchedProductId).length}/{invoiceData.items.length}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black border border-slate-300">
                    {ENGINE_LABELS[invoiceData.engineUsed || 'sample'] || invoiceData.engineUsed}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Invoice #{invoiceData.invoiceNumber || 'Not detected'} • Date: {invoiceData.invoiceDate && invoiceData.invoiceDate.trim() !== '' ? invoiceData.invoiceDate : 'Invoice date could not be detected'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {cropperImageUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCroppingOpen(true)}
                  icon={<ScanLine className="w-4 h-4 text-emerald-600" />}
                  className="font-bold text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-300"
                >
                  Recrop Table
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDebugOpen(true)}
                icon={<Cpu className="w-4 h-4 text-purple-600" />}
                className="font-bold text-xs text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-200"
              >
                Inspect Layout & OCR
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={requestDiscardReview}
                icon={<X className="w-4 h-4" />}
                className="font-bold text-slate-600"
              >
                Cancel & Rescan
              </Button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">{t('scanner.supplier')}</p>
              <p className="font-extrabold text-slate-900 mt-1 truncate">
                {invoiceData.supplierName && invoiceData.supplierName.trim() !== '' ? invoiceData.supplierName : 'Not detected'}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">{t('scanner.itemsExtracted')}</p>
              <p className="font-extrabold text-slate-900 mt-1">{invoiceData.items.length} Products</p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">Total Units to Restock</p>
              <p className="font-extrabold text-slate-900 mt-1">{totalUnits} Units</p>
            </div>
            <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200">
              <p className="text-[11px] text-emerald-800 font-bold uppercase">{t('scanner.totalAmount')}</p>
              <p className="font-black text-emerald-700 text-base mt-0.5">₹{calculatedTotal.toLocaleString('en-IN')}</p>
            </div>
          </div>

          {/* Total Validation Warning */}
          {Boolean(
            (invoiceData.canonical?.totalAmount || invoiceData.totalAmount) &&
            Math.abs(calculatedTotal - (invoiceData.canonical?.totalAmount || invoiceData.totalAmount)) > 2
          ) && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs font-semibold flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Extraction requires review: Sum of line items (₹{calculatedTotal.toLocaleString('en-IN')}) differs from invoice total (₹{(invoiceData.canonical?.totalAmount || invoiceData.totalAmount).toLocaleString('en-IN')}). Please check and edit lines if needed.
              </span>
            </div>
          )}

          {/* Extracted Items: Mobile Cards & Desktop Table */}
          <div className="space-y-4">

            {invoiceData.notices && invoiceData.notices.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs space-y-1">
                {invoiceData.notices.map((n, i) => (
                  <p key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{n}</span>
                  </p>
                ))}
              </div>
            )}
            
            {/* Extraction issues, grouped by kind (missing, low confidence, arithmetic, MRP lookup) */}
            {extractionIssues.length > 0 && (
              <section aria-label="Extraction issues to review" className="p-3 sm:p-4 bg-white border border-slate-300 rounded-2xl space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-slate-600">Check before adding to stock</p>
                <ul className="space-y-1.5">
                  {extractionIssues.map((issue) => (
                    <li key={issue.key} className="text-xs flex items-start gap-2">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-px" aria-hidden="true" />
                      ) : issue.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-px" aria-hidden="true" />
                      ) : (
                        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-px" aria-hidden="true" />
                      )}
                      <span className="text-slate-700">
                        <span className="font-black text-slate-900">
                          {issue.severity === 'error' ? 'Required: ' : issue.severity === 'warning' ? 'Check: ' : 'Note: '}
                          {issue.label}
                        </span>{' '}
                        ({issue.itemIds.length} {issue.itemIds.length === 1 ? 'line' : 'lines'}:{' '}
                        {issue.itemNames.slice(0, 3).join(', ')}
                        {issue.itemNames.length > 3 ? ` +${issue.itemNames.length - 3} more` : ''}). {issue.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Validation Errors Alert Banner */}
            {validationErrors.length > 0 && (
              <div className="p-4 bg-rose-50 rounded-2xl border-2 border-rose-400 text-rose-950 shadow-sm space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <p className="font-extrabold text-sm sm:text-base">
                      Please fix {validationErrors.length === 1 ? 'this item' : `these ${validationErrors.length} items`} before adding to stock:
                    </p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setValidationErrors([])} 
                    className="text-rose-600 hover:text-rose-800 text-xs font-bold cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
                <ul className="text-xs space-y-1 pl-6 list-disc text-rose-900 font-medium">
                  {validationErrors.map((err) => (
                    <li key={err.itemId}>
                      <span className="font-bold">{err.itemName}:</span> {err.issues.join(' • ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Review & Edit Mode Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-xs">
              <div className="flex items-center gap-2 text-emerald-950 font-bold">
                <Edit3 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Review & Edit: You can correct any spelling, quantities, prices, or units inline, or click ✏️ for full details.</span>
              </div>
              <span className="text-[11px] text-emerald-800 font-semibold bg-emerald-100/70 px-2 py-0.5 rounded-lg border border-emerald-200">
                Totals recalculate live
              </span>
            </div>

            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Extracted Line Items ({invoiceData.items.length})</span>
              </h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-black text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-emerald-50 border border-emerald-200 active:scale-95 transition-transform cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            {invoiceData.confidenceScore < 70 && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs font-semibold flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>OCR Quality is {invoiceData.confidenceScore}%. Items with ⚠️ Review have uncertain text or numbers—please check and edit if needed.</span>
              </div>
            )}

            {/* Mobile Cards View (< md) */}
            <div className="md:hidden space-y-3">
              {invoiceData.items.map((item) => {
                const itemError = validationErrors.find((e) => e.itemId === item.id);
                const isUncertain = item.lowConfidence || (typeof item.confidence === 'number' && item.confidence < 70);
                return (
                  <div 
                    key={item.id} 
                    className={`p-3.5 rounded-2xl transition-all space-y-3 ${
                      itemError 
                        ? 'border-2 border-rose-400 bg-rose-50/40 ring-1 ring-rose-300' 
                        : isUncertain
                        ? 'border border-amber-300 bg-amber-50/30'
                        : 'border border-slate-200 bg-slate-50/80'
                    }`}
                  >
                    {itemError && (
                      <div className="text-[11px] font-bold text-rose-700 bg-rose-100 border border-rose-200 px-2 py-1 rounded-lg flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{itemError.issues.join(' • ')}</span>
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-bold uppercase text-slate-500">Product Name</label>
                          <div className="flex items-center gap-1.5">
                            {item.validationStatus && <ValidationStatusBadge status={item.validationStatus} />}
                            {isUncertain && (
                              <span className="text-[9px] font-black text-amber-800 bg-amber-200 px-1 rounded">⚠️ Review</span>
                            )}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleItemChange(item.id, 'name', e.target.value)}
                          placeholder="e.g. Aashirvaad Atta 5 kg"
                          className="w-full font-bold text-slate-900 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none text-base sm:text-sm"
                        />
                        {item.inventoryData && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded-lg">
                            <span className="font-semibold text-slate-700">Store:</span>
                            <span>Purch: {knownStorePrice(item.inventoryData.storePurchasePrice) != null ? `₹${item.inventoryData.storePurchasePrice}` : '—'}</span>
                            <span>•</span>
                            <span>Sell: {item.inventoryData.storeSellingPrice != null ? `₹${item.inventoryData.storeSellingPrice}` : '—'}</span>
                            {item.inventoryData.storeMrp != null && (
                              <>
                                <span>•</span>
                                <span>MRP: ₹{item.inventoryData.storeMrp}</span>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => applyStorePrices(item)}
                              className="ml-auto text-[10px] text-emerald-700 hover:text-emerald-800 font-bold hover:underline cursor-pointer"
                              title="Click to copy existing inventory prices to this item"
                            >
                              Use Store Prices
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-4 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingItem({ ...item })}
                          aria-label="Edit item details"
                          title="Edit full item details"
                          className="text-slate-500 hover:text-emerald-700 w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-white border border-slate-200 active:scale-95 transition-all cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          aria-label="Remove item"
                          title="Remove item"
                          className="text-slate-400 hover:text-rose-600 w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-white border border-slate-200 active:scale-95 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Category</label>
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
                          className="w-full text-xs font-semibold bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity ?? ''}
                          placeholder="—"
                          onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value.trim() === '' ? null : Number(e.target.value))}
                          className="w-full text-center font-extrabold text-slate-900 bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Unit</label>
                        <select
                          value={item.unit || ''}
                          onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                          className="w-full text-xs font-bold text-slate-800 bg-white px-1.5 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none capitalize"
                        >
                          <option value="" disabled>Select</option>
                          {COMMON_UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          {item.unit && !COMMON_UNITS.includes(item.unit.toLowerCase()) && (
                            <option value={item.unit}>{item.unit}</option>
                          )}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Pack Size</label>
                        <input
                          type="text"
                          value={formatPackSize(item)}
                          placeholder="e.g. 400g"
                          onChange={(e) => handleItemChange(item.id, 'packSize' as any, e.target.value)}
                          className="w-full text-xs font-medium text-slate-700 bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-right">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5 text-left">
                          Purchase Price (₹)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={item.purchasePrice ?? item.rate ?? ''}
                          placeholder="—"
                          title={item.purchasePrice === null && item.rate === null ? 'Purchase price not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'purchasePrice', val === '' ? null : Number(val));
                          }}
                          className="w-full text-right font-bold text-slate-800 bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none text-base sm:text-sm placeholder:text-slate-400 placeholder:font-normal"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5 text-left">
                          Selling Price (₹)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={item.sellingPrice ?? ''}
                          placeholder="—"
                          title={item.sellingPrice === null ? 'Selling price not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'sellingPrice', val === '' ? null : Number(val));
                          }}
                          className="w-full text-right font-bold text-emerald-700 bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none text-base sm:text-sm placeholder:text-slate-400 placeholder:font-normal"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5 text-left">
                          MRP (₹)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={item.mrp ?? ''}
                          placeholder="—"
                          title={item.mrp === null ? 'MRP not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'mrp', val === '' ? null : Number(val));
                          }}
                          className="w-full text-right font-bold text-slate-700 bg-white px-2 py-1.5 rounded-xl border border-slate-200 focus:border-emerald-500 focus:outline-none text-base sm:text-sm placeholder:text-slate-400 placeholder:font-normal"
                        />
                        <MrpStatus item={item} />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5 text-right">Line Amount</label>
                        <div className="min-h-[38px] flex items-center justify-end px-2 text-sm">
                          <LineAmount item={item} />
                        </div>
                      </div>
                    </div>

                    <LineReviewNotes item={item} onApplyRate={() => applySuggestedRate(item)} />

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-xs">
                      <span className="text-[11px] text-slate-500 font-medium">Store Match:</span>
                      <button
                        type="button"
                        onClick={() => setMatchingPickerItem(item)}
                        className="cursor-pointer active:scale-95 flex items-center gap-1"
                        title="Click to match with store inventory or mark as new"
                      >
                        {item.matchedProductId ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold shadow-2xs border border-emerald-200">
                            <Check className="w-3 h-3 text-emerald-700" /> Matched: {item.inventoryData?.name || 'Existing Product'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold shadow-2xs border border-blue-200">
                            <Plus className="w-3 h-3 text-blue-700" /> + New Item
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 hover:text-slate-600 underline">Change</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View (>= md) */}
            {/* The table scrolls inside this box so its header stays visible over long invoices */}
            <div className="hidden md:block overflow-auto max-h-[70dvh] border border-slate-200 rounded-2xl">
              <table className="w-full text-left text-xs sm:text-sm">
                <caption className="sr-only">Extracted invoice line items</caption>
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] select-none shadow-[inset_0_-1px_0_0_rgb(226_232_240)]">
                  <tr>
                    <th className="py-3 px-3 sm:px-4">Product Name</th>
                    <th className="py-3 px-2">Category</th>
                    <th className="py-3 px-2 text-center">Qty</th>
                    <th className="py-3 px-2 text-center">Unit</th>
                    <th className="py-3 px-2 text-center">Pack</th>
                    <th className="py-3 px-2 text-right">Purchase Price (₹)</th>
                    <th className="py-3 px-2 text-right">Selling Price (₹)</th>
                    <th className="py-3 px-2 text-right">MRP (₹)</th>
                    <th className="py-3 px-2 text-right">Line Amount (₹)</th>
                    <th className="py-3 px-2 text-center">Validation</th>
                    <th className="py-3 px-2 text-center">Store Status</th>
                    <th className="py-3 px-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {invoiceData.items.map((item) => {
                    const itemError = validationErrors.find((e) => e.itemId === item.id);
                    const isUncertain = item.lowConfidence || (typeof item.confidence === 'number' && item.confidence < 70);
                    return (
                    <tr 
                      key={item.id} 
                      className={`transition-colors ${
                        itemError
                          ? 'bg-rose-50/70 hover:bg-rose-100/60 border-l-4 border-l-rose-500'
                          : isUncertain 
                          ? 'bg-amber-50/70 hover:bg-amber-100/60 border-l-4 border-l-amber-400' 
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2.5 px-3 sm:px-4 min-w-[15rem]">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleItemChange(item.id, 'name', e.target.value)}
                          placeholder="e.g. Tata Salt 1 kg"
                          className="w-full min-w-0 font-bold text-slate-900 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                        />
                        {(itemError || isUncertain || item.arithmeticStatus === 'MISMATCH') && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {itemError && (
                              <span
                                className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-900 text-[10px] font-black select-none"
                                title={itemError.issues.join(' • ')}
                              >
                                Fix required
                              </span>
                            )}
                            {isUncertain && !itemError && (
                              <span
                                className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-black select-none"
                                title="Some values need checking"
                              >
                                Review
                              </span>
                            )}
                            {item.arithmeticStatus === 'MISMATCH' && !itemError && (
                              <span
                                className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-black select-none border border-rose-200"
                                title={item.validationWarning}
                              >
                                Qty × rate ≠ amount
                              </span>
                            )}
                          </div>
                        )}
                        {item.inventoryData && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 px-2 py-0.5 rounded-md">
                            <span className="font-semibold text-slate-600">Store:</span>
                            <span>Purch: {knownStorePrice(item.inventoryData.storePurchasePrice) != null ? `₹${item.inventoryData.storePurchasePrice}` : '—'}</span>
                            <span>•</span>
                            <span>Sell: {item.inventoryData.storeSellingPrice != null ? `₹${item.inventoryData.storeSellingPrice}` : '—'}</span>
                            {item.inventoryData.storeMrp != null && (
                              <>
                                <span>•</span>
                                <span>MRP: ₹{item.inventoryData.storeMrp}</span>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => applyStorePrices(item)}
                              className="ml-auto text-[10px] text-emerald-700 hover:text-emerald-800 font-bold hover:underline cursor-pointer"
                              title="Click to copy existing inventory prices to this item"
                            >
                              Use Store Prices
                            </button>
                          </div>
                        )}
                        <LineReviewNotes item={item} onApplyRate={() => applySuggestedRate(item)} />
                      </td>
                      <td className="py-2.5 px-2 text-slate-600">
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
                          className="w-16 sm:w-20 text-xs font-semibold bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity ?? ''}
                          placeholder="—"
                          onChange={(e) => handleItemChange(item.id, 'quantity', e.target.value.trim() === '' ? null : Number(e.target.value))}
                          className="w-12 text-center font-extrabold text-slate-900 bg-slate-100 rounded-lg py-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <select
                          value={item.unit || ''}
                          onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                          className="text-xs font-bold text-slate-800 bg-slate-100 rounded-lg py-1 px-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 capitalize"
                        >
                          <option value="" disabled>Select</option>
                          {COMMON_UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                          {item.unit && !COMMON_UNITS.includes(item.unit.toLowerCase()) && (
                            <option value={item.unit}>{item.unit}</option>
                          )}
                        </select>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input
                          type="text"
                          value={formatPackSize(item)}
                          placeholder="—"
                          title="Packaging size printed on product (e.g. 400g, 1L, 25kg)"
                          onChange={(e) => handleItemChange(item.id, 'packSize' as any, e.target.value)}
                          className="w-16 text-center text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg py-1 px-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-300"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={item.purchasePrice ?? item.rate ?? ''}
                          placeholder="—"
                          title={item.purchasePrice === null && item.rate === null ? 'Purchase price not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'purchasePrice', val === '' ? null : Number(val));
                          }}
                          className="w-16 sm:w-20 text-right font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={item.sellingPrice ?? ''}
                          placeholder="—"
                          title={item.sellingPrice === null ? 'Selling price not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'sellingPrice', val === '' ? null : Number(val));
                          }}
                          className="w-16 sm:w-20 text-right font-bold text-emerald-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={item.mrp ?? ''}
                          placeholder="—"
                          title={item.mrp === null ? 'MRP not provided in invoice' : undefined}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            handleItemChange(item.id, 'mrp', val === '' ? null : Number(val));
                          }}
                          className="w-16 sm:w-20 text-right font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
                        />
                        <div className="max-w-[9rem] ml-auto">
                          <MrpStatus item={item} />
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <LineAmount item={item} />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <ValidationStatusBadge status={item.validationStatus} />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => setMatchingPickerItem(item)}
                          title="Click to match with store product or toggle new item"
                          className="cursor-pointer transition-transform active:scale-95 select-none inline-block"
                        >
                          {item.matchedProductId ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-extrabold shadow-2xs border border-emerald-200">
                              <Check className="w-3 h-3 text-emerald-700" /> Restock
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-800 text-[10px] font-extrabold shadow-2xs border border-blue-200">
                              <Plus className="w-3 h-3 text-blue-700" /> New Item
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingItem({ ...item })}
                            className="text-slate-500 hover:text-emerald-700 p-1.5 transition-colors cursor-pointer rounded-lg hover:bg-slate-100"
                            title="Edit full item details (HSN, Tax, MRP, etc.)"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 transition-colors cursor-pointer rounded-lg hover:bg-slate-100"
                            title="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>

            {/* Structured Diagnostic Failure Card (Phase 20) */}
            {invoiceData.items.length === 0 && (
              <div className="p-5 bg-amber-50/90 border-2 border-amber-300 rounded-3xl text-amber-950 text-xs sm:text-sm space-y-3 shadow-xs animate-in fade-in">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-5 h-5 text-amber-700" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-amber-950 text-sm">Extraction Needs Review</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-mono font-bold uppercase">
                          0 Products Extracted
                        </span>
                      </div>
                      <p className="text-amber-800 font-medium text-xs mt-1">
                        {invoiceData.reason || 'The parser could not confidently isolate standard table columns or price rows from this document.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-amber-200">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAddItem}
                    icon={<Plus className="w-4 h-4" />}
                    className="font-bold text-xs"
                  >
                    + Add Item Manually
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDebugOpen(true)}
                    icon={<Cpu className="w-4 h-4" />}
                    className="font-bold text-xs bg-white text-slate-800"
                  >
                    Inspect OCR Diagnostics
                  </Button>
                </div>
              </div>
            )}

            {/* Raw Detected OCR Text Accordion */}
            {invoiceData.rawOcrText && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50">
                <button
                  type="button"
                  onClick={() => setIsRawTextOpen(!isRawTextOpen)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-black text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span>View Detected Bill Text ({invoiceData.rawOcrText.split('\n').filter(Boolean).length} lines detected)</span>
                  </span>
                  <span className="text-[11px] text-emerald-700 font-bold">
                    {isRawTextOpen ? 'Hide Raw Text ▲' : 'Show Raw Text ▼'}
                  </span>
                </button>
                {isRawTextOpen && (
                  <div className="p-3 border-t border-slate-200 bg-slate-900 text-slate-200 text-xs font-mono max-h-56 overflow-y-auto whitespace-pre-wrap rounded-b-2xl">
                    {invoiceData.rawOcrText}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
              <Info className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Confirming will validate items, prompt confirmation, and update store stock atomically.</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={requestDiscardReview}
                disabled={isSaving}
                className="w-1/3 sm:w-auto font-bold"
              >
                Discard
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={isSaving || invoiceData.items.length === 0}
                onClick={handleInitiateAddToStock}
                icon={isSaving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                className="w-2/3 sm:w-auto font-black px-6"
              >
                {isSaving ? 'Adding to Stock...' : `Add to Stock (${totalUnits} Units)`}
              </Button>
            </div>
          </div>

        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmDiscardReview}
        title="Discard this invoice?"
        message={
          <>
            The {invoiceData?.items.length ?? 0} extracted line{invoiceData?.items.length === 1 ? '' : 's'} and any corrections you
            made will be lost. Your stock has not been changed.
          </>
        }
        confirmLabel="Discard invoice"
        cancelLabel="Keep reviewing"
        tone="default"
        onConfirm={discardReview}
        onCancel={() => setConfirmDiscardReview(false)}
      />

      {/* Confirmation Before Stock Update Modal (Section 8 & 15) */}
      {isConfirmModalOpen && invoiceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 animate-in fade-in">
          <div ref={confirmModalRef} role="dialog" aria-modal="true" aria-labelledby={confirmTitleId} className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-5 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 id={confirmTitleId} className="text-lg font-black text-slate-900">Confirm & Add to Stock</h3>
                  <p className="text-xs text-slate-500 font-medium">Verify summary before inventory database update</p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsConfirmModalOpen(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Exact Impact Summary */}
            <div className="grid grid-cols-3 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-center">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Products</p>
                <p className="text-base sm:text-lg font-black text-slate-900 mt-0.5">{invoiceData.items.length}</p>
                <p className="text-[10px] text-slate-500 font-semibold">
                  {invoiceData.items.filter((i) => i.matchedProductId || products.some(p => p.name.toLowerCase().trim() === i.name.toLowerCase().trim())).length} restock • {invoiceData.items.filter((i) => !i.matchedProductId && !products.some(p => p.name.toLowerCase().trim() === i.name.toLowerCase().trim())).length} new
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Total Units</p>
                <p className="text-base sm:text-lg font-black text-emerald-700 mt-0.5">{totalUnits}</p>
                <p className="text-[10px] text-slate-500 font-semibold">To inventory</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Purchase Cost</p>
                <p className="text-base sm:text-lg font-black text-teal-700 mt-0.5">₹{calculatedTotal.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-slate-500 font-semibold">Wholesale value</p>
              </div>
            </div>

            {/* Products Breakdown List */}
            <div className="space-y-2">
              <p className="text-xs font-black uppercase text-slate-500 tracking-wider">Item Details to Add ({invoiceData.items.length})</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                {invoiceData.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-xs py-1 px-2 bg-white rounded-lg border border-slate-100">
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-bold text-slate-900 truncate">{it.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {it.quantity ?? '—'} {it.unit} @ {it.purchasePrice != null ? `₹${it.purchasePrice}` : 'Rate —'}
                        {it.mrp != null ? ` • MRP ₹${it.mrp}` : ''}
                        {it.matchedProductId ? ' • Restocking' : ' • New Item'}
                      </p>
                    </div>
                    <span className="font-black text-slate-900 shrink-0">
                      {it.lineTotal != null ? `₹${it.lineTotal.toLocaleString('en-IN')}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl text-[11px] text-emerald-950 font-medium">
              Stock, prices, MRPs and the purchase record are saved together; if anything fails, nothing is changed.
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => setIsConfirmModalOpen(false)}
                className="font-bold"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={isSaving}
                onClick={handleConfirmAddToStock}
                icon={<Check className="w-4 h-4" />}
                className="font-black px-5"
              >
                {isSaving ? 'Adding to Stock...' : 'Confirm & Add to Stock'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Full Line Item Edit Modal (Section 1, 2, 3, 4, 5, 6) */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 animate-in fade-in">
          <div ref={editModalRef} role="dialog" aria-modal="true" aria-labelledby={editTitleId} className="bg-white rounded-3xl border border-slate-200 max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 id={editTitleId} className="text-base font-black text-slate-900">Edit Line Item Details</h3>
                  <p className="text-xs text-slate-500">Correct spelling, prices, units, HSN, and taxes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Product Name */}
              <div>
                <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  placeholder="e.g. Aashirvaad Atta 5 kg"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  You can correct any OCR spelling mistakes directly here.
                </p>
              </div>

              {/* Category */}
              <div>
                <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={editingItem.category}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  placeholder="e.g. Groceries, Dairy, Beverages"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              {/* Quantity, Unit & Pack Size */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingItem.quantity ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({ ...editingItem, quantity: val === '' ? null : Number(val) });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-extrabold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Unit *
                  </label>
                  <select
                    value={editingItem.unit || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white capitalize"
                  >
                    <option value="" disabled>Select</option>
                    {COMMON_UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    {editingItem.unit && !COMMON_UNITS.includes(editingItem.unit.toLowerCase()) && (
                      <option value={editingItem.unit}>{editingItem.unit}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Pack Size
                  </label>
                  <input
                    type="text"
                    value={formatPackSize(editingItem)}
                    placeholder="e.g. 400g / 1L"
                    onChange={(e) => setEditingItem(setPackSizeText(editingItem, e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              {/* Purchase, Selling, MRP Prices */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Purchase Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.purchasePrice ?? editingItem.rate ?? ''}
                    placeholder="— (not on bill)"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      const num = val === '' ? null : Number(val);
                      setEditingItem({ ...editingItem, purchasePrice: num, rate: num });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Selling Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.sellingPrice ?? ''}
                    placeholder="— (not on bill)"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        sellingPrice: val === '' ? null : Number(val),
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-emerald-700 focus:outline-none focus:border-emerald-600 focus:bg-white placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    MRP (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.mrp ?? ''}
                    placeholder="— (not on bill)"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        mrp: val === '' ? null : Number(val),
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-700 focus:outline-none focus:border-emerald-600 focus:bg-white placeholder:text-slate-400 placeholder:font-normal"
                  />
                </div>
              </div>

              {/* Discount, GST Rate, HSN Code */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    Discount (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.discount ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        discount: val === '' ? null : Number(val),
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    GST / Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingItem.gstRate ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        gstRate: val === '' ? null : Number(val),
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={editingItem.hsnCode ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        hsnCode: val === '' ? null : val,
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white font-mono"
                  />
                </div>
              </div>

              {/* Line Total */}
              <div>
                <label className="font-extrabold text-slate-800 uppercase tracking-wider block mb-1">
                  Line Amount (₹)
                  {editingItem.lineTotalSource === 'INVOICE' && (
                    <span className="ml-2 normal-case font-semibold text-slate-500">printed on invoice</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.lineTotal ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setEditingItem({
                        ...editingItem,
                        lineTotal: val === '' ? null : Number(val),
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-black text-slate-900 text-sm focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                  <button
                    type="button"
                    disabled={editingItem.quantity == null || (editingItem.purchasePrice ?? editingItem.rate) == null}
                    onClick={() => {
                      const pur = Number(editingItem.purchasePrice ?? editingItem.rate);
                      const q = Number(editingItem.quantity);
                      setEditingItem({
                        ...editingItem,
                        lineTotal: Math.round(q * pur * 100) / 100,
                      });
                    }}
                    className="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold shrink-0 text-xs cursor-pointer"
                    title="Auto-calculate as Qty × Purchase Price"
                  >
                    Recalculate
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Quantity × purchase price = {editingItem.quantity ?? '—'} × ₹{editingItem.purchasePrice ?? editingItem.rate ?? '—'}
                  {editingItem.quantity != null && (editingItem.purchasePrice ?? editingItem.rate) != null
                    ? ` = ₹${Math.round(Number(editingItem.quantity) * Number(editingItem.purchasePrice ?? editingItem.rate) * 100) / 100}`
                    : ''}
                </p>
              </div>

              {/* Store Matching info */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">Store Catalog Link</p>
                  <p className="text-[11px] text-slate-500">
                    {editingItem.matchedProductId ? `Matched to store item (Stock: ${editingItem.inventoryData?.currentStock ?? 0})` : 'New item (will be created in catalog)'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const currentIt = editingItem;
                    setMatchingPickerItem(currentIt);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-emerald-700 font-bold text-xs hover:bg-emerald-50 cursor-pointer"
                >
                  {editingItem.matchedProductId ? 'Change Match' : 'Link Store Item'}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingItem(null)}
                className="font-bold"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSaveEditingItem(editingItem)}
                className="font-black px-4"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Product Matcher Picker Modal (Section 10) */}
      {matchingPickerItem && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-3 sm:p-4 animate-in fade-in">
          <div ref={pickerModalRef} role="dialog" aria-modal="true" aria-labelledby={pickerTitleId} className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Search className="w-4 h-4" />
                </div>
                <div>
                  <h3 id={pickerTitleId} className="text-base font-black text-slate-900">Select Store Product</h3>
                  <p className="text-xs text-slate-500">Link extracted line to existing product or create new</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMatchingPickerItem(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                Item from invoice: <span className="font-extrabold text-slate-900">{matchingPickerItem.name}</span>
              </p>
              
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={matchingSearch}
                  onChange={(e) => setMatchingSearch(e.target.value)}
                  placeholder="Search products by name or category..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              {/* Option to create as brand new item */}
              <button
                type="button"
                onClick={() => handleSelectMatchProduct(matchingPickerItem.id, null)}
                className="w-full text-left p-3 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 hover:bg-blue-50 transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <p className="font-extrabold text-blue-900 text-xs">+ Mark as Brand New Product</p>
                  <p className="text-[10px] text-blue-700">Creates a new product record in catalog rather than restocking existing</p>
                </div>
                <span className="text-xs font-bold text-blue-700">Select →</span>
              </button>
            </div>

            {/* List of matching products */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[160px]">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                Matching Store Products ({products.filter((p) => !matchingSearch || p.name.toLowerCase().includes(matchingSearch.toLowerCase()) || p.category.toLowerCase().includes(matchingSearch.toLowerCase())).length})
              </p>
              {products
                .filter((p) => !matchingSearch || p.name.toLowerCase().includes(matchingSearch.toLowerCase()) || p.category.toLowerCase().includes(matchingSearch.toLowerCase()))
                .map((p) => {
                  const isCurrent = matchingPickerItem.matchedProductId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleSelectMatchProduct(matchingPickerItem.id, p)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between text-xs ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-950 font-bold'
                          : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <p className="font-extrabold text-slate-900 truncate">{p.name}</p>
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">{p.category}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Stock: {p.stock} {p.unit || 'pcs'} • Purch: {knownStorePrice(p.purchasePrice) != null ? `₹${p.purchasePrice}` : '—'} • Sell: ₹{p.sellingPrice || p.price}
                          {p.mrp != null && ` • MRP: ₹${p.mrp}`}
                        </p>
                      </div>
                      <span className={`text-[11px] font-extrabold shrink-0 ${isCurrent ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {isCurrent ? '✓ Linked' : 'Link →'}
                      </span>
                    </div>
                  );
                })}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMatchingPickerItem(null)}
                className="font-bold text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live Camera Viewfinder Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4">
          <div ref={cameraModalRef} role="dialog" aria-modal="true" aria-labelledby={cameraTitleId} className="bg-slate-900 rounded-3xl border border-slate-700 overflow-hidden max-w-lg w-full shadow-2xl flex flex-col max-h-[92dvh]">
            
            <div className="p-3.5 sm:p-4 flex items-center justify-between border-b border-slate-800 text-white">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-emerald-400 shrink-0" />
                <span id={cameraTitleId} className="font-extrabold text-xs sm:text-base">Align Supplier Bill Inside Frame</span>
              </div>
              <button 
                onClick={closeCamera}
                aria-label="Close camera"
                className="w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cameraError && (
              <div className="p-3 bg-rose-900/40 border-b border-rose-700 text-rose-200 text-xs font-semibold text-center">
                {cameraError}
              </div>
            )}

            <div className="relative bg-black flex items-center justify-center min-h-[260px] sm:min-h-[380px] grow">
              <video 
                ref={videoRef} 
                playsInline 
                autoPlay 
                muted 
                className="w-full h-full object-cover"
              />
              
              {/* Target scan overlay guides */}
              <div className="absolute inset-6 sm:inset-8 border-2 border-dashed border-emerald-400/80 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
                  <div className="w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
                </div>
                <div className="text-center">
                  <span className="bg-black/60 px-3 py-1 rounded-full text-[11px] font-bold text-emerald-300">
                    Keep receipt flat & well-lit
                  </span>
                </div>
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-emerald-400" />
                </div>
              </div>
            </div>

            <div className="p-3.5 sm:p-4 bg-slate-900 flex items-center justify-between gap-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={closeCamera}
                className="text-white border-slate-700 hover:bg-slate-800 font-bold min-h-[44px] px-4"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={capturePhotoFromCamera}
                icon={<Camera className="w-5 h-5" />}
                className="font-black px-6 min-h-[44px]"
              >
                Capture Bill
              </Button>
            </div>

          </div>
        </div>
      )}

      {/* OCR Engine & Gemini API Key Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div ref={settingsModalRef} role="dialog" aria-modal="true" aria-labelledby={settingsTitleId} className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-5 animate-in fade-in max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 id={settingsTitleId} className="text-base font-black text-slate-900">OCR & AI Scanner Settings</h3>
                  <p className="text-xs text-slate-500 font-medium">Configure recognition engine & API keys</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)} 
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-extrabold text-slate-800 block mb-1.5 uppercase tracking-wider text-[11px]">
                  Recognition Engine Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('auto')}
                    className={`p-2.5 rounded-xl border text-center font-extrabold transition-all cursor-pointer ${
                      selectedEngine === 'auto' 
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Auto (Best)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('gemini')}
                    className={`p-2.5 rounded-xl border text-center font-extrabold transition-all cursor-pointer ${
                      selectedEngine === 'gemini' 
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Gemini AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEngine('tesseract')}
                    className={`p-2.5 rounded-xl border text-center font-extrabold transition-all cursor-pointer ${
                      selectedEngine === 'tesseract' 
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Local OCR
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {selectedEngine === 'auto' && 'Uses Gemini Vision if API key is provided, otherwise falls back to fast in-browser Tesseract OCR.'}
                  {selectedEngine === 'gemini' && 'Multimodal AI Vision for complex receipts, multi-lingual bills, and thermal printouts.'}
                  {selectedEngine === 'tesseract' && 'Runs 100% in your browser using Tesseract.js. No internet API required.'}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">
                    Google Gemini API Key (Optional)
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-black text-emerald-600 hover:underline"
                  >
                    Get Free Key ↗
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs pr-10 focus:outline-none focus:border-emerald-600 focus:bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Key is saved locally in your browser only. Free Google AI Studio tier includes generous daily quota.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setIsSettingsOpen(false)}
                className="font-bold"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setGeminiApiKey(apiKeyInput);
                  setPreferredOcrEngine(selectedEngine);
                  setIsSettingsOpen(false);
                }}
                className="font-black px-4"
              >
                Save Preferences
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Developer Debug Inspector Modal (Phase 19) */}
      {isDebugOpen && invoiceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 animate-in fade-in">
          <div ref={debugModalRef} role="dialog" aria-modal="true" aria-labelledby={debugTitleId} className="bg-slate-900 border border-slate-700 text-slate-100 rounded-3xl p-5 sm:p-6 max-w-4xl w-full max-h-[90dvh] overflow-y-auto space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-600/30 text-purple-400 flex items-center justify-center border border-purple-500/30">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 id={debugTitleId} className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                    <span>Developer OCR & Layout Inspector</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 font-mono uppercase">
                      Dev Debug View
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Spatial tokens, zoning sections, column aliases & arithmetic validation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDebugOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Document & Engine Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Document Type</span>
                <span className="font-extrabold text-white capitalize">{invoiceData.documentType || 'Image / Camera'}</span>
              </div>
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Engine Used</span>
                <span className="font-extrabold text-purple-300">{invoiceData.engineUsed || 'tesseract'}</span>
              </div>
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Extraction Method</span>
                <span className="font-mono text-emerald-400 font-bold">{invoiceData.extractionMethod || 'TABLE_STRUCTURED'}</span>
              </div>
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Overall Confidence</span>
                <span className="font-black text-amber-300">{invoiceData.confidenceScore}%</span>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 text-xs overflow-x-auto">
              <button
                type="button"
                onClick={() => setDebugTab('overview')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
                  debugTab === 'overview'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                Overview & Math
              </button>
              <button
                type="button"
                onClick={() => setDebugTab('raw_ocr')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
                  debugTab === 'raw_ocr'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                Raw OCR Text
              </button>
              <button
                type="button"
                onClick={() => setDebugTab('detected_words')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
                  debugTab === 'detected_words'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                Detected Words ({invoiceData.diagnostics?.rawWords?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDebugTab('columns_rows')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
                  debugTab === 'columns_rows'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                Detected Columns & Rows
              </button>
              <button
                type="button"
                onClick={() => setDebugTab('objects_api')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer shrink-0 ${
                  debugTab === 'objects_api'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                Parsed, API & Frontend
              </button>
            </div>

            {/* TAB 1: OVERVIEW & MATH CHECK */}
            {debugTab === 'overview' && (
              <div className="space-y-4">
                {/* Document & Engine Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Document Type</span>
                    <span className="font-extrabold text-white capitalize">{invoiceData.documentType || 'Image / Camera'}</span>
                  </div>
                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Engine Used</span>
                    <span className="font-extrabold text-purple-300">{invoiceData.engineUsed || 'tesseract'}</span>
                  </div>
                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Extraction Method</span>
                    <span className="font-mono text-emerald-400 font-bold">{invoiceData.extractionMethod || 'TABLE_STRUCTURED'}</span>
                  </div>
                  <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Overall Confidence</span>
                    <span className="font-black text-amber-300">{invoiceData.confidenceScore}%</span>
                  </div>
                </div>

                {/* Detected Document Sections */}
                {invoiceData.detectedSections && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                      Document Zoning Sections
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <span className="text-emerald-400 font-bold block text-[11px] mb-1">
                          Header & Supplier ({invoiceData.detectedSections.supplierLines?.length || 0} lines)
                        </span>
                        <p className="text-slate-300 truncate">
                          {invoiceData.detectedSections.supplierLines?.join(' • ') || 'None detected'}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <span className="text-blue-400 font-bold block text-[11px] mb-1">
                          Candidate Item Lines ({invoiceData.detectedSections.itemLines?.length || 0} lines)
                        </span>
                        <p className="text-slate-300 truncate">
                          {invoiceData.detectedSections.itemLines?.slice(0, 3).join(' • ') || 'None detected'}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <span className="text-amber-400 font-bold block text-[11px] mb-1">
                          Tax & Subtotals ({invoiceData.detectedSections.taxLines?.length || 0} lines)
                        </span>
                        <p className="text-slate-300 truncate">
                          {invoiceData.detectedSections.taxLines?.join(' • ') || 'None detected'}
                        </p>
                      </div>
                      <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <span className="text-rose-400 font-bold block text-[11px] mb-1">
                          Totals & Summary ({invoiceData.detectedSections.totalLines?.length || 0} lines)
                        </span>
                        <p className="text-slate-300 truncate">
                          {invoiceData.detectedSections.totalLines?.join(' • ') || 'None detected'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Canonical Line Items & Arithmetic Verification */}
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    Canonical Items & Mathematical Validation ({invoiceData.items.length})
                  </h4>
                  <div className="border border-slate-700 rounded-xl overflow-x-auto bg-slate-800/40">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-800 text-slate-300 text-[11px] uppercase">
                        <tr>
                          <th className="p-2">Item Name</th>
                          <th className="p-2 text-center">Qty</th>
                          <th className="p-2 text-right">Rate</th>
                          <th className="p-2 text-right">Total</th>
                          <th className="p-2 text-center">Math Check</th>
                          <th className="p-2 text-center">Conf</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {invoiceData.items.map((it) => {
                          const expectedTotal = (it.quantity !== null && it.purchasePrice !== null) ? Math.round(it.quantity * it.purchasePrice * 100) / 100 : null;
                          const hasMathIssue = Boolean(it.validationWarning);
                          return (
                            <tr key={it.id} className="hover:bg-slate-700/30">
                              <td className="p-2 font-bold text-white">{it.name}</td>
                              <td className="p-2 text-center">{it.quantity} {it.unit}</td>
                              <td className="p-2 text-right">{it.purchasePrice !== null ? `₹${it.purchasePrice}` : '—'}</td>
                              <td className="p-2 text-right">{it.lineTotal !== null ? `₹${it.lineTotal}` : '—'}</td>
                              <td className="p-2 text-center">
                                {hasMathIssue ? (
                                  <span className="text-[10px] text-rose-300 font-bold bg-rose-900/60 px-1.5 py-0.5 rounded">
                                    Diff (calc ₹{expectedTotal})
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-emerald-300 font-bold bg-emerald-900/60 px-1.5 py-0.5 rounded">
                                    ✓ Exact Match
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-center text-amber-300">{it.confidence}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: RAW OCR TEXT */}
            {debugTab === 'raw_ocr' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    RAW OCR Output Stream
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {invoiceData.rawOcrText ? invoiceData.rawOcrText.split('\n').filter(Boolean).length : 0} lines • {invoiceData.rawOcrText?.length || 0} characters
                  </span>
                </div>
                <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-300 max-h-96 overflow-y-auto whitespace-pre-wrap select-all leading-relaxed">
                  {invoiceData.rawOcrText || 'No raw OCR text recorded.'}
                </pre>
              </div>
            )}

            {/* TAB 3: DETECTED WORDS (word | x | y | width | height | confidence) */}
            {debugTab === 'detected_words' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    DETECTED WORDS (word | x | y | width | height | confidence)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {invoiceData.diagnostics?.rawWords?.length || 0} words with spatial coordinates
                  </span>
                </div>
                {invoiceData.diagnostics?.rawWords && invoiceData.diagnostics.rawWords.length > 0 ? (
                  <div className="border border-slate-700 rounded-xl overflow-x-auto max-h-96 overflow-y-auto bg-slate-800/40">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-800 text-slate-300 text-[11px] uppercase sticky top-0">
                        <tr>
                          <th className="p-2">word</th>
                          <th className="p-2 text-right">x</th>
                          <th className="p-2 text-right">y</th>
                          <th className="p-2 text-right">width</th>
                          <th className="p-2 text-right">height</th>
                          <th className="p-2 text-center">confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {invoiceData.diagnostics.rawWords.map((w, idx) => {
                          const x0 = w.bbox ? w.bbox.x0 : (w as any).x ?? 0;
                          const y0 = w.bbox ? w.bbox.y0 : (w as any).y ?? 0;
                          const width = w.bbox ? Math.round(w.bbox.x1 - w.bbox.x0) : (w as any).width ?? 0;
                          const height = w.bbox ? Math.round(w.bbox.y1 - w.bbox.y0) : (w as any).height ?? 0;
                          return (
                            <tr key={idx} className="hover:bg-slate-700/30">
                              <td className="p-2 font-bold text-white">{w.text}</td>
                              <td className="p-2 text-right text-slate-300">{Math.round(x0)}</td>
                              <td className="p-2 text-right text-slate-300">{Math.round(y0)}</td>
                              <td className="p-2 text-right text-slate-400">{width}</td>
                              <td className="p-2 text-right text-slate-400">{height}</td>
                              <td className="p-2 text-center text-amber-300">{Math.round(w.confidence)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700 text-slate-400 text-xs">
                    No OCR bounding boxes available for this scan (words were extracted as pure text or synthesized).
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: DETECTED COLUMNS & DETECTED ROWS */}
            {debugTab === 'columns_rows' && (
              <div className="space-y-4">
                {/* Detected Columns */}
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    DETECTED COLUMNS
                  </h4>
                  {invoiceData.diagnostics?.detectedColumnsList && invoiceData.diagnostics.detectedColumnsList.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      {invoiceData.diagnostics.detectedColumnsList.map((col, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-800/70 rounded-xl border border-slate-700">
                          <span className="text-[10px] text-purple-400 uppercase font-black block">
                            {col.type.toUpperCase()}
                          </span>
                          <span className="text-white font-bold block truncate">{col.headerText}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            x = {Math.round(col.leftX ?? col.minX)}–{Math.round(col.rightX ?? col.maxX)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {['ITEM', 'QTY', 'UNIT', 'RATE', 'DISCOUNT', 'TAX', 'AMOUNT'].map((c) => (
                        <span key={c} className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs font-mono border border-slate-700">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Detected Rows */}
                <div className="space-y-2">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    DETECTED ROWS ({invoiceData.diagnostics?.detectedRows?.length || 0})
                  </h4>
                  {invoiceData.diagnostics?.detectedRows && invoiceData.diagnostics.detectedRows.length > 0 ? (
                    <div className="border border-slate-700 rounded-xl overflow-x-auto max-h-96 overflow-y-auto bg-slate-800/40">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-800 text-slate-300 text-[11px] uppercase sticky top-0">
                          <tr>
                            <th className="p-2">Product Name</th>
                            <th className="p-2 text-center">Qty</th>
                            <th className="p-2 text-center">Unit</th>
                            <th className="p-2 text-right">Rate</th>
                            <th className="p-2 text-right">Discount</th>
                            <th className="p-2 text-right">Tax</th>
                            <th className="p-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {invoiceData.diagnostics.detectedRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-700/30">
                              <td className="p-2 font-bold text-white max-w-[200px] truncate" title={row.productName}>
                                {row.productName || '—'}
                              </td>
                              <td className="p-2 text-center text-slate-300">{row.quantity || '—'}</td>
                              <td className="p-2 text-center text-slate-400">{row.unit || '—'}</td>
                              <td className="p-2 text-right text-emerald-400 font-bold">{row.rate || '—'}</td>
                              <td className="p-2 text-right text-slate-400">{row.discount || '—'}</td>
                              <td className="p-2 text-right text-slate-400">{row.tax || '—'}</td>
                              <td className="p-2 text-right text-amber-300 font-bold">{row.amount || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700 text-slate-400 text-xs">
                      No raw structured table rows recorded for this extraction tier.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: PARSED OBJECTS, API RESPONSE & FRONTEND OBJECT */}
            {debugTab === 'objects_api' && (
              <div className="space-y-4 text-xs font-mono">
                {/* PARSED OBJECT */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                      PARSED OBJECT (Canonical Normalized Items)
                    </h4>
                    <span className="text-[11px] text-purple-400">
                      {invoiceData.canonical?.items?.length || invoiceData.items.length} items
                    </span>
                  </div>
                  <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-cyan-300 max-h-60 overflow-y-auto whitespace-pre-wrap select-all">
                    {JSON.stringify(
                      (invoiceData.canonical?.items || invoiceData.items).map((it: any) => ({
                        productName: it.productName || it.name,
                        quantity: it.quantity,
                        unit: it.unit,
                        rate: it.rate ?? it.purchasePrice ?? null,
                        purchasePrice: it.purchasePrice ?? null,
                        sellingPrice: it.sellingPrice ?? null,
                        mrp: it.mrp ?? null,
                        lineTotal: it.lineTotal ?? null,
                      })),
                      null,
                      2
                    )}
                  </pre>
                </div>

                {/* API RESPONSE */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    API RESPONSE (Backend JSON)
                  </h4>
                  <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-amber-300 max-h-48 overflow-y-auto whitespace-pre-wrap select-all">
                    {invoiceData.diagnostics?.rawApiResponse
                      ? JSON.stringify(invoiceData.diagnostics.rawApiResponse, null, 2)
                      : '// Client-side in-browser OCR engine utilized. Backend API response not applicable for client scan.'}
                  </pre>
                </div>

                {/* FRONTEND OBJECT */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                    FRONTEND OBJECT (Current Review Table State)
                  </h4>
                  <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-emerald-300 max-h-60 overflow-y-auto whitespace-pre-wrap select-all">
                    {JSON.stringify(
                      invoiceData.items.map((it) => ({
                        id: it.id,
                        name: it.name,
                        quantity: it.quantity,
                        unit: it.unit,
                        purchasePrice: it.purchasePrice,
                        sellingPrice: it.sellingPrice,
                        mrp: it.mrp,
                        lineTotal: it.lineTotal,
                        confidence: it.confidence,
                        confidenceLevel: it.confidenceLevel,
                        validationWarning: it.validationWarning || null,
                      })),
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsDebugOpen(false)}
                className="font-bold text-xs"
              >
                Close Inspector
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

