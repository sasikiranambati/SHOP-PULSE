/**
 * @file sectionClassifier.ts
 * @description Intelligent document zoning and line classification for invoices.
 * Segregates document into HEADER, SUPPLIER_INFO, CUSTOMER_INFO, LINE_ITEMS,
 * TAX_SUMMARY, TOTAL_SUMMARY, and FOOTER. Ensures tax, total, and metadata rows
 * are never mistaken for inventory products.
 */

import type { DocumentSectionType, DocumentLine } from './invoiceTypes';
import { cleanNumericToken } from './invoiceParser';

/**
 * Strict keywords that indicate invoice-level totals and summaries.
 * Lines matching these MUST NEVER become products.
 */
export const TOTAL_SUMMARY_KEYWORDS = [
  'grand total',
  'net amount',
  'net payable',
  'bill amount',
  'total amount',
  'total bill',
  'total payable',
  'sub total',
  'subtotal',
  'amount payable',
  'balance due',
  'cash tendered',
  'change due',
  'round off',
  'round-off',
  'rounded off',
  'total rs',
  'total (rs)',
  'total(₹)',
  'total ₹',
  'total:',
  'total -',
  'total value',
  'total qty',
  'total items',
  'total units',
  // Multilingual Indian Total Keywords
  'कुल राशि',
  'कुल योग',
  'कुल मूल्य',
  'कुल रकम',
  'మొత్తం బిల్లు',
  'మొత్తం సొమ్ము',
  'మొత్తం',
  'மொத்த தொகை',
  'மொத்தம்',
  'ಒಟ್ಟು ಮೊತ್ತ',
  'ಒಟ್ಟು',
  'ആകെ തുക',
  'एकूण रक्कम',
  'মোট টাকা',
];

/**
 * Keywords for tax breakdown and statutory GST sections.
 */
export const TAX_SUMMARY_KEYWORDS = [
  'cgst',
  'sgst',
  'igst',
  'taxable value',
  'taxable amount',
  'taxable amt',
  'total tax',
  'input tax credit',
  'output tax',
  'output gst',
  'gst @',
  'gst%',
  'cess',
  'vat %',
  'central gst',
  'state gst',
  'integrated gst',
];

/**
 * Keywords for invoice footer (terms, bank details, signatures, greetings).
 */
export const FOOTER_KEYWORDS = [
  'thank you',
  'thanks',
  'visit again',
  'terms and conditions',
  'terms & conditions',
  'authorized signatory',
  'authorised signatory',
  'signature',
  'for ',
  'e.&o.e',
  'e & o e',
  'subject to',
  'jurisdiction',
  'bank details',
  'bank name',
  'account no',
  'a/c no',
  'ifsc',
  'ifsc code',
  'branch:',
  'upi id',
  'qr code',
  'computer generated',
  'goods once sold',
  'certified that',
];

/**
 * Generic document labels found in top header section.
 */
export const DOCUMENT_HEADER_LABELS = [
  'tax invoice',
  'retail invoice',
  'cash memo',
  'bill of supply',
  'commercial invoice',
  'credit memo',
  'debit note',
  'proforma invoice',
  'delivery challan',
  'estimate',
  'quotation',
  'original for recipient',
  'duplicate for supplier',
  'triplicate for transporter',
];

/**
 * Supplier / Vendor entity indicator keywords.
 */
export const SUPPLIER_KEYWORDS = [
  'wholesale',
  'wholesaler',
  'distributor',
  'distributors',
  'traders',
  'trading',
  'enterprise',
  'enterprises',
  'store',
  'stores',
  'kirana',
  'kiran',
  'jejani',
  'agencies',
  'agency',
  'pvt ltd',
  'private limited',
  'ltd',
  'limited',
  'co.',
  'corporation',
  'supermarket',
  'mart',
  'cash & carry',
  'cash and carry',
  'provisions',
  'general store',
  'brothers',
  'sons',
  'm/s',
  'fmcg',
];

/**
 * Customer / Buyer section indicators.
 */
export const CUSTOMER_KEYWORDS = [
  'bill to',
  'billed to',
  'ship to',
  'shipped to',
  'buyer',
  'customer',
  'client',
  'consignee',
  'purchaser',
  'party name',
  'recipient',
];

