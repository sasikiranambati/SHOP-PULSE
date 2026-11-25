/**
 * Deterministic intent detection for the business assistant.
 *
 * A question is matched against a registry of rules. Each rule belongs to one category and topic and
 * has a weight: specific phrases ("out of stock", "top selling", "reorder") weigh more than generic
 * category words ("sales", "stock", "forecast"). The highest-weighted rule wins. When two different
 * categories tie at the top, the question is ambiguous and the assistant asks which one was meant
 * instead of fetching data for either. Unrecognised questions fetch nothing.
 *
 * To support a new question type, add a rule to RULES (and a formatter for its topic).
 */
import type {
  AssistantIntent,
  AssistantSalesPeriod,
  ForecastTopic,
  InventoryTopic,
  SalesTopic,
  SummaryTopic,
} from './types';

type RuleTarget =
  | { category: 'SALES'; topic: SalesTopic }
  | { category: 'INVENTORY'; topic: InventoryTopic }
  | { category: 'FORECAST'; topic: ForecastTopic }
  | { category: 'BUSINESS_SUMMARY'; topic: SummaryTopic };

interface IntentRule {
  id: string;
  target: RuleTarget;
  weight: number;
  /** Returns true when the normalised question matches. */
  test: (q: string) => boolean;
}

const re = (pattern: RegExp) => (q: string) => pattern.test(q);
/** Substring match, for scripts where \b word boundaries do not apply. */
const anyOf = (words: string[]) => (q: string) => words.some((w) => q.includes(w));
const either = (...tests: Array<(q: string) => boolean>) => (q: string) => tests.some((t) => t(q));

const SALES_WORDS = re(
  /\b(sales?|sell|sold|selling|revenue|turnover|income|earn(ed|ings|ing)?|collections?|collected|takings|transactions?|bills?|billing)\b/
);
const SALES_WORDS_INDIC = anyOf([
  'बिक्री', 'అమ్మకాలు', 'விற்பனை', 'فروخت', 'বিক্রি', 'विक्री', 'ಮಾರಾಟ', 'വിൽപ്പന', 'વેચાણ', 'ਵਿਕਰੀ',
]);
const INVENTORY_WORDS = re(/\b(inventory|stock|stocks|products? left|items? left)\b/);
const INVENTORY_WORDS_INDIC = anyOf(['स्टॉक', 'స్టాక్', 'இருப்பு', 'اسٹاک', 'স্টক', 'ಸ್ಟಾಕ್', 'സ്റ്റോക്ക്', 'સ્ટોક', 'ਸਟਾਕ']);
const ATTENTION = re(/\b(needs?|requires?|requiring|needing) (my |urgent |immediate )?attention\b|\battention (items?|needed|required)\b/);
const PRODUCT_WORDS = re(/\b(stock|inventory|products?|items?)\b/);

