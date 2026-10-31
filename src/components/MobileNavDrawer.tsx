import React from 'react';
import { createPortal } from 'react-dom';
import { 
  Activity, 
  X, 
  Home, 
  Receipt, 
  Package, 
  ScanLine, 
  Sparkles, 
  Settings as SettingsIcon, 
  PhoneCall, 
  Wifi, 
  WifiOff, 
  Globe, 
  LogOut 
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useSync } from '../hooks/useSync';
import { useDialog } from '../hooks/useDialog';

export interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName?: string;
  isLoggedIn?: boolean;
  onLogout?: () => void;
  onOpenLanguageModal?: () => void;
}

interface NavItem {
  id: PageRoute;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | null;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  isOpen,
  onClose,
  activePage,
  setActivePage,
  shopName = 'Kiran General Store',
  isLoggedIn = true,
  onLogout,
  onOpenLanguageModal,
}) => {
  const { t, currentLanguageMeta } = useLanguage();
  const { isOnline, isSyncing, totalPendingCount, syncNow } = useSync();

  // Escape key closes it, focus moves in and is trapped, background scroll is locked
  const drawerRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  // Grouped navigation matching desktop sidebar structure
  const mobileNavGroups: NavGroup[] = [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'dashboard', labelKey: 'nav.dashboard', icon: Home, badge: null },
      ],
    },
    {
      id: 'sales',
      label: 'Sales & Billing',
      items: [
        { id: 'sales', labelKey: 'nav.quickSales', icon: Receipt, badge: 'POS' },
      ],
    },
    {
      id: 'inventory',
      label: 'Inventory',
      items: [
        { id: 'inventory', labelKey: 'nav.stockCatalog', icon: Package, badge: null },
      ],
    },
    {
      id: 'tools',
      label: 'Tools & Automation',
      items: [
        { id: 'scanner', labelKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
        { id: 'insights', labelKey: 'nav.shopInsights', icon: Sparkles, badge: null },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        { id: 'settings', labelKey: 'nav.settingsMore', icon: SettingsIcon, badge: null },
      ],
    },
  ];

  const handleNavClick = (page: PageRoute) => {
    setActivePage(page);
    onClose();
  };

  const drawerContent = (
    <div className="no-print md:hidden fixed inset-0 z-50 flex">
      {/* Semi-transparent Backdrop */}
      <div 
        className="fixed inset-0 bg-[#202923]/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Sheet */}
      <div
        ref={drawerRef}
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col justify-between p-4 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-50 animate-in slide-in-from-left duration-200 overflow-y-auto overscroll-contain border-r border-[#E3E5DE]"
      >
        <div className="space-y-4">
          {/* Drawer Brand Header */}
          <div className="flex items-center justify-between pb-3.5 border-b border-[#E3E5DE]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#234B3A] flex items-center justify-center text-white shadow-xs shrink-0">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-0.5">
                  <span className="text-base font-bold text-[#202923]">Shop</span>
                  <span className="text-base font-extrabold text-[#234B3A]">Pulse</span>
                </div>
                <p className="text-[11px] font-normal text-[#69736C] truncate max-w-[150px]">
                  {shopName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-lg bg-[#F7F5EF] hover:bg-[#F2EFE9] border border-[#E3E5DE] text-[#202923] flex items-center justify-center cursor-pointer min-h-[44px]"
              aria-label="Close menu"
            >
              <X className="w-4 h-4 text-[#202923]" />
            </button>
          </div>

          {/* Sync Status Banner */}
          <div 
            role={!isOnline ? 'button' : 'status'}
            tabIndex={!isOnline ? 0 : undefined}
            onKeyDown={(e) => {
              if (!isOnline && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                syncNow();
              }
            }}
            onClick={() => !isOnline && syncNow()}
            className={`flex items-center justify-between p-3 rounded-lg border text-xs font-semibold transition-all ${
              !isOnline
                ? 'bg-[#FEF9EB] text-[#A66A16] border-[#A66A16]/30 cursor-pointer'
                : isSyncing
                  ? 'bg-[#EEF4FC] text-[#3567A8] border-[#3567A8]/20'
                  : 'bg-[#E5EEE6] text-[#18382B] border-[#52745D]/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="w-4 h-4 text-[#234B3A]" />
              ) : (
                <WifiOff className="w-4 h-4 text-[#A66A16]" />
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
              <span className="text-[10px] font-bold underline">Sync Now</span>
            )}
          </div>

          {/* Grouped Navigation List */}
          <nav aria-label="Main navigation" className="space-y-3">
            {mobileNavGroups.map((group) => (
              <div key={group.id} className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#69736C] px-3 pb-0.5" aria-hidden="true">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer min-h-[44px] ${
                        isActive
                          ? 'bg-[#234B3A] text-white shadow-xs'
                          : 'text-[#202923] hover:bg-[#F7F5EF] active:bg-[#F2EFE9]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-white' : 'text-[#69736C]'}`} />
                        <span>{t(item.labelKey)}</span>
                      </div>
                      {item.badge && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                          isActive 
                            ? 'bg-white/20 text-white' 
                            : 'bg-[#E5EEE6] text-[#18382B] border border-[#52745D]/20'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Language Switcher inside Drawer */}
          {onOpenLanguageModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLanguageModal();
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#F7F5EF] hover:bg-[#F2EFE9] text-[#202923] text-xs font-semibold border border-[#E3E5DE] cursor-pointer min-h-[44px]"
            >
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#234B3A]" />
                <span>{t('settings.language')}</span>
              </div>
              <span className="text-[#18382B] bg-white px-2 py-0.5 rounded border border-[#E3E5DE] text-[11px] font-bold">
                {currentLanguageMeta.nativeName}
              </span>
            </button>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="pt-3.5 border-t border-[#E3E5DE] space-y-2.5 shrink-0">
          <div className="bg-[#F7F5EF] rounded-xl p-3 border border-[#E3E5DE] text-xs">
            <div className="flex items-center gap-2 text-[#234B3A] font-bold mb-0.5">
              <PhoneCall className="w-3.5 h-3.5 text-[#234B3A]" />
              <span>{t('settings.supportLine')}</span>
            </div>
            <p className="font-extrabold text-[#18382B] text-xs">1800-SHOP-PULSE</p>
          </div>

          {isLoggedIn && onLogout && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="w-full py-2.5 px-4 rounded-lg bg-[#FDF2F2] hover:bg-[#FCE8E8] text-[#B93838] font-semibold text-xs flex items-center justify-center gap-2 border border-[#B93838]/30 transition-colors cursor-pointer min-h-[44px]"
            >
              <LogOut className="w-4 h-4 text-[#B93838]" />
              <span>{t('nav.logout')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(drawerContent, document.body) : drawerContent;
};
