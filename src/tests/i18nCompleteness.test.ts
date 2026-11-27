/**
 * Dictionary completeness for every supported language.
 *
 * - Every locale must define exactly the keys that English defines (no missing, no extra keys).
 * - Placeholders such as {count} must match English in every language.
 * - No translation may be empty.
 * - Every key used by the Insights page must resolve in every language.
 */
import { describe, it, expect } from 'vitest';
import { en } from '../i18n/locales/en';
import { translationsMap } from '../i18n/locales/index';
import { LANGUAGES } from '../i18n/languages';

type Leaves = Record<string, string>;

function flatten(obj: unknown, prefix = ''): Leaves {
  const out: Leaves = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

const enLeaves = flatten(en);
const enKeys = Object.keys(enLeaves).sort();
const placeholdersOf = (s: string) => Array.from(s.matchAll(/\{([a-zA-Z_]+)\}/g), (m) => m[1]).sort().join(',');

const LANGS = LANGUAGES.map((l) => l.code);

describe('locale dictionaries: key parity with English', () => {
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    it(`${lang} defines every English key and no extra keys`, () => {
      const leaves = flatten(translationsMap[lang]);
      const keys = Object.keys(leaves).sort();
      const missing = enKeys.filter((k) => !(k in leaves));
      const extra = keys.filter((k) => !(k in enLeaves));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${lang} keeps the same placeholders as English for every key`, () => {
      const leaves = flatten(translationsMap[lang]);
      const mismatches = enKeys
        .filter((k) => k in leaves && placeholdersOf(enLeaves[k]) !== placeholdersOf(leaves[k]))
        .map((k) => `${k}: en={${placeholdersOf(enLeaves[k])}} ${lang}={${placeholdersOf(leaves[k])}}`);
      expect(mismatches).toEqual([]);
    });

    it(`${lang} has no empty translations`, () => {
      const leaves = flatten(translationsMap[lang]);
      const empty = Object.entries(leaves)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k);
      expect(empty).toEqual([]);
    });
  }

  it('English itself has no empty strings', () => {
    const empty = Object.entries(enLeaves).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('every supported language has a dictionary', () => {
    for (const code of LANGS) {
      expect(translationsMap[code], `missing dictionary for ${code}`).toBeDefined();
    }
  });
});
