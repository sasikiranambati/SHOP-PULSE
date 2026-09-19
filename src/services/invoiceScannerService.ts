/**
 * @file invoiceScannerService.ts
 * @description Intelligent real invoice parsing service for ShopPulse.
 * Coordinates client-side image preprocessing, spatial OCR table extraction,
 * Google Gemini Multimodal Vision AI extraction, and matching against inventory.
 */

import type { Product } from '../types/product';
import { preprocessInvoiceImage } from './imagePreprocessor';
import { performOCR } from './ocrService';
import { parseInvoiceDocument, type ClassifiedLine, inferProductCategory } from './invoiceParser';

export interface InvoiceLineItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  lineTotal: number;
  matchedProductId?: string;
  currentStock?: number;
  confidence?: number;
  lowConfidence?: boolean;
}

export interface ParsedInvoice {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: InvoiceLineItem[];
  totalAmount: number;
  totalUnits?: number;
  totalItems?: number;
  confidenceScore: number;
  imagePreviewUrl?: string;
  rawOcrText?: string;
  engineUsed?: 'gemini' | 'tesseract' | 'sample';
  supplierConfidence?: number;
  invoiceNoConfidence?: number;
  dateConfidence?: number;
  classifiedLines?: ClassifiedLine[];
}

export const SAMPLE_INVOICES: Array<{ label: string; supplier: string; invoice: ParsedInvoice }> = [
  {
    label: 'Kirana & Grocery Delivery',
    supplier: 'Metro Cash & Carry Wholesale',
    invoice: {
      id: 'inv_sample_1',
      supplierName: 'Metro Cash & Carry Wholesale',
      invoiceNumber: 'MCC/BLR/2026/8942',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      confidenceScore: 97,
      totalAmount: 3850,
      engineUsed: 'sample',
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
          lowConfidence: false,
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
          lowConfidence: false,
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
          lowConfidence: false,
        },
      ],
    },
  },
  {
    label: 'Dairy & Beverages Supplier',
    supplier: 'Amul Gujarat Co-op Federation',
    invoice: {
      id: 'inv_sample_2',
      supplierName: 'Amul Gujarat Co-op Federation',
      invoiceNumber: 'AMUL-DIST-50119',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      confidenceScore: 99,
      totalAmount: 2350,
      engineUsed: 'sample',
      items: [
        {
          id: 'item_4',
          name: 'Amul Taaza Milk 500ml',
          category: 'Dairy',
          quantity: 30,
          unit: 'pcs',
          purchasePrice: 25,
          sellingPrice: 27,
          lineTotal: 750,
          confidence: 99,
          lowConfidence: false,
        },
        {
          id: 'item_5',
          name: 'Amul Butter 100g',
          category: 'Dairy',
          quantity: 20,
          unit: 'pcs',
          purchasePrice: 50,
          sellingPrice: 58,
          lineTotal: 1000,
          confidence: 99,
          lowConfidence: false,
        },
        {
          id: 'item_6',
          name: 'Amul Masti Dahi 400g',
          category: 'Dairy',
          quantity: 20,
          unit: 'pcs',
          purchasePrice: 30,
          sellingPrice: 35,
          lineTotal: 600,
          confidence: 98,
          lowConfidence: false,
        },
      ],
    },
  },
  {
    label: 'FMCG & Snacks Invoice',
    supplier: 'Nestlé & Britannia Distributor',
    invoice: {
      id: 'inv_sample_3',
      supplierName: 'Nestlé & Britannia Distributor',
      invoiceNumber: 'NES-BRIT-3391',
      invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      confidenceScore: 95,
      totalAmount: 1750,
      engineUsed: 'sample',
      items: [
        {
          id: 'item_7',
          name: 'Maggi 2-Minute Noodles 70g',
          category: 'Snacks',
          quantity: 48,
          unit: 'pcs',
          purchasePrice: 11.5,
          sellingPrice: 14,
          lineTotal: 552,
          confidence: 96,
          lowConfidence: false,
        },
        {
          id: 'item_8',
          name: 'Britannia Good Day Butter 100g',
          category: 'Snacks',
          quantity: 36,
          unit: 'pcs',
          purchasePrice: 18,
          sellingPrice: 25,
          lineTotal: 648,
          confidence: 95,
          lowConfidence: false,
        },
        {
          id: 'item_9',
          name: 'Parle-G Gold 1kg',
          category: 'Snacks',
          quantity: 10,
          unit: 'pcs',
          purchasePrice: 55,
          sellingPrice: 70,
          lineTotal: 550,
          confidence: 94,
          lowConfidence: false,
        },
      ],
    },
  },
];

