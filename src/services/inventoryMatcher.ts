/**
 * @file inventoryMatcher.ts
 * @description Product Normalization and Fuzzy Inventory Matching for ShopPulse.
 * Handles OCR character errors ("Tata Sa1t" -> "Tata Salt", "R1ce" -> "Rice"),
 * calculates Levenshtein & token similarity, and enforces 3 confidence tiers:
 * - HIGH (>= 0.85): Automatically match existing inventory item
 * - MEDIUM (0.55 to 0.84): Suggest match, require user confirmation
 * - LOW (< 0.55): Leave unmatched, require manual selection or create new item
 *
 * Never fabricates product IDs, prices, or categories.
 */

import type { Product } from '../types/product';
import type { CanonicalInvoiceItem, InvoiceLineItem, ConfidenceLevel } from './invoiceTypes';
import { inferProductCategory } from './invoiceParser';

/**
 * Normalizes a product title by correcting common OCR letter-digit confusions,
 * lowercasing, and stripping punctuation and parenthetical tokens.
 */
export function normalizeProductTitle(text: string): string {
  let cleaned = text
    .toLowerCase()
    .replace(/[₹$€£]/g, '')
    .replace(/\b(?:rs|inr)\b\.?/gi, '')
    .replace(/[|*.\-_=~()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Fix common OCR digit-for-letter substitutions in words (e.g. "r1ce" -> "rice", "sa1t" -> "salt", "s0ap" -> "soap")
  cleaned = cleaned
    .replace(/\br1ce\b/gi, 'rice')
    .replace(/\bsa[1l]t\b/gi, 'salt')
    .replace(/\bsal1\b/gi, 'salt')
    .replace(/\bs0ap\b/gi, 'soap')
    .replace(/([a-z])1([a-z])/g, (_m, p1, p2) => (p1 === 'r' && p2 === 'c' ? 'ric' : `${p1}i${p2}`))
    .replace(/([a-z])1\b/g, '$1t') // e.g. "sal1" -> "salt"
    .replace(/\b1([a-z])/g, 'i$1')
    .replace(/([a-z])0([a-z])/g, '$1o$2')
    .replace(/([a-z])5([a-z])/g, '$1s$2');

  return cleaned.trim();
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Normalized string similarity score between 0.0 and 1.0.
 */
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  const normA = normalizeProductTitle(a);
  const normB = normalizeProductTitle(b);
  if (!normA || !normB) return 0;
  if (normA.length < 3 || normB.length < 3) return 0;
  if (normA === normB) return 0.98;

  // Exact substring containment
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    const ratio = minLen / maxLen;
    if (ratio >= 0.6) {
      return Math.max(0.85, Math.round(ratio * 100) / 100);
    } else if (minLen >= 3) {
      const smaller = normA.length <= normB.length ? normA : normB;
      const larger = normA.length <= normB.length ? normB : normA;
      const wordRegex = new RegExp(`\\b${smaller.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (wordRegex.test(larger)) {
        return Math.max(0.65, Math.round(ratio * 100) / 100);
      }
    }
  }

  // Token Jaccard overlap
  const tokensA = new Set(normA.split(/\s+/).filter((t) => t.length > 1));
  const tokensB = new Set(normB.split(/\s+/).filter((t) => t.length > 1));

  let intersectionCount = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersectionCount++;
  }

  const unionCount = new Set([...tokensA, ...tokensB]).size;
  const tokenScore = unionCount > 0 ? intersectionCount / unionCount : 0;

  // Edit distance similarity
  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);
  const editScore = maxLen > 0 ? Math.max(0, 1 - dist / maxLen) : 0;

  // Combined score with higher weight to token overlap for multi-word FMCG items
  return Math.max(editScore, tokenScore * 0.7 + editScore * 0.3);
}

/**
 * Matches canonical items against existing store inventory products.
 */
export function matchCanonicalItemsWithInventory(
  canonicalItems: CanonicalInvoiceItem[],
  existingProducts: Product[]
): InvoiceLineItem[] {
  return canonicalItems.map((item) => {
    let bestProduct: Product | null = null;
    let highestScore = 0;
    const candidates: Array<{ product: Product; score: number }> = [];

    for (const prod of existingProducts) {
      const score = stringSimilarity(item.productName, prod.name);
      if (score > 0.45) {
        candidates.push({ product: prod, score });
      }
      if (score > highestScore) {
        highestScore = score;
        bestProduct = prod;
      }
    }

    // Sort candidates descending by score
    candidates.sort((a, b) => b.score - a.score);

    let matchLevel: ConfidenceLevel = 'LOW';
    let matchedProductId: string | undefined = undefined;
    let currentStock: number | undefined = undefined;
    let suggestedMatch: InvoiceLineItem['suggestedMatch'] = undefined;
    let isMatchConfirmed = false;

    if (highestScore >= 0.85 && bestProduct) {
      matchLevel = 'HIGH';
      matchedProductId = bestProduct.id;
      currentStock = bestProduct.stock;
      isMatchConfirmed = true;
    } else if (highestScore >= 0.55 && bestProduct) {
      matchLevel = 'MEDIUM';
      suggestedMatch = {
        id: bestProduct.id,
        name: bestProduct.name,
        stock: bestProduct.stock,
        sellingPrice: bestProduct.sellingPrice,
      };
      isMatchConfirmed = false; // User review required!
    }

    // Extracted invoice values are preserved as primary; do NOT overwrite them with inventory catalog prices
    const rate = item.rate ?? item.purchasePrice ?? null;
    const purchasePrice = item.purchasePrice ?? item.rate ?? null;
    const sellingPrice = item.sellingPrice ?? null;
    const mrp = item.mrp ?? null;
    const quantity = item.quantity ?? 1;

    // Line total comes from the invoice Amount column when available.
    // If Amount is missing: lineTotal = quantity * purchasePrice ONLY when both are valid.
    // NEVER write 0 for a missing line total — null means "not available".
    let lineTotal: number | null = item.lineTotal ?? null;
    if (lineTotal === null && quantity !== null && purchasePrice !== null && purchasePrice > 0) {
      lineTotal = Math.round(quantity * purchasePrice * 100) / 100;
    }

    const inventoryData =
      bestProduct && (matchLevel === 'HIGH' || matchLevel === 'MEDIUM')
        ? {
            storePurchasePrice: bestProduct.purchasePrice,
            storeSellingPrice: bestProduct.sellingPrice ?? bestProduct.price,
            storeMrp: bestProduct.mrp,
            currentStock: bestProduct.stock,
          }
        : undefined;

    const category =
      bestProduct && matchLevel === 'HIGH' && bestProduct.category
        ? bestProduct.category
        : inferProductCategory(item.productName);

    const lowConfidence =
      item.confidenceLevel === 'LOW' ||
      item.confidence < 70 ||
      matchLevel === 'MEDIUM' ||
      (item.validationIssues && item.validationIssues.length > 0);

    return {
      id: item.id,
      name: item.productName,
      category,
      quantity,
      unit: item.unit || 'pcs',
      rate,
      purchasePrice,
      sellingPrice,
      mrp,
      lineTotal,
      rawRate: item.rawRate ?? item.rate ?? null,
      rawPurchasePrice: item.rawPurchasePrice ?? item.purchasePrice ?? null,
      rawSellingPrice: item.rawSellingPrice ?? item.sellingPrice ?? null,
      rawMrp: item.rawMrp ?? item.mrp ?? null,
      inventoryData,
      discount: item.discount,
      taxableAmount: item.taxableAmount,
      taxAmount: item.taxAmount,
      gstRate: item.gstRate,
      hsnCode: item.hsnCode,
      confidence: item.confidence,
      confidenceLevel: item.confidenceLevel,
      lowConfidence: !!lowConfidence,
      matchedProductId,
      currentStock,
      suggestedMatch,
      isMatchConfirmed,
      validationWarning: item.validationIssues?.join('; '),
      sourceText: item.sourceText,
      extractionMethod: item.extractionMethod,
    };
  });
}
