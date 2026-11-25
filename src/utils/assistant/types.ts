/**
 * Shared types for the ShopPulse business assistant.
 *
 * The assistant answers only from the shop's own records, read through the existing Insights APIs
 * (sales, inventory, AI summary, demand forecast). Nothing in these modules invents a value: every
 * number in an answer comes from an API response, and a failed or malformed response becomes an
 * error answer, never a fallback figure.
 */

export type IntentCategory = 'SALES' | 'INVENTORY' | 'FORECAST' | 'BUSINESS_SUMMARY' | 'UNKNOWN';

/** Rolling periods the sales API supports. "today" is the current UTC calendar day so far. */
export type AssistantSalesPeriod = 'today' | '7d' | '30d' | '90d';

export type SalesTopic = 'overview' | 'yesterday' | 'top_sellers' | 'slow_movers' | 'trend' | 'comparison';
export type InventoryTopic = 'summary' | 'out_of_stock' | 'low_stock' | 'attention';
export type ForecastTopic =
  | 'overview'
  | 'runout_7d'
  | 'reorder'
  | 'high_risk'
  | 'low_confidence'
  | 'insufficient_history'
  | 'product';
export type SummaryTopic = 'summary' | 'attention' | 'actions';

export type AssistantIntent =
  | { category: 'SALES'; topic: SalesTopic; period: AssistantSalesPeriod; periodExplicit: boolean }
  | { category: 'INVENTORY'; topic: InventoryTopic }
  | { category: 'FORECAST'; topic: ForecastTopic; productQuery?: string }
  | { category: 'BUSINESS_SUMMARY'; topic: SummaryTopic }
  | { category: 'UNKNOWN'; reason: 'empty' | 'unrecognized' | 'ambiguous'; options?: AssistantIntent[] };

/** A suggested question. It carries its intent, so a chip in any language routes exactly. */
export interface AssistantSuggestion {
  id: string;
  label: string;
  intent: AssistantIntent;
}

export type AnswerTone = 'critical' | 'warning' | 'positive' | 'neutral';

export interface AnswerItem {
  primary: string;
  secondary?: string;
  tone?: AnswerTone;
}

export type AnswerKind = 'answer' | 'empty' | 'clarify' | 'help' | 'restricted' | 'error';

/** A structured, renderable answer. All values are already formatted strings taken from API data. */
export interface AssistantAnswer {
  kind: AnswerKind;
  title: string;
  /** Short statements: totals, counts, the main finding. */
  lines: string[];
  /** Per-product rows (name, stock, quantities...). */
  items: AnswerItem[];
  /** Data-quality notes: insufficient history, low confidence, partial data, advisory figures. */
  warnings: string[];
  /** Where the numbers came from and for which range, e.g. "Sales records · 18 Nov 2026 10:00 – 25 Nov 2026 10:00 UTC". */
  source?: string;
  /** Follow-up questions (each carries its own intent). */
  followUps: AssistantSuggestion[];
  /** Only for errors: whether asking again may succeed (network, server). */
  retryable?: boolean;
}
