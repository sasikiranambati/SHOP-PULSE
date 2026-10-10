/**
 * @file invoiceScannerService.ts
 * @description Intelligent Flexible Multi-Format Invoice Extraction Service for ShopPulse.
 * Coordinates client-side image preprocessing, native PDF digital text extraction,
 * spatial layout-aware OCR table extraction (Tesseract.js), Google Gemini Multimodal Vision AI,
 * section classification, canonical normalization, and 3-tier inventory matching.
 */

import type { Product } from '../types/product';
import type {
  InvoiceLineItem,
  ParsedInvoice,
  CanonicalInvoice,
  ExtractionMethod,
} from './invoiceTypes';
import { preprocessInvoiceImage } from './imagePreprocessor';
import { performOCR } from './ocrService';
import { extractFromPdf } from './pdfExtractor';
import {
  classifyDocumentSection,
  extractDocumentMetadata,
  type ExtractedMetadata,
} from './sectionClassifier';
import { extractLineItemsFlexible } from './tableLayoutExtractor';
import { normalizeCanonicalInvoice } from './invoiceNormalizer';
import { matchCanonicalItemsWithInventory } from './inventoryMatcher';

// Re-export types for backward compatibility
export type { InvoiceLineItem, ParsedInvoice, CanonicalInvoice, ExtractionMethod };

