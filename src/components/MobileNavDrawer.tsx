import React from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Home, 
  Receipt, 
  Package, 
  Sparkles, 
  ScanLine,
  Settings as SettingsIcon, 
  Wifi, 
  WifiOff, 
  Globe, 
  LogOut 
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ShelforaLogo } from './branding/ShelforaLogo';
import { useSync } from '../hooks/useSync';
import { useDialog } from '../hooks/useDialog';
import { useShopRole } from '../hooks/useShopRole';

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
  const { canAccessPage } = useShopRole();

  const drawerRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

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
        { id: 'insights', labelKey: 'nav.shopInsights', icon: Sparkles, badge: null },
        { id: 'scanner', labelKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
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

  const visibleMobileNavGroups = mobileNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessPage(item.id)),
    }))
    .filter((group) => group.items.length > 0);

  const syncStatusClasses = !isOnline
    ? 'bg-[#FBF4E7] text-[#D6AE62] border-[#D6AE62]/40 cursor-pointer'
    : isSyncing
      ? 'bg-[#F0F6FB] text-[#83B8DD] border-[#83B8DD]/30'
      : 'bg-[#E7F3EE] text-[#153D32] border-[#23866A]/20';

  const syncBannerClasses =
    'flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all ' +
    syncStatusClasses;

  const syncStatusText = !isOnline
    ? `Offline (${totalPendingCount} queued)`
    : isSyncing
      ? 'Syncing with cloud...'
      : 'Cloud Connected';

  const drawerContent = (
    <div className="no-print md:hidden fixed inset-0 z-50 flex">
      {/* Semi-transparent Backdrop */}
      <div 
        className="fixed inset-0 bg-[#0B231D]/50 backdrop-blur-xs transition-opacity"
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
        className="relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col justify-between p-4 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-50 animate-in slide-in-from-left duration-200 overflow-y-auto overscroll-contain border-r border-[#DDE9DF]"
      >
        <div className="space-y-4">
          {/* Drawer Brand Header */}
          <div className="flex items-center justify-between pb-3.5 border-b border-[#DDE9DF]">
            <div className="flex items-center gap-2.5">
              <ShelforaLogo variant="compact" size="md" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-0.5">
                  <span className="text-base font-black text-[#153D32] tracking-wider">SHELFORA</span>
                </div>
                <p className="text-[11px] font-medium text-[#5E6C64] truncate max-w-[150px]">
                  {shopName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-[#FAF8F2] hover:bg-[#F3EFE3] border border-[#DDE9DF] text-[#252D29] flex items-center justify-center cursor-pointer min-h-[44px]"
              aria-label="Close menu"
            >
              <X className="w-4 h-4 text-[#252D29]" />
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
            onClick={() => {
              if (!isOnline) {
                syncNow();
              }
            }}
            className={syncBannerClasses}
          >
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="w-4 h-4 text-[#23866A]" />
              ) : (
                <WifiOff className="w-4 h-4 text-[#D6AE62]" />
              )}
              <span>{syncStatusText}</span>
            </div>
            {!isOnline && (
              <span className="text-[10px] font-bold underline">Sync Now</span>
            )}
          </div>

          {/* Grouped Navigation List */}
          <nav aria-label="Main navigation" className="space-y-3">
            {visibleMobileNavGroups.map((group) => (
              <div key={group.id} className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#5E6C64] px-3 pb-0.5" aria-hidden="true">
                  {group.label}
                </p>

                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;
                  const buttonClasses = isActive
                    ? 'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer min-h-[44px] bg-[#153D32] text-[#FAF8F2] shadow-xs'
                    : 'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer min-h-[44px] text-[#252D29] hover:bg-[#FAF8F2] active:bg-[#F3EFE3]';

                  const iconClasses = isActive
                    ? 'w-4.5 h-4.5 shrink-0 text-[#FAF8F2]'
                    : 'w-4.5 h-4.5 shrink-0 text-[#5E6C64]';

                  let badgeClasses = 'text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ';
                  if (isActive) {
                    badgeClasses += 'bg-white/20 text-[#FAF8F2]';
                  } else if (item.badge === 'AI') {
                    badgeClasses += 'bg-[#D6AE62]/20 text-[#A07828] border border-[#D6AE62]/40';
                  } else {
                    badgeClasses += 'bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/20';
                  }

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={buttonClasses}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={iconClasses} />
                        <span>{t(item.labelKey)}</span>
                      </div>
                      {item.badge && (
                        <span className={badgeClasses}>
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
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#FAF8F2] hover:bg-[#F3EFE3] text-[#252D29] text-xs font-semibold border border-[#DDE9DF] cursor-pointer min-h-[44px]"
            >
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#23866A]" />
                <span>{t('settings.language')}</span>
              </div>
              <span className="text-[#153D32] bg-white px-2 py-0.5 rounded-md border border-[#DDE9DF] text-[11px] font-bold">
                {currentLanguageMeta.nativeName}
              </span>
            </button>
          )}
        </div>

        {/* Drawer Footer */}
        {isLoggedIn && onLogout && (
          <div className="pt-3.5 border-t border-[#DDE9DF] shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#FDF1EF] hover:bg-[#F9E2DD] text-[#EF806D] font-semibold text-xs flex items-center justify-center gap-2 border border-[#EF806D]/30 transition-colors cursor-pointer min-h-[44px]"
            >
              <LogOut className="w-4 h-4 text-[#EF806D]" />
              <span>{t('nav.logout')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(drawerContent, document.body) : drawerContent;
};