// --- Engine and API Key Utilities ---

const GEMINI_KEY_STORAGE = 'shoppulse_gemini_api_key';
const OCR_ENGINE_STORAGE = 'shoppulse_ocr_engine';

export function getGeminiApiKey(): string {
  const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';
  const localKey = localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  return localKey.trim() || envKey.trim();
}

export function setGeminiApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
}

export function getPreferredOcrEngine(): 'auto' | 'gemini' | 'tesseract' {
  const stored = localStorage.getItem(OCR_ENGINE_STORAGE);
  if (stored === 'gemini' || stored === 'tesseract') return stored;
  return 'auto';
}

export function setPreferredOcrEngine(engine: 'auto' | 'gemini' | 'tesseract'): void {
  localStorage.setItem(OCR_ENGINE_STORAGE, engine);
}

// --- Google Gemini Multimodal Vision AI Extraction ---

export async function parseInvoiceWithGemini(
  base64Image: string,
  mimeType: string,
  apiKey: string
): Promise<ParsedInvoice> {
  const prompt = `You are an expert OCR and retail receipt / invoice reader specialized in Indian FMCG, Kirana, and wholesale invoices.
Examine this invoice image and extract the structured bill data.
Return ONLY a valid JSON object matching this schema without any markdown wrapping or extra comments:
{
  "supplierName": "Store, Wholesaler or Distributor Name",
  "invoiceNumber": "Invoice or Bill Reference Number",
  "invoiceDate": "Date in DD/MM/YYYY or original text format",
  "confidenceScore": 98,
  "totalAmount": 1500,
  "items": [
    {
      "name": "Full product title including weight or pack size (e.g. Aashirvaad Atta 5kg)",
      "category": "Groceries | Dairy | Beverages | Snacks | Personal Care | Household | Other",
      "quantity": 10,
      "unit": "pcs | kg | g | l | ml | box | pkt | bag",
      "purchasePrice": 45,
      "sellingPrice": 55,
      "lineTotal": 450
    }
  ]
}

Important Rules:
1. Extract EVERY distinct product line item present in the invoice table or bill list.
2. If selling price / MRP is specified, use it. If not printed, calculate a realistic retail selling price (15% to 25% higher than purchasePrice).
3. Do NOT include taxes (CGST/SGST), subtotals, round-off, or discounts as items.
4. Output raw JSON only. Do not enclose in backticks or markdown codeblocks.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
    headers: { 'Content-Type': 'application/json' },
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

  // Clean any markdown backticks if model included them
  const cleaned = textOutput.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsedData = JSON.parse(cleaned);

  const items: InvoiceLineItem[] = (parsedData.items || []).map((it: any, idx: number) => ({
    id: 'item_gemini_' + Date.now().toString(36) + '_' + idx,
    name: String(it.name || 'Product ' + (idx + 1)).trim(),
    category: String(it.category || inferProductCategory(it.name || '')),
    quantity: Math.max(1, Number(it.quantity) || 1),
    unit: String(it.unit || 'pcs').toLowerCase(),
    purchasePrice: Number(it.purchasePrice) || 0,
    sellingPrice: Number(it.sellingPrice) || Math.round((Number(it.purchasePrice) || 0) * 1.2),
    lineTotal: Number(it.lineTotal) || (Number(it.quantity) || 1) * (Number(it.purchasePrice) || 0),
    confidence: 96,
    lowConfidence: false,
  }));

  return {
    id: 'inv_' + Date.now().toString(36),
    supplierName: String(parsedData.supplierName || 'Wholesale Supplier').trim(),
    invoiceNumber: String(parsedData.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`).trim(),
    invoiceDate: String(parsedData.invoiceDate || new Date().toLocaleDateString('en-IN')).trim(),
    items,
    totalAmount: Number(parsedData.totalAmount) || items.reduce((acc, i) => acc + i.lineTotal, 0),
    confidenceScore: Math.min(99, Math.max(85, Number(parsedData.confidenceScore) || 96)),
    rawOcrText: textOutput,
    engineUsed: 'gemini',
    supplierConfidence: 95,
    invoiceNoConfidence: 95,
    dateConfidence: 95,
  };
}

