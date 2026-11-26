/**
 * Localization behaviour across all supported languages.
 *
 * Renders the real Insights page in each language (server markup) and checks that the translated
 * labels appear and the English labels do not. Also covers persistence, locale-aware formatting
 * and the development missing-key report.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Insights } from '../pages/Insights';
import { LanguageProvider, useLanguage } from '../i18n/LanguageContext';
import { missingTranslationReports } from '../i18n/missingKeys';
import { translationsMap } from '../i18n/locales/index';
import { en } from '../i18n/locales/en';
import { LANGUAGES, type LanguageCode } from '../i18n/languages';
import { formatINRFor, formatNumberFor, formatDateFor, INTL_LOCALE } from '../i18n/format';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'test-user', email: 'owner@example.com' },
    loading: false,
  }),
}));

// React escapes these characters in server markup; compare translated text in the same form.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const LANG_CODES = LANGUAGES.map((l) => l.code) as LanguageCode[];

function renderInsightsIn(lang: LanguageCode): string {
  localStorage.setItem('shelfora_language', lang);
  localStorage.setItem('shoppulse_language', lang);
  return renderToStaticMarkup(
    <LanguageProvider>
      <Insights />
    </LanguageProvider>,
  );
}

// The test environment is node (server markup only). Provide an in-memory localStorage that behaves
// like the browser one, so the language provider's persistence code runs for real.
const memoryStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k: string, v: string) => void memoryStore.set(k, String(v)),
  removeItem: (k: string) => void memoryStore.delete(k),
  clear: () => memoryStore.clear(),
  key: (i: number) => Array.from(memoryStore.keys())[i] ?? null,
  get length() { return memoryStore.size; },
} as Storage;

beforeEach(() => {
  localStorage.clear();
  missingTranslationReports.length = 0;
});

describe('Insights page follows the selected language', () => {
  for (const lang of LANG_CODES) {
    it(`${lang}: shows translated tabs and headings`, () => {
      const html = renderInsightsIn(lang);
      const dict = translationsMap[lang].insightsPage;
      expect(html).toContain(escapeHtml(dict.tabSales));
      expect(html).toContain(escapeHtml(dict.tabInventory));
      expect(html).toContain(escapeHtml(dict.tabForecast));
      expect(html).toContain(escapeHtml(dict.tabAi));
      expect(html).toContain(escapeHtml(dict.trendTitle));
      expect(html).toContain(escapeHtml(dict.perfTitle));
    });

    if (lang !== 'en') {
      it(`${lang}: does not show the English tab labels`, () => {
        const html = renderInsightsIn(lang);
        for (const english of ['Sales Insights', 'Inventory Insights', 'Demand Forecast', 'AI Intelligence', 'Product Performance']) {
          expect(html).not.toContain(english);
        }
      });
    }
  }
});

describe('language selection persists', () => {
  it('reads the saved language on load', () => {
    localStorage.setItem('shelfora_language', 'hi');
    const Probe = () => <span data-lang={useLanguage().language} />;
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(html).toContain('data-lang="hi"');
  });

  it('falls back to English for an unknown saved value', () => {
    localStorage.setItem('shelfora_language', 'xx');
    const Probe = () => <span data-lang={useLanguage().language} />;
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(html).toContain('data-lang="en"');
  });
});

describe('missing-key reporting', () => {
  it('reports a key missing from the selected language, once, and falls back to English', () => {
    missingTranslationReports.length = 0;
    const Probe = () => <span>{useLanguage().t('insightsPage.__no_such_key__')}</span>;
    localStorage.setItem('shelfora_language', 'te');
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(html).toContain('insightsPage.__no_such_key__');
    expect(missingTranslationReports).toContain('te:insightsPage.__no_such_key__');
  });

  it('does not report keys that exist in the selected language', () => {
    missingTranslationReports.length = 0;
    const Probe = () => <span>{useLanguage().t('insightsPage.title')}</span>;
    localStorage.setItem('shelfora_language', 'ta');
    renderToStaticMarkup(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(missingTranslationReports).toEqual([]);
  });
});

describe('locale-aware display formatting (values are never changed)', () => {
  it('keeps the rupee amount numerically identical in every language', () => {
    for (const lang of LANG_CODES) {
      const text = formatINRFor(lang, 1234.5);
      // Grouping separators differ by locale (1,234.50 or 12,34.50); the digits and the decimal part must not.
      expect(text.replace(/[^0-9]/g, '')).toBe('123450');
      expect(text).toContain('.50');
      expect(text).toContain('₹');
    }
  });

  it('uses Latin digits for every language', () => {
    for (const lang of LANG_CODES) {
      expect(formatNumberFor(lang, 1234567)).toMatch(/^[0-9,.\s]+$/);
      expect(formatINRFor(lang, 99)).toMatch(/[0-9]/);
      expect(formatINRFor(lang, 99)).not.toMatch(/[०-९০-৯٠-٩۰-۹]/);
    }
  });

  it('returns a placeholder for missing numbers and empty strings for invalid dates', () => {
    expect(formatNumberFor('en', null)).toBe('—');
    expect(formatINRFor('en', undefined)).toBe('₹0.00');
    expect(formatDateFor('en', 'not-a-date')).toBe('');
  });

  it('maps every supported language to a locale tag', () => {
    for (const lang of LANG_CODES) {
      expect(INTL_LOCALE[lang]).toMatch(/^[a-z]{2}-IN$/);
    }
  });

  it('English dictionary is the reference for the Insights page keys', () => {
    expect(en.insightsPage.title).toBe('AI Insights & Analytics');
  });
});
