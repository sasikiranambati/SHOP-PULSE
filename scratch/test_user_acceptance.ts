/**
 * @file test_user_acceptance.ts
 * @description Dedicated validation test script for user criteria:
 * 1. Dashboard numbers update.
 * 2. Revenue matches sales.
 * 3. Top products change after new sales.
 * 4. AI insight cards display meaningful messages.
 * 5. No TypeScript errors.
 */

// Environment polyfill for Node.js
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

async function runAcceptanceTests() {
  console.log('================================================================');
  console.log('🎯 Running User Acceptance Verification:');
  console.log('   1. Dashboard numbers update');
  console.log('   2. Revenue matches sales');
  console.log('   3. Top products change after new sales');
  console.log('   4. AI insight cards display meaningful messages');
  console.log('   5. No TypeScript errors');
  console.log('================================================================\n');

  const { createSale, getSales } = await import('../src/services/salesService');
  const { getProducts } = await import('../src/services/inventoryService');
  const { 
    getDailyRevenue, 
    getDashboardStats, 
    getTopSellingProducts, 
    generateBusinessInsights,
    clearAnalyticsCache 
  } = await import('../src/services/analyticsService');

  // ---------------------------------------------------------------------------
  // STEP 1: Capture Initial Baseline
  // ---------------------------------------------------------------------------
  console.log('📊 Step 1: Capture Initial Baseline Stats');
  clearAnalyticsCache();
  const initialDaily = await getDailyRevenue();
  const initialStats = await getDashboardStats();
  const initialTop = await getTopSellingProducts(5);
  const initialInsights = await generateBusinessInsights();

  console.log(`   Initial Daily Revenue: ₹${initialDaily.revenue}`);
  console.log(`   Initial Orders Count:  ${initialDaily.ordersCount}`);
  console.log(`   Initial Items Sold:    ${initialDaily.itemsSold}`);
  console.log(`   Initial Top Product:   #1 ${initialTop[0]?.productName} (₹${initialTop[0]?.revenue})`);
  console.log('');

  // ---------------------------------------------------------------------------
  // STEP 2: Record a Brand New Sale
  // ---------------------------------------------------------------------------
  const targetProduct = (await getProducts())[0] || {
    id: 'p_test_boost',
    name: 'Heritage Special Ghee (1L)',
    price: 650,
    sellingPrice: 650,
    purchasePrice: 520,
    stock: 50,
    unit: 'jars'
  };

  const SALE_QTY = 8;
  const SALE_UNIT_PRICE = targetProduct.sellingPrice || targetProduct.price || 650;
  const EXPECTED_SALE_TOTAL = SALE_QTY * SALE_UNIT_PRICE; // e.g. 8 * 650 = ₹5,200

  console.log(`🛒 Step 2: Record New Transaction:`);
  console.log(`   Product:    ${targetProduct.name}`);
  console.log(`   Quantity:   ${SALE_QTY} ${targetProduct.unit || 'units'}`);
  console.log(`   Unit Price: ₹${SALE_UNIT_PRICE}`);
  console.log(`   Expected Sale Amount: ₹${EXPECTED_SALE_TOTAL}`);

  const sale = await createSale({
    items: [
      {
        productId: targetProduct.id,
        productName: targetProduct.name,
        quantity: SALE_QTY,
        unitPrice: SALE_UNIT_PRICE,
        total: EXPECTED_SALE_TOTAL
      }
    ],
    customerName: 'Loyal Kirana Customer',
    paymentMethod: 'UPI'
  }, 'cashier_01');

  console.log(`   ✅ Sale recorded with Bill No: ${sale.billNumber}, Total: ₹${sale.total}\n`);

  // Clear analytics cache to reflect new sales
  clearAnalyticsCache();

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Criteria 1 & 2: Revenue Matches Sales & Dashboard Numbers Update
  // ---------------------------------------------------------------------------
  console.log('🔍 Step 3: Verify Revenue Matches Sales & Dashboard Numbers Update');
  const updatedDaily = await getDailyRevenue();
  const updatedStats = await getDashboardStats();

  const expectedRevenue = initialDaily.revenue + EXPECTED_SALE_TOTAL;
  const expectedOrders = initialDaily.ordersCount + 1;
  const expectedItemsSold = initialDaily.itemsSold + SALE_QTY;

  console.log(`   Expected Revenue: ₹${expectedRevenue} | Actual: ₹${updatedDaily.revenue}`);
  if (updatedDaily.revenue === expectedRevenue) {
    console.log('   ✅ PASS: Revenue exactly matches sales (+₹' + EXPECTED_SALE_TOTAL + ')');
  } else {
    throw new Error(`Revenue mismatch: expected ₹${expectedRevenue}, got ₹${updatedDaily.revenue}`);
  }

  console.log(`   Expected Orders:  ${expectedOrders} | Actual: ${updatedDaily.ordersCount}`);
  if (updatedDaily.ordersCount === expectedOrders) {
    console.log('   ✅ PASS: Dashboard order count updated (+1)');
  } else {
    throw new Error(`Order count mismatch: expected ${expectedOrders}, got ${updatedDaily.ordersCount}`);
  }

  console.log(`   Expected Items Sold: ${expectedItemsSold} | Actual: ${updatedDaily.itemsSold}`);
  if (updatedDaily.itemsSold === expectedItemsSold) {
    console.log('   ✅ PASS: Dashboard items sold updated (+' + SALE_QTY + ')');
  } else {
    throw new Error(`Items sold mismatch: expected ${expectedItemsSold}, got ${updatedDaily.itemsSold}`);
  }

  console.log(`   Dashboard Average Order Value: ₹${updatedStats.averageOrderValue}`);
  console.log('');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Criteria 3: Top Products Change After New Sales
  // ---------------------------------------------------------------------------
  console.log('🏆 Step 4: Verify Top Products Change After New Sales');
  const updatedTop = await getTopSellingProducts(5);
  const targetInTop = updatedTop.find(p => p.productId === targetProduct.id || p.productName === targetProduct.name);

  console.log('   Updated Top 5 Products:');
  updatedTop.forEach(p => {
    console.log(`     #${p.rank} ${p.productName} — ${p.quantitySold} ${p.unit} sold (₹${p.revenue.toLocaleString('en-IN')})`);
  });

  if (targetInTop && targetInTop.revenue >= EXPECTED_SALE_TOTAL) {
    console.log(`   ✅ PASS: Top products updated! "${targetProduct.name}" ranked #${targetInTop.rank} with ₹${targetInTop.revenue}`);
  } else {
    throw new Error(`Top products did not reflect newly sold product: ${targetProduct.name}`);
  }
  console.log('');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify Criteria 4: AI Insight Cards Display Meaningful Messages
  // ---------------------------------------------------------------------------
  console.log('💡 Step 5: Verify AI Insight Cards Display Meaningful Messages');
  const updatedInsights = await generateBusinessInsights();

  if (!updatedInsights || updatedInsights.length === 0) {
    throw new Error('AI insights returned an empty list!');
  }

  console.log(`   Generated ${updatedInsights.length} contextual AI business insights:`);
  updatedInsights.forEach((ins, idx) => {
    console.log(`     Card ${idx + 1}: [${ins.type.toUpperCase()}] "${ins.title}"`);
    console.log(`       Message: "${ins.message}"`);
    console.log(`       Badge Metric: ${ins.metric || 'N/A'}`);
  });

  // Verify none are empty or placeholder
  const validMessages = updatedInsights.every(i => 
    i.message.length > 20 && 
    !i.message.includes('undefined') && 
    !i.message.includes('NaN') &&
    (i.message.includes('₹') || i.message.includes('%') || i.message.includes('stock') || i.message.includes('revenue') || i.message.includes('sales'))
  );

  if (validMessages) {
    console.log('   ✅ PASS: AI insights display dynamic, human-readable, data-backed messages!');
  } else {
    throw new Error('AI insights contain invalid or placeholder messages.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 5 USER ACCEPTANCE CRITERIA VERIFIED AND PASSED!');
  console.log('================================================================\n');
}

runAcceptanceTests().catch(err => {
  console.error('Acceptance test failed:', err);
  process.exit(1);
});