const RULES: IntentRule[] = [
  // ------------------------------------------------------------------ FORECAST (projections)
  {
    id: 'forecast.product',
    target: { category: 'FORECAST', topic: 'product' },
    weight: 4,
    test: (q) => extractProductQuery(q) !== null,
  },
  {
    id: 'forecast.runout',
    target: { category: 'FORECAST', topic: 'runout_7d' },
    weight: 4,
    test: re(
      /\b(will|going to|about to|could|might|may|likely to|when)\b[\w\s]*\b(run|sell) out\b|\brunning out\b|\brun ?out (soon|in|within|next|this)\b|\b(next|coming) (7|seven) days\b|\bwithin (a|one|1) week\b|\bstock ?-?out (in|within|soon|next|this)\b|\bdays? (of stock )?(left|remaining)\b|\bhow long will\b[\w\s]*\blast\b/
    ),
  },
  {
    id: 'forecast.reorder',
    target: { category: 'FORECAST', topic: 'reorder' },
    weight: 3,
    test: either(
      re(
        /\bre-?order(ing|s)?\b(?! (level|point|threshold))|\bre-?stock(ing)?\b|\border more\b|\bwhat (should|do|must|can) i (buy|order|purchase)\b|\bwhat to (buy|order|purchase)\b|\b(need|have) to (buy|order|purchase)\b|\bpurchase (list|plan)\b|\bshopping list\b|\bhow much (to|should i) (order|buy)\b/
      ),
      anyOf(['रीस्टॉक', 'ری اسٹاک', 'రీస్టాక్'])
    ),
  },
  {
    id: 'forecast.high_risk',
    target: { category: 'FORECAST', topic: 'high_risk' },
    weight: 3,
    test: re(/\bstock ?-?outs?\b|\brisk of (a )?(stock ?-?out|running out|selling out)\b|\b(high|highest|most|biggest) (stock ?-?out )?risk\b|\bat risk\b/),
  },
  {
    id: 'forecast.low_confidence',
    target: { category: 'FORECAST', topic: 'low_confidence' },
    weight: 3,
    test: re(/\b(low|weak|poor)[- ]confidence\b|\bconfidence\b|\b(unreliable|uncertain)\b|\bnot (reliable|confident|accurate)\b/),
  },
  {
    id: 'forecast.insufficient_history',
    target: { category: 'FORECAST', topic: 'insufficient_history' },
    weight: 3,
    test: re(
      /\b(insufficient|not enough|no|limited|little|without|missing|sparse|less) (sales )?(history|data|records)\b|\bcold[- ]start\b|\bnew products?\b|\bnever (been )?sold\b|\bno sales history\b/
    ),
  },
  {
    id: 'forecast.overview',
    target: { category: 'FORECAST', topic: 'overview' },
    weight: 2,
    test: re(/\bforecasts?\b|\bforecasting\b|\bpredict(ion|ions|ed|s)?\b|\bdemand\b|\bprojections?\b/),
  },

  // ------------------------------------------------------------------ INVENTORY (current stock)
  {
    id: 'inventory.out_of_stock',
    target: { category: 'INVENTORY', topic: 'out_of_stock' },
    weight: 3,
    test: re(/\bout of stock\b|\bsold out\b|\b(zero|no|nil|empty) stock\b|\b(have|has|already) (run|ran|sold) out\b|\bran out\b/),
  },
  {
    id: 'inventory.out_of_stock_past',
    target: { category: 'INVENTORY', topic: 'out_of_stock' },
    weight: 4.5,
    test: re(/\b(have|has|already) (run|ran|sold) out\b|\bran out\b|\b(what|which)[\w\s]* (is|are) (currently |now )?out of stock\b/),
  },
  {
    id: 'inventory.low_stock',
    target: { category: 'INVENTORY', topic: 'low_stock' },
    weight: 3,
    test: either(
      re(
        /\blow[- ]?stock\b|\brunning low\b|\b(stock|inventory) (is |are )?(getting |running )?low\b|\blow (on|in) stock\b|\bbelow (the |their )?(minimum|threshold|reorder level|reorder point)\b|\blow (items|products|inventory)\b|\balmost (empty|finished|gone)\b|\b(products?|items?) (are |is )?(getting |running )?low\b/
      ),
      anyOf(['स्टॉक कम', 'कम स्टॉक', 'స్టాక్ తక్కువ', 'తక్కువ స్టాక్', 'இருப்பு குறைவ', 'اسٹاک کم', 'کم اسٹاک'])
    ),
  },
  {
    id: 'inventory.attention',
    target: { category: 'INVENTORY', topic: 'attention' },
    weight: 3,
    test: (q) => ATTENTION(q) && PRODUCT_WORDS(q),
  },
  {
    id: 'inventory.summary.explicit',
    target: { category: 'INVENTORY', topic: 'summary' },
    weight: 3,
    test: re(/\b(inventory|stock) (summary|status|overview|levels?|health|report|position|count)\b|\bhow (is|are) (my|the|our) (stock|inventory)\b|\boverstock(ed)?\b/),
  },
  {
    id: 'inventory.summary',
    target: { category: 'INVENTORY', topic: 'summary' },
    weight: 2,
    test: either(INVENTORY_WORDS, INVENTORY_WORDS_INDIC),
  },

  // ------------------------------------------------------------------ SALES (recorded sales)
  {
    id: 'sales.top_sellers',
    target: { category: 'SALES', topic: 'top_sellers' },
    weight: 3,
    test: either(
      re(
        /\b(top|best|fastest|highest|most popular)[- ]?(selling|sellers?|sold|products?|items?|revenue)\b|\bbest ?-?sellers?\b|\bselling (fast|fastest|best|most|well)\b|\bsells? (the )?(most|best|fastest)\b|\bsold (the )?most\b|\bmost sold\b|\bpopular (products?|items?)\b/
      ),
      anyOf(['सबसे ज्यादा बिक', 'सबसे तेजी से बिक', 'ఎక్కువగా అమ్మ', 'அதிகம் விற்', 'سب سے زیادہ فروخت'])
    ),
  },
  {
    id: 'sales.slow_movers',
    target: { category: 'SALES', topic: 'slow_movers' },
    weight: 3,
    test: re(/\bslow[- ]?(moving|movers?|selling|sellers?)\b|\bnot selling\b|\b(least|worst)[- ]?(selling|sold|sellers?|performing)\b|\bdead stock\b/),
  },
  {
    id: 'sales.trend',
    target: { category: 'SALES', topic: 'trend' },
    weight: 3,
    test: re(/\btrends?\b|\bdaily (sales|revenue)\b|\bpeak (day|sales)\b|\bbest (sales )?day\b|\bday[- ]by[- ]day\b|\b(sales|revenue) (by|per) day\b/),
  },
  {
    id: 'sales.comparison',
    target: { category: 'SALES', topic: 'comparison' },
    weight: 3,
    test: (q) =>
      /\bcompar(e|ed|ing|ison)\b|\bvs\b|\bversus\b|\bgrowth\b|\b(grew|grown|growing)\b|\bthan (yesterday|last)\b|\bbetter or worse\b|\b(up|down) (from|on|compared|vs)\b/.test(q) &&
      (SALES_WORDS(q) || SALES_WORDS_INDIC(q) || detectPeriod(q) !== null || /\byesterday\b/.test(q)),
  },
  {
    id: 'sales.yesterday',
    target: { category: 'SALES', topic: 'yesterday' },
    weight: 3,
    test: (q) => /\byesterday\b/.test(q) && (SALES_WORDS(q) || SALES_WORDS_INDIC(q)),
  },
  {
    id: 'sales.overview',
    target: { category: 'SALES', topic: 'overview' },
    weight: 2,
    test: either(SALES_WORDS, SALES_WORDS_INDIC, re(/\bhow much (money )?(did i|have i|i) (make|made|earn|earned|collect|collected)\b/)),
  },

  // ------------------------------------------------------------------ BUSINESS SUMMARY
  {
    id: 'summary.explicit',
    target: { category: 'BUSINESS_SUMMARY', topic: 'summary' },
    weight: 3,
    test: re(
      /\b(business|shop|store|overall) (summary|overview|health|status|report|update|performance)\b|\bhow (is|are) (my|the|our) (business|shop|store|things)\b|\bhow am i doing\b|\bdaily (report|briefing|brief)\b|\bbriefing\b/
    ),
  },
  {
    id: 'summary.generic',
    target: { category: 'BUSINESS_SUMMARY', topic: 'summary' },
    weight: 1.5,
    test: re(/\bsummar(y|ise|ize|ies)\b|\boverview\b|\breport\b/),
  },
  {
    id: 'summary.attention',
    target: { category: 'BUSINESS_SUMMARY', topic: 'attention' },
    weight: 3,
    test: (q) =>
      (ATTENTION(q) && !PRODUCT_WORDS(q)) ||
      /\b(concerns?|concerning|worr(y|ies|ied|ying)|problems?|issues?|red flags?|risks)\b|\bwhat('s| is) wrong\b/.test(q),
  },
  {
    id: 'summary.actions.explicit',
    target: { category: 'BUSINESS_SUMMARY', topic: 'actions' },
    weight: 3,
    test: re(/\bwhat (should|must|can) i (do|focus on|work on|prioriti[sz]e)\b|\bwhat to do\b|\baction (items?|plan|list)\b|\bto-?do( list)?\b|\bnext steps?\b/),
  },
  {
    id: 'summary.actions.generic',
    target: { category: 'BUSINESS_SUMMARY', topic: 'actions' },
    weight: 2.5,
    test: re(/\bactions?\b|\bpriorit(y|ies|i[sz]e)\b|\brecommend(ation|ations|ed|s)?\b|\btips?\b|\badvice\b|\bsuggest(ion|ions)?\b/),
  },
];

/** Lowercase, unify apostrophes, drop punctuation (keeping letters/digits of every script), collapse spaces. */
export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The rolling sales period a question names, or null when none is named. */
export function detectPeriod(q: string): AssistantSalesPeriod | null {
  if (/\b(quarter|quarterly|3 months|three months|90 days|ninety days)\b/.test(q)) return '90d';
  if (/\b(month|monthly|30 days|thirty days)\b/.test(q)) return '30d';
  if (/\b(week|weekly|weeks|7 days|seven days)\b/.test(q)) return '7d';
  if (/\b(today|todays|so far|this morning|tonight|right now)\b/.test(q) || /(आज|ఈరోజు|ఈ రోజు|இன்று|آج|আজ|ಇಂದು|ഇന്ന്|આજે|ਅੱਜ)/.test(q)) {
    return 'today';
  }
  return null;
}

const GENERIC_PRODUCT_WORDS = new Set([
  '', 'it', 'anything', 'something', 'any product', 'any item', 'this', 'that', 'them', 'they', 'my stock', 'stock', 'my inventory', 'inventory', 'products', 'items',
  'my products', 'my items', 'everything', 'things', 'the forecast', 'forecast', 'forecasts', 'my shop', 'my store',
  'the stock', 'demand', 'sales', 'my sales',
]);

/**
 * A product named in a product-specific forecast question ("explain the forecast for basmati rice",
 * "how long will sugar last", "when will tea run out"), or null when the question names none.
 */
export function extractProductQuery(q: string): string | null {
  const m =
    /\b(?:explain|tell me about|is(?= .+ going to (?:run|sell) out)|details? (?:for|of|on|about)|forecast (?:for|of|on)|demand (?:for|of)|how long will|how many days will|when will|why is)\s+(.+)$/.exec(q);
  if (!m) return null;
  const subject = m[1]
    .replace(/^(?:the |my |our )?(?:demand )?(?:forecast|prediction|estimate)s? (?:for|of|on) /, '')
    .replace(/^(?:the|my|our) /, '');
  // A sentence about the whole shop ("explain my sales", "tell me about low stock") is not a product
  const withoutVerb = subject.replace(/\s+(?:going to|about to|likely to|last|run out|sell out|go out of stock)\b.*$/, '');
  if (/\b(sales|stock|inventory|forecasts?|business|shop|store|summary|products|items|confidence|history|risk)\b/.test(withoutVerb)) return null;
  const name = subject
    .replace(/\s+(?:going to|about to|likely to)\b.*$/, '')
    .replace(/\s+(?:last|last for|run out|sell out|finish|be finished|stock out|go out of stock|forecast|be|do|stock)(?:\s.*)?$/, '')
    .replace(/\s+(?:in|within|next|this)\s+.*$/, '')
    .trim();
  if (GENERIC_PRODUCT_WORDS.has(name) || name.length < 2) return null;
  return name;
}

const DEFAULT_PERIOD: Record<SalesTopic, AssistantSalesPeriod> = {
  overview: 'today',
  yesterday: 'today',
  comparison: '7d',
  top_sellers: '7d',
  slow_movers: '7d',
  trend: '7d',
};

function toIntent(target: RuleTarget, q: string): AssistantIntent {
  switch (target.category) {
    case 'SALES': {
      const named = detectPeriod(q);
      let period = named ?? DEFAULT_PERIOD[target.topic];
      // "today vs yesterday": the today window carries yesterday as its comparison period
      if (target.topic === 'comparison' && /\byesterday\b/.test(q)) period = 'today';
      if (target.topic === 'yesterday') period = 'today';
      return { category: 'SALES', topic: target.topic, period, periodExplicit: named !== null || /\byesterday\b/.test(q) };
    }
    case 'FORECAST':
      return target.topic === 'product'
        ? { category: 'FORECAST', topic: 'product', productQuery: extractProductQuery(q) ?? undefined }
        : { category: 'FORECAST', topic: target.topic };
    case 'INVENTORY':
      return { category: 'INVENTORY', topic: target.topic };
    case 'BUSINESS_SUMMARY':
      return { category: 'BUSINESS_SUMMARY', topic: target.topic };
  }
}

export interface IntentMatch {
  ruleId: string;
  weight: number;
  intent: AssistantIntent;
}

/** All matching rules, strongest first (for debugging and tests). */
export function matchRules(question: string): IntentMatch[] {
  const q = normalizeQuestion(question);
  if (!q) return [];
  return RULES.filter((r) => r.test(q))
    .map((r) => ({ ruleId: r.id, weight: r.weight, intent: toIntent(r.target, q) }))
    .sort((a, b) => b.weight - a.weight);
}

/** Detect the intent of a free-text question. */
export function detectIntent(question: string): AssistantIntent {
  const q = normalizeQuestion(question);
  if (!q) return { category: 'UNKNOWN', reason: 'empty' };
  const matches = matchRules(question);
  if (matches.length === 0) return { category: 'UNKNOWN', reason: 'unrecognized' };

  const best = matches[0];
  // The strongest match of each other category at the same weight makes the question ambiguous
  const rivals = matches.filter((m) => m.weight === best.weight && m.intent.category !== best.intent.category);
  if (rivals.length > 0) {
    const options: AssistantIntent[] = [best.intent];
    for (const r of rivals) {
      if (!options.some((o) => o.category === r.intent.category)) options.push(r.intent);
    }
    return { category: 'UNKNOWN', reason: 'ambiguous', options };
  }
  return best.intent;
}
