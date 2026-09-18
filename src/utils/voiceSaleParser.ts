/**
 * @file voiceSaleParser.ts
 * @description Natural language parser for future voice-assisted POS checkout.
 * Example input: "2 milk 1 bread" or "3 maggi and 2 coca cola".
 * Transforms unstructured text into structured SaleItems matched against catalog products.
 */

import type { Product } from '../types/product';
import type { VoiceSaleParseResult, ParsedVoiceSaleItem } from '../types/sale';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
  'half dozen': 6
};

/**
 * Replace spoken numbers with digits ("two milk" -> "2 milk").
 */
function normalizeSpokenNumbers(text: string): string {
  let normalized = text.toLowerCase().trim();

  // Handle "half dozen" first
  normalized = normalized.replace(/\bhalf\s+dozen\b/g, '6');

  // Replace standard number words
  for (const [word, val] of Object.entries(NUMBER_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    normalized = normalized.replace(regex, String(val));
  }

  return normalized;
}

/**
 * Find the best matching product from the catalog for a given search query.
 */
export function findMatchingProduct(query: string, catalog: Product[]): Product | null {
  const cleanQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!cleanQuery) return null;

  // 1. Exact name match
  const exact = catalog.find(p => p.name.toLowerCase() === cleanQuery);
  if (exact) return exact;

  // 2. Starts-with or contains match on name
  const nameMatch = catalog.find(p => p.name.toLowerCase().includes(cleanQuery));
  if (nameMatch) return nameMatch;

  // 3. Match against words in product name
  const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length > 0) {
    let bestProduct: Product | null = null;
    let maxMatchCount = 0;

    for (const p of catalog) {
      const pNameLower = p.name.toLowerCase();
      let matchCount = 0;
      for (const w of queryWords) {
        if (pNameLower.includes(w)) {
          matchCount++;
        }
      }
      if (matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        bestProduct = p;
      }
    }

    if (bestProduct && maxMatchCount > 0) {
      return bestProduct;
    }
  }

  // 4. Category match fallback (e.g. "milk" in Dairy category)
  const categoryMatch = catalog.find(p => p.category.toLowerCase() === cleanQuery);
  if (categoryMatch) return categoryMatch;

  return null;
}

/**
 * Parse natural language voice text into structured sale items.
 * Example: "2 milk 1 bread" -> 2x Milk, 1x Bread
 */
export function parseVoiceSaleInput(
  rawInput: string,
  catalog: Product[]
): VoiceSaleParseResult {
  if (!rawInput || !rawInput.trim() || !catalog || catalog.length === 0) {
    return {
      items: [],
      unmatchedPhrases: [],
      rawText: rawInput || '',
      confidence: 0
    };
  }

  const normalized = normalizeSpokenNumbers(rawInput);
  
  // Split by connectors: comma, "and", "plus", "+", or semicolon
  const rawSegments = normalized
    .split(/[,;\+]|\band\b|\bplus\b/g)
    .map(s => s.trim())
    .filter(Boolean);

  const matchedItems: ParsedVoiceSaleItem[] = [];
  const unmatchedPhrases: string[] = [];

  for (const segment of rawSegments) {
    // Check if segment has leading digit: e.g. "2 toned milk"
    const digitPrefixMatch = segment.match(/^(\d+(?:\.\d+)?)\s*(?:packets?|pkts?|kg|liters?|ltrs?|bottles?|units?|pieces?|pcs?)?\s+(.*)$/i);

    // Or trailing digit: e.g. "toned milk 2"
    const digitSuffixMatch = segment.match(/^(.*?)\s+(\d+(?:\.\d+)?)$/i);

    // Or compact: e.g. "2 milk 1 bread" within single segment
    const multiMatch = [...segment.matchAll(/(\d+(?:\.\d+)?)\s+([a-zA-Z\s]+?)(?=(?:\d+|$))/g)];

    if (multiMatch.length > 1) {
      for (const m of multiMatch) {
        const qty = parseFloat(m[1]) || 1;
        const itemText = m[2].trim();
        const product = findMatchingProduct(itemText, catalog);
        if (product) {
          const price = product.sellingPrice ?? product.price ?? 0;
          matchedItems.push({
            product,
            quantity: qty,
            price,
            total: Math.round(price * qty * 100) / 100,
            unit: product.unit || 'units'
          });
        } else {
          unmatchedPhrases.push(`${qty} ${itemText}`);
        }
      }
    } else if (digitPrefixMatch) {
      const qty = parseFloat(digitPrefixMatch[1]) || 1;
      const itemText = digitPrefixMatch[2].trim();
      const product = findMatchingProduct(itemText, catalog);

      if (product) {
        const price = product.sellingPrice ?? product.price ?? 0;
        matchedItems.push({
          product,
          quantity: qty,
          price,
          total: Math.round(price * qty * 100) / 100,
          unit: product.unit || 'units'
        });
      } else {
        unmatchedPhrases.push(segment);
      }
    } else if (digitSuffixMatch) {
      const itemText = digitSuffixMatch[1].trim();
      const qty = parseFloat(digitSuffixMatch[2]) || 1;
      const product = findMatchingProduct(itemText, catalog);

      if (product) {
        const price = product.sellingPrice ?? product.price ?? 0;
        matchedItems.push({
          product,
          quantity: qty,
          price,
          total: Math.round(price * qty * 100) / 100,
          unit: product.unit || 'units'
        });
      } else {
        unmatchedPhrases.push(segment);
      }
    } else {
      // Default to quantity 1 if no number provided (e.g. "milk")
      const product = findMatchingProduct(segment, catalog);
      if (product) {
        const price = product.sellingPrice ?? product.price ?? 0;
        matchedItems.push({
          product,
          quantity: 1,
          price,
          total: price,
          unit: product.unit || 'units'
        });
      } else {
        unmatchedPhrases.push(segment);
      }
    }
  }

  const totalSegments = matchedItems.length + unmatchedPhrases.length;
  const confidence = totalSegments > 0 ? matchedItems.length / totalSegments : 0;

  return {
    items: matchedItems,
    unmatchedPhrases,
    rawText: rawInput,
    confidence
  };
}