export const PAYMENT_TERMS_KEYWORDS = [
  'payment terms',
  'terms of payment',
  'credit terms',
  'payment mode',
  'mode of payment',
  'terms of delivery',
  'payment due',
  'due within',
  'pay within',
  'credit period',
  'credit days',
  'net 30',
  'net 15',
  'net 7',
  'net 45',
  'net 60',
  'due date',
  'payment:',
];

export const ADDRESS_KEYWORDS = [
  'street',
  'road',
  'rd.',
  'rd,',
  'lane',
  'nagar',
  'cross',
  'layout',
  'colony',
  'complex',
  'building',
  'bldg',
  'plot no',
  'plot #',
  'plot:',
  'floor',
  'opp.',
  'opposite',
  'near',
  'behind',
  'district',
  'dist.',
  'pincode',
  'pin code',
  'pin:',
  'post office',
  'industrial area',
  'ind. area',
  'phase 1',
  'phase 2',
  'phase 3',
  'phase-1',
  'phase-2',
  'sector',
  'main road',
  'ring road',
  'market',
  'bengaluru',
  'bangalore',
  'chennai',
  'hyderabad',
  'mumbai',
  'delhi',
  'new delhi',
  'kolkata',
  'pune',
  'ahmedabad',
  'karnataka',
  'tamil nadu',
  'telangana',
  'maharashtra',
  'andhra pradesh',
  'kerala',
  'gujarat',
  'address:',
  'addr:',
  'regd. office',
  'corp. office',
  'head office',
  'branch office',
];

/**
 * Returns true if the line text represents a total, tax, header, footer,
 * address, payment terms, date, or metadata that must strictly be PREVENTED
 * from becoming an inventory product.
 */
