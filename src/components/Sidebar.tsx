import React from 'react';
import { 
  Home, 
  Receipt, 
  Package, 
  Sparkles,
  ScanLine,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useShopRole } from '../hooks/useShopRole';

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
  const { canAccessPage } = useShopRole();

  // Navigation groups aligned with Shelfora intelligence architecture
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
        { id: 'insights', labelKey: 'nav.shopInsights', icon: Sparkles },
        { id: 'scanner', labelKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
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

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessPage(item.id)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside 
      aria-label="Sidebar Navigation"
      className={`no-print shrink-0 hidden md:flex flex-col justify-between bg-white border-r border-[#DDE9DF] transition-[width] duration-200 ease-in-out select-none sticky top-14 h-[calc(100vh-3.5rem)] h-[calc(100dvh-3.5rem)] z-30 ${
        isCollapsed ? 'w-[72px] p-2.5' : 'w-64 p-3.5'
      }`}
    >
      {/* Navigation Groups */}
      <nav aria-label="Main menu" className="space-y-3 overflow-y-auto pr-0.5">
        {visibleGroups.map((group, groupIdx) => (
          <div key={group.id} className="space-y-1">
            {/* Group Header / Separator */}
            {!isCollapsed ? (
              <p 
                className="px-3 text-[10px] font-bold text-[#5E6C64] uppercase tracking-wider mb-1 pt-1"
                aria-hidden="true"
              >
                {group.label}
              </p>
            ) : groupIdx > 0 ? (
              <div className="border-t border-[#DDE9DF] my-2 mx-1" aria-hidden="true" />
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
                      className={`w-full flex items-center rounded-xl font-medium text-xs transition-all duration-150 cursor-pointer ${
                        isCollapsed 
                          ? 'justify-center p-2.5 min-h-[42px]' 
                          : 'justify-between px-3 py-2.5 min-h-[42px]'
                      } ${
                        isActive
                          ? 'bg-[#153D32] text-[#FAF8F2] font-semibold shadow-xs'
                          : 'text-[#252D29] hover:bg-[#F3EFE3] hover:text-[#153D32]'
                      }`}
                    >
                      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                        <Icon 
                          className={`w-4.5 h-4.5 shrink-0 transition-colors ${
                            isActive ? 'text-[#FAF8F2]' : 'text-[#5E6C64] group-hover:text-[#153D32]'
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
                              ? 'bg-white/20 text-[#FAF8F2]' 
                              : item.badge === 'AI'
                                ? 'bg-[#D6AE62]/20 text-[#A07828] border border-[#D6AE62]/40'
                                : 'bg-[#E7F3EE] text-[#153D32] border border-[#23866A]/20'
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
                        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1.5 rounded-lg bg-[#153D32] text-[#FAF8F2] text-xs font-medium whitespace-nowrap shadow-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 flex items-center gap-1.5"
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

      {/* Sidebar Footer: Collapse Controls */}
      {onToggleCollapse && (
        <div className="pt-3 border-t border-[#DDE9DF] shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Expand sidebar navigation' : 'Collapse sidebar navigation'}
            className={`w-full flex items-center rounded-xl text-xs font-medium text-[#5E6C64] hover:text-[#153D32] hover:bg-[#F3EFE3] transition-colors cursor-pointer border border-transparent hover:border-[#DDE9DF] ${
              isCollapsed ? 'justify-center p-2' : 'justify-between px-3 py-2'
            }`}
          >
            {!isCollapsed ? (
              <>
                <span className="text-[11px] font-semibold">Collapse menu</span>
                <ChevronLeft className="w-4 h-4 text-[#5E6C64]" />
              </>
            ) : (
              <ChevronRight className="w-4 h-4 text-[#5E6C64]" />
            )}
          </button>
        </div>
      )}
    </aside>
  );
};
