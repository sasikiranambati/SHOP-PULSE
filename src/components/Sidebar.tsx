import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  ScanLine, 
  Sparkles,
  Settings as SettingsIcon,
  PhoneCall,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

export interface SidebarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItem {
  id: PageRoute;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activePage, 
  setActivePage,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { t } = useLanguage();

  // Navigation groups derived strictly from verified existing application routes
  const navGroups: NavGroup[] = [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'dashboard', labelKey: 'nav.dashboard', icon: Home },
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
        { id: 'inventory', labelKey: 'nav.stockCatalog', icon: Package },
      ],
    },
    {
      id: 'tools',
      label: 'Tools & Automation',
      items: [
        { id: 'scanner', labelKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
        { id: 'insights', labelKey: 'nav.shopInsights', icon: Sparkles },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        { id: 'settings', labelKey: 'nav.settingsMore', icon: SettingsIcon },
      ],
    },
  ];

  return (
    <aside 
      aria-label="Sidebar Navigation"
      className={`no-print shrink-0 hidden md:flex flex-col justify-between bg-white border-r border-[#E3E5DE] transition-[width] duration-200 ease-in-out select-none sticky top-14 h-[calc(100vh-3.5rem)] h-[calc(100dvh-3.5rem)] z-30 ${
        isCollapsed ? 'w-[72px] p-2.5' : 'w-64 p-3.5'
      }`}
    >
      {/* Navigation Groups */}
      <nav aria-label="Main menu" className="space-y-3 overflow-y-auto pr-0.5">
        {navGroups.map((group, groupIdx) => (
          <div key={group.id} className="space-y-1">
            {/* Group Header / Separator */}
            {!isCollapsed ? (
              <p 
                className="px-3 text-[10px] font-bold text-[#69736C] uppercase tracking-wider mb-1 pt-1"
                aria-hidden="true"
              >
                {group.label}
              </p>
            ) : groupIdx > 0 ? (
              <div className="border-t border-[#E3E5DE] my-2 mx-1" aria-hidden="true" />
            ) : null}

            {/* Nav Items */}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const labelText = t(item.labelKey);

                return (
                  <div key={item.id} className="relative group">
                    <button
                      type="button"
                      onClick={() => setActivePage(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={labelText}
                      className={`w-full flex items-center rounded-lg font-medium text-xs transition-all duration-150 cursor-pointer ${
                        isCollapsed 
                          ? 'justify-center p-2.5 min-h-[42px]' 
                          : 'justify-between px-3 py-2.5 min-h-[42px]'
                      } ${
                        isActive
                          ? 'bg-[#234B3A] text-white font-semibold shadow-xs'
                          : 'text-[#202923] hover:bg-[#F2EFE9] hover:text-[#18382B]'
                      }`}
                    >
                      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                        <Icon 
                          className={`w-4.5 h-4.5 shrink-0 transition-colors ${
                            isActive ? 'text-white' : 'text-[#69736C] group-hover:text-[#234B3A]'
                          }`} 
                        />
                        {!isCollapsed && (
                          <span className="truncate">{labelText}</span>
                        )}
                      </div>

                      {!isCollapsed && item.badge && (
                        <span 
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                            isActive 
                              ? 'bg-white/20 text-white' 
                              : 'bg-[#E5EEE6] text-[#18382B] border border-[#52745D]/20'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>

                    {/* Accessible Hover & Focus Tooltip for Collapsed State */}
                    {isCollapsed && (
                      <div 
                        role="tooltip"
                        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1.5 rounded-md bg-[#202923] text-white text-xs font-medium whitespace-nowrap shadow-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 flex items-center gap-1.5"
                      >
                        <span>{labelText}</span>
                        {item.badge && (
                          <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-white/20 text-white uppercase tracking-wider">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Sidebar Footer: Support & Collapse Controls */}
      <div className="pt-3 border-t border-[#E3E5DE] space-y-2 shrink-0">
        {/* Support Help Banner */}
        {!isCollapsed ? (
          <div className="bg-[#F7F5EF] rounded-xl p-3 border border-[#E3E5DE] text-xs">
            <div className="flex items-center gap-2 text-[#234B3A] font-bold mb-0.5">
              <PhoneCall className="w-3.5 h-3.5 text-[#234B3A]" />
              <span>{t('settings.supportLine')}</span>
            </div>
            <p className="text-[#69736C] text-[11px]">Help available 24/7</p>
            <p className="font-extrabold text-[#18382B] mt-1 text-xs tracking-tight">1800-SHOP-PULSE</p>
          </div>
        ) : (
          <div className="flex justify-center relative group">
            <div 
              aria-label="Help available 24/7: 1800-SHOP-PULSE"
              className="w-10 h-10 rounded-lg bg-[#F7F5EF] border border-[#E3E5DE] flex items-center justify-center text-[#234B3A] cursor-pointer hover:bg-[#E5EEE6] transition-colors"
            >
              <PhoneCall className="w-4 h-4 text-[#234B3A]" />
            </div>
            <div 
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1.5 rounded-md bg-[#202923] text-white text-xs font-medium whitespace-nowrap shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50"
            >
              Support: 1800-SHOP-PULSE (24/7)
            </div>
          </div>
        )}

        {/* Sidebar Collapse Toggle Button */}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
            className={`w-full flex items-center rounded-lg text-xs font-medium text-[#69736C] hover:text-[#202923] hover:bg-[#F2EFE9] transition-colors cursor-pointer border border-transparent hover:border-[#E3E5DE] ${
              isCollapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'
            }`}
          >
            {!isCollapsed ? (
              <>
                <span className="text-[11px] font-semibold">Collapse menu</span>
                <ChevronLeft className="w-4 h-4 text-[#69736C]" />
              </>
            ) : (
              <ChevronRight className="w-4 h-4 text-[#69736C]" />
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
