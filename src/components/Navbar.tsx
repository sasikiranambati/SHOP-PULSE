import React, { useState, useRef, useEffect, useContext } from 'react';
import { 
  Bell, 
  User, 
  LogOut, 
  Store, 
  Globe, 
  Menu, 
  Search, 
  PanelLeftClose, 
  PanelLeftOpen,
  ChevronRight,
  Settings,
  RefreshCw
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ShelforaLogo } from './branding/ShelforaLogo';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { NotificationsPanel } from './NotificationsPanel';
import { useAlerts } from '../hooks/useAlerts';
import { useSync } from '../hooks/useSync';
import { AuthContext } from '../context/authContextDef';

export interface NavbarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName?: string;
  isLoggedIn?: boolean;
  onLogout?: () => void;
  onOpenSearch?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
}

const pageLabelMap: Record<PageRoute, string> = {
  dashboard: 'nav.dashboard',
  sales: 'nav.quickSales',
  inventory: 'nav.stockCatalog',
  insights: 'nav.shopInsights',
  scanner: 'nav.scanner',
  settings: 'nav.settingsMore',
  landing: 'Home',
  login: 'auth.loginBtn',
  signup: 'auth.createAccount',
};

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  shopName = 'Kiran General Store',
  isLoggedIn = true,
  onLogout,
  onOpenSearch,
  isSidebarCollapsed = false,
  onToggleSidebar,
  onOpenMobileMenu,
}) => {
  const { t, currentLanguageMeta } = useLanguage();
  const [showNotifications, setShowNotifications] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  const bellRef = useRef<HTMLButtonElement | null>(null);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const { unreadCount } = useAlerts();
  const { isOnline, isSyncing, totalPendingCount, syncNow } = useSync();

  // Safely resolve user and store identity from AuthContext if available
  const authContext = useContext(AuthContext);
  const userProfile = authContext?.userProfile;
  const currentShopName = userProfile?.shopName || shopName;
  const userDisplayName = userProfile?.displayName || userProfile?.ownerName || 'Store Owner';
  const userEmail = userProfile?.email || 'owner@shelfora.com';

  // Compute initials for avatar (e.g. "Kiran Admin" -> "KA")
  const userInitials = (userDisplayName || 'SO')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'SF';

  // Handle clicking outside the profile dropdown and Escape key navigation
  useEffect(() => {
    if (!isProfileOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        profileBtnRef.current &&
        !profileBtnRef.current.contains(target)
      ) {
        setIsProfileOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProfileOpen(false);
        profileBtnRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileOpen]);

  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#DDE9DF] shadow-2xs">
      <div className="w-full px-2.5 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-1.5 sm:gap-4">
        
        {/* ================================================================= */}
        {/* LEFT SECTION: Sidebar Toggle, Brand & Breadcrumb                  */}
        {/* ================================================================= */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink-0">
          {/* Desktop Sidebar Toggle */}
          {isLoggedIn && onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={isSidebarCollapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
              aria-expanded={!isSidebarCollapsed}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:flex w-9 h-9 rounded-lg bg-[#FAF8F2] hover:bg-[#F3EFE3] border border-[#DDE9DF] text-[#252D29] items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none"
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-[#153D32]" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-[#5E6C64]" />
              )}
            </button>
          )}

          {/* Shelfora Logo & Brand Name */}
          <button 
            type="button"
            onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
            aria-label={`Shelfora – ${currentShopName}. Go to ${isLoggedIn ? 'dashboard' : 'home'}`}
            className="flex items-center gap-2 cursor-pointer group select-none min-w-0 text-left rounded-xl focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none"
          >
            <ShelforaLogo variant="horizontal" size="sm" />
            {/* Subtle non-interactive store identity text */}
            {isLoggedIn && (
              <span className="hidden xl:inline text-[11px] font-medium text-[#5E6C64] max-w-[130px] truncate pl-2 border-l border-[#DDE9DF]" title={currentShopName}>
                {currentShopName}
              </span>
            )}
          </button>

          {/* Compact Breadcrumb Context (Desktop) */}
          {isLoggedIn && (
            <div 
              className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-[#DDE9DF] text-xs font-semibold text-[#5E6C64]"
              aria-label="Current section"
            >
              <ChevronRight className="w-3.5 h-3.5 text-[#5E6C64]/60" aria-hidden="true" />
              <span className="truncate max-w-[160px] text-[#252D29]">
                {t(pageLabelMap[activePage] || 'nav.dashboard')}
              </span>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* CENTER SECTION: One Prominent Responsive Search Field             */}
        {/* ================================================================= */}
        {isLoggedIn && onOpenSearch && (
          <div className="hidden sm:flex flex-1 max-w-xl sm:mx-4 justify-center">
            <button
              type="button"
              id="global-search-header-btn"
              onClick={onOpenSearch}
              aria-label="Search products, bills, invoices"
              aria-keyshortcuts="Control+K Meta+K /"
              className="w-full hidden sm:flex items-center justify-between gap-2.5 px-3.5 py-1.5 rounded-lg border border-[#DDE9DF] bg-[#FAF8F2] hover:bg-white hover:border-[#23866A]/40 focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none text-[#5E6C64] text-xs font-medium cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Search className="w-3.5 h-3.5 shrink-0 text-[#5E6C64] group-hover:text-[#153D32] transition-colors" aria-hidden="true" />
                <span className="truncate text-left text-[#5E6C64] font-normal">
                  Search products, bills, invoices...
                </span>
              </div>
              <kbd className="hidden md:inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border border-[#DDE9DF] bg-white text-[#5E6C64] shadow-3xs shrink-0 select-none">
                Ctrl K
              </kbd>
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* RIGHT SECTION: Notification Bell & Profile Avatar Control         */}
        {/* ================================================================= */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {isLoggedIn ? (
            <>
              {/* Mobile Search Icon Button (visible only below sm) */}
              {onOpenSearch && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Search products, bills, invoices"
                  className="sm:hidden w-8 h-8 rounded-lg bg-[#FAF8F2] hover:bg-[#F3EFE3] border border-[#DDE9DF] text-[#252D29] flex items-center justify-center transition-colors cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none"
                >
                  <Search className="w-4 h-4 text-[#252D29]" />
                </button>
              )}

              {/* 1. Notification Bell Control */}
              <div className="relative">
                <button
                  ref={bellRef}
                  type="button"
                  id="notification-bell-btn"
                  onClick={() => {
                    setShowNotifications(!showNotifications);
                    setIsProfileOpen(false);
                  }}
                  title="Notifications"
                  aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                  aria-expanded={showNotifications}
                  aria-controls="notifications-panel"
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#FAF8F2] hover:bg-[#F3EFE3] border border-[#DDE9DF] text-[#252D29] flex items-center justify-center transition-colors cursor-pointer relative focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none active:scale-95"
                >
                  <Bell className="w-4 h-4 text-[#252D29]" />
                  {unreadCount > 0 && (
                    <span 
                      id="notification-badge"
                      className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF806D] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white shadow-xs"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                <NotificationsPanel
                  isOpen={showNotifications}
                  onClose={() => setShowNotifications(false)}
                  setActivePage={setActivePage}
                  triggerRef={bellRef}
                />
              </div>

              {/* 2. Profile / Avatar Control & Dropdown */}
              <div className="relative">
                <button
                  ref={profileBtnRef}
                  type="button"
                  id="user-profile-menu-button"
                  onClick={() => {
                    setIsProfileOpen(!isProfileOpen);
                    setShowNotifications(false);
                  }}
                  title={`${userDisplayName} • ${currentShopName} (${isOnline ? 'Online' : 'Offline'})`}
                  aria-label="User account menu"
                  aria-expanded={isProfileOpen}
                  aria-controls="user-profile-dropdown"
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#E7F3EE] text-[#153D32] hover:bg-[#B9E5D0] border border-[#23866A]/25 flex items-center justify-center font-bold text-xs tracking-wider transition-all cursor-pointer relative focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none active:scale-95"
                >
                  <span>{userInitials}</span>

                  {/* Micro Online/Sync Status Indicator Dot */}
                  <span 
                    className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                      !isOnline
                        ? 'bg-[#A66A16] animate-pulse'
                        : isSyncing
                          ? 'bg-[#3567A8] animate-spin'
                          : 'bg-[#287A4B]'
                    }`}
                    aria-hidden="true"
                    title={isOnline ? (isSyncing ? 'Syncing...' : 'Connected online') : 'Offline'}
                  />
                </button>

                {/* Profile Dropdown Menu */}
                {isProfileOpen && (
                  <div
                    ref={dropdownRef}
                    id="user-profile-dropdown"
                    aria-labelledby="user-profile-menu-button"
                    className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.25rem)] rounded-xl bg-white border border-[#DDE9DF] shadow-lg shadow-[#0F2D25]/8 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                  >
                    {/* Header: User & Store Identity Information */}
                    <div className="px-4 py-3 bg-[#FAF8F2]/70 border-b border-[#DDE9DF] rounded-t-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#153D32] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                          {userInitials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#252D29] truncate leading-tight">
                            {userDisplayName}
                          </p>
                          <p className="text-xs text-[#5E6C64] truncate mt-0.5">
                            {userEmail}
                          </p>
                        </div>
                      </div>

                      {/* Store Identity Badge */}
                      <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-[#DDE9DF] text-xs text-[#252D29] shadow-3xs">
                        <Store className="w-3.5 h-3.5 text-[#153D32] shrink-0" aria-hidden="true" />
                        <span className="truncate font-medium">{currentShopName}</span>
                      </div>

                      {/* Online / Offline Sync Status Row */}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#5E6C64]">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${
                            !isOnline
                              ? 'bg-[#A66A16]'
                              : isSyncing
                                ? 'bg-[#3567A8] animate-spin'
                                : 'bg-[#287A4B]'
                          }`} />
                          <span className="font-medium">
                            {!isOnline
                              ? `Offline (${totalPendingCount} pending)`
                              : isSyncing
                                ? 'Syncing...'
                                : 'Connected online'}
                          </span>
                        </div>
                        {!isOnline && (
                          <button
                            type="button"
                            onClick={() => syncNow()}
                            className="text-[#153D32] font-semibold hover:underline cursor-pointer flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Sync</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Navigation Actions Group */}
                    <div className="py-1">
                      {/* Profile & Account Link */}
                      <button
                        type="button"
                        onClick={() => {
                          setActivePage('settings');
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#252D29] hover:bg-[#FAF8F2] transition-colors cursor-pointer text-left focus-visible:bg-[#FAF8F2] focus-visible:outline-none"
                      >
                        <User className="w-4 h-4 text-[#5E6C64]" aria-hidden="true" />
                        <span>Profile & Account</span>
                      </button>

                      {/* Store Settings Link */}
                      <button
                        type="button"
                        onClick={() => {
                          setActivePage('settings');
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#252D29] hover:bg-[#FAF8F2] transition-colors cursor-pointer text-left focus-visible:bg-[#FAF8F2] focus-visible:outline-none"
                      >
                        <Store className="w-4 h-4 text-[#5E6C64]" aria-hidden="true" />
                        <span>Store Settings</span>
                      </button>

                      {/* Language Preferences Action */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsLangModalOpen(true);
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-[#252D29] hover:bg-[#FAF8F2] transition-colors cursor-pointer text-left focus-visible:bg-[#FAF8F2] focus-visible:outline-none"
                      >
                        <div className="flex items-center gap-2.5">
                          <Globe className="w-4 h-4 text-[#5E6C64]" aria-hidden="true" />
                          <span>Language Preferences</span>
                        </div>
                        <span className="text-[10px] font-semibold text-[#153D32] bg-[#E7F3EE] px-2 py-0.5 rounded-md">
                          {currentLanguageMeta.nativeName}
                        </span>
                      </button>

                      {/* General Settings Link */}
                      <button
                        type="button"
                        onClick={() => {
                          setActivePage('settings');
                          setIsProfileOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#252D29] hover:bg-[#FAF8F2] transition-colors cursor-pointer text-left focus-visible:bg-[#FAF8F2] focus-visible:outline-none"
                      >
                        <Settings className="w-4 h-4 text-[#5E6C64]" aria-hidden="true" />
                        <span>General Settings</span>
                      </button>
                    </div>

                    {/* Divider before Logout */}
                    <div className="border-t border-[#DDE9DF] my-1" />

                    {/* Logout Action (Visually Distinguishable) */}
                    {onLogout && (
                      <div className="px-1 py-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsProfileOpen(false);
                            onLogout();
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-[#EF806D] hover:bg-[#FDF1EF] hover:text-[#962626] rounded-lg transition-colors cursor-pointer text-left focus-visible:bg-[#FDF1EF] focus-visible:outline-none"
                        >
                          <LogOut className="w-4 h-4 text-[#EF806D]" aria-hidden="true" />
                          <span>{t('nav.logout')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mobile Navigation Drawer Trigger (Hamburger icon on small screens) */}
              {onOpenMobileMenu && (
                <button
                  type="button"
                  onClick={onOpenMobileMenu}
                  title="Navigation Menu"
                  aria-label="Open navigation menu"
                  aria-controls="mobile-nav-drawer"
                  aria-haspopup="dialog"
                  className="md:hidden w-8 h-8 rounded-lg bg-[#FAF8F2] hover:bg-[#F3EFE3] border border-[#DDE9DF] text-[#252D29] flex items-center justify-center transition-colors cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-[#153D32] focus-visible:outline-none"
                >
                  <Menu className="w-5 h-5 text-[#252D29]" />
                </button>
              )}
            </>
          ) : (
            /* Logged-out State (Minimal Login / Signup buttons) */
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActivePage('login')}
                className="px-3 py-1.5 text-xs sm:text-sm font-semibold text-[#252D29] hover:text-[#0F2D25] rounded-lg transition-colors cursor-pointer"
              >
                {t('auth.loginBtn')}
              </button>
              <button
                type="button"
                onClick={() => setActivePage('signup')}
                className="px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white bg-[#153D32] hover:bg-[#0F2D25] rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                {t('auth.createAccount')}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Language Selector Modal (Portaled dialog) */}
      {isLangModalOpen && (
        <LanguageSelectorModal
          isOpen={isLangModalOpen}
          onClose={() => setIsLangModalOpen(false)}
        />
      )}
    </header>
  );
};
