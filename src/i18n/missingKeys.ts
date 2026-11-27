/**
 * @file missingKeys.ts
 * @description Development and test reporting for translation keys that are missing from the
 * selected language. Production keeps the silent English fallback so users never see a blank label.
 */
import type { LanguageCode } from './languages';

const REPORT_ENABLED = Boolean(import.meta.env.DEV) || import.meta.env.MODE === 'test';
const reported = new Set<string>();

/** Every "language:key" pair reported so far (test hook). */
export const missingTranslationReports: string[] = [];

export function reportMissingKey(language: LanguageCode, key: string): void {
  if (language === 'en' || !REPORT_ENABLED) return;
  const id = `${language}:${key}`;
  if (reported.has(id)) return;
  reported.add(id);
  missingTranslationReports.push(id);
  console.warn(`[i18n] missing "${key}" for language "${language}"; showing English`);
}
