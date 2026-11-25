/**
 * Context-aware speech-to-quantity disambiguation, confidence scoring, and
 * conversational false-positive filtering for ShopPulse Voice-to-Bill.
 */
import type { Product } from '../types/product';

export interface HomophoneCandidateInfo {
  num: number;
  word: string;
  basePrior: number;
}

export const HOMOPHONE_QUANTITY_CANDIDATES: Record<string, HomophoneCandidateInfo> = {
  to: { num: 2, word: 'two', basePrior: 0.80 },
  too: { num: 2, word: 'two', basePrior: 0.83 },
  tu: { num: 2, word: 'two', basePrior: 0.76 },
  for: { num: 4, word: 'four', basePrior: 0.70 },
  fore: { num: 4, word: 'four', basePrior: 0.84 },
  won: { num: 1, word: 'one', basePrior: 0.80 },
  ate: { num: 8, word: 'eight', basePrior: 0.79 },
  tree: { num: 3, word: 'three', basePrior: 0.75 },
  sex: { num: 6, word: 'six', basePrior: 0.83 },
  sikh: { num: 6, word: 'six', basePrior: 0.78 },
};

const NON_BILL_FOLLOW_WORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that', 'these', 'those',
  'him', 'them', 'us', 'me', 'you', 'it', 'everyone', 'someone', 'anyone', 'nobody',
  'go', 'went', 'going', 'come', 'came', 'coming', 'get', 'got', 'buy', 'sell', 'pay', 'paid',
  'check', 'open', 'close', 'make', 'made', 'take', 'took', 'give', 'gave', 'see', 'saw',
  'know', 'be', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'have', 'has', 'had',
  'very', 'much', 'many', 'more', 'most', 'less', 'expensive', 'cheap', 'costly',
  'high', 'low', 'big', 'small', 'late', 'early', 'fast', 'slow', 'good', 'bad', 'hot', 'cold',
  'counter', 'shop', 'store', 'market', 'home', 'house', 'family', 'people', 'person', 'persons',
  'friend', 'friends', 'customer', 'customers', 'today', 'tomorrow', 'yesterday', 'now', 'here',
  'there', 'please', 'thank', 'thanks', 'sale', 'free', 'work', 'time', 'times', 'way',
]);

const INFINITIVE_OR_PREP_PREV_WORDS = new Set([
  'want', 'wanted', 'need', 'needed', 'like', 'going', 'go', 'went', 'come', 'came',
  'give', 'gave', 'send', 'sent', 'talk', 'speak', 'listen', 'try', 'trying', 'used',
  'ready', 'able', 'add', 'added', 'change', 'changed', 'set', 'update', 'updated', 'convert',
]);

const CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS = new Set([
  ...NON_BILL_FOLLOW_WORDS,
  'to', 'too', 'tu', 'for', 'of', 'in', 'on', 'at', 'by', 'from', 'with', 'and', 'or', 'but',
  'not', 'so', 'up', 'down', 'out', 'off', 'over', 'into', 'about', 'after', 'before', 'around',
  'want', 'need', 'like', 'would', 'could', 'should', 'will', 'shall', 'can', 'may', 'might',
  'just', 'only', 'also', 'really', 'actually', 'hey', 'hi', 'hello', 'ok', 'okay', 'yes', 'no',
  'i', 'we', 'he', 'she', 'they', 'who', 'what', 'when', 'where', 'why', 'how',
]);

const FILLER_PREFIX_WORDS = new Set([
  'please', 'give', 'me', 'us', 'get', 'add', 'bill', 'pack', 'want', 'need', 'i', 'we',
  'could', 'can', 'you', 'would', 'like', 'put', 'take', 'also', 'then',
]);

const CONJUNCTION_SEPARATORS = new Set(['and', 'plus', 'with', 'aur', 'mariyu', 'matrum', 'evam', 'tatha']);
const DISTINGUISHING_MODS = new Set(['flour', 'powder', 'free', 'brown', 'black', 'essential']);

