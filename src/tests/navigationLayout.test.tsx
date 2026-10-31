/**
 * @file navigationLayout.test.tsx
 * @description Unit tests for Phase 3: Application Shell, Sidebar, Navbar, Mobile Drawer, and BottomNav.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/Sidebar';
import { Navbar } from '../components/Navbar';
import { BottomNav } from '../components/BottomNav';
import { MobileNavDrawer } from '../components/MobileNavDrawer';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../hooks/useAlerts', () => ({
  useAlerts: () => ({
    unreadCount: 3,
    alerts: [],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}));

vi.mock('../hooks/useSync', () => ({
  useSync: () => ({
    isOnline: true,
    isSyncing: false,
    totalPendingCount: 0,
    syncNow: vi.fn(),
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('Sidebar Component', () => {
  it('renders all verified navigation routes in expanded state', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Sidebar 
          activePage="dashboard" 
          setActivePage={() => {}} 
          isCollapsed={false} 
          onToggleCollapse={() => {}}
        />
      </LanguageProvider>
    );

    // Verify groups and sections
    expect(html).toContain('Overview');
    expect(html).toContain('Sales &amp; Billing');
    expect(html).toContain('Inventory');
    expect(html).toContain('Tools &amp; Automation');
    expect(html).toContain('Settings');

    // Verify badges
    expect(html).toContain('POS');
    expect(html).toContain('AI');

    // Verify active page indicator
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('1800-SHOP-PULSE');
    expect(html).toContain('Collapse menu');
  });

  it('renders collapsed state with compact width, tooltips, and collapse toggle', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Sidebar 
          activePage="sales" 
          setActivePage={() => {}} 
          isCollapsed={true} 
          onToggleCollapse={() => {}}
        />
      </LanguageProvider>
    );

    // Collapsed width class
    expect(html).toContain('w-[72px]');
    // Tooltips are rendered for accessible hover
    expect(html).toContain('role="tooltip"');
    // Active route highlighted
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Expand sidebar navigation"');
  });
});

describe('Navbar Component', () => {
  it('renders clean top header with branding, breadcrumb, search, and action controls', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Navbar
          activePage="inventory"
          setActivePage={() => {}}
          shopName="Kiran Supermarket"
          isLoggedIn={true}
          onOpenSearch={() => {}}
          isSidebarCollapsed={false}
          onToggleSidebar={() => {}}
          onOpenMobileMenu={() => {}}
        />
      </LanguageProvider>
    );

    // Brand and Shop Name
    expect(html).toContain('Shop');
    expect(html).toContain('Pulse');
    expect(html).toContain('Kiran Supermarket');

    // Breadcrumb section indicator
    expect(html).toContain('Current section');
    expect(html).toContain('Stock Catalog');

    // Search and keyboard shortcut
    expect(html).toContain('Search products, bills, invoices...');
    expect(html).toContain('Ctrl K');

    // Minimal Action controls: Notification bell & User Profile Menu button
    expect(html).toContain('notification-bell-btn');
    expect(html).toContain('user-profile-menu-button');
    expect(html).toContain('User account menu');
    expect(html).toContain('Open navigation menu');

    // Verified: No separate cluttered buttons on the main bar
    expect(html).not.toContain('title="Change Language"');
    expect(html).not.toContain('title="Logout"');
  });
});

describe('MobileNavDrawer Component', () => {
  it('renders app-like slide-over mobile drawer with dialog accessibility', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <MobileNavDrawer
          isOpen={true}
          onClose={() => {}}
          activePage="dashboard"
          setActivePage={() => {}}
          shopName="Kiran Supermarket"
          isLoggedIn={true}
          onLogout={() => {}}
          onOpenLanguageModal={() => {}}
        />
      </LanguageProvider>
    );

    // Dialog accessibility attributes
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Navigation menu"');
    expect(html).toContain('Close menu');

    // Navigation items
    expect(html).toContain('Dashboard');
    expect(html).toContain('Quick Sales POS');
    expect(html).toContain('Stock Catalog');
    expect(html).toContain('Scan Bill');
    expect(html).toContain('Shop Insights');
    expect(html).toContain('Settings &amp; More');

    // Support and logout
    expect(html).toContain('1800-SHOP-PULSE');
    expect(html).toContain('Logout');
  });
});

describe('BottomNav Component', () => {
  it('renders 5 primary mobile destinations with touch-friendly targets', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <BottomNav
          activePage="scanner"
          setActivePage={() => {}}
          onOpenMenu={() => {}}
        />
      </LanguageProvider>
    );

    expect(html).toContain('aria-label="Bottom mobile navigation"');
    // Active scanner route highlighted
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Scan Bill');
    expect(html).toContain('Home');
    expect(html).toContain('Sales');
    expect(html).toContain('Stock');
    expect(html).toContain('More');
  });
});

describe('Scrolling Architecture & Layout Integrity', () => {
  it('ensures sidebar nav does not apply overscroll-contain to allow natural page scrolling', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Sidebar 
          activePage="dashboard" 
          setActivePage={() => {}} 
          isCollapsed={false} 
        />
      </LanguageProvider>
    );

    // Sidebar navigation should not trap mouse-wheel events
    expect(html).not.toContain('overscroll-contain');
  });

  it('ensures useDialog lockBodyScroll and unlockBodyScroll clean up document.body overflow', async () => {
    const mockStyle = {
      overflow: '' as string | undefined,
      removeProperty(prop: string) {
        if (prop === 'overflow') {
          delete this.overflow;
        }
      },
    };

    vi.stubGlobal('document', {
      body: {
        style: mockStyle,
      },
    });

    const { lockBodyScroll, unlockBodyScroll } = await import('../hooks/useDialog');

    lockBodyScroll();
    expect(mockStyle.overflow).toBe('hidden');

    unlockBodyScroll();
    expect(mockStyle.overflow).toBeUndefined();
  });
});
