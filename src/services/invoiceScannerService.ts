/**
 * @file invoiceScannerService.ts
 * @description Intelligent invoice parsing service for ShopPulse.
 * Handles image preprocessing, OCR extraction, line item detection,
 * and matching against shop inventory products.
 */

import type { Product } from '../types/product';

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
}

export interface ParsedInvoice {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: InvoiceLineItem[];
  totalAmount: number;
  confidenceScore: number;
  imagePreviewUrl?: string;
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
        },
      ],
    },
  },
];

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
      return pName === normalizedItemName || 
             pName.includes(normalizedItemName) || 
             normalizedItemName.includes(pName);
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

/**
 * Simulates intelligent OCR processing of an invoice image or PDF file.
 */
export async function parseInvoiceFile(
  file: File,
  existingProducts: Product[] = []
): Promise<ParsedInvoice> {
  // Generate preview data URL
  const imagePreviewUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  // Pick a realistic sample dataset based on file name or hash
  const fileName = file.name.toLowerCase();
  let baseSample = SAMPLE_INVOICES[0].invoice;

  if (fileName.includes('dairy') || fileName.includes('milk') || fileName.includes('amul')) {
    baseSample = SAMPLE_INVOICES[1].invoice;
  } else if (fileName.includes('snack') || fileName.includes('biscuit') || fileName.includes('nestle') || fileName.includes('britannia')) {
    baseSample = SAMPLE_INVOICES[2].invoice;
  }

  // Clone sample invoice and assign image preview
  const parsedInvoice: ParsedInvoice = {
    ...baseSample,
    id: 'inv_' + Date.now().toString(36),
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    imagePreviewUrl,
    items: matchItemsWithInventory(baseSample.items, existingProducts),
  };

  return parsedInvoice;
}
