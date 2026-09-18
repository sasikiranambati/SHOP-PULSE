import React, { useState } from 'react';
import { Activity, Bell, User, LogOut, Store, X, AlertTriangle, CheckCircle2, Globe } from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSelectorModal } from './LanguageSelectorModal';

import { useAlerts } from '../hooks/useAlerts';

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
  setActivePage,
  shopName = 'Kiran General Store',
  isLoggedIn = true,
  onLogout,
}) => {
  const { t, currentLanguageMeta } = useLanguage();
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  // Live real-time alerts connection
  const { alerts, unreadCount, markAsRead, markAllAsRead } = useAlerts();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Brand Logo & Shop Name */}
        <div 
          onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors shrink-0">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Shop</span>
              <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">Pulse</span>
            </div>
            <p className="text-[10px] font-bold text-slate-500 leading-none truncate max-w-[130px] sm:max-w-none">
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

              {/* Notification Popover Icon */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  title="Notifications"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer relative"
                >
                  <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white animate-pulse"></span>
                  )}
                </button>

                {/* Notifications Dropdown Panel */}
                {showNotifications && (
                  <div className="absolute right-0 top-12 w-80 sm:w-96 bg-white rounded-2xl border border-slate-200 shadow-xl p-3.5 z-50 animate-fade-in max-h-[460px] flex flex-col">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900 uppercase">Notifications</span>
                        {unreadCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-extrabold text-[10px]">
                            {unreadCount} new
                          </span>
                        )}
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
                          className="text-slate-400 hover:text-slate-700 cursor-pointer p-0.5"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                      {alerts.slice(0, 8).map((alertItem) => {
                        const isCritical = alertItem.priority === 'critical';
                        const isHigh = alertItem.priority === 'high';
                        const timeAgo = formatAlertTime(alertItem.createdAt);

                        return (
                          <div
                            key={alertItem.id}
                            onClick={() => {
                              markAsRead(alertItem.id);
                              setShowNotifications(false);
                              if (alertItem.type === 'LOW_STOCK' || alertItem.type === 'OUT_OF_STOCK') {
                                setActivePage('inventory');
                              } else {
                                setActivePage('dashboard');
                              }
                            }}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                              !alertItem.isRead
                                ? isCritical
                                  ? 'bg-rose-50/90 border-rose-200 text-rose-950 ring-1 ring-rose-300/60'
                                  : isHigh
                                  ? 'bg-amber-50/90 border-amber-200 text-amber-950 ring-1 ring-amber-300/60'
                                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                                : 'bg-slate-50 border-slate-200/80 text-slate-600 opacity-80 hover:opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between font-extrabold mb-0.5">
                              <span className="flex items-center gap-1.5 truncate">
                                {isCritical ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                ) : isHigh ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                )}
                                <span className="truncate">{alertItem.title || alertItem.type.replace(/_/g, ' ')}</span>
                              </span>
                              <span className="text-[10px] text-slate-400 font-semibold shrink-0 ml-2">
                                {timeAgo}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium leading-relaxed mt-0.5 line-clamp-2">
                              {alertItem.message}
                            </p>
                          </div>
                        );
                      })}

                      {alerts.length === 0 && (
                        <div className="py-8 text-center text-slate-400 space-y-1">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                          <p className="font-extrabold text-slate-700 text-xs">All caught up!</p>
                          <p className="text-[11px] text-slate-400">No stock alerts or urgent notifications.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile & Settings Action */}
              <button
                onClick={() => setActivePage('settings')}
                title="Shop Profile & Settings"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition-colors cursor-pointer font-bold"
              >
                <User className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Logout Button */}
              <button
                onClick={onLogout}
                title="Logout"
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

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </header>
  );
};
