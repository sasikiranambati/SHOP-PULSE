/**
 * Phase 10 Live Speech Replay & Failure Separation Utility.
 * Replays recorded/simulated transcripts through the exact production parsing pipeline
 * and separates upstream Speech Recognition (STT) errors from downstream Parser/Matcher errors.
 */
import type { Product } from '../types/product';
import {
  parseMultilingualVoiceBill,
  type MultilingualParseResult,
} from './multilingualVoiceParser';

export interface ReplayExpectation {
  spokenIntent?: string;
  sttTranscript: string;
  speechAlternatives?: string[];
  sttConfidence?: number | null;
  expectedItems: Array<{ productName: string; quantity: number }>;
}

export type ReplayClassification =
  | 'PASS'
  | 'STT_CORRUPTED_RECOVERED'
  | 'AMBIGUOUS_CONFIRMATION'
  | 'FALSE_POSITIVE'
  | 'STT_FAILURE'
  | 'PARSER_FAILURE';

export interface ReplayDiagnosticResult {
  classification: ReplayClassification;
  sttDrifted: boolean;
  parseResult: MultilingualParseResult;
  extractedSummary: Array<{ productName: string; quantity: number; quantitySource?: string; confidence?: number | null }>;
}

export function replayVoiceTranscript(
  input: ReplayExpectation,
  catalog: Product[],
): ReplayDiagnosticResult {
  const parseResult = parseMultilingualVoiceBill(input.sttTranscript, catalog, 'english', {
    sttConfidence: input.sttConfidence,
    speechAlternatives: input.speechAlternatives,
  });

  const got = parseResult.matched_items.map((m) => ({
    name: m.name.toLowerCase(),
    qty: Math.round(m.quantity * 1000) / 1000,
  }));
  const exp = input.expectedItems.map((e) => ({
    name: e.productName.toLowerCase(),
    qty: Math.round(e.quantity * 1000) / 1000,
  }));

  const normIntent = (input.spokenIntent || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normStt = input.sttTranscript.trim().toLowerCase().replace(/\s+/g, ' ');
  const sttDrifted = Boolean(normIntent) && normIntent !== normStt;

  const exactMatch =
    got.length === exp.length &&
    got.every((g, idx) => g.name === exp[idx].name && Math.abs(g.qty - exp[idx].qty) < 1e-6);

  let classification: ReplayClassification;
  if (exp.length === 0) {
    classification = got.length > 0 ? 'FALSE_POSITIVE' : 'PASS';
  } else if (exactMatch) {
    const usedCtx = parseResult.matched_items.some(
      (m) => m.quantity_source === 'contextual_homophone' || m.quantity_source === 'stt_alternative',
    );
    classification = sttDrifted || usedCtx ? 'STT_CORRUPTED_RECOVERED' : 'PASS';
  } else if (parseResult.ambiguous_items.length > 0 && got.length === 0) {
    classification = 'AMBIGUOUS_CONFIRMATION';
  } else {
    classification = sttDrifted ? 'STT_FAILURE' : 'PARSER_FAILURE';
  }

  return {
    classification,
    sttDrifted,
    parseResult,
    extractedSummary: parseResult.matched_items.map((m) => ({
      productName: m.name,
      quantity: m.quantity,
      quantitySource: m.quantity_source,
      confidence: m.quantity_confidence,
    })),
  };
}
