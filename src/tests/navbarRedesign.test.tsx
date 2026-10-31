import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Navbar } from '../components/Navbar';
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

const renderNavbarHtml = (props: Partial<React.ComponentProps<typeof Navbar>> = {}) => {
  const defaultProps = {
    activePage: 'dashboard' as const,
    setActivePage: vi.fn(),
    shopName: 'Balaji Kirana & General Store',
    isLoggedIn: true,
    onLogout: vi.fn(),
    onOpenSearch: vi.fn(),
    isSidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    onOpenMobileMenu: vi.fn(),
    ...props,
  };

  return renderToStaticMarkup(
    <LanguageProvider>
      <Navbar {...defaultProps} />
    </LanguageProvider>
  );
};

describe('ShopPulse Minimal Header Redesign', () => {
  it('renders minimal left, center, and right sections without visual clutter', () => {
    const html = renderNavbarHtml();

    // 1. Left Section: Sidebar toggle, Brand, Breadcrumb
    expect(html).toContain('aria-label="Collapse sidebar navigation"');
    expect(html).toContain('Shop');
    expect(html).toContain('Pulse');
    expect(html).toContain('aria-label="Current section"');
    expect(html).toContain('Dashboard');

    // 2. Center Section: One prominent search field
    expect(html).toContain('id="global-search-header-btn"');
    expect(html).toContain('Search products, bills, invoices...');
    expect(html).toContain('Ctrl K');

    // 3. Right Section: Notification bell and Profile avatar
    expect(html).toContain('id="notification-bell-btn"');
    expect(html).toContain('id="user-profile-menu-button"');
    expect(html).toContain('aria-label="User account menu"');
    expect(html).toContain('aria-haspopup="menu"');

    // 4. Clutter elimination: No standalone top-bar buttons for language, store, online, or logout
    expect(html).not.toContain('title="Change Language"');
    expect(html).not.toContain('title="Logout"');
    expect(html).not.toContain('Connected online</span>'); // standalone online button removed from top bar
  });

  it('displays store identity as subtle non-interactive text in brand area', () => {
    const html = renderNavbarHtml({ shopName: 'Sri Balaji Supermarket' });
    expect(html).toContain('Sri Balaji Supermarket');
    expect(html).toContain('title="Sri Balaji Supermarket"');
  });

  it('renders micro status indicator dot on profile avatar', () => {
    const html = renderNavbarHtml();
    // Micro status dot container on avatar
    expect(html).toContain('w-2.5 h-2.5 rounded-full ring-2 ring-white');
  });

  it('supports logged-out minimal state with login/signup buttons', () => {
    const html = renderNavbarHtml({ isLoggedIn: false });

    expect(html).toContain('Shop');
    expect(html).toContain('Pulse');
    expect(html).toContain('Log In to Store');
    expect(html).toContain('Create account');

    // No search or profile menu for logged out visitors
    expect(html).not.toContain('id="global-search-header-btn"');
    expect(html).not.toContain('id="user-profile-menu-button"');
  });

  it('renders accessible mobile hamburger trigger for small screens', () => {
    const html = renderNavbarHtml({ onOpenMobileMenu: vi.fn() });
    expect(html).toContain('aria-label="Open navigation menu"');
    expect(html).toContain('aria-controls="mobile-nav-drawer"');
  });
});
