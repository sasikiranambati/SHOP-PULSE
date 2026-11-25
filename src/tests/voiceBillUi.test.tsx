import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceBillModal } from '../components/VoiceBillModal';
import { LanguageProvider } from '../i18n/LanguageContext';
import { VOICE_LANGUAGES_LIST } from '../config/voiceLanguages';
import type { Product } from '../types';

const sampleProducts: Product[] = [
  {
    id: 'p-rice',
    name: 'Basmati Rice',
    category: 'Grains',
    price: 60,
    sellingPrice: 60,
    purchasePrice: 48,
    stock: 25,
    unit: 'kg',
  },
];

describe('Voice-to-Bill Card UI Polish', () => {
  it('contains zero decorative emojis or raw pictograph glyphs in VoiceBillModal source', () => {
    const src = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u25A0-\u25FF]/u;
    expect(emojiPattern.test(src)).toBe(false);
  });

  it('renders clean header, both language selectors (all 12 languages), primary mic CTA, and footer actions', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <VoiceBillModal
          isOpen={true}
          onClose={vi.fn()}
          products={sampleProducts}
          onConfirmToCart={vi.fn()}
          onDirectCheckout={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(html).toContain('Voice to Bill');
    expect(html).toContain('12 Indian Languages');
    expect(html).toContain('Language I Speak');
    expect(html).toContain('Show Bill In');
    expect(html).toContain('Start Speaking');
    expect(html).toContain('Multilingual Voice Simulation Presets');
    expect(html).toContain('Add to Bill');
    expect(html).toContain('Confirm &amp; Pay');

    for (const lang of VOICE_LANGUAGES_LIST) {
      expect(html).toContain(lang.name);
    }
  });
});