// --- In-Browser Tesseract.js Spatial Table OCR Engine ---

export async function parseInvoiceWithTesseract(
  imageSource: string | HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void
): Promise<ParsedInvoice> {
  const ocrResult = await performOCR(imageSource, onProgress, 'auto');

  if (onProgress) {
    onProgress(90, 'Classifying invoice lines & extracting items...');
  }

  // Layout-aware table parsing with smart line classification & OCR error correction
  const parsed = parseInvoiceDocument(ocrResult.lines, ocrResult.words, ocrResult.text);

  return {
    id: 'inv_' + Date.now().toString(36),
    supplierName: parsed.supplierName,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    items: parsed.items,
    totalAmount: parsed.totalAmount,
    totalUnits: parsed.totalUnits,
    totalItems: parsed.totalItems,
    confidenceScore: parsed.overallConfidence,
    rawOcrText: ocrResult.text,
    engineUsed: 'tesseract',
    supplierConfidence: parsed.supplierConfidence,
    invoiceNoConfidence: parsed.invoiceNoConfidence,
    dateConfidence: parsed.dateConfidence,
    classifiedLines: parsed.classifiedLines,
  };
}

// --- Inventory Matching ---

/**
 * Matches extracted invoice items against existing shop inventory products.
 */
export function matchItemsWithInventory(
  items: InvoiceLineItem[],
  existingProducts: Product[]
): InvoiceLineItem[] {
  return items.map((item) => {
    const normalizedItemName = item.name.toLowerCase().trim();

    // Find closest match by exact or substring name
    const match = existingProducts.find((p) => {
      const pName = p.name.toLowerCase().trim();
      return (
        pName === normalizedItemName ||
        pName.includes(normalizedItemName) ||
        normalizedItemName.includes(pName)
      );
    });

    if (match) {
      return {
        ...item,
        matchedProductId: match.id,
        currentStock: match.stock,
        category: match.category || item.category,
        sellingPrice: match.sellingPrice || item.sellingPrice,
      };
    }

    return item;
  });
}

// --- Main Extraction Orchestrator ---

/**
 * Parses an uploaded invoice file using AI Vision (if Gemini key available)
 * or real in-browser OCR (Tesseract.js with spatial table reconstruction).
 */
export async function parseInvoiceFile(
  file: File,
  existingProducts: Product[] = [],
  onProgress?: (progress: number, statusText: string) => void
): Promise<ParsedInvoice> {
  if (onProgress) {
    onProgress(5, 'Deskewing, denoising & enhancing image contrast...');
  }

  // Preprocess image (deskew, denoise, adaptive threshold, text sharpening)
  const preprocessed = await preprocessInvoiceImage(file);
  const geminiApiKey = getGeminiApiKey();
  const preferredEngine = getPreferredOcrEngine();

  let parsedInvoice: ParsedInvoice | null = null;

  // Tier 1: Try Gemini Vision if preferred or auto-detected key
  if (geminiApiKey && preferredEngine !== 'tesseract') {
    try {
      if (onProgress) {
        onProgress(25, 'Connecting to Gemini AI Vision...');
      }
      parsedInvoice = await parseInvoiceWithGemini(
        preprocessed.base64Raw,
        'image/png',
        geminiApiKey
      );
    } catch (err) {
      console.warn('Gemini AI Vision extraction failed, falling back to local OCR:', err);
      if (onProgress) {
        onProgress(20, 'AI Vision unavailable. Switching to Local OCR Engine...');
      }
    }
  }

  // Tier 2: In-browser local Tesseract OCR with spatial table extraction
  if (!parsedInvoice) {
    parsedInvoice = await parseInvoiceWithTesseract(preprocessed.processedDataUrl, onProgress);
  }

  // Attach original image preview for user review
  parsedInvoice.imagePreviewUrl = preprocessed.originalDataUrl;

  // Match items against store inventory
  parsedInvoice.items = matchItemsWithInventory(parsedInvoice.items, existingProducts);

  if (onProgress) {
    onProgress(100, 'Invoice extraction complete!');
  }

  return parsedInvoice;
}
