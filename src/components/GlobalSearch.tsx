import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, Package, Receipt, FileText, Loader2, AlertCircle, CornerDownLeft } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { searchApi, SEARCH_MIN_LENGTH, type SearchResults } from '../api/search';
import { ApiError } from '../api/client';
import { describeError } from '../utils/errorHandler';
import { formatCurrency } from '../utils/formatCurrency';
import {
  flattenSearchGroups,
  groupSearchResults,
  nextActiveIndex,
  searchOptionDomId,
  type SearchOption,
} from '../utils/searchResults';

const DEBOUNCE_MS = 250;

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenOption: (option: SearchOption) => void;
  /** Opens the stock catalog filtered by the query (shown when there are more products than listed). */
  onShowAllProducts: (query: string) => void;
}

const formatDay = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const GROUP_ICONS = {
  product: Package,
  sale: Receipt,
  purchase: FileText,
} as const;

function optionText(option: SearchOption): { title: string; meta: string } {
  switch (option.kind) {
    case 'product': {
      const h = option.hit;
      return {
        title: h.name,
        meta: [h.category, h.sku ? `SKU ${h.sku}` : null, `${h.current_stock} ${h.unit || 'pcs'} in stock`, formatCurrency(h.selling_price)]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'sale': {
      const h = option.hit;
      return {
        title: `Bill ${h.bill_number}`,
        meta: [
          formatDay(h.created_at),
          formatCurrency(h.total_amount),
          `${h.item_count} item${h.item_count === 1 ? '' : 's'}`,
          h.matched_product ? `includes ${h.matched_product}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'purchase': {
      const h = option.hit;
      return {
        title: h.invoice_number ? `Invoice ${h.invoice_number}` : 'Purchase (no invoice number)',
        meta: [
          h.supplier_name,
          h.invoice_date || formatDay(h.created_at),
          formatCurrency(h.total_amount),
          h.matched_product ? `includes ${h.matched_product}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
  }
}

/**
 * Search dialog for products, sales bills and purchase invoices. Results come from the server
 * (a few per group); nothing is shown that the server did not return.
 */
export const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose, onOpenOption, onShowAllProducts }) => {
  const titleId = useId();
  const listboxId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useDialog<HTMLDivElement>({ isOpen, onClose, initialFocusRef: inputRef });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryToken, setRetryToken] = useState(0);

  const trimmed = query.trim();
  const groups = useMemo(() => groupSearchResults(results), [results]);
  const options = useMemo(() => flattenSearchGroups(groups), [groups]);
  const indexById = useMemo(() => new Map(options.map((o, i) => [searchOptionDomId(o), i])), [options]);

  // Fetch after the user pauses typing; a newer query cancels the previous request.
  useEffect(() => {
    if (!isOpen || trimmed.length < SEARCH_MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      setError(null);
      try {
        const data = await searchApi.search(trimmed, { limit: 5, signal: controller.signal });
        if (controller.signal.aborted) return;
        setResults(data);
        setActiveIndex(-1);
        setStatus('done');
      } catch (err) {
        if (controller.signal.aborted || (err instanceof ApiError && err.category === 'ABORTED')) return;
        setResults(null);
        setError(describeError(err, 'Search is unavailable right now.'));
        setStatus('error');
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, isOpen, retryToken]);

  if (!isOpen) return null;

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(-1);
    if (value.trim().length < SEARCH_MIN_LENGTH) {
      setResults(null);
      setStatus('idle');
      setError(null);
    }
  };

  const close = () => {
    onClose();
  };

  const choose = (option: SearchOption) => {
    onOpenOption(option);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key) || ((e.key === 'Home' || e.key === 'End') && options.length > 0 && activeIndex >= 0)) {
      e.preventDefault();
      const next = nextActiveIndex(activeIndex, e.key, options.length);
      setActiveIndex(next);
      if (next >= 0) {
        document.getElementById(searchOptionDomId(options[next]))?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      const option = options[activeIndex >= 0 ? activeIndex : 0];
      if (option && status === 'done') {
        e.preventDefault();
        choose(option);
      }
    }
  };

  const showResults = status === 'done' && trimmed.length >= SEARCH_MIN_LENGTH;
  const isEmpty = showResults && options.length === 0;
  const productGroup = groups.find((g) => g.key === 'product');

  return (
    <div className="no-print fixed inset-0 z-[65] bg-slate-900/50 flex items-start justify-center sm:pt-[10vh] sm:px-4" onClick={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white w-full h-full sm:h-auto sm:max-h-[75vh] sm:max-w-2xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">Search ShopPulse</h2>
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:pt-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0 ml-1" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showResults && options.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 && options[activeIndex] ? searchOptionDomId(options[activeIndex]) : undefined}
            aria-describedby={hintId}
            aria-label="Search products, bills and purchase invoices"
            placeholder="Search products, bills, invoices, suppliers…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 py-2 text-base bg-transparent focus:outline-none"
          />
          {status === 'loading' && <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" aria-hidden="true" />}
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer shrink-0"
          >
            <span className="hidden sm:inline">Esc</span>
            <X className="w-4 h-4 sm:hidden" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <p id={hintId} className="sr-only">
            Type at least {SEARCH_MIN_LENGTH} characters. Use the up and down arrow keys to move through results and Enter to open one.
          </p>

          {/* Status messages are announced to screen readers */}
          <div role="status" aria-live="polite" className="sr-only">
            {status === 'loading' && 'Searching…'}
            {showResults && (options.length === 0 ? `No results for ${trimmed}` : `${options.length} results`)}
          </div>

          {trimmed.length < SEARCH_MIN_LENGTH && (
            <div className="p-6 text-center text-sm text-slate-500">
              <p className="font-bold text-slate-700">Find any product, sales bill or purchase invoice</p>
              <p className="mt-1">Try a product name, SKU, bill number like “SP-1A2B3C4D”, invoice number or supplier.</p>
            </div>
          )}

          {status === 'loading' && !results && (
            <p className="p-6 text-center text-sm font-bold text-slate-600">Searching…</p>
          )}

          {status === 'error' && (
            <div role="alert" className="m-4 p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-sm flex items-start justify-between gap-3">
              <span className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
                <span>
                  <strong className="font-black">Search failed.</strong> {error}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRetryToken((n) => n + 1)}
                className="text-xs font-black text-rose-800 underline underline-offset-2 cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {isEmpty && (
            <div className="p-6 text-center text-sm text-slate-600">
              <p className="font-bold text-slate-800">No matches for “{trimmed}”</p>
              <p className="mt-1">Check the spelling, or search by SKU, bill number, invoice number or supplier.</p>
            </div>
          )}

          {showResults && options.length > 0 && (
            <div id={listboxId} role="listbox" aria-label="Search results" className="py-2">
              {groups.map((group) => {
                const Icon = GROUP_ICONS[group.key];
                const groupLabelId = `${listboxId}-${group.key}`;
                return (
                  <div key={group.key} role="group" aria-labelledby={groupLabelId} className="pb-1">
                    <p id={groupLabelId} className="px-4 pt-2 pb-1 text-[11px] font-black uppercase tracking-wider text-slate-500">
                      {group.label}
                      {group.total > group.options.length && (
                        <span className="normal-case font-bold tracking-normal"> · showing {group.options.length} of {group.total}</span>
                      )}
                    </p>
                    {group.options.map((option) => {
                      const index = indexById.get(searchOptionDomId(option)) ?? -1;
                      const isActive = index === activeIndex;
                      const { title, meta } = optionText(option);
                      return (
                        <div
                          key={`${option.kind}-${option.id}`}
                          id={searchOptionDomId(option)}
                          role="option"
                          aria-selected={isActive}
                          tabIndex={-1}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => choose(option)}
                          className={`mx-2 px-3 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer ${
                            isActive ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'hover:bg-slate-50'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-900 truncate">{title}</p>
                            <p className="text-xs text-slate-500 truncate">{meta}</p>
                          </div>
                          {isActive && <CornerDownLeft className="w-4 h-4 text-emerald-700 shrink-0 hidden sm:block" aria-hidden="true" />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {showResults && productGroup && productGroup.total > productGroup.options.length && (
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => {
                  onShowAllProducts(trimmed);
                  close();
                }}
                className="text-xs font-black text-emerald-700 hover:text-emerald-900 underline underline-offset-2 cursor-pointer"
              >
                Show all {productGroup.total} matching products in Stock Catalog
              </button>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-slate-200 text-[11px] text-slate-500 font-semibold">
          <span><kbd className="font-sans px-1 rounded border border-slate-300">↑</kbd> <kbd className="font-sans px-1 rounded border border-slate-300">↓</kbd> to move</span>
          <span><kbd className="font-sans px-1 rounded border border-slate-300">Enter</kbd> to open</span>
          <span><kbd className="font-sans px-1 rounded border border-slate-300">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
};
