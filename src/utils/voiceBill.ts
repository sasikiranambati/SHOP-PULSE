/**
 * Voice-to-Bill line helpers: how a recognised line becomes a cart line, and manual price correction.
 * A price spoken (or corrected by the user) is carried as the line's own unit price, so the cart, the
 * displayed bill and the saved sale all use it; the catalogue price applies only when no price was said.
 */
import type {
  AmbiguousVoiceItem,
  MatchedVoiceItem,
  UnmatchedVoiceItem,
} from '../api/voice';
import type { CartItem, Product } from '../types';
import { catalogPrice, lineTotal, round3 } from './cartPricing';

/** True when the line's price must be kept instead of the catalogue price. */
export function hasAgreedPrice(item: MatchedVoiceItem, product?: Product): boolean {
  if (item.price_source === 'spoken' || item.price_source === 'edited') return true;
  if (item.price_source === 'catalogue') return false;
  // Older responses without price_source: keep any price that differs from the catalogue
  const exact = item.unit_price_exact ?? item.unit_price;
  return product ? Math.abs(exact - catalogPrice(product)) > 1e-9 : false;
}

/** Exact unit price of a line: quantity x this, rounded to paise, gives the line total. */
export function exactUnitPrice(item: MatchedVoiceItem): number {
  if (typeof item.unit_price_exact === 'number') return item.unit_price_exact;
  return item.quantity > 0 ? item.total_price / item.quantity : item.unit_price;
}

export function voiceLineToCartItem(item: MatchedVoiceItem, product: Product): CartItem {
  const line: CartItem = { product, quantity: item.quantity };
  if (hasAgreedPrice(item, product)) {
    line.unitPrice = exactUnitPrice(item);
    line.priceSource = item.price_source === 'edited' ? 'edited' : 'spoken';
  }
  if (item.spoken_quantity) line.spokenQuantity = item.spoken_quantity;
  return line;
}

/** A line whose total the user corrected: the unit price follows the new total; the quantity is unchanged. */
export function withEditedLineTotal(item: MatchedVoiceItem, total: number): MatchedVoiceItem {
  const paise = lineTotal(1, total); // to the paisa, half-up
  const exact = item.quantity > 0 ? paise / item.quantity : paise;
  return {
    ...item,
    total_price: paise,
    unit_price_exact: exact,
    unit_price: Math.round(exact * 1000) / 1000,
    price_source: 'edited',
  };
}

export interface VoiceUtteranceOutcome {
  matched_items: MatchedVoiceItem[];
  ambiguous_items: AmbiguousVoiceItem[];
  unmatched_items: UnmatchedVoiceItem[];
}

export interface VoiceUtteranceEntry {
  seq: number;
  outcome: VoiceUtteranceOutcome;
}

export interface VoiceBillDraftState {
  /** Committed bill items before pending utterance log entries (updated by manual +/-/edit/delete actions). */
  baseItems: MatchedVoiceItem[];
  /** Ordered sequence of spoken/simulated utterance outcomes applied on top of baseItems. */
  entries: VoiceUtteranceEntry[];
  ambiguousItems: AmbiguousVoiceItem[];
  unmatchedItems: UnmatchedVoiceItem[];
}

export function createEmptyVoiceBillDraft(): VoiceBillDraftState {
  return {
    baseItems: [],
    entries: [],
    ambiguousItems: [],
    unmatchedItems: [],
  };
}

function samePriceRate(a: MatchedVoiceItem, b: MatchedVoiceItem): boolean {
  const pa = a.price_source || 'catalogue';
  const pb = b.price_source || 'catalogue';
  if (pa !== pb) return false;
  const ua = a.unit_price_exact ?? a.unit_price;
  const ub = b.unit_price_exact ?? b.unit_price;
  return Math.abs(ua - ub) < 1e-6;
}

