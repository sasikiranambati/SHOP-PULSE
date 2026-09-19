/**
 * @file test_analytics.ts
 * @description Comprehensive validation test script for ShopPulse Phase 7 AI Business Analytics.
 */

// Node.js environment polyfill for browser storage
if (typeof window === 'undefined') {
  const store = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (global as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };
  (global as any).CustomEvent = class { constructor(public type: string, public detail?: any) {} };
}

async function runTests() {
  console.log('================================================================');
  console.log('📊 Starting ShopPulse Phase 7 AI Business Analytics Tests');
  console.log('================================================================\n');

  const analyticsService = await import('../src/services/analyticsService');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      throw new Error(`Assertion Failed: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1: Daily Revenue (Step 3)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 1] Daily Revenue Metrics');
  const daily = await analyticsService.getDailyRevenue();
  assert(typeof daily.revenue === 'number', 'Daily revenue is a number');
  assert(typeof daily.ordersCount === 'number', 'Daily ordersCount is a number');
  assert(typeof daily.averageOrderValue === 'number', 'Daily averageOrderValue is a number');
  assert(typeof daily.itemsSold === 'number', 'Daily itemsSold is a number');
  assert(Boolean(daily.date), 'Daily date string is populated');
  console.log(`     Values: ₹${daily.revenue} revenue, ${daily.ordersCount} orders, ₹${daily.averageOrderValue} avg bill\n`);

  // ---------------------------------------------------------------------------
  // Test 2: Weekly & Monthly Trends (Step 4)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 2] Weekly & Monthly Revenue Trends');
  const weekly = await analyticsService.getWeeklyRevenue();
  assert(weekly.period === '7days', 'Weekly trend period is 7days');
  assert(weekly.points.length === 7, 'Weekly trend has exactly 7 days');
  assert(weekly.points.some(p => p.isToday === true), 'Weekly trend identifies today');
  assert(weekly.points.every(p => p.height.endsWith('%')), 'All weekly points have CSS percentage height');
  assert(Boolean(weekly.peakDay), 'Weekly trend identifies peak day');

  const monthly = await analyticsService.getMonthlyRevenue();
  assert(monthly.period === '30days', 'Monthly trend period is 30days');
  assert(monthly.points.length === 30, 'Monthly trend has exactly 30 days');
  console.log(`     Weekly Total: ₹${weekly.totalRevenue.toLocaleString('en-IN')}, Peak: ${weekly.peakDay?.day} (₹${weekly.peakDay?.amount})\n`);

  // ---------------------------------------------------------------------------
  // Test 3: Top Selling Products (Step 5)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 3] Top Selling Products Ranking');
  const topProducts = await analyticsService.getTopSellingProducts(5);
  assert(Array.isArray(topProducts) && topProducts.length > 0, 'Top products returns non-empty list');
  assert(topProducts.length <= 5, 'Top products respects limit of 5');
  assert(topProducts[0].rank === 1, 'Top product is ranked #1');
  assert(Boolean(topProducts[0].productName), 'Top product has productName');
  assert(topProducts[0].revenue >= (topProducts[1]?.revenue || 0), 'Top products sorted descending by revenue/quantity');
  console.log(`     #1: ${topProducts[0].productName} (₹${topProducts[0].revenue})\n`);

  // ---------------------------------------------------------------------------
  // Test 4: Slow Moving Products (Step 6)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 4] Slow Moving Products Detection');
  const slowMoving = await analyticsService.getSlowMovingProducts(30);
  assert(Array.isArray(slowMoving), 'Slow moving products returns an array');
  if (slowMoving.length > 0) {
    const item = slowMoving[0];
    assert(Boolean(item.productName), 'Slow item has productName');
    assert(typeof item.estimatedBlockedCapital === 'number', 'Blocked capital is computed');
    assert(Boolean(item.recommendation), 'Actionable Kirana recommendation provided');
    console.log(`     Flagged ${slowMoving.length} slow items. Top: ${item.productName} (₹${item.estimatedBlockedCapital} capital blocked)`);
  }
  console.log('');

  // ---------------------------------------------------------------------------
  // Test 5: Estimated Profit (Step 7)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 5] Estimated Profit & Margin Analysis');
  const profit = await analyticsService.getEstimatedProfit();
  assert(typeof profit.dailyProfit === 'number', 'Daily profit calculated');
  assert(typeof profit.weeklyProfit === 'number', 'Weekly profit calculated');
  assert(typeof profit.monthlyProfit === 'number', 'Monthly profit calculated');
  assert(typeof profit.overallProfitMargin === 'number', 'Overall profit margin percentage calculated');
  assert(profit.overallProfitMargin > 0, 'Profit margin is positive');
  assert(typeof profit.itemsWithMissingCost === 'number', 'Handled missing purchase price gracefully');
  console.log(`     Margin: ${profit.overallProfitMargin}%, Weekly Profit: ₹${profit.weeklyProfit}, Missing Cost Items: ${profit.itemsWithMissingCost}\n`);

  // ---------------------------------------------------------------------------
  // Test 6: AI Business Insight Generator (Step 8)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 6] Dynamic AI Business Insights');
  const insights = await analyticsService.generateBusinessInsights();
  assert(Array.isArray(insights) && insights.length > 0, 'AI insights returned non-empty list');
  assert(insights.every(i => Boolean(i.id && i.title && i.message && i.type)), 'All insights have id, title, message, and type');
  assert(insights.some(i => i.title.toLowerCase().includes('revenue') || i.title.toLowerCase().includes('demand') || i.title.toLowerCase().includes('margin')), 'Contextual heuristics matched');
  insights.forEach((ins, idx) => {
    console.log(`     [${idx + 1}] [${ins.type.toUpperCase()}] ${ins.title}: "${ins.message}"`);
  });
  console.log('');

  // ---------------------------------------------------------------------------
  // Test 7: Low Stock Insights Engine
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 7] Low Stock Velocity & Restock Predictions');
  const lowStock = await analyticsService.getLowStockInsights();
  assert(Array.isArray(lowStock), 'Low stock insights returns array');
  if (lowStock.length > 0) {
    const item = lowStock[0];
    assert(typeof item.dailyVelocity === 'number', 'Daily velocity calculated');
    assert(typeof item.estimatedDaysUntilStockout === 'number', 'Days until stockout predicted');
    assert(typeof item.recommendedRestockQuantity === 'number', 'Restock quantity recommended');
    console.log(`     Critical Alert: ${item.productName} (~${item.estimatedDaysUntilStockout} days left, recommend ${item.recommendedRestockQuantity} ${item.unit})`);
  }
  console.log('');

  // ---------------------------------------------------------------------------
  // Test 8: Consolidated Master Analytics Object (Step 1)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 8] Consolidated Master Analytics Model (Step 1)');
  const consolidated = await analyticsService.getConsolidatedAnalytics();
  assert(typeof consolidated.totalRevenue === 'number', 'consolidated.totalRevenue present');
  assert(typeof consolidated.totalOrders === 'number', 'consolidated.totalOrders present');
  assert(typeof consolidated.averageOrderValue === 'number', 'consolidated.averageOrderValue present');
  assert(typeof consolidated.itemsSold === 'number', 'consolidated.itemsSold present');
  assert(Array.isArray(consolidated.topProducts), 'consolidated.topProducts present');
  assert(Array.isArray(consolidated.lowStockProducts), 'consolidated.lowStockProducts present');
  assert(Boolean(consolidated.dailySales), 'consolidated.dailySales present');
  assert(Boolean(consolidated.weeklySales), 'consolidated.weeklySales present');
  assert(Boolean(consolidated.monthlySales), 'consolidated.monthlySales present');
  assert(Boolean(consolidated.estimatedProfit), 'consolidated.estimatedProfit present');
  assert(Boolean(consolidated.generatedAt), 'consolidated.generatedAt present');

  // ---------------------------------------------------------------------------
  // Test 9: Cache Invalidation (Step 9)
  // ---------------------------------------------------------------------------
  console.log('\n👉 [Test 9] In-Memory Cache Optimization');
  analyticsService.clearAnalyticsCache();
  const refreshed = await analyticsService.getDashboardStats();
  assert(Boolean(refreshed.todayRevenue), 'getDashboardStats functions cleanly after clearAnalyticsCache');

  console.log('');
  console.log('================================================================');
  console.log(`🎉 ALL ${passed}/${total} ANALYTICS TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('Analytics test failed:', err);
  process.exit(1);
});