export const CONFIDENCE_HIGH_AUTO = 0.82;
export const CONFIDENCE_MODERATE_CONFIRM = 0.60;

export interface ContextualCorrectionDetail {
  tokenIndex: number;
  originalToken: string;
  suggestedQuantity: number;
  matchedProductName: string | null;
  confidence: number;
  decision: 'auto' | 'confirm' | 'rejected';
  source: 'contextual_homophone' | 'stt_alternative';
  reason: string;
}

export interface ContextualResolutionResult {
  resolvedText: string;
  corrections: ContextualCorrectionDetail[];
}

export interface ParsedContextQtyTag {
  mode: 'auto' | 'conf';
  quantity: number;
  originalToken: string;
  confidence: number;
  source: 'contextual_homophone' | 'stt_alternative';
}

interface IndexedEntry {
  name: string;
  nameNorm: string;
  nameStems: string[];
  allStems: Set<string>;
  catStems: string[];
}

function normTok(tok: string): string {
  return tok.toLowerCase().replace(/[^a-z0-9\u0900-\u0D7F]/g, '');
}

function stemTok(tok: string): string {
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) {
    return tok.slice(0, -1);
  }
  return tok;
}

function phoneticKey(tok: string): string {
  if (!/^[\x00-\x7F]+$/.test(tok)) return tok;
  let s = tok.toLowerCase().replace(/(.)\1+/g, '$1');
  s = s.replace(/ie/g, 'i').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ph/g, 'f').replace(/aa/g, 'a');
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

function levSim(a: string, b: string): number {
  const sa = stemTok(a);
  const sb = stemTok(b);
  if (sa === sb) return 1.0;
  if (!sa || !sb || !/^[\x00-\x7F]+$/.test(sa) || !/^[\x00-\x7F]+$/.test(sb)) return 0.0;
  if (/^\d+$/.test(sa) || /^\d+$/.test(sb)) return sa === sb ? 1.0 : 0.0;
  const pa = phoneticKey(sa);
  const pb = phoneticKey(sb);
  if (pa && pa === pb && Math.min(sa.length, sb.length) >= 3) return 0.92;
  if (Math.abs(sa.length - sb.length) > 3 || Math.min(sa.length, sb.length) < 4) return 0.0;
  let s1 = sa;
  let s2 = sb;
  if (s1.length < s2.length) [s1, s2] = [s2, s1];
  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s1.length; i++) {
    const curr = [i];
    for (let j = 1; j <= s2.length; j++) {
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)));
    }
    prev = curr;
  }
  return Math.max(0.0, 1.0 - prev[s2.length] / Math.max(s1.length, s2.length));
}

function buildLightCatalogIndex(catalog?: Product[]): IndexedEntry[] {
  if (!catalog || catalog.length === 0) return [];
  const out: IndexedEntry[] = [];
  for (const p of catalog) {
    if (!p?.name) continue;
    const nameNorm = p.name.toLowerCase().replace(/[^a-z0-9\s\u0900-\u0D7F]/g, ' ').replace(/\s+/g, ' ').trim();
    const toks = nameNorm.split(' ').filter((t) => t.length > 1 || /^\d+$/.test(t));
    const stems = toks.map(stemTok);
    const catNorm = String(p.category || '').toLowerCase().replace(/[^a-z0-9\s\u0900-\u0D7F]/g, ' ').replace(/\s+/g, ' ').trim();
    const catStems = catNorm.split(' ').filter((t) => t.length > 2).map(stemTok);
    out.push({
      name: p.name,
      nameNorm,
      nameStems: stems,
      allStems: new Set(stems),
      catStems,
    });
  }
  return out;
}

