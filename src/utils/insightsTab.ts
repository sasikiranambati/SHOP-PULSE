/**
 * One-time request for the Insights page tab (e.g. the dashboard "View all" link opens the Action
 * Center). Without a request the page opens on its default tab, Sales Insights.
 */
export type InsightsTab = 'actions' | 'sales' | 'inventory' | 'forecast' | 'ai';

const KEY = 'shoppulse_insights_tab';
const TABS: InsightsTab[] = ['actions', 'sales', 'inventory', 'forecast', 'ai'];

export function requestInsightsTab(tab: InsightsTab): void {
  try {
    sessionStorage.setItem(KEY, tab);
  } catch {
    /* storage unavailable: the page opens on its default tab */
  }
}

/** The requested tab, else the default. Pure read, so it is safe as a state initializer. */
export function readRequestedInsightsTab(): InsightsTab {
  try {
    const requested = sessionStorage.getItem(KEY) as InsightsTab | null;
    if (requested && TABS.includes(requested)) return requested;
  } catch {
    /* ignore */
  }
  return 'sales';
}

/** Called once the page has mounted, so the request applies to one visit only. */
export function clearRequestedInsightsTab(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
