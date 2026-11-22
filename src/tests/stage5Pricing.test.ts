/**
 * Stage 5: frontend pricing integration (status UX, pricing basis, server-checked cart, role-aware actions,
 * localized approval labels). The server stays authoritative; these tests check what the interface shows
 * and offers, and that it never decides a price on its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translationsMap } from '../i18n/locales';
import { BILL_UI_LABELS, VOICE_LANGUAGES_LIST, getLocalizedBillLabel } from '../config/voiceLanguages';
import {
  basisText,
  formatRupees,
  hasConvertedBasis,
  isSellableStatus,
  normalizePricingStatus,
  rateText,
  statusBadgeKey,
  statusReasonKey,
} from '../utils/productPricing';
import { cartLineRequest } from '../hooks/useSaleQuote';
import { isApproverRole } from '../hooks/useShopRole';
import { mapBackendProductToFrontend } from '../services/inventoryService';
import type { Product } from '../types';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() }, getAccessToken: () => null }));

const product = (over: Partial<Product> = {}): Product =>
  ({ id: 'p', name: 'Tea', sellingPrice: 40, price: 40, unit: 'packet', ...over }) as Product;

const src = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('the four pricing statuses', () => {
  it('are read from the server and only VERIFIED / WHOLESALE_ONLY are offered for sale', () => {
    expect(['VERIFIED', 'NEEDS_REVIEW', 'INCOMPLETE', 'WHOLESALE_ONLY', 'needs_review', 'bogus', null].map(normalizePricingStatus))
      .toEqual(['VERIFIED', 'NEEDS_REVIEW', 'INCOMPLETE', 'WHOLESALE_ONLY', 'NEEDS_REVIEW', null, null]);
    expect(isSellableStatus('VERIFIED')).toBe(true);
    expect(isSellableStatus('WHOLESALE_ONLY')).toBe(true);
    expect(isSellableStatus('NEEDS_REVIEW')).toBe(false);
    expect(isSellableStatus('INCOMPLETE')).toBe(false);
    expect(isSellableStatus(null)).toBe(true); // legacy product without a status: the server decides
  });

  it('each status has a badge and, where relevant, an explanation', () => {
    expect(statusBadgeKey('VERIFIED')).toBeNull();
    expect(statusBadgeKey('NEEDS_REVIEW')).toBe('pricing.status.NEEDS_REVIEW');
    expect(statusBadgeKey('INCOMPLETE')).toBe('pricing.status.INCOMPLETE');
    expect(statusBadgeKey('WHOLESALE_ONLY')).toBe('pricing.status.WHOLESALE_ONLY');
    expect(statusReasonKey('VERIFIED')).toBeNull();
    for (const s of ['NEEDS_REVIEW', 'INCOMPLETE', 'WHOLESALE_ONLY'] as const) expect(statusReasonKey(s)).toBe(`pricing.reason.${s}`);
  });

  it('the product mapping keeps status and pricing basis from the server', () => {
    const p = mapBackendProductToFrontend({
      id: 'x', name: 'Saffron', selling_price: 30, current_stock: 1, unit: 'kg', stock_status: 'In Stock',
      pricing_status: 'NEEDS_REVIEW', price_basis_quantity: 100, price_basis_unit: 'g', mrp: 40, mrp_basis_quantity: 100, mrp_basis_unit: 'g',
    } as never);
    expect(p).toMatchObject({ pricingStatus: 'NEEDS_REVIEW', priceBasisQuantity: 100, priceBasisUnit: 'g', mrpBasisQuantity: 100, mrpBasisUnit: 'g' });
  });
});

describe('pricing basis display (no client price calculation)', () => {
  it('shows the rate with its basis', () => {
    expect(basisText(product())).toBe('packet');
    expect(basisText(product({ unit: 'kg', priceBasisQuantity: 1, priceBasisUnit: 'kg' }))).toBe('kg');
    expect(basisText(product({ unit: 'kg', priceBasisQuantity: 100, priceBasisUnit: 'g' }))).toBe('100 g');
    expect(rateText(product())).toBe('₹40.00 / packet');
    expect(rateText(product({ sellingPrice: 30, unit: 'kg', priceBasisQuantity: 100, priceBasisUnit: 'g' }))).toBe('₹30.00 / 100 g');
    expect(rateText(product({ sellingPrice: 62.988 }))).toBe('₹62.988 / packet');
    expect(formatRupees(1250.5)).toBe('₹1,250.50');
  });

  it('flags a converted basis (the server converts the quantity)', () => {
    expect(hasConvertedBasis(product())).toBe(false);
    expect(hasConvertedBasis(product({ unit: 'kg', priceBasisQuantity: 100, priceBasisUnit: 'g' }))).toBe(true);
  });

  it('the quote and checkout send the line, never a client-computed price for catalogue lines', () => {
    expect(cartLineRequest({ product: product(), quantity: 3 })).toEqual({ product_id: 'p', quantity: 3 });
    expect(cartLineRequest({ product: product(), quantity: 3, unitPrice: 33.3333333333, needsApproval: true }))
      .toEqual({ product_id: 'p', quantity: 3, requested_line_total: 100 });
  });
});

describe('roles', () => {
  it('only OWNER and MANAGER are approvers', () => {
    expect(['OWNER', 'MANAGER', 'CASHIER', null, 'owner'].map(isApproverRole)).toEqual([true, true, false, false, false]);
  });
});

describe('POS integration (source)', () => {
  const sales = src('../pages/Sales.tsx');
  it('never adds a product the server would refuse, and explains why', () => {
    expect(sales).toMatch(/if \(!isSellableStatus\(product\.pricingStatus\)\) \{/);
    expect(sales).toMatch(/data-testid="pricing-status-badge"/);
    expect(sales).toMatch(/data-testid="pricing-status-reason"/);
    expect(sales).toMatch(/disabled=\{!sellable\}/);
  });
  it('offers verification only to approvers; others are told to ask a Manager / Owner', () => {
    expect(sales).toMatch(/\{!sellable && \(canApprove \? \(/);
    expect(sales).toMatch(/productsApi\.verifyProduct/);
    expect(sales).toMatch(/t\('pricing\.askManager'\)/);
  });
  it('totals come from the server quote; checkout waits for it and for approval rules', () => {
    expect(sales).toMatch(/useSaleQuote\(cart, quoteNonce\)/);
    expect(sales).toMatch(/const shownTotal = quoteReady && quote!\.all_ok \? quote!\.total : totalAmount;/);
    expect(sales).toMatch(/quoteStatus === 'checking' \|\| blockingLines\.length > 0\s*\|\| \(approvalPending && !canApprove\)/);
    expect(sales).toMatch(/disabled=\{checkoutBlocked \|\| isProcessing\}/);
    expect(sales).toMatch(/checkoutInFlight\.current \|\| checkoutBlocked\) return;/);
  });
  it('per-line server reasons are shown on the line; a refused sale keeps the cart and re-checks it', () => {
    expect(sales).toMatch(/data-testid="cart-line-error"/);
    expect(sales).toMatch(/t\(`pricing\.errors\.\$\{lineProblem\.code \?\? 'invalid'\}`\)/);
    expect(sales).toMatch(/setQuoteNonce\(\(n\) => n \+ 1\)/);
    expect(sales).not.toMatch(/setCart\(\[\]\);\s*\n\s*\}\s*catch/);
  });
  it('a changed cart is "checking" in the same render (never a stale ready/idle that would enable checkout)', () => {
    const hook = src('../hooks/useSaleQuote.ts');
    expect(hook).toMatch(/if \(!result \|\| result\.forKey !== requestKey\) return \{ quote: null, status: 'checking' \};/);
    expect(hook).toMatch(/if \(seq\.current === id\) setResult/);  // stale responses ignored
  });
  it('the role comes from the server membership endpoint', () => {
    expect(src('../hooks/useShopRole.ts')).toMatch(/shopsApi\.getMyMembership\(\)/);
    expect(src('../api/shops.ts')).toMatch(/\/api\/v1\/shops\/me\/membership/);
    expect(src('../api/sales.ts')).toMatch(/\/api\/v1\/sales\/quote/);
  });
});

describe('localization: pricing labels in every app language', () => {
  const en = translationsMap.en.pricing as Record<string, unknown>;
  const flatten = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
    Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => (
      typeof v === 'string' ? { ...acc, [prefix + k]: v } : { ...acc, ...flatten(v as Record<string, unknown>, `${prefix}${k}.`) }), {});
  const enFlat = flatten(en);
  const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
  const codes = Object.keys(translationsMap) as (keyof typeof translationsMap)[];

  it('covers English and the 12 Indian languages with the same keys and placeholders', () => {
    expect(codes.length).toBe(13);
    for (const code of codes) {
      const flat = flatten(translationsMap[code].pricing as Record<string, unknown>);
      expect(Object.keys(flat).sort(), code).toEqual(Object.keys(enFlat).sort());
      for (const [key, text] of Object.entries(flat)) {
        expect(text.trim().length, `${code}.${key}`).toBeGreaterThan(0);
        expect(placeholders(text), `${code}.${key}`).toBe(placeholders(enFlat[key]));
      }
    }
  });

  it('non-English languages are translated, not copies of English', () => {
    for (const code of codes.filter((c) => c !== 'en')) {
      const flat = flatten(translationsMap[code].pricing as Record<string, unknown>);
      const copied = Object.keys(flat).filter((k) => flat[k] === enFlat[k]);
      expect(copied, code).toEqual([]);
    }
  });
});

describe('localization: voice bill approval labels in all 12 voice languages', () => {
  const keys = ['spokenNeedsApproval', 'editedNeedsApproval', 'spokenMatchesCatalogue', 'catalogue', 'needsApprovalShort', 'notFinalApproval'];
  it('every voice language has every approval label, translated', () => {
    expect(VOICE_LANGUAGES_LIST.length).toBe(12);
    for (const key of keys) {
      for (const lang of VOICE_LANGUAGES_LIST) {
        const text = BILL_UI_LABELS[key][lang.key];
        expect(text?.trim().length, `${key}.${lang.key}`).toBeGreaterThan(0);
        if (lang.key !== 'english') expect(text, `${key}.${lang.key}`).not.toBe(BILL_UI_LABELS[key].english);
      }
    }
    expect(getLocalizedBillLabel('spokenNeedsApproval', 'hindi')).toBe('बोला गया मूल्य · मंज़ूरी ज़रूरी');
  });
  it('the voice modal uses them instead of fixed English text', () => {
    const modal = src('../components/VoiceBillModal.tsx');
    for (const key of ['spokenNeedsApproval', 'editedNeedsApproval', 'spokenMatchesCatalogue', 'notFinalApproval', 'needsApprovalShort']) {
      expect(modal).toContain(`'${key}'`);
    }
    expect(modal).not.toMatch(/'Spoken price = catalogue'|Not final: includes requested prices/);
  });
});