function scoreCatalogProbe(
  probeTokens: string[],
  catalogIndex: IndexedEntry[],
): { score: number; matchedName: string | null; containsFirstToken: boolean } {
  if (!probeTokens.length || !catalogIndex.length) {
    return { score: 0, matchedName: null, containsFirstToken: false };
  }
  const qStems = probeTokens.map((t) => stemTok(normTok(t))).filter(Boolean);
  if (!qStems.length) return { score: 0, matchedName: null, containsFirstToken: false };

  const qSet = new Set(qStems);
  const qJoined = qStems.join(' ');
  let bestScore = 0;
  let bestName: string | null = null;
  let containsFirst = false;

  for (const entry of catalogIndex) {
    if (entry.nameNorm === qJoined) {
      return { score: 1.0, matchedName: entry.name, containsFirstToken: entry.allStems.has(qStems[0]) };
    }
    let hasUnreqMod = false;
    for (const s of entry.allStems) {
      if (!qSet.has(s) && DISTINGUISHING_MODS.has(s)) {
        hasUnreqMod = true;
        break;
      }
    }
    if (hasUnreqMod) continue;

    const sims: number[] = [];
    let primaryHit = false;
    for (const qt of qStems) {
      let bestTokSim = 0;
      for (const ct of entry.nameStems) {
        bestTokSim = Math.max(bestTokSim, levSim(qt, ct));
      }
      if (bestTokSim >= 0.78) {
        primaryHit = true;
        sims.push(bestTokSim);
      } else if (!DISTINGUISHING_MODS.has(qt) && entry.catStems.length > 0) {
        let catSim = 0;
        for (const ct of entry.catStems) {
          catSim = Math.max(catSim, levSim(qt, ct));
        }
        if (catSim >= 0.85) {
          primaryHit = true;
          sims.push(0.86);
        } else {
          sims.push(0);
        }
      } else {
        sims.push(0);
      }
    }

    if (!primaryHit) continue;
    const coverage = sims.filter((s) => s >= 0.78).length / qStems.length;
    const avgSim = sims.reduce((a, b) => a + b, 0) / qStems.length;
    const score = coverage >= 0.60 ? Math.min(0.98, 0.55 * coverage + 0.45 * avgSim) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestName = entry.name;
      containsFirst = entry.allStems.has(qStems[0]);
    }
  }

  return { score: bestScore, matchedName: bestName, containsFirstToken: containsFirst };
}

function isNumericLike(tok: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(tok);
}

function hasSttAlternativeCorroboration(
  tokens: string[],
  idx: number,
  expectedNum: number,
  alternatives?: string[],
): boolean {
  if (!alternatives || alternatives.length === 0) return false;
  const numStr = String(expectedNum);
  const wordStr = HOMOPHONE_QUANTITY_CANDIDATES[normTok(tokens[idx])]?.word || '';
  const nextTok = idx + 1 < tokens.length ? normTok(tokens[idx + 1]) : '';
  for (const alt of alternatives) {
    const altToks = alt.split(/\s+/).map(normTok).filter(Boolean);
    for (let j = 0; j < altToks.length; j++) {
      if ((altToks[j] === numStr || altToks[j] === wordStr) && (!nextTok || (j + 1 < altToks.length && levSim(altToks[j + 1], nextTok) >= 0.80))) {
        return true;
      }
    }
  }
  return false;
}

export function isConversationalNonProductPhraseClient(phrase: string, catalog?: Product[]): boolean {
  const toks = phrase.split(/\s+/).map(normTok).filter(Boolean);
  if (toks.length === 0) return true;
  if (!toks.every((t) => CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS.has(t) || CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS.has(stemTok(t)))) {
    return false;
  }
  if (catalog && catalog.length > 0) {
    const { score } = scoreCatalogProbe(toks, buildLightCatalogIndex(catalog));
    if (score >= 0.65) return false;
  }
  return true;
}

const CONTEXT_TAG_REGEX = /^__q(auto|conf)_(\d+)_([a-z0-9]+)_(\d+)_([a-z_]+)__$/i;

export function parseContextQtyTagClient(tok: string): ParsedContextQtyTag | null {
  const m = tok.trim().match(CONTEXT_TAG_REGEX);
  if (!m) return null;
  return {
    mode: m[1].toLowerCase() as 'auto' | 'conf',
    quantity: parseInt(m[2], 10),
    originalToken: m[3],
    confidence: Math.round((parseInt(m[4], 10) / 1000) * 1000) / 1000,
    source: (m[5] as 'contextual_homophone' | 'stt_alternative') || 'contextual_homophone',
  };
}

