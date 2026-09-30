import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Bell, 
  User, 
  LogOut, 
  Store, 
  X, 
  AlertTriangle, 
  CheckCircle2, 
  Globe, 
  Check, 
  Menu, 
  Home, 
  Receipt, 
  Package, 
  ScanLine, 
  Sparkles, 
  Settings as SettingsIcon, 
  PhoneCall,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSelectorModal } from './LanguageSelectorModal';

import { useAlerts } from '../hooks/useAlerts';
import { useSync } from '../hooks/useSync';

interface NavbarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName?: string;
  isLoggedIn?: boolean;
  onLogout?: () => void;
}

function formatAlertTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  } catch {
    return 'Recently';
  }
}

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  shopName = 'Kiran General Store',
  isLoggedIn = true,
  onLogout,
}) => {
  const { t, currentLanguageMeta } = useLanguage();
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [alertTab, setAlertTab] = useState<'unread' | 'all'>('unread');

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Live real-time alerts connection
  const { alerts, unreadCount, markAsRead, markAllAsRead } = useAlerts();
  const { isOnline, isSyncing, totalPendingCount, syncNow } = useSync();

  const displayedAlerts = alertTab === 'unread'
    ? alerts.filter(a => !a.isRead && !a.resolvedAt)
    : alerts;

  const handleNavClick = (page: PageRoute) => {
    setActivePage(page);
    setIsMobileMenuOpen(false);
  };

  const navMenuItems = [
    { id: 'dashboard' as PageRoute, labelKey: 'nav.dashboard', icon: Home, badge: null },
    { id: 'sales' as PageRoute, labelKey: 'nav.quickSales', icon: Receipt, badge: 'POS' },
    { id: 'inventory' as PageRoute, labelKey: 'nav.stockCatalog', icon: Package, badge: null },
    { id: 'scanner' as PageRoute, labelKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
    { id: 'insights' as PageRoute, labelKey: 'nav.shopInsights', icon: Sparkles, badge: null },
    { id: 'settings' as PageRoute, labelKey: 'nav.settingsMore', icon: SettingsIcon, badge: null },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Brand Logo & Shop Name */}
        <div 
          onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
          className="flex items-center gap-2 sm:gap-2.5 cursor-pointer group select-none min-w-0"
        >
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors shrink-0">
            <Activity className="w-4 h-4 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-0.5">
              <span className="text-base sm:text-xl font-black text-slate-900 tracking-tight">Shop</span>
              <span className="text-base sm:text-xl font-black text-emerald-600 tracking-tight">Pulse</span>
            </div>
            <p className="text-[10px] font-bold text-slate-500 leading-none truncate max-w-[95px] xs:max-w-[140px] sm:max-w-none">
              {shopName}
            </p>
          </div>
        </div>

        {/* Action Controls & Store Info */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* Quick Language Selector Button */}
          <button
            onClick={() => setIsLangModalOpen(true)}
            title="Change Language"
            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-black"
          >
            <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="hidden xs:inline">{currentLanguageMeta.nativeName}</span>
          </button>

          {isLoggedIn ? (
            <>
              {/* Desktop Store Tag */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black">
                <Store className="w-4 h-4 text-emerald-600" />
                <span>{shopName}</span>
              </div>

              {/* Sync & Connectivity Status Indicator */}
              <div 
                onClick={() => !isOnline && syncNow()}
                title={isOnline ? (isSyncing ? 'Syncing data with cloud...' : 'Connected online') : `${totalPendingCount} items queued offline. Click to sync.`}
                className={`hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold border transition-all select-none ${
                  !isOnline
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : isSyncing
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${
                  !isOnline
                    ? 'bg-amber-500 animate-pulse'
                    : isSyncing
                      ? 'bg-blue-500 animate-spin'
                      : 'bg-emerald-500'
                }`} />
                <span>
                  {!isOnline
                    ? `Offline (${totalPendingCount})`
                    : isSyncing
                      ? 'Syncing...'
                      : 'Online'}
                </span>
              </div>

              {/* Notification Popover Icon */}
              <div className="relative">
                <button
                  id="notification-bell-btn"
                  onClick={() => setShowNotifications(!showNotifications)}
                  title="Notifications"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer relative"
                >
                  <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  {unreadCount > 0 && (
                    <span 
                      id="notification-badge"
                      className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white shadow-xs animate-pulse"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown Panel */}
                {showNotifications && (
                  <>
                    <div 
                      className="fixed inset-0 z-40 bg-slate-900/20 sm:hidden" 
                      onClick={() => setShowNotifications(false)} 
                    />
                    <div className="fixed inset-x-2.5 top-16 sm:inset-x-auto sm:right-0 sm:top-12 w-auto sm:w-96 max-w-[calc(100vw-1.25rem)] bg-white rounded-2xl border border-slate-200 shadow-2xl p-3.5 z-50 animate-fade-in max-h-[75vh] sm:max-h-[480px] flex flex-col">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAlertTab('unread')}
                            className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                              alertTab === 'unread'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            Unread ({unreadCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setAlertTab('all')}
                            className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                              alertTab === 'all'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            All ({alerts.length})
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          {unreadCount > 0 && (
                            <button
                              type="button"
                              onClick={() => markAllAsRead()}
                              className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                            >
                              Mark all read
                            </button>
                          )}
                          <button 
                            onClick={() => setShowNotifications(false)}
                            aria-label="Close notifications"
                            className="text-slate-400 hover:text-slate-700 cursor-pointer p-0.5"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 overflow-y-auto pr-1 flex-1 max-h-[380px]">
                        {displayedAlerts.slice(0, 12).map((alertItem) => {
                          const isResolved = Boolean(alertItem.resolvedAt);
                          const isCritical = alertItem.priority === 'critical' || alertItem.type === 'OUT_OF_STOCK';
                          const isLowStock = alertItem.type === 'LOW_STOCK' || alertItem.priority === 'high';
                          const timeAgo = formatAlertTime(alertItem.createdAt);

                          return (
                            <div
                              key={alertItem.id}
                              onClick={() => {
                                if (!alertItem.isRead) markAsRead(alertItem.id);
                                setShowNotifications(false);
                                if (alertItem.type === 'LOW_STOCK' || alertItem.type === 'OUT_OF_STOCK') {
                                  setActivePage('inventory');
                                } else {
                                  setActivePage('dashboard');
                                }
                              }}
                              className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                                isResolved
                                  ? 'bg-emerald-50/70 border-emerald-200/90 text-emerald-950 hover:bg-emerald-50'
                                  : !alertItem.isRead
                                  ? isCritical
                                    ? 'bg-rose-50/90 border-rose-200 text-rose-950 ring-1 ring-rose-300/60'
                                    : isLowStock
                                    ? 'bg-amber-50/90 border-amber-200 text-amber-950 ring-1 ring-amber-300/60'
                                    : 'bg-slate-50 border-slate-200 text-slate-800'
                                  : 'bg-slate-50/80 border-slate-200/80 text-slate-600 opacity-80 hover:opacity-100'
                              }`}
                            >
                              <div className="flex items-center justify-between font-extrabold mb-0.5">
                                <div className="flex items-center gap-1.5 truncate">
                                  {isResolved ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  ) : isCritical ? (
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  ) : isLowStock ? (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  ) : (
                                    <Bell className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                  )}
                                  <span className="truncate font-black">
                                    {alertItem.title || alertItem.type.replace(/_/g, ' ')}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                  {isResolved && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase">
                                      Resolved
                                    </span>
                                  )}
                                  {!isResolved && isCritical && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[9px] font-black uppercase">
                                      Critical
                                    </span>
                                  )}
                                  {!isResolved && !isCritical && isLowStock && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-black uppercase">
                                      Low Stock
                                    </span>
                                  )}
                                  
                                  {!alertItem.isRead && !isResolved && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        markAsRead(alertItem.id);
                                      }}
                                      title="Mark as read"
                                      aria-label="Mark notification as read"
                                      className="p-1 rounded-lg bg-white hover:bg-slate-100 text-slate-600 hover:text-emerald-700 shadow-2xs border border-slate-200 transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold active:scale-95"
                                    >
                                      <Check className="w-3 h-3 text-emerald-600" />
                                      <span className="hidden sm:inline">Read</span>
                                    </button>
                                  )}

                                  <span className="text-[10px] text-slate-400 font-semibold ml-1">
                                    {timeAgo}
                                  </span>
                                </div>
                              </div>

                              <p className="text-[11px] font-medium leading-relaxed mt-0.5">
                                {alertItem.message}
                              </p>
                            </div>
                          );
                        })}

                        {displayedAlerts.length === 0 && (
                          <div className="py-8 text-center text-slate-400 space-y-1">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                            <p className="font-extrabold text-slate-700 text-xs">All caught up!</p>
                            <p className="text-[11px] text-slate-400">
                              {alertTab === 'unread' ? 'No unread notifications.' : 'No alerts recorded.'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Profile & Settings Action */}
              <button
                onClick={() => setActivePage('settings')}
                title="Shop Profile & Settings"
                aria-label="Shop Profile and Settings"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition-colors cursor-pointer font-bold active:scale-95"
              >
                <User className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Mobile Hamburger Navigation Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                title="Navigation Menu"
                aria-label="Navigation Menu"
                className="md:hidden w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer active:scale-95"
              >
                {isMobileMenuOpen ? <X className="w-5 h-5 text-emerald-700" /> : <Menu className="w-5 h-5" />}
              </button>

              {/* Desktop Logout Button */}
              <button
                onClick={onLogout}
                title="Logout"
                aria-label="Logout"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('nav.logout')}</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivePage('login')}
                className="px-3 py-1.5 text-xs sm:text-sm font-bold text-slate-700 hover:text-slate-900 rounded-xl transition-colors cursor-pointer"
              >
                {t('auth.loginBtn')}
              </button>
              <button
                onClick={() => setActivePage('signup')}
                className="px-3.5 py-2 text-xs sm:text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                {t('auth.createAccount')}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Mobile Slide-Over Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Semi-transparent Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer Sheet */}
          <div className="relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col justify-between p-5 z-50 animate-in slide-in-from-left duration-200 overflow-y-auto">
            <div className="space-y-4">
              {/* Drawer Brand Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-lg font-black text-slate-900">Shop</span>
                      <span className="text-lg font-black text-emerald-600">Pulse</span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-500 truncate max-w-[150px]">
                      {shopName}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sync Status Banner in Mobile Drawer */}
              <div 
                onClick={() => !isOnline && syncNow()}
                className={`flex items-center justify-between p-3 rounded-2xl border text-xs font-bold transition-all ${
                  !isOnline
                    ? 'bg-amber-50 text-amber-900 border-amber-300'
                    : isSyncing
                      ? 'bg-blue-50 text-blue-900 border-blue-200'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isOnline ? (
                    <Wifi className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-amber-600" />
                  )}
                  <span>
                    {!isOnline
                      ? `Offline (${totalPendingCount} queued)`
                      : isSyncing
                        ? 'Syncing with cloud...'
                        : 'Cloud Connected'}
                  </span>
                </div>
                {!isOnline && (
                  <span className="text-[10px] font-black underline">Sync Now</span>
                )}
              </div>

              {/* Full Navigation List */}
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-3 pb-1">
                  Menu
                </p>
                {navMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl font-black text-sm transition-all cursor-pointer min-h-[48px] ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                          : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                        <span>{t(item.labelKey)}</span>
                      </div>
                      {item.badge && (
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Language Switcher inside Drawer */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsLangModalOpen(true);
                }}
                className="w-full flex items-center justify-between px-3.5 py-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-black border border-slate-200 cursor-pointer min-h-[48px]"
              >
                <div className="flex items-center gap-2.5">
                  <Globe className="w-4 h-4 text-emerald-600" />
                  <span>{t('settings.language')}</span>
                </div>
                <span className="text-emerald-700 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                  {currentLanguageMeta.nativeName}
                </span>
              </button>
            </div>

            {/* Drawer Footer */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="bg-emerald-50/70 rounded-2xl p-3 border border-emerald-200/80 text-xs">
                <div className="flex items-center gap-2 text-emerald-800 font-black mb-0.5">
                  <PhoneCall className="w-3.5 h-3.5 text-emerald-600" />
                  <span>24/7 Helpline</span>
                </div>
                <p className="font-extrabold text-emerald-700 text-xs">1800-SHOP-PULSE</p>
              </div>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (onLogout) onLogout();
                }}
                className="w-full py-3 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs flex items-center justify-center gap-2 border border-rose-200 transition-colors cursor-pointer min-h-[44px]"
              >
                <LogOut className="w-4 h-4 text-rose-600" />
                <span>{t('nav.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </header>
  );
};
