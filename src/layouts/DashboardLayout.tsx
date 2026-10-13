import React, { useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { BottomNav } from '../components/BottomNav';
import { AiChatBox } from '../components/AiChatBox';
import { GlobalSearch } from '../components/GlobalSearch';
import { PurchaseRecordModal } from '../components/PurchaseRecordModal';
import { Plus } from 'lucide-react';
import type { PageRoute } from '../types';
import type { SearchOption } from '../utils/searchResults';

interface DashboardLayoutProps {
  children: React.ReactNode;
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName: string;
  onLogout: () => void;
  /** Opens a product or sales bill chosen in global search. Purchases open in a dialog here. */
  onOpenSearchResult?: (option: SearchOption) => void;
  /** Opens the stock catalog filtered by a search query. */
  onShowAllProducts?: (query: string) => void;
}

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  activePage,
  setActivePage,
  shopName,
  onLogout,
  onOpenSearchResult,
  onShowAllProducts,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [openPurchaseId, setOpenPurchaseId] = useState<string | null>(null);

  // Ctrl/Cmd+K anywhere, or "/" when not typing, opens search (not on top of another dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey);
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target);
      if (!combo && !slash) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      setIsSearchOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleSearchResult = (option: SearchOption) => {
    if (option.kind === 'purchase') {
      setOpenPurchaseId(option.id);
    } else {
      onOpenSearchResult?.(option);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans relative">
      <a
        href="#main-content"
        className="no-print sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-white focus:text-emerald-800 focus:font-bold focus:shadow-lg"
      >
        Skip to main content
      </a>

      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        shopName={shopName}
        isLoggedIn={true}
        onLogout={onLogout}
        onOpenSearch={() => setIsSearchOpen(true)}
      />

      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 p-3 sm:p-6 lg:p-8 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] md:pb-12 overflow-x-hidden max-w-full focus:outline-none"
        >
          {children}
        </main>
      </div>

      {/* Floating Action Button (FAB) for Mobile Quick Sale */}
      {activePage !== 'sales' && (
        <button
          type="button"
          onClick={() => setActivePage('sales')}
          aria-label="Open Quick Sale POS"
          className="no-print md:hidden fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-3.5 sm:left-4 z-30 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold px-3.5 py-2.5 rounded-full shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition-all cursor-pointer min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span className="text-xs font-black">Quick Sale</span>
        </button>
      )}

      {/* ShopPulse AI Floating Assistant */}
      <div className="no-print">
        <AiChatBox />
      </div>

      <BottomNav activePage={activePage} setActivePage={setActivePage} />

      {isSearchOpen && (
        <GlobalSearch
          isOpen
          onClose={() => setIsSearchOpen(false)}
          onOpenOption={handleSearchResult}
          onShowAllProducts={(query) => onShowAllProducts?.(query)}
        />
      )}

      {openPurchaseId && (
        <PurchaseRecordModal
          key={openPurchaseId}
          purchaseId={openPurchaseId}
          shopName={shopName}
          onClose={() => setOpenPurchaseId(null)}
        />
      )}
    </div>
  );
};