export function stripContextTagsToDigitsClient(text: string): string {
  return text.replace(/__q(auto|conf)_(\d+)_([a-z0-9]+)_(\d+)_([a-z_]+)__/gi, (_m, mode, numStr, orig) =>
    mode.toLowerCase() === 'auto' ? numStr : orig,
  );
}

export function resolveContextualHomophonesClient(
  normalizedText: string,
  catalog?: Product[],
  options: {
    unitWords?: Set<string>;
    sttConfidence?: number | null;
    speechAlternatives?: string[];
    hasActiveBillContext?: boolean;
  } = {},
): ContextualResolutionResult {
  if (!normalizedText || !normalizedText.trim()) {
    return { resolvedText: normalizedText, corrections: [] };
  }

  const tokens = normalizedText.trim().split(/\s+/);
  const n = tokens.length;
  if (n < 2) {
    return { resolvedText: normalizedText, corrections: [] };
  }

  const catalogIndex = buildLightCatalogIndex(catalog);
  const unitsSet = options.unitWords || new Set<string>();
  const outputTokens = [...tokens];
  const corrections: ContextualCorrectionDetail[] = [];

  for (let i = 0; i < n; i++) {
    const rawTok = tokens[i];
    const low = normTok(rawTok);
    const candInfo = HOMOPHONE_QUANTITY_CANDIDATES[low];
    if (!candInfo || i + 1 >= n) continue;

    const expectedNum = candInfo.num;
    const prevRaw = i > 0 ? tokens[i - 1] : '';
    const prevLow = normTok(prevRaw);
    const nextLow = normTok(tokens[i + 1]);

    if (isNumericLike(nextLow) || NON_BILL_FOLLOW_WORDS.has(nextLow)) {
      corrections.push({
        tokenIndex: i,
        originalToken: rawTok,
        suggestedQuantity: expectedNum,
        matchedProductName: null,
        confidence: 0,
        decision: 'rejected',
        source: 'contextual_homophone',
        reason: 'Followed by ordinary English word or digit',
      });
      continue;
    }

    if ((low === 'to' || low === 'for') && INFINITIVE_OR_PREP_PREV_WORDS.has(prevLow)) {
      if (!(['add', 'pack', 'bill'].includes(prevLow) && i <= 1)) {
        corrections.push({
          tokenIndex: i,
          originalToken: rawTok,
          suggestedQuantity: expectedNum,
          matchedProductName: null,
          confidence: 0,
          decision: 'rejected',
          source: 'contextual_homophone',
          reason: `Preceded by grammatical verb '${prevLow}'`,
        });
        continue;
      }
    }

    let probeStart = i + 1;
    let hasUnit = false;
    if (unitsSet.has(nextLow)) {
      hasUnit = true;
      probeStart += 1;
      if (probeStart < n && normTok(tokens[probeStart]) === 'of') {
        probeStart += 1;
      }
    }

    const candWindow: string[] = [];
    for (let j = probeStart; j < Math.min(n, probeStart + 3); j++) {
      const tj = tokens[j];
      const lj = normTok(tj);
      if (!lj || isNumericLike(lj) || CONJUNCTION_SEPARATORS.has(lj)) break;
      if (j > probeStart && lj in HOMOPHONE_QUANTITY_CANDIDATES && j + 1 < n) {
        const nxtAfter = normTok(tokens[j + 1]);
        if (!NON_BILL_FOLLOW_WORDS.has(nxtAfter) && catalogIndex.length > 0) {
          const { score: nxtScore } = scoreCatalogProbe([tokens[j + 1]], catalogIndex);
          if (nxtScore >= 0.75) break;
        }
      }
      if (NON_BILL_FOLLOW_WORDS.has(lj)) break;
      candWindow.push(tj);
    }

    if (candWindow.length === 0 && !hasUnit) continue;

    let withScore = 0;
    let containsSelf = false;
    if (catalogIndex.length > 0 && candWindow.length > 0) {
      const withRes = scoreCatalogProbe([rawTok, ...candWindow.slice(0, 2)], catalogIndex);
      withScore = withRes.score;
      containsSelf = withRes.containsFirstToken;
    }

    let bestProdScore = 0;
    let bestProdName: string | null = null;
    if (catalogIndex.length > 0 && candWindow.length > 0) {
      for (let k = 1; k <= candWindow.length; k++) {
        const res = scoreCatalogProbe(candWindow.slice(0, k), catalogIndex);
        if (res.score > bestProdScore) {
          bestProdScore = res.score;
          bestProdName = res.matchedName;
        }
      }
    }

    if (containsSelf && withScore >= bestProdScore) {
      corrections.push({
        tokenIndex: i,
        originalToken: rawTok,
        suggestedQuantity: expectedNum,
        matchedProductName: bestProdName,
        confidence: 0,
        decision: 'rejected',
        source: 'contextual_homophone',
        reason: 'Token belongs to catalog product name itself',
      });
      continue;
    }

    const altMatch = hasSttAlternativeCorroboration(tokens, i, expectedNum, options.speechAlternatives);
    const prev2Low = i >= 2 ? normTok(tokens[i - 2]) : '';
    const atClauseStart =
      i === 0 ||
      prevRaw.endsWith(',') ||
      prevRaw.endsWith(';') ||
      CONJUNCTION_SEPARATORS.has(prevLow) ||
      (FILLER_PREFIX_WORDS.has(prevLow) && (i === 1 || FILLER_PREFIX_WORDS.has(prev2Low)));

    const hasCompletedPrevItem = tokens
      .slice(Math.max(0, i - 4), i)
      .some((t) => isNumericLike(normTok(t)) || normTok(t) in HOMOPHONE_QUANTITY_CANDIDATES);

    let score = candInfo.basePrior;
    if (bestProdScore >= 0.90) score += 0.16;
    else if (bestProdScore >= 0.80) score += 0.12;
    else if (bestProdScore >= 0.72) score += 0.06;
    else if (hasUnit && bestProdScore === 0 && catalogIndex.length === 0) score -= 0.05;
    else score -= 0.55;

    if (atClauseStart || hasCompletedPrevItem) score += 0.08;
    else if (low === 'to' || low === 'for') score -= 0.14;

    if (hasUnit) score += 0.08;
    if (options.hasActiveBillContext) score += 0.04;
    if (altMatch) score += 0.16;
    else if (typeof options.sttConfidence === 'number') {
      if (options.sttConfidence < 0.80) score += 0.04;
      else if (options.sttConfidence >= 0.96 && low === 'for' && !atClauseStart) score -= 0.05;
    }

    score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
    const source: 'contextual_homophone' | 'stt_alternative' = altMatch ? 'stt_alternative' : 'contextual_homophone';

    let decision: 'auto' | 'confirm' | 'rejected' = 'rejected';
    if (score >= CONFIDENCE_HIGH_AUTO) {
      decision = 'auto';
      outputTokens[i] = `__qauto_${expectedNum}_${low}_${Math.round(score * 1000)}_${source}__`;
    } else if (score >= CONFIDENCE_MODERATE_CONFIRM) {
      decision = 'confirm';
      outputTokens[i] = `__qconf_${expectedNum}_${low}_${Math.round(score * 1000)}_${source}__`;
    }

    corrections.push({
      tokenIndex: i,
      originalToken: rawTok,
      suggestedQuantity: expectedNum,
      matchedProductName: bestProdName,
      confidence: score,
      decision,
      source,
      reason: bestProdName ? `Catalog match '${bestProdName}' (${bestProdScore.toFixed(2)})` : 'Insufficient catalog context',
    });
  }

  return {
    resolvedText: outputTokens.join(' '),
    corrections,
  };
}