/** Applies a single utterance's matched items (add / update / remove commands) cleanly onto an item list. */
export function mergeVoiceMatchedItems(
  current: MatchedVoiceItem[],
  incoming: MatchedVoiceItem[],
): MatchedVoiceItem[] {
  const next = current.map((line) => ({ ...line }));

  for (const item of incoming) {
    const action = item.action || 'add';
    const existingIdx = next.findIndex((line) => line.product_id === item.product_id);

    if (action === 'remove') {
      if (existingIdx === -1) continue;
      if (item.explicit_quantity === false) {
        next.splice(existingIdx, 1);
      } else {
        const remainingQty = round3(next[existingIdx].quantity - item.quantity);
        if (remainingQty <= 0) {
          next.splice(existingIdx, 1);
        } else {
          const unitRate = exactUnitPrice(next[existingIdx]);
          next[existingIdx] = {
            ...next[existingIdx],
            quantity: remainingQty,
            total_price: lineTotal(remainingQty, unitRate),
            is_insufficient_stock: remainingQty > next[existingIdx].current_stock,
          };
        }
      }
      continue;
    }

    if (action === 'update') {
      if (existingIdx !== -1) {
        const cur = next[existingIdx];
        const useSpoken = item.price_source === 'spoken';
        const rate = useSpoken ? exactUnitPrice(item) : exactUnitPrice(cur);
        const newQty = round3(item.quantity);
        next[existingIdx] = {
          ...cur,
          quantity: newQty,
          unit_price: useSpoken ? item.unit_price : cur.unit_price,
          unit_price_exact: rate,
          price_source: useSpoken ? 'spoken' : cur.price_source,
          total_price: useSpoken ? item.total_price : lineTotal(newQty, rate),
          is_insufficient_stock: newQty > cur.current_stock,
        };
      } else {
        next.push({ ...item, action: 'add' });
      }
      continue;
    }

    // Default 'add': merge matching product when price rate matches; preserve distinct spoken-price lines.
    const mergeIdx = next.findIndex(
      (line) => line.product_id === item.product_id && samePriceRate(line, item),
    );
    if (mergeIdx !== -1) {
      const mergedQty = round3(next[mergeIdx].quantity + item.quantity);
      const unitRate = exactUnitPrice(next[mergeIdx]);
      next[mergeIdx] = {
        ...next[mergeIdx],
        quantity: mergedQty,
        total_price: lineTotal(mergedQty, unitRate),
        is_insufficient_stock: mergedQty > next[mergeIdx].current_stock,
      };
    } else {
      next.push({ ...item });
    }
  }

  return next;
}

/** Recomputes effective matched items by deterministically folding baseItems + all entries in order. */
export function computeDraftMatchedItems(draft: VoiceBillDraftState): MatchedVoiceItem[] {
  let acc = draft.baseItems;
  for (const entry of draft.entries) {
    acc = mergeVoiceMatchedItems(acc, entry.outcome.matched_items || []);
  }
  return acc;
}

function mergeAmbiguousList(
  existing: AmbiguousVoiceItem[],
  incoming: AmbiguousVoiceItem[],
): AmbiguousVoiceItem[] {
  const out = [...existing];
  for (const amb of incoming) {
    const idx = out.findIndex((a) => a.queried_name.toLowerCase() === amb.queried_name.toLowerCase());
    if (idx !== -1) {
      out[idx] = amb;
    } else {
      out.push(amb);
    }
  }
  return out;
}

function mergeUnmatchedList(
  existing: UnmatchedVoiceItem[],
  incoming: UnmatchedVoiceItem[],
): UnmatchedVoiceItem[] {
  const out = [...existing];
  for (const un of incoming) {
    const idx = out.findIndex(
      (u) => u.queried_name.toLowerCase() === un.queried_name.toLowerCase() && u.reason === un.reason,
    );
    if (idx !== -1) {
      out[idx] = un;
    } else {
      out.push(un);
    }
  }
  return out;
}

/**
 * Applies or updates a numbered utterance outcome in the draft state without losing previous utterances
 * or double-counting between instant client preview and authoritative backend resolution.
 */
export function upsertVoiceUtteranceOutcome(
  draft: VoiceBillDraftState,
  seq: number,
  outcome: VoiceUtteranceOutcome,
  options: { replaceLast?: boolean; mode?: 'preview' | 'authoritative' } = {},
): VoiceBillDraftState {
  const entries = [...draft.entries];
  const existingIdx = entries.findIndex((e) => e.seq === seq);

  if (existingIdx !== -1) {
    entries[existingIdx] = { seq, outcome };
  } else if (options.replaceLast && entries.length > 0) {
    entries[entries.length - 1] = { seq, outcome };
  } else {
    entries.push({ seq, outcome });
  }

  const isAuth = options.mode === 'authoritative';
  // Recompute ambiguous/unmatched cleanly on authoritative updates without clobbering earlier unresolved items
  let nextAmbiguous = draft.ambiguousItems;
  let nextUnmatched = draft.unmatchedItems;
  if (isAuth || outcome.ambiguous_items.length > 0 || outcome.unmatched_items.length > 0) {
    nextAmbiguous = mergeAmbiguousList(draft.ambiguousItems, outcome.ambiguous_items);
    nextUnmatched = mergeUnmatchedList(draft.unmatchedItems, outcome.unmatched_items);
  }

  return {
    baseItems: draft.baseItems,
    entries,
    ambiguousItems: nextAmbiguous,
    unmatchedItems: nextUnmatched,
  };
}

/** Commits pending entries into baseItems before applying a manual user adjustment (stepper, edit, remove). */
export function flattenDraftToBase(draft: VoiceBillDraftState): VoiceBillDraftState {
  return {
    ...draft,
    baseItems: computeDraftMatchedItems(draft),
    entries: [],
  };
}
