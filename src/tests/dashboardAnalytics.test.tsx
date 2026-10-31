import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalesOverview } from '../components/dashboard/SalesOverview';
import { TodaySummary } from '../components/dashboard/TodaySummary';
import { SalesChart } from '../components/SalesChart';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'test-user', email: 'owner@example.com' },
    loading: false,
  }),
}));

describe('Phase 4: Analytics-First Dashboard & Line Chart Tests', () => {
  it('renders SalesOverview with verified SVG line chart when data is provided', () => {
    const mockPoints = [
      { day: 'Mon', date: '2026-10-08', amount: 1500, itemsCount: 4 },
      { day: 'Tue', date: '2026-10-09', amount: 3200, itemsCount: 7 },
      { day: 'Wed', date: '2026-10-10', amount: 2100, itemsCount: 5 },
      { day: 'Thu', date: '2026-10-11', amount: 4800, itemsCount: 11 },
      { day: 'Fri', date: '2026-10-12', amount: 3900, itemsCount: 9 },
      { day: 'Sat', date: '2026-10-13', amount: 6200, itemsCount: 15 },
      { day: 'Sun (Today)', date: '2026-10-14', amount: 5400, itemsCount: 12, isToday: true },
    ];

    const html = renderToStaticMarkup(
      <LanguageProvider>
        <SalesOverview
          totalRevenue={27100}
          averageDailyRevenue={3871}
          data={mockPoints}
          period="7days"
          onPeriodChange={vi.fn()}
        />
      </LanguageProvider>
    );

    // Verified period total and daily average are rendered
    expect(html).toContain('₹27,100');
    expect(html).toContain('Avg. ₹3,871/day');

    // SVG Line chart is rendered with aria-label
    expect(html).toContain('aria-label="Sales performance line chart"');
    expect(html).toContain('path');
    expect(html).toContain('stroke="#234B3A"');

    // X-axis day labels are present
    expect(html).toContain('Mon');
    expect(html).toContain('Sun');
  });

  it('renders honest empty state when no sales are recorded', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <SalesOverview
          totalRevenue={0}
          data={[]}
          period="7days"
          onPeriodChange={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(html).toContain('No Sales Recorded For This Period');
    expect(html).not.toContain('+18.5%');
  });

  it('omits fake growth badge when growth comparison is undefined', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <SalesOverview
          totalRevenue={5000}
          growthPercent={undefined}
          data={[{ day: 'Today', amount: 5000 }]}
        />
      </LanguageProvider>
    );

    // No "+18.5%" or fabricated percentage badge
    expect(html).not.toContain('vs last week');
    expect(html).not.toContain('18.5%');
  });

  it('renders period toggles (7D and 30D)', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <SalesOverview
          totalRevenue={12000}
          data={[{ day: 'Today', amount: 12000 }]}
          period="7days"
          onPeriodChange={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(html).toContain('7D');
    expect(html).toContain('30D');
  });

  it('renders TodaySummary with 4 distinct, verified metric cards', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <TodaySummary
          revenue={8450}
          itemsSold={24}
          productsCount={48}
          billsCount={6}
          setActivePage={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(html).toContain('₹8,450');
    expect(html).toContain('24');
    expect(html).toContain('6');
    expect(html).toContain('48');

    // Metric titles are clear and distinct
    expect(html).toContain('Sales');
    expect(html).toContain('Items Sold');
    expect(html).toContain('Bills Completed');
    expect(html).toContain('In store catalog');
  });

  it('renders SalesChart with SVG line, gradient defs, and verified peak tag', () => {
    const testData = [
      { day: 'Mon', date: '2026-10-12', amount: 2000 },
      { day: 'Tue', date: '2026-10-13', amount: 8500 },
      { day: 'Wed', date: '2026-10-14', amount: 4000, isToday: true },
    ];

    const html = renderToStaticMarkup(
      <SalesChart
        data={testData}
        peakText="Peak: Tue (₹8.5k)"
      />
    );

    expect(html).toContain('Peak: Tue (₹8.5k)');
    expect(html).toContain('aria-label="Daily sales revenue trend line chart"');
    expect(html).toContain('linearGradient');
    expect(html).toContain('#234B3A');
  });
});
