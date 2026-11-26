/**
 * @file format.ts
 * @description Locale-aware display formatting for numbers, currency, dates and times.
 *
 * Display only. Calculations never use these functions; they receive raw numbers from the
 * engines and format them at render time. Numbers always use Latin digits (0-9) so amounts stay
 * readable and match what cashiers type. Currency is always INR (₹).
 */

import type { LanguageCode } from './languages';

/** BCP 47 tag used for Intl formatting of each supported language. */
export const INTL_LOCALE: Record<LanguageCode, string> = {
  en: 'en-IN',
  te: 'te-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  or: 'or-IN',
  as: 'as-IN',
  ur: 'ur-IN',
};

const NUMBERING_SYSTEM = 'latn' as const;

function tagFor(language: LanguageCode | string | undefined): string {
  return (language && INTL_LOCALE[language as LanguageCode]) || INTL_LOCALE.en;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Plain number with Indian digit grouping, Latin digits. Returns '—' for missing values. */
export function formatNumberFor(
  language: LanguageCode | string | undefined,
  value: number | string | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  return new Intl.NumberFormat(tagFor(language), { numberingSystem: NUMBERING_SYSTEM, ...options }).format(n);
}

/** Rupee amount with two decimals, e.g. ₹1,234.50. Missing values render as ₹0.00. */
export function formatINRFor(
  language: LanguageCode | string | undefined,
  value: number | string | null | undefined,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '₹0.00';
  return new Intl.NumberFormat(tagFor(language), {
    numberingSystem: NUMBERING_SYSTEM,
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(n);
}

/** Localised calendar date. Accepts a Date or an ISO string. Invalid input renders as ''. */
export function formatDateFor(
  language: LanguageCode | string | undefined,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(tagFor(language), options).format(d);
}

/** Localised time of day, e.g. 10:30 AM (locale-specific), 24-hour where the locale uses it. */
export function formatTimeFor(
  language: LanguageCode | string | undefined,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(tagFor(language), options).format(d);
}
