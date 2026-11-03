import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { BottomNav } from '../components/BottomNav';
import { MobileNavDrawer } from '../components/MobileNavDrawer';
import { GlobalSearch } from '../components/GlobalSearch';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';
import type { PageRoute } from '../types';
import type { SearchOption } from '../utils/searchResults';

// Defer heavy auxiliary modals so initial shell renders instantly
const AiChatBox = lazy(() => import('../components/AiChatBox').then((m) => ({ default: m.AiChatBox })));
const PurchaseRecordModal = lazy(() => import('../components/PurchaseRecordModal').then((m) => ({ default: m.PurchaseRecordModal })));

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  // Persist desktop sidebar collapse preference
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('shoppulse_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('shoppulse_sidebar_collapsed', String(next));
      } catch {
        // Ignore localStorage write errors
      }
      return next;
    });
  };

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
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col font-sans relative">
      <a
        href="#main-content"
        className="no-print sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:px-3.5 focus:py-2 focus:rounded-lg focus:bg-white focus:text-[#234B3A] focus:font-bold focus:shadow-md focus:outline-2 focus:outline-[#234B3A]"
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
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
      />

      {/* Main Application Workspace: Edge-to-edge layout with docked sidebar and centered content container */}
      <div className="flex-1 flex w-full min-w-0">
        <Sidebar 
          activePage={activePage} 
          setActivePage={setActivePage} 
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 flex flex-col max-w-full focus:outline-none transition-all duration-200"
        >
          <div className="w-full max-w-7xl mx-auto p-3 sm:p-6 lg:p-8 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] md:pb-10 flex-1 flex flex-col min-w-0">
            {children}
          </div>
        </main>
      </div>


      {/* ShopPulse AI Floating Assistant */}
      <div className="no-print">
        <Suspense fallback={null}>
          <AiChatBox />
        </Suspense>
      </div>

      {/* App-like Mobile Bottom Navigation */}
      <BottomNav 
        activePage={activePage} 
        setActivePage={setActivePage} 
        onOpenMenu={() => setIsMobileMenuOpen(true)}
      />

      {/* Mobile Slide-Over Navigation Drawer */}
      <MobileNavDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        activePage={activePage}
        setActivePage={setActivePage}
        shopName={shopName}
        isLoggedIn={true}
        onLogout={onLogout}
        onOpenLanguageModal={() => setIsLangModalOpen(true)}
      />

      {isSearchOpen && (
        <GlobalSearch
          isOpen
          onClose={() => setIsSearchOpen(false)}
          onOpenOption={handleSearchResult}
          onShowAllProducts={(query) => onShowAllProducts?.(query)}
        />
      )}

      {openPurchaseId && (
        <Suspense fallback={null}>
          <PurchaseRecordModal
            key={openPurchaseId}
            purchaseId={openPurchaseId}
            shopName={shopName}
            onClose={() => setOpenPurchaseId(null)}
          />
        </Suspense>
      )}

      {isLangModalOpen && (
        <LanguageSelectorModal
          isOpen={isLangModalOpen}
          onClose={() => setIsLangModalOpen(false)}
        />
      )}
    </div>
  );
};
