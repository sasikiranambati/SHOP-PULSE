import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceBillModal } from '../components/VoiceBillModal';
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

describe('Voice-to-Bill English-Only UI', () => {
  it('contains zero decorative emojis or raw pictograph glyphs in VoiceBillModal source', () => {
    const src = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u25A0-\u25FF]/u;
    expect(emojiPattern.test(src)).toBe(false);
  });

  it('uses fixed English speech & bill config with zero language selectors or multilingual options', () => {
    const src = readFileSync(resolve(__dirname, '../components/VoiceBillModal.tsx'), 'utf8');
    expect(src).toContain("VOICE_SPEECH_CODE = 'en-IN'");
    expect(src).not.toContain('spoken-lang-dropdown');
    expect(src).not.toContain('display-lang-dropdown');

    const html = renderToStaticMarkup(
      <VoiceBillModal
        isOpen={true}
        onClose={vi.fn()}
        products={sampleProducts}
        onConfirmToCart={vi.fn()}
        onDirectCheckout={vi.fn()}
      />
    );

    expect(html).toContain('Voice-to-Bill');
    expect(html).toContain('Voice to Bill');
    expect(html).toContain('Start Speaking');
    expect(html).toContain('English Voice Simulation Presets');
    expect(html).toContain('Add to Bill');
    expect(html).toContain('Confirm &amp; Pay');

    expect(html).not.toContain('<select');
    expect(html).not.toContain('Language I Speak');
    expect(html).not.toContain('Show Bill In');
    expect(html).not.toContain('12 Indian Languages');
    for (const removedLang of [
      'Telugu',
      'Hindi',
      'Tamil',
      'Kannada',
      'Malayalam',
      'Marathi',
      'Bengali',
      'Gujarati',
      'Punjabi',
      'Odia',
      'Assamese',
    ]) {
      expect(html).not.toContain(removedLang);
    }
  });
});