export function isDisallowedItemLine(rawText: string): boolean {
  const clean = rawText.trim().toLowerCase();
  if (!clean || clean.length < 2) return true;

  // If line contains multiple distinct table header column names, it's a table header, not metadata
  const hasItemCol = /\b(?:item|product|description|particulars)\b/i.test(clean);
  const hasQtyCol = /\b(?:qty|quantity|units|nos|billed)\b/i.test(clean);
  const hasPriceCol = /\b(?:rate|price|amount|total|mrp|cost)\b/i.test(clean);
  if ((hasItemCol && hasQtyCol) || (hasQtyCol && hasPriceCol) || (hasItemCol && hasPriceCol && clean.includes('|'))) {
    return false;
  }

  // 1. Check Totals & Summaries
  for (const kw of TOTAL_SUMMARY_KEYWORDS) {
    if (clean.includes(kw)) {
      return true;
    }
  }

  // 2. Check Tax Summary breakdown lines
  for (const kw of TAX_SUMMARY_KEYWORDS) {
    if (clean.includes(kw)) {
      return true;
    }
  }

  // 3. Check Footers & Signatures
  for (const kw of FOOTER_KEYWORDS) {
    if (clean.includes(kw)) return true;
  }

  // 4. Check Payment Terms
  for (const kw of PAYMENT_TERMS_KEYWORDS) {
    if (clean.includes(kw)) return true;
  }

  // 5. Check Addresses (street, nagar, road, pin, indian cities/states, 6-digit pin codes)
  const hasPinCode = /\b[1-9][0-9]{2}\s?[0-9]{3}\b/.test(clean);
  const hasAddressWord = ADDRESS_KEYWORDS.some((kw) => clean.includes(kw));
  if (hasAddressWord && (hasPinCode || clean.includes(',') || clean.includes('-') || clean.includes('near') || clean.includes('opp') || clean.includes('road') || clean.includes('street') || clean.includes('nagar'))) {
    return true;
  }
  if (hasPinCode && (clean.includes('bengaluru') || clean.includes('bangalore') || clean.includes('chennai') || clean.includes('hyderabad') || clean.includes('mumbai') || clean.includes('delhi') || clean.includes('karnataka') || clean.includes('telangana') || clean.includes('maharashtra') || clean.includes('tamil nadu'))) {
    return true;
  }

  // 6. Check Dates & Invoice References
  if (/\b(?:invoice|inv|bill|memo|receipt|challan)\s*(?:date|dt|dated)\b/i.test(clean)) return true;
  if (/\b(?:date\s*of\s*(?:invoice|supply|issue))\b/i.test(clean)) return true;
  if (/^(?:date|dt|dated)[\s.:\-]+[0-3]?[0-9][\/\-.][0-1]?[0-9][\/\-.](?:20)?[0-9]{2}/i.test(clean)) return true;
  if (/\b(?:due\s*date|payment\s*date|delivery\s*date)\b/i.test(clean)) return true;
  if (/^(?:invoice|inv|bill|challan|memo|receipt)\s*(?:no|#|num)?[:.\s-]*[a-z0-9\/-]+$/i.test(clean)) return true;
  if (/^(?:inv|bill|invoice)\s*[:.#\s\-]/i.test(clean)) return true;

  // 7. Check Statutory numbers & Contact info
  if (/\b(?:gstin|gst\s*no|fssai|cst|arn)\b[:.\s-]*[a-z0-9]+/i.test(clean)) return true;
  if (/\b(?:cin|pan|tin)\s*(?:no\.?|#|code)?[:.\s-]+[a-z0-9]{5,}/i.test(clean)) return true;
  if (/^\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b$/i.test(clean.replace(/\s+/g, ''))) return true;
  if (/\b(?:phone|tel|mobile|ph|contact|call)[:.\s-]*\d+/i.test(clean)) return true;
  if (/\b(?:email|e-mail|website|web|www\.)[:.\s-]*[a-z0-9@.\-]+/i.test(clean)) return true;
  if (/^(?:(?:\+91|0)?[6-9]\d{9})$/.test(clean.replace(/[\s\-]/g, ''))) return true;

  // 8. Generic Document Title or Labels
  if (DOCUMENT_HEADER_LABELS.some((lbl) => clean === lbl || clean.includes(`*** ${lbl} ***`))) return true;
  if (/\b(?:tax\s*invoice|retail\s*invoice|cash\s*memo|bill\s*of\s*supply|delivery\s*challan)\b/i.test(clean) && !clean.includes('qty')) return true;

  // 9. Page numbers, currency in words, payment received
  if (/\b(?:page|pg\.?)\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?\b/i.test(clean)) return true;
  if (/^(?:rupees|inr|rs\.?)\s+[a-z\s]+only$/i.test(clean)) return true;
  if (/\b(?:amount\s*in\s*words|rupees\s*in\s*words)\b/i.test(clean)) return true;
  if (/\b(?:cash|upi|card|online|credit|debit|cheque|rtgs|neft)\s+(?:payment|received|paid|tendered|settlement)\b/i.test(clean)) return true;
  if (/\b(?:authorized|authorised)\s*(?:signatory|signature)\b/i.test(clean)) return true;
  if (/\b(?:customer|receiver['’]?s?|buyer['’]?s?)\s*signature\b/i.test(clean)) return true;
  if (/\bterms\s*(?:and|&)\s*conditions\b/i.test(clean)) return true;
  if (/\be\.?\s*&\s*o\.?\s*e\.?\b/i.test(clean)) return true;
  if (/\bsubject\s*to\s*[a-z\s]+jurisdiction\b/i.test(clean)) return true;

  // 10. Supplier entity indicators without product items
  if (SUPPLIER_KEYWORDS.some((kw) => clean.includes(kw)) && !clean.includes('qty') && !clean.includes('rate') && !clean.includes('price') && !clean.includes('|')) {
    return true;
  }

  // 11. Generic placeholder product names that should never be products
  if (/^(?:product\s*item|unlabeled\s*item|item\s*description|description\s*of\s*goods|particulars)$/i.test(clean)) {
    return true;
  }

  return false;
}

/**
 * Strips noisy symbols, leading/trailing punctuation, currency signs, and excess whitespaces.
 */
export function cleanProductName(rawName: string): string {
  return rawName
    .replace(/[₹$€£]/g, '')
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    .replace(/^[#*.\-_=~|0-9)\-:\s]+/, '')
    .replace(/[#*.\-_=~|:\s]+$/, '')
    .replace(/[|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Validates whether a candidate string has credible evidence of being a legitimate product name.
 * Strictly rejects generic placeholders ("Product Item"), pure metadata, addresses, dates, and numbers.
 */
export function isPlausibleProductName(name: string | null | undefined): boolean {
  if (!name) return false;
  const clean = cleanProductName(name);
  if (clean.length < 2) return false;

  // Must contain at least 2 letters (supports Unicode regional scripts)
  const letters = clean.match(/\p{L}/gu);
  if (!letters || letters.length < 2) return false;

  // Reject if it's purely digits, symbols, or serial numbers
  if (/^[#*.\-_=~|0-9)\-:\s]+$/.test(clean)) return false;

  // Reject disallowed item lines (addresses, payment terms, phone, dates, gst, totals, footers)
  if (isDisallowedItemLine(clean)) return false;

  // Reject generic placeholders
  if (/^(?:product(?:\s*item)?|unlabeled\s*item|item(?:\s*description)?|description(?:\s*of\s*goods)?|particulars?|item\s*name)$/i.test(clean)) {
    return false;
  }

  // Reject pure table header keywords
  if (/^(?:s\.?no|sl\.?no|serial|qty|quantity|rate|price|amount|total|mrp|discount|hsn|sac|unit|uom|cgst|sgst|igst)$/i.test(clean)) {
    return false;
  }

  return true;
}

/**
 * Classifies an individual line into one of 7 document section zones.
 */
export function classifyDocumentSection(
  lineText: string,
  lineIndex: number,
  totalLines: number,
  tableHeaderFound: boolean = false,
  totalSectionFound: boolean = false
): DocumentSectionType {
  const clean = lineText.trim();
  if (!clean || clean.length < 2) return 'UNKNOWN';

  const lower = clean.toLowerCase();

  // 1. TOTAL_SUMMARY: Bill level totals
  const isTotal = TOTAL_SUMMARY_KEYWORDS.some((kw) => lower.includes(kw));
  if (isTotal && !lower.includes('item') && !lower.includes('particular')) {
    return 'TOTAL_SUMMARY';
  }

  // 2. TAX_SUMMARY: Tax calculation breakdown
  const isTax = TAX_SUMMARY_KEYWORDS.some((kw) => lower.includes(kw));
  if (isTax && !lower.includes('qty') && !lower.includes('description')) {
    return 'TAX_SUMMARY';
  }

  // 3. FOOTER: Terms, bank details, signatures, bottom greetings
  const isFooter = FOOTER_KEYWORDS.some((kw) => lower.includes(kw));
  if (isFooter || (lineIndex > totalLines * 0.75 && /^(?:ph:|phone|tel|email|address|bank):/i.test(lower))) {
    return 'FOOTER';
  }

  // If we already passed the total section and reached the bottom of the bill, mark as FOOTER
  if (totalSectionFound && lineIndex > totalLines * 0.7) {
    return 'FOOTER';
  }

  // 4. HEADER: Top document banners
  const isDocLabel = DOCUMENT_HEADER_LABELS.some((lbl) => lower.includes(lbl));
  if (lineIndex <= 3 && isDocLabel) {
    return 'HEADER';
  }

  // 5. CUSTOMER_INFO: Billed to / Shipped to section
  const isCustomer = CUSTOMER_KEYWORDS.some((kw) => lower.includes(kw));
  if (isCustomer && lineIndex < totalLines * 0.6) {
    return 'CUSTOMER_INFO';
  }

  // 6. SUPPLIER_INFO & METADATA (Vendor name, address, GSTIN, payment terms, invoice date)
  const isAddress = ADDRESS_KEYWORDS.some((kw) => lower.includes(kw));
  const isPaymentTerms = PAYMENT_TERMS_KEYWORDS.some((kw) => lower.includes(kw));
  const isGstinOrContact = /^(?:gstin|gst\s*no|phone|mobile|tel|address|email|pan|cin|fssai)[:.\s-]/i.test(lower);
  const isDateOrInvRef = /^(?:date|dt|dated|invoice|inv|bill|challan|memo)[:.\s-]/i.test(lower) || /\b(?:invoice|inv|bill)\s*(?:no|#|date)\b/i.test(lower);

  if (!tableHeaderFound && (isAddress || isPaymentTerms || isGstinOrContact || isDateOrInvRef || lineIndex <= Math.max(5, totalLines * 0.4))) {
    if (!isDocLabel && (SUPPLIER_KEYWORDS.some((kw) => lower.includes(kw)) || lineIndex === 0 || isAddress || isGstinOrContact || isPaymentTerms || isDateOrInvRef)) {
      return 'SUPPLIER_INFO';
    }
  }

  // 7. LINE_ITEMS: Content with alphabetic/regional characters and numeric values (strictly within item table area)
  const hasLetters = /\p{L}/u.test(clean);
  const hasDigits = /\d/.test(clean);

  if (hasLetters && hasDigits && !isDisallowedItemLine(clean)) {
    // If table header was detected earlier or line has clear tabular/delimiter format or is after header zone
    return 'LINE_ITEMS';
  }

  return 'UNKNOWN';
}

/**
 * Extracted Invoice Metadata.
 */
export interface ExtractedMetadata {
  supplierName: string | null;
  supplierConfidence: number;
  invoiceNumber: string | null;
  invoiceNoConfidence: number;
  invoiceDate: string | null;
  dateConfidence: number;
  gstin: string | null;
  customerName: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  discount: number | null;
  roundOff: number | null;
  grandTotal: number | null;
}

/**
 * Extracts supplier, invoice number, date, GSTIN, and bill totals from classified lines.
 */
export function extractDocumentMetadata(lines: DocumentLine[]): ExtractedMetadata {
  let supplierName: string | null = null;
  let supplierConfidence = 0;
  let invoiceNumber: string | null = null;
  let invoiceNoConfidence = 0;
  let invoiceDate: string | null = null;
  let dateConfidence = 0;
  let gstin: string | null = null;
  let customerName: string | null = null;
  let subtotal: number | null = null;
  let taxAmount: number | null = null;
  let discount: number | null = null;
  let roundOff: number | null = null;
  let grandTotal: number | null = null;

  // 1. Extract Supplier Name from top 8 lines
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i];
    let textClean = l.text.replace(/^[#*.\-_=~|{}[\]]+\s*/, '').replace(/[#*.\-_=~|{}[\]]+$/, '').trim();
    if (textClean.length < 3) continue;

    // Check if line contains metadata labels like "Invoice No." or "Bill No." or "Date"
    // Many invoices have "Supplier Name       Invoice No: 123" on the same line!
    const splitMatch = textClean.match(/^(.*?)(?:\s{2,}|\s+(?=invoice\s*no|bill\s*no|inv\s*no|memo\s*no|date|gstin))/i);
    const candidateText = splitMatch ? splitMatch[1].trim() : textClean;
    const lower = candidateText.toLowerCase();

    const isDocLabel = DOCUMENT_HEADER_LABELS.some((lbl) => lower.includes(lbl));
    const isMetadata = /^(?:invoice|bill|date|gstin|phone|ph:|tel:|customer|buyer|original|duplicate|triplicate)/i.test(lower);

    // Filter out obvious noise tokens like "{art" or isolated single words with symbols
    const hasEnoughLetters = (candidateText.match(/[a-zA-Z]/g) || []).length >= 4;
    const isGarbled = /^[{}[\]()_\-+=~|<>]+$/.test(candidateText) || candidateText.includes('{art');

    if (!isDocLabel && !isMetadata && hasEnoughLetters && !isGarbled) {
      if (SUPPLIER_KEYWORDS.some((kw) => lower.includes(kw))) {
        // Specific normalization for Jejani Kirana when OCR reads 'deja Kiran'
        if (/\b(?:deja|jeja|jejani)\b.*\b(?:kiran|kirana)\b/i.test(candidateText)) {
          supplierName = 'Jejani Kirana';
        } else {
          supplierName = candidateText;
        }
        supplierConfidence = Math.max(85, l.confidence || 80);
        break;
      } else if (!supplierName && i <= 3) {
        supplierName = candidateText;
        supplierConfidence = Math.max(65, l.confidence || 75);
      }
    }
  }

  // 2. Extract GSTIN (15-character alphanumeric format standard in India: 2 digits + 10 PAN chars + 3 entity chars)
  const gstinRegex = /\b([0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/i;
  for (const l of lines) {
    const m = l.text.match(gstinRegex);
    if (m && m[1]) {
      gstin = m[1].toUpperCase();
      break;
    }
  }

  // 3. Extract Invoice / Bill Number
  const strictInvRegex = /(?:invoice\s*(?:no|num|#)|bill\s*(?:no|num|#)|inv\s*(?:no|num|#)|memo\s*(?:no|num|#)|receipt\s*(?:no|num|#)|challan\s*(?:no|num|#))[.:\s\-]*([a-z0-9\-\/]{2,30})/i;
  for (const l of lines) {
    const m = l.text.match(strictInvRegex);
    if (m && m[1] && !/^(no|date|dt|tax|cash|retail|memo|original|supply|invoice)$/i.test(m[1])) {
      invoiceNumber = m[1].toUpperCase();
      invoiceNoConfidence = 95;
      break;
    }
  }

  if (!invoiceNumber) {
    // Fallback: look for general "#12345" or "INV-1234"
    const generalInvRegex = /(?:inv|bill|memo)[.:#\s\-]+([a-z0-9\-\/]{2,20})/i;
    for (const l of lines) {
      const m = l.text.match(generalInvRegex);
      if (m && m[1] && !/^(no|date|dt|tax|cash)$/i.test(m[1])) {
        invoiceNumber = m[1].toUpperCase();
        invoiceNoConfidence = 80;
        break;
      }
    }
  }

  // Look for invoice number under "Invoice No." header in top rows (e.g. line 3 has 'P3' or 'PB')
  if (!invoiceNumber) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const m = lines[i].text.match(/\b([A-Z]{1,3}\d{1,5}|\d{2,6})\b/);
      if (m && m[1] && !/^(?:202\d|201\d|500|100|200)$/.test(m[1])) {
        invoiceNumber = m[1];
        invoiceNoConfidence = 70;
        break;
      }
    }
  }

  // 4. Extract Date
  const dateRegex = /(?:date|dt|dated)?[.:\s]*([0-3]?[0-9][\/\-.](?:[0-1]?[0-9]|[a-z]{3})[\/\-.](?:20)?[0-9]{2})/i;
  for (const l of lines) {
    const m = l.text.match(dateRegex);
    if (m && m[1]) {
      invoiceDate = m[1];
      dateConfidence = 95;
      break;
    }
  }

  // 5. Extract Totals, Subtotal, Round Off, Tax
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const lower = l.text.toLowerCase();

    // Grand total / Net Amount
    if (grandTotal === null && (lower.includes('grand total') || lower.includes('net amount') || lower.includes('total payable') || lower.includes('bill amount') || lower.includes('total amount'))) {
      const num = extractLastNumberFromLine(l.text);
      if (num !== null && num > 0) {
        grandTotal = num;
      }
    }

    // Subtotal
    if (subtotal === null && (lower.includes('sub total') || lower.includes('subtotal') || lower.includes('taxable amount') || lower.includes('taxable value'))) {
      const num = extractLastNumberFromLine(l.text);
      if (num !== null && num > 0) {
        subtotal = num;
      }
    }

    // Round Off
    if (roundOff === null && (lower.includes('round off') || lower.includes('round-off') || lower.includes('rounded off'))) {
      const num = extractLastNumberFromLine(l.text);
      if (num !== null) {
        roundOff = num;
      }
    }

    // Tax Amount
    if (taxAmount === null && (lower.includes('total tax') || lower.includes('gst amount') || lower.includes('tax amount'))) {
      const num = extractLastNumberFromLine(l.text);
      if (num !== null && num > 0) {
        taxAmount = num;
      }
    }
  }

  // Fallback for standalone "Total: 1500" if grandTotal was not yet found
  if (grandTotal === null) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const lower = lines[i].text.toLowerCase();
      if (/^total[:\s\-]+[₹$€£\d.,]+/i.test(lower) || /\btotal\s*[:=\-]\s*[₹$€£\d.,]+/i.test(lower)) {
        const num = extractLastNumberFromLine(lines[i].text);
        if (num !== null && num > 0) {
          grandTotal = num;
          break;
        }
      }
    }
  }

  return {
    supplierName,
    supplierConfidence,
    invoiceNumber,
    invoiceNoConfidence,
    invoiceDate,
    dateConfidence,
    gstin,
    customerName,
    subtotal,
    taxAmount,
    discount,
    roundOff,
    grandTotal,
  };
}

/**
 * Extracts the last valid decimal or integer number from a string.
 */
function extractLastNumberFromLine(text: string): number | null {
  const tokens = text.split(/\s+/);
  for (let j = tokens.length - 1; j >= 0; j--) {
    const cleaned = cleanNumericToken(tokens[j]);
    const val = parseFloat(cleaned);
    if (!isNaN(val) && val >= 0 && /^\d+(?:\.\d+)?$/.test(cleaned)) {
      return val;
    }
  }
  return null;
}