export const SAMPLE_INVOICES: Array<{ label: string; supplier: string; invoice: ParsedInvoice }> = [
  {
    label: 'Kirana & Grocery Delivery (Format A)',
    supplier: 'Metro Cash & Carry Wholesale',
    invoice: {
      id: 'inv_sample_1',
      supplierName: 'Metro Cash & Carry Wholesale',
      invoiceNumber: 'MCC/BLR/2026/8942',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      confidenceScore: 97,
      totalAmount: 3850,
      engineUsed: 'sample',
      extractionMethod: 'TABLE_STRUCTURED',
      items: [
        {
          id: 'item_1',
          name: 'Tata Salt 1kg',
          category: 'Groceries',
          quantity: 24,
          unit: 'pcs',
          purchasePrice: 22,
          sellingPrice: 28,
          lineTotal: 528,
          confidence: 98,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_2',
          name: 'Fortune Sunflower Oil 1L',
          category: 'Groceries',
          quantity: 15,
          unit: 'pcs',
          purchasePrice: 135,
          sellingPrice: 160,
          lineTotal: 2025,
          confidence: 96,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_3',
          name: 'Aashirvaad Shudh Chakki Atta 5kg',
          category: 'Groceries',
          quantity: 6,
          unit: 'pcs',
          purchasePrice: 216,
          sellingPrice: 250,
          lineTotal: 1296,
          confidence: 97,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
      ],
    },
  },
  {
    label: 'GST Tax Invoice (Format B: HSN & Taxable)',
    supplier: 'Sri Lakshmi Enterprises Wholesale',
    invoice: {
      id: 'inv_sample_2',
      supplierName: 'Sri Lakshmi Enterprises Wholesale',
      invoiceNumber: 'SLE-BLR-8942',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      gstin: '29AAAAA1234A1Z5',
      confidenceScore: 98,
      totalAmount: 6696.9,
      engineUsed: 'sample',
      extractionMethod: 'TABLE_STRUCTURED',
      items: [
        {
          id: 'item_4',
          name: 'Basmati Rice 25kg',
          category: 'Groceries',
          quantity: 2,
          unit: 'bag',
          purchasePrice: 1400,
          sellingPrice: 1650,
          lineTotal: 2800,
          hsnCode: '1006',
          taxableAmount: 2800,
          confidence: 99,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_5',
          name: 'Sugar Premium',
          category: 'Groceries',
          quantity: 10,
          unit: 'kg',
          purchasePrice: 45,
          sellingPrice: 52,
          lineTotal: 450,
          hsnCode: '1701',
          taxableAmount: 450,
          confidence: 98,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_6',
          name: 'Sunflower Oil 5L',
          category: 'Groceries',
          quantity: 4,
          unit: 'box',
          purchasePrice: 650,
          sellingPrice: 750,
          lineTotal: 2600,
          hsnCode: '1514',
          taxableAmount: 2600,
          confidence: 97,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
      ],
    },
  },
  {
    label: 'Thermal Receipt (Format G: Compact / Multipliers)',
    supplier: 'Kiran General Store',
    invoice: {
      id: 'inv_sample_3',
      supplierName: 'Kiran General Store',
      invoiceNumber: 'TR-50119',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      confidenceScore: 95,
      totalAmount: 500,
      engineUsed: 'sample',
      extractionMethod: 'TEXT_LINE_ITEM',
      items: [
        {
          id: 'item_7',
          name: 'Amul Milk 500ml',
          category: 'Dairy',
          quantity: 2,
          unit: 'pcs',
          purchasePrice: 25,
          sellingPrice: 27,
          lineTotal: 50,
          confidence: 96,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_8',
          name: 'Britannia Good Day',
          category: 'Snacks',
          quantity: 3,
          unit: 'pkt',
          purchasePrice: 20,
          sellingPrice: 25,
          lineTotal: 60,
          confidence: 95,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_9',
          name: 'Tata Tea Gold',
          category: 'Beverages',
          quantity: 1,
          unit: 'pcs',
          purchasePrice: 250,
          sellingPrice: 280,
          lineTotal: 250,
          confidence: 94,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
        {
          id: 'item_10',
          name: 'Fortune Oil 1L',
          category: 'Groceries',
          quantity: 1,
          unit: 'pcs',
          purchasePrice: 140,
          sellingPrice: 165,
          lineTotal: 140,
          confidence: 95,
          confidenceLevel: 'HIGH',
          lowConfidence: false,
          isMatchConfirmed: true,
        },
      ],
    },
  },
];

// --- Engine and API Key Utilities ---

const GEMINI_KEY_STORAGE = 'shoppulse_gemini_api_key';
const OCR_ENGINE_STORAGE = 'shoppulse_ocr_engine';

/**
 * The optional Gemini key is the user's own key, typed into Engine Settings and kept in
 * this browser only. It is deliberately not read from a VITE_* variable, because Vite
 * inlines those into the public JavaScript bundle.
 */
export function getGeminiApiKey(): string {
  const localKey = (typeof localStorage !== 'undefined' && localStorage.getItem(GEMINI_KEY_STORAGE)) || '';
  return localKey.trim();
}

export function setGeminiApiKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  if (key.trim()) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

export function getPreferredOcrEngine(): 'auto' | 'gemini' | 'tesseract' {
  if (typeof localStorage === 'undefined') return 'auto';
  const stored = localStorage.getItem(OCR_ENGINE_STORAGE);
  if (stored === 'gemini' || stored === 'tesseract') return stored;
  return 'auto';
}

export function setPreferredOcrEngine(engine: 'auto' | 'gemini' | 'tesseract'): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(OCR_ENGINE_STORAGE, engine);
}

// --- Google Gemini Multimodal Vision AI Extraction ---

export async function parseInvoiceWithGemini(
  base64Image: string,
  mimeType: string,
  apiKey: string,
  existingProducts: Product[] = []
): Promise<ParsedInvoice> {
  const prompt = `You are an expert OCR and retail receipt / invoice reader specialized in Indian FMCG, Kirana, and wholesale invoices.
Examine this invoice image and extract the structured bill data.
Support different column layouts (e.g. HSN, Taxable Value, MRP, Disct, Qty, Rate).
Return ONLY a valid JSON object matching this schema without any markdown wrapping or extra comments:
{
  "supplierName": "Store, Wholesaler or Distributor Name",
  "invoiceNumber": "Invoice or Bill Reference Number",
  "invoiceDate": "Date in DD/MM/YYYY or original format",
  "gstin": "GSTIN number if present or null",
  "confidenceScore": 98,
  "subtotal": 1400,
  "taxAmount": 100,
  "totalAmount": 1500,
  "items": [
    {
      "name": "Full product title including weight or pack size (e.g. Aashirvaad Atta 5kg)",
      "category": "Groceries | Dairy | Beverages | Snacks | Personal Care | Household | Other",
      "quantity": 10,
      "unit": "pcs | kg | g | l | ml | box | pkt | bag",
      "purchasePrice": 45,
      "sellingPrice": 55,
      "mrp": null,
      "discount": null,
      "taxableAmount": null,
      "taxAmount": null,
      "gstRate": null,
      "hsnCode": null,
      "lineTotal": 450
    }
  ]
}

Important Rules:
1. Extract EVERY distinct product line item present in the invoice table or bill list.
2. If purchase price is missing, leave null. Do NOT invent prices.
3. If selling price / MRP is printed, use it.
4. Do NOT include taxes (CGST/SGST), subtotals, round-off, or discounts as items.
5. Output raw JSON only. Do not enclose in backticks or markdown codeblocks.`;

  // Key goes in a header, not the URL, so it does not end up in logs or proxies
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const textOutput = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!textOutput) {
    throw new Error('Gemini returned an empty response.');
  }

  const cleaned = textOutput.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsedData = JSON.parse(cleaned);

  const rawItems = (parsedData.items || []).map((it: any, idx: number) => ({
    productName: String(it.name || 'Product ' + (idx + 1)).trim(),
    quantity: Number(it.quantity) > 0 ? Number(it.quantity) : null,
    unit: String(it.unit || 'pcs').toLowerCase(),
    purchasePrice: Number(it.purchasePrice) > 0 ? Number(it.purchasePrice) : null,
    sellingPrice: Number(it.sellingPrice) > 0 ? Number(it.sellingPrice) : null,
    mrp: Number(it.mrp) > 0 ? Number(it.mrp) : null,
    discount: Number(it.discount) > 0 ? Number(it.discount) : null,
    taxableAmount: Number(it.taxableAmount) > 0 ? Number(it.taxableAmount) : null,
    taxAmount: Number(it.taxAmount) > 0 ? Number(it.taxAmount) : null,
    gstRate: Number(it.gstRate) > 0 ? Number(it.gstRate) : null,
    hsnCode: it.hsnCode ? String(it.hsnCode) : null,
    lineTotal: Number(it.lineTotal) > 0 ? Number(it.lineTotal) : null,
    confidence: 96,
    sourceText: it.name || '',
    extractionMethod: 'TABLE_STRUCTURED' as ExtractionMethod,
  }));

  const metadata: ExtractedMetadata = {
    supplierName: parsedData.supplierName ? String(parsedData.supplierName).trim() : null,
    supplierConfidence: parsedData.supplierName ? 95 : 0,
    invoiceNumber: parsedData.invoiceNumber ? String(parsedData.invoiceNumber).trim() : null,
    invoiceNoConfidence: parsedData.invoiceNumber ? 95 : 0,
    invoiceDate: parsedData.invoiceDate ? String(parsedData.invoiceDate).trim() : null,
    dateConfidence: parsedData.invoiceDate ? 95 : 0,
    gstin: parsedData.gstin || null,
    customerName: null,
    subtotal: Number(parsedData.subtotal) || null,
    taxAmount: Number(parsedData.taxAmount) || null,
    discount: null,
    roundOff: null,
    grandTotal: Number(parsedData.totalAmount) || null,
  };

  const canonical = normalizeCanonicalInvoice(
    metadata,
    rawItems,
    textOutput,
    'gemini',
    'TABLE_STRUCTURED',
    {
      headerLines: [],
      supplierLines: metadata.supplierName ? [metadata.supplierName] : [],
      customerLines: [],
      itemLines: rawItems.map((r: any) => r.productName),
      taxLines: [],
      totalLines: [`Total: ${metadata.grandTotal}`],
      footerLines: [],
    }
  );

  const matchedItems = matchCanonicalItemsWithInventory(canonical.items, existingProducts);

  return {
    id: canonical.id,
    supplierName: canonical.supplierName || '',
    invoiceNumber: canonical.invoiceNumber || '',
    invoiceDate: canonical.invoiceDate || '',
    gstin: canonical.gstin || undefined,
    items: matchedItems,
    totalAmount: canonical.totalAmount || matchedItems.reduce((acc, i) => acc + (i.lineTotal ?? 0), 0),
    totalUnits: matchedItems.reduce((acc, i) => acc + (i.quantity ?? 0), 0),
    totalItems: matchedItems.length,
    subtotal: canonical.subtotal || undefined,
    taxAmount: canonical.taxAmount || undefined,
    confidenceScore: canonical.confidenceScore,
    rawOcrText: textOutput,
    engineUsed: 'gemini',
    extractionMethod: 'TABLE_STRUCTURED',
    supplierConfidence: 95,
    invoiceNoConfidence: 95,
    dateConfidence: 95,
    canonical,
    detectedSections: canonical.detectedSections,
  };
}

// --- Multi-Format Layout & Section Parsing Pipeline ---

export function parseInvoiceWithFlexibleEngine(
  lines: any[],
  words: any[],
  rawText: string,
  engineUsed: 'tesseract' | 'pdf_direct' = 'tesseract',
  existingProducts: Product[] = []
): ParsedInvoice {
  // Synthesize lines from rawText if lines is empty
  const effectiveLines: any[] =
    lines && lines.length > 0
      ? lines
      : (rawText || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((text) => ({ text, confidence: 80 }));

  // 1. Group and classify document sections
  const classifiedLines = effectiveLines.map((l, idx) => ({
    text: l.text,
    confidence: l.confidence || 80,
    words: l.words,
    bbox: l.bbox,
    lineIndex: idx,
    section: classifyDocumentSection(l.text, idx, effectiveLines.length),
  }));

  const sectionLines = {
    headerLines: classifiedLines.filter((l) => l.section === 'HEADER').map((l) => l.text),
    supplierLines: classifiedLines.filter((l) => l.section === 'SUPPLIER_INFO').map((l) => l.text),
    customerLines: classifiedLines.filter((l) => l.section === 'CUSTOMER_INFO').map((l) => l.text),
    itemLines: classifiedLines.filter((l) => l.section === 'LINE_ITEMS').map((l) => l.text),
    taxLines: classifiedLines.filter((l) => l.section === 'TAX_SUMMARY').map((l) => l.text),
    totalLines: classifiedLines.filter((l) => l.section === 'TOTAL_SUMMARY').map((l) => l.text),
    footerLines: classifiedLines.filter((l) => l.section === 'FOOTER').map((l) => l.text),
  };

  // 2. Extract Document Metadata (Supplier, Inv No, Date, GSTIN, Totals)
  const metadata = extractDocumentMetadata(classifiedLines);

  // 3. Multi-tier Line-Item Extraction (Table -> Layout -> Line-Item -> Multi-line)
  const { items: rawItems, methodUsed, detectedColumns, detectedRows } = extractLineItemsFlexible(lines, words, rawText);

  // 4. Canonical Normalization & Arithmetic Validation
  const canonical = normalizeCanonicalInvoice(
    metadata,
    rawItems,
    rawText,
    engineUsed,
    methodUsed,
    sectionLines
  );

  // 5. Inventory Matching with 3-tier confidence
  const items = matchCanonicalItemsWithInventory(canonical.items, existingProducts);

  const totalUnits = items.reduce((acc, item) => acc + (item.quantity || 0), 0);
  const totalItems = items.length;

  return {
    id: canonical.id,
    supplierName: canonical.supplierName || '',
    invoiceNumber: canonical.invoiceNumber || '',
    invoiceDate: canonical.invoiceDate || '',
    gstin: canonical.gstin || undefined,
    items,
    totalAmount: canonical.totalAmount || 0,
    totalUnits,
    totalItems,
    subtotal: canonical.subtotal || undefined,
    taxAmount: canonical.taxAmount || undefined,
    discount: canonical.discount || undefined,
    confidenceScore: canonical.confidenceScore,
    rawOcrText: rawText,
    engineUsed,
    extractionMethod: methodUsed,
    supplierConfidence: canonical.supplierConfidence,
    invoiceNoConfidence: canonical.invoiceNoConfidence,
    dateConfidence: canonical.dateConfidence,
    canonical,
    detectedSections: sectionLines,
    documentType: engineUsed === 'pdf_direct' ? 'pdf' : 'image',
    status: items.length > 0 ? 'success' : 'needs_review',
    reason: items.length > 0 ? null : 'No confident product line items detected in invoice layout',
    rawLines: classifiedLines,
    diagnostics: {
      totalRawLines: classifiedLines.length,
      totalRawWords: words?.length || 0,
      headerDetected: sectionLines.headerLines.length > 0,
      detectedColumns: canonical.items.map((it) => it.extractionMethod),
      detectedSections: Object.keys(sectionLines).filter((k) => (sectionLines as any)[k].length > 0),
      warnings: items.filter((it) => it.validationWarning).map((it) => it.validationWarning!),
      rawWords: words,
      detectedColumnsList: detectedColumns,
      detectedRows: detectedRows,
    },
  };
}

// --- In-Browser Tesseract.js Engine ---

export async function parseInvoiceWithTesseract(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  existingProducts: Product[] = []
): Promise<ParsedInvoice> {
  const ocrResult = await performOCR(imageSource, onProgress, 'auto');

  if (onProgress) {
    onProgress(90, 'Applying semantic column identification & section classification...');
  }

  return parseInvoiceWithFlexibleEngine(
    ocrResult.lines,
    ocrResult.words,
    ocrResult.text,
    'tesseract',
    existingProducts
  );
}

// --- Backward-Compatible Item Matcher ---

export function matchItemsWithInventory(
  items: InvoiceLineItem[],
  existingProducts: Product[]
): InvoiceLineItem[] {
  // If items already have match levels from canonical matcher, keep them; else re-match
  return items.map((item) => {
    if (item.matchedProductId) return item;
    const normalizedItemName = item.name ? item.name.toLowerCase().trim() : '';
    if (!normalizedItemName || normalizedItemName.length < 3) return item;

    const match = existingProducts.find((p) => {
      const pName = p.name ? p.name.toLowerCase().trim() : '';
      if (!pName || pName.length < 3) return false;
      return (
        pName === normalizedItemName ||
        (normalizedItemName.length >= 4 && pName.includes(normalizedItemName) && normalizedItemName.length / pName.length >= 0.6) ||
        (pName.length >= 4 && normalizedItemName.includes(pName) && pName.length / normalizedItemName.length >= 0.6)
      );
    });

    if (match) {
      const pPrice = item.purchasePrice ?? item.rate ?? match.purchasePrice ?? null;
      const sPrice = item.sellingPrice ?? match.sellingPrice ?? match.price ?? null;
      const q = item.quantity || 1;
      const lTotal: number | null = (item.lineTotal != null && item.lineTotal > 0) ? item.lineTotal : (pPrice != null ? Math.round(q * pPrice * 100) / 100 : null);

      return {
        ...item,
        matchedProductId: match.id,
        currentStock: match.stock,
        category: match.category || item.category,
        rate: item.rate ?? pPrice,
        purchasePrice: pPrice,
        sellingPrice: sPrice,
        lineTotal: lTotal,
        isMatchConfirmed: true,
      };
    }

    return item;
  });
}

// --- Main Extraction Orchestrator ---

/**
 * Parses an uploaded invoice file (PDF or Image) using the multi-tier pipeline.
 *
 * Pipeline:
 * 1. PDF: Check selectable text -> extract directly without OCR if possible.
 *         If scanned/image PDF -> render pages to canvas -> OCR.
 * 2. Image: Preprocess (deskew, denoise, adaptive threshold) ->
 *           Gemini Vision (if API key provided) OR Tesseract OCR with PSM auto-selection.
 * 3. Canonical normalization -> 3-tier inventory matching.
 */
export async function parseInvoiceFile(
  file: File,
  existingProducts: Product[] = [],
  onProgress?: (progress: number, statusText: string) => void
): Promise<ParsedInvoice> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  // =========================================================================
  // STEP 1: PDF PROCESSING (Selectable Text vs Scanned OCR)
  // =========================================================================
  if (isPdf) {
    if (onProgress) {
      onProgress(15, 'Inspecting PDF document structure & text streams...');
    }

    try {
      const pdfResult = await extractFromPdf(file);

      // If PDF contains selectable digital text and layout coordinates:
      if (pdfResult.hasSelectableText && pdfResult.lines.length >= 4) {
        if (onProgress) {
          onProgress(70, 'Digital PDF text stream extracted. Detecting line items & columns...');
        }

        const parsed = parseInvoiceWithFlexibleEngine(
          pdfResult.lines,
          pdfResult.words,
          pdfResult.rawText,
          'pdf_direct',
          existingProducts
        );

        if (onProgress) {
          onProgress(100, 'Digital invoice extraction complete!');
        }

        return parsed;
      }

      // If PDF has no digital text (scanned PDF), use rendered page images
      if (pdfResult.renderedImageDataUrls && pdfResult.renderedImageDataUrls.length > 0) {
        let mergedInvoice: ParsedInvoice | null = null;
        const totalScanPages = Math.min(pdfResult.renderedImageDataUrls.length, 3);

        for (let pIdx = 0; pIdx < totalScanPages; pIdx++) {
          if (onProgress) {
            onProgress(
              25 + pIdx * 20,
              `Scanned PDF: reading page ${pIdx + 1} of ${totalScanPages}...`
            );
          }
          const pageParsed = await parseInvoiceWithTesseract(
            pdfResult.renderedImageDataUrls[pIdx],
            undefined,
            existingProducts
          );

          if (!mergedInvoice) {
            mergedInvoice = pageParsed;
          } else {
            // Append items from subsequent pages
            mergedInvoice.items.push(...pageParsed.items);
            mergedInvoice.totalUnits = (mergedInvoice.totalUnits || 0) + (pageParsed.totalUnits || 0);
            mergedInvoice.totalItems = mergedInvoice.items.length;
            mergedInvoice.totalAmount = (mergedInvoice.totalAmount || 0) + (pageParsed.totalAmount || 0);
            mergedInvoice.rawOcrText = (mergedInvoice.rawOcrText || '') + '\n--- PAGE BREAK ---\n' + (pageParsed.rawOcrText || '');
          }
        }

        if (mergedInvoice) {
          mergedInvoice.imagePreviewUrl = pdfResult.renderedImageDataUrls[0];
          mergedInvoice.documentType = 'pdf';
          return mergedInvoice;
        }
      }
    } catch (pdfErr) {
      console.warn('PDF direct extraction encountered an error, falling back to rasterization:', pdfErr);
    }
  }

  // =========================================================================
  // STEP 2: IMAGE PREPROCESSING
  // =========================================================================
  if (onProgress) {
    onProgress(15, 'Deskewing, denoising & enhancing image contrast...');
  }

  const preprocessed = await preprocessInvoiceImage(file);
  const geminiApiKey = getGeminiApiKey();
  const preferredEngine = getPreferredOcrEngine();

  let parsedInvoice: ParsedInvoice | null = null;

  // Tier 1: Try Gemini Vision if preferred or API key configured
  if (geminiApiKey && preferredEngine !== 'tesseract') {
    try {
      if (onProgress) {
        onProgress(35, 'Connecting to Gemini Multimodal AI Vision...');
      }
      parsedInvoice = await parseInvoiceWithGemini(
        preprocessed.base64Raw,
        'image/png',
        geminiApiKey,
        existingProducts
      );
    } catch (err) {
      console.warn('Gemini AI Vision extraction failed, falling back to local OCR engine:', err);
      if (onProgress) {
        onProgress(30, 'AI Vision unavailable. Switching to Local Multi-Format OCR Engine...');
      }
    }
  }

  // Tier 2: In-browser local Tesseract OCR with spatial table extraction
  if (!parsedInvoice) {
    parsedInvoice = await parseInvoiceWithTesseract(
      preprocessed.processedDataUrl,
      onProgress,
      existingProducts
    );
  }

  // Attach original image preview for user review
  parsedInvoice.imagePreviewUrl = preprocessed.originalDataUrl;

  if (onProgress) {
    onProgress(100, 'Invoice extraction complete! Ready for review.');
  }

  return parsedInvoice;
}
