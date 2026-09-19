import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  CheckCircle2, 
  Info, 
  Check, 
  Sparkles, 
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
  Cpu
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

interface InvoiceScannerProps {
  products?: Product[];
  onAddProduct?: (newProd: Omit<Product, 'id'>) => Promise<void>;
  onRestock?: (id: string, amount: number, purchasePrice?: number) => Promise<void>;
  setActivePage?: (page: PageRoute) => void;
}

export const InvoiceScanner: React.FC<InvoiceScannerProps> = ({
  products = [],
  onAddProduct,
  onRestock,
  setActivePage,
}) => {
  const { t } = useLanguage();
  
  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatusText, setScanStatusText] = useState('');
  const [invoiceData, setInvoiceData] = useState<ParsedInvoice | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  
  // Settings & Engine state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => getGeminiApiKey());
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<'auto' | 'gemini' | 'tesseract'>(() => getPreferredOcrEngine());
  const [isRawTextOpen, setIsRawTextOpen] = useState(false);
  
  // Camera modal state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);

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
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'camera_invoice.jpg', { type: 'image/jpeg' });
          closeCamera();
          processUploadedFile(file);
        }
      }, 'image/jpeg');
    }
  };

  const processUploadedFile = async (file: File) => {
    setIsScanning(true);
    setScanProgress(10);
    setScanStatusText('Preparing image for OCR recognition...');
    setSuccessMessage(null);
    setScanWarning(null);

    try {
      const parsed = await parseInvoiceFile(file, products, (progress, statusText) => {
        setScanProgress(progress);
        setScanStatusText(statusText);
      });
      setInvoiceData(parsed);
      if (parsed.items.length === 0) {
        setScanWarning(
          'No tabular product rows could be detected automatically from this bill photo. You can add items using the "+ Add Item" button below or check the extracted text.'
        );
      }
    } catch (err: any) {
      console.error('Failed to parse invoice:', err);
      alert('Failed to parse invoice: ' + (err?.message || 'Unknown error. Please try a clearer photo.'));
    } finally {
      setIsScanning(false);
    }
  };

  const loadSampleInvoice = (sampleIndex: number) => {
    setIsScanning(true);
    setScanProgress(30);
    setScanStatusText('Loading sample supplier bill...');
    setSuccessMessage(null);

    setTimeout(() => {
      setScanProgress(75);
      setScanStatusText('Matching line items with current inventory...');
    }, 300);

    setTimeout(() => {
      setScanProgress(100);
      const sample = SAMPLE_INVOICES[sampleIndex].invoice;
      const matched = {
        ...sample,
        id: 'inv_' + Date.now().toString(36),
        items: matchItemsWithInventory(sample.items, products),
      };
      setInvoiceData(matched);
      setIsScanning(false);
    }, 600);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  // Editable item handlers
  const handleItemChange = (id: string, field: keyof InvoiceLineItem, value: any) => {
    if (!invoiceData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'quantity' || field === 'purchasePrice') {
          updated.lineTotal = Math.round((updated.quantity || 0) * (updated.purchasePrice || 0));
        }
        return updated;
      }),
    });
  };

  const handleRemoveItem = (id: string) => {
    if (!invoiceData) return;
    setInvoiceData({
      ...invoiceData,
      items: invoiceData.items.filter((item) => item.id !== id),
    });
  };

  const handleAddItem = () => {
    if (!invoiceData) return;
    const newItem: InvoiceLineItem = {
      id: 'item_' + Date.now().toString(36),
      name: 'New Product Item',
      category: 'Groceries',
      quantity: 10,
      unit: 'pcs',
      purchasePrice: 50,
      sellingPrice: 65,
      lineTotal: 500,
    };
    setInvoiceData({
      ...invoiceData,
      items: [...invoiceData.items, newItem],
    });
  };

  // Calculate live total
  const calculatedTotal = invoiceData?.items.reduce((acc, item) => acc + (item.lineTotal || 0), 0) || 0;
  const totalUnits = invoiceData?.items.reduce((acc, item) => acc + (item.quantity || 0), 0) || 0;

  // Confirm and update inventory
  const handleConfirmAddToStock = async () => {
    if (!invoiceData || invoiceData.items.length === 0) return;
    setIsSaving(true);
    let addedCount = 0;
    let restockedCount = 0;

    try {
      // Deduplicate items within the invoice batch to prevent redundant inventory rows
      const mergedBatch: InvoiceLineItem[] = [];
      for (const item of invoiceData.items) {
        const trimmedName = item.name.toLowerCase().trim();
        const existing = mergedBatch.find(
          (m) =>
            (m.matchedProductId && m.matchedProductId === item.matchedProductId) ||
            m.name.toLowerCase().trim() === trimmedName
        );
        if (existing) {
          existing.quantity = (Number(existing.quantity) || 0) + (Number(item.quantity) || 0);
          existing.lineTotal = (Number(existing.lineTotal) || 0) + (Number(item.lineTotal) || 0);
        } else {
          mergedBatch.push({ ...item });
        }
      }

      for (const item of mergedBatch) {
        if (item.matchedProductId && onRestock) {
          // Increase stock for existing product and preserve wholesale purchase price
          await onRestock(item.matchedProductId, Number(item.quantity), Number(item.purchasePrice));
          restockedCount++;
        } else if (onAddProduct) {
          // Check if product already exists in current store inventory by exact name
          const existingInStore = products.find(
            (p) => p.name.toLowerCase().trim() === item.name.toLowerCase().trim()
          );

          if (existingInStore && onRestock) {
            await onRestock(existingInStore.id, Number(item.quantity), Number(item.purchasePrice));
            restockedCount++;
          } else {
            // Create new product in inventory
            const now = new Date().toISOString();
            await onAddProduct({
              name: item.name,
              category: item.category || 'Groceries',
              stock: Number(item.quantity),
              unit: item.unit || 'pcs',
              purchasePrice: Number(item.purchasePrice),
              sellingPrice: Number(item.sellingPrice || item.purchasePrice * 1.2),
              price: Number(item.sellingPrice || item.purchasePrice * 1.2),
              reorderLevel: 10,
              minStock: 10,
              status: 'In Stock',
              createdAt: now,
              updatedAt: now,
            });
            addedCount++;
          }
        }
      }

      // Record purchase transaction in the authenticated user's Firestore workspace
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
              name: it.name,
              category: it.category,
              quantity: Number(it.quantity),
              unit: it.unit,
              purchasePrice: Number(it.purchasePrice),
              lineTotal: Number(it.lineTotal),
            })),
            createdAt: new Date().toISOString(),
          });
        } catch (pErr) {
          console.warn('Could not record purchase record in Firestore workspace:', pErr);
        }
      }

      // Invalidate analytics caches so profit margins and inventory valuation update immediately
      clearAnalyticsCache();

      // Record smart alert
      try {
        await createAlert({
          type: 'system',
          priority: 'low',
          productName: invoiceData.supplierName,
          message: `📦 Restocked ${totalUnits} units across ${mergedBatch.length} items (Total: ₹${calculatedTotal.toLocaleString('en-IN')}) from Bill #${invoiceData.invoiceNumber}.`,
        });
      } catch (alertErr) {
        console.warn('Could not post restock alert:', alertErr);
      }

      setSuccessMessage(
        `Successfully updated inventory! Restocked ${restockedCount} existing items and created ${addedCount} new products (${totalUnits} total units added).`
      );
      setInvoiceData(null);
    } catch (err: any) {
      console.error('Error adding invoice items to stock:', err);
      alert('Failed to update inventory: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
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

      {/* Top Banner: Real AI Engine Active */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-linear-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 rounded-2xl border border-emerald-300 text-xs sm:text-sm font-bold text-emerald-950">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-extrabold text-slate-900">
                {apiKeyInput && selectedEngine !== 'tesseract' ? '⚡ Multimodal AI Vision Active' : '⚡ In-Browser OCR Active (Tesseract.js)'}
              </p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-300">
                {apiKeyInput && selectedEngine !== 'tesseract' ? 'Gemini AI Vision' : '100% In-Browser'}
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              {apiKeyInput && selectedEngine !== 'tesseract' 
                ? 'Extracts items, quantities, wholesale rates & retail prices with multimodal AI accuracy' 
                : 'Scans and parses invoice text locally in your browser. Connect optional free Gemini API for 99%+ accuracy.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Success Notification */}
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

      {/* Main Upload Dropzone & Controls (When no invoice parsed) */}
      {!invoiceData && (
        <Card className="text-center p-6 sm:p-10 border-2 border-dashed border-emerald-300 bg-emerald-50/20">
          <div className="max-w-md mx-auto space-y-6">
            
            {/* Big Scanner Icon Area */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-emerald-600 text-white mx-auto flex items-center justify-center shadow-lg shadow-emerald-600/20 relative group">
              <Camera className="w-10 h-10 sm:w-12 sm:h-12 group-hover:scale-110 transition-transform" />
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-teal-500 border-2 border-white flex items-center justify-center text-white">
                <ScanLine className="w-3.5 h-3.5 animate-pulse" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-black text-slate-900">
                {t('scanner.heading')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed font-semibold">
                {t('scanner.subheading')}
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
              <div className="p-6 bg-white rounded-2xl border border-emerald-300 shadow-sm space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                    <span>{scanStatusText}</span>
                  </span>
                  <span className="text-emerald-700 font-black">{scanProgress}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-600 transition-all duration-300 rounded-full"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Extracting tabular items and aligning with store inventory...</p>
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
                ⚡ Try One-Click Sample Invoices:
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
                    {invoiceData.supplierName}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-300">
                    {invoiceData.confidenceScore}% OCR Match
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black border border-slate-300">
                    {invoiceData.engineUsed === 'gemini' 
                      ? '🤖 Gemini AI Vision' 
                      : invoiceData.engineUsed === 'tesseract' 
                      ? '⚡ Tesseract Local OCR' 
                      : 'Demo Bill'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Invoice #{invoiceData.invoiceNumber} • Date: {invoiceData.invoiceDate}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInvoiceData(null)}
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
              <p className="font-extrabold text-slate-900 mt-1 truncate">{invoiceData.supplierName}</p>
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

          {/* Extracted Items Editable Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Extracted Line Items ({invoiceData.items.length})</span>
              </h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-black text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            {invoiceData.confidenceScore < 70 && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs font-semibold flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Moderate OCR match ({invoiceData.confidenceScore}%). Items with ⚠️ Review have uncertain text or numbers—please check and edit if needed.</span>
              </div>
            )}

            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-700 font-extrabold uppercase text-[11px] border-b border-slate-200 select-none">
                  <tr>
                    <th className="py-3 px-3 sm:px-4">Product Name</th>
                    <th className="py-3 px-2 sm:px-3">Category</th>
                    <th className="py-3 px-2 sm:px-3 text-center">Qty</th>
                    <th className="py-3 px-2 sm:px-3 text-right">Purchase (₹)</th>
                    <th className="py-3 px-2 sm:px-3 text-right">Selling (₹)</th>
                    <th className="py-3 px-2 sm:px-3 text-right">Line Total</th>
                    <th className="py-3 px-2 text-center">Status</th>
                    <th className="py-3 px-2 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {invoiceData.items.map((item) => {
                    const isUncertain = item.lowConfidence || (typeof item.confidence === 'number' && item.confidence < 70);
                    return (
                    <tr 
                      key={item.id} 
                      className={`transition-colors ${
                        isUncertain 
                          ? 'bg-amber-50/70 hover:bg-amber-100/60 border-l-4 border-l-amber-400' 
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2.5 px-3 sm:px-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleItemChange(item.id, 'name', e.target.value)}
                            className="w-full font-bold text-slate-900 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                          />
                          {isUncertain && (
                            <span 
                              className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-black shrink-0 select-none"
                              title="Low OCR certainty - please verify"
                            >
                              ⚠️ Review
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 sm:px-3 text-slate-600">
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
                          className="w-20 sm:w-24 text-xs font-semibold bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-2 sm:px-3 text-center">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                          className="w-14 text-center font-extrabold text-slate-900 bg-slate-100 rounded-lg py-1 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="py-2.5 px-2 sm:px-3 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={item.purchasePrice}
                          onChange={(e) => handleItemChange(item.id, 'purchasePrice', Number(e.target.value))}
                          className="w-16 text-right font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-2 sm:px-3 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={item.sellingPrice}
                          onChange={(e) => handleItemChange(item.id, 'sellingPrice', Number(e.target.value))}
                          className="w-16 text-right font-bold text-emerald-700 bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-2 sm:px-3 text-right font-black text-slate-900">
                        ₹{item.lineTotal.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {item.matchedProductId ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                            <Check className="w-3 h-3 text-emerald-700" /> Restock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                            <Plus className="w-3 h-3 text-blue-700" /> New Item
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>

            {/* Zero Items Warning */}
            {invoiceData.items.length === 0 && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs sm:text-sm font-medium space-y-1">
                <div className="flex items-center gap-2 font-extrabold text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>No tabular product lines were automatically recognized from this bill.</span>
                </div>
                <p className="text-amber-800">
                  You can click <button type="button" onClick={handleAddItem} className="font-black underline text-emerald-800 cursor-pointer">+ Add Item</button> above to manually input line items, or click below to inspect what text was detected.
                </p>
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
              <span>Confirming will immediately increment store stock & track wholesale purchase expense.</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={() => setInvoiceData(null)}
                className="w-1/3 sm:w-auto font-bold"
              >
                Discard
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={isSaving || invoiceData.items.length === 0}
                onClick={handleConfirmAddToStock}
                icon={isSaving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                className="w-2/3 sm:w-auto font-black px-6 shadow-md shadow-emerald-600/20"
              >
                {isSaving ? 'Updating Stock...' : `Add to Stock (${totalUnits} Units)`}
              </Button>
            </div>
          </div>

        </Card>
      )}

      {/* Live Camera Viewfinder Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="bg-slate-900 rounded-3xl border border-slate-700 overflow-hidden max-w-lg w-full shadow-2xl flex flex-col">
            
            <div className="p-4 flex items-center justify-between border-b border-slate-800 text-white">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-emerald-400" />
                <span className="font-extrabold text-sm sm:text-base">Align Supplier Bill Inside Frame</span>
              </div>
              <button 
                onClick={closeCamera}
                className="text-slate-400 hover:text-white p-1 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cameraError && (
              <div className="p-3 bg-rose-900/40 border-b border-rose-700 text-rose-200 text-xs font-semibold text-center">
                {cameraError}
              </div>
            )}

            <div className="relative bg-black flex items-center justify-center min-h-[300px] sm:min-h-[380px]">
              <video 
                ref={videoRef} 
                playsInline 
                autoPlay 
                muted 
                className="w-full h-full object-cover"
              />
              
              {/* Target scan overlay guides */}
              <div className="absolute inset-8 border-2 border-dashed border-emerald-400/80 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
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

            <div className="p-4 bg-slate-900 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={closeCamera}
                className="text-white border-slate-700 hover:bg-slate-800 font-bold"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={capturePhotoFromCamera}
                icon={<Camera className="w-5 h-5" />}
                className="font-black px-6 shadow-md shadow-emerald-500/20"
              >
                Capture Bill
              </Button>
            </div>

          </div>
        </div>
      )}

      {/* OCR Engine & Gemini API Key Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl space-y-5 animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">OCR & AI Scanner Settings</h3>
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

    </div>
  );
};

