/**
 * @file posDraftStorage.ts
 * @description Session-scoped POS cart and expiry-return persistence so a 401 session timeout
 * never silently discards an active bill or Voice-to-Bill checkout draft.
 */

import type { CartItem, PageRoute } from '../types';

export const POS_DRAFT_STORAGE_KEY = 'shoppulse_pos_draft_v1';
export const SESSION_EXPIRED_STORAGE_KEY = 'shoppulse_session_expired_v1';

export interface PosBillDraft {
  ownerKey: string;
  cart: CartItem[];
  customerName: string;
  paymentMethod: 'Cash' | 'UPI' | 'Card';
  savedAt: number;
}

export interface SessionExpiredRecord {
  expiredAt: number;
  returnPage?: PageRoute;
  hadActiveDraft?: boolean;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadPosDraft(ownerKey: string = 'anonymous'): PosBillDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(POS_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosBillDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.ownerKey !== ownerKey) return null;
    if (!Array.isArray(parsed.cart)) return null;
    const paymentMethod = parsed.paymentMethod === 'UPI' || parsed.paymentMethod === 'Card' ? parsed.paymentMethod : 'Cash';
    return {
      ownerKey: parsed.ownerKey,
      cart: parsed.cart,
      customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
      paymentMethod,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePosDraft(
  ownerKey: string = 'anonymous',
  draft: { cart: CartItem[]; customerName: string; paymentMethod: 'Cash' | 'UPI' | 'Card' },
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (draft.cart.length === 0 && !draft.customerName.trim()) {
      const existing = loadPosDraft(ownerKey);
      if (existing) {
        storage.removeItem(POS_DRAFT_STORAGE_KEY);
      }
      return;
    }
    const payload: PosBillDraft = {
      ownerKey,
      cart: draft.cart,
      customerName: draft.customerName,
      paymentMethod: draft.paymentMethod,
      savedAt: Date.now(),
    };
    storage.setItem(POS_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore sessionStorage quota or private-mode errors
  }
}

export function clearPosDraft(ownerKey?: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (!ownerKey) {
      storage.removeItem(POS_DRAFT_STORAGE_KEY);
      return;
    }
    const raw = storage.getItem(POS_DRAFT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.ownerKey === ownerKey) {
      storage.removeItem(POS_DRAFT_STORAGE_KEY);
    }
  } catch {
    storage.removeItem(POS_DRAFT_STORAGE_KEY);
  }
}

export function hasAnySavedPosDraft(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const raw = storage.getItem(POS_DRAFT_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.cart) && parsed.cart.length > 0;
  } catch {
    return false;
  }
}

const PROTECTED_RETURN_PAGES: ReadonlySet<PageRoute> = new Set([
  'dashboard',
  'inventory',
  'sales',
  'insights',
  'scanner',
  'settings',
]);

export function markSessionExpired(returnPage?: PageRoute): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const existing = readSessionExpiredNotice();
    const validIncoming = returnPage && PROTECTED_RETURN_PAGES.has(returnPage) ? returnPage : undefined;
    const validExisting = existing?.returnPage && PROTECTED_RETURN_PAGES.has(existing.returnPage)
      ? existing.returnPage
      : undefined;
    const preservedReturnPage = validIncoming ?? validExisting;
    const record: SessionExpiredRecord = {
      expiredAt: Date.now(),
      returnPage: preservedReturnPage,
      hadActiveDraft: hasAnySavedPosDraft(),
    };
    storage.setItem(SESSION_EXPIRED_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage errors
  }
}

export function readSessionExpiredNotice(): SessionExpiredRecord | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_EXPIRED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionExpiredRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSessionExpiredNotice(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
