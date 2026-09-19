/**
 * @file testIsolationMatrix.ts
 * @description Automated verification script to test User Data Isolation across multiple users.
 * Validates that:
 * 1. User A and User B have separate workspaces.
 * 2. New users start with 0 products, 0 sales, 0 alerts, 0 analytics.
 * 3. Mutations performed by User A are never visible to User B.
 * 4. Switching back to User A restores User A's data without contamination.
 */

// Mock browser localStorage and window if running in Node.js
if (typeof window === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => store.get(`session_${key}`) ?? null,
    setItem: (key: string, val: string) => store.set(`session_${key}`, String(val)),
    removeItem: (key: string) => store.delete(`session_${key}`),
    clear: () => store.clear(),
  };
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  };
}

import { setActiveUserIdForTesting, initializeUserWorkspace } from '../services/authService';
import * as inventoryService from '../services/inventoryService';
import * as salesService from '../services/salesService';
import * as alertService from '../services/alertService';
import { dashboardCacheService } from '../services/dashboardCacheService';

export async function runIsolationTest(): Promise<void> {
  console.log('=== Starting ShopPulse Per-User Isolation Automated Test ===\n');

  const USER_A = 'uid_alpha_test_111';
  const USER_B = 'uid_beta_test_222';

  // --- Step 1: User A Onboarding ---
  console.log('[Test 1] Onboarding User A...');
  setActiveUserIdForTesting(USER_A);
  await initializeUserWorkspace(USER_A, {
    uid: USER_A,
    email: 'alpha@shoppulse.store',
    displayName: 'Alpha Merchant',
    shopName: "Alpha's Groceries",
    role: 'owner',
    theme: 'light',
    language: 'en',
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString()
  });

  const userAProductsInitial = await inventoryService.getProducts();
  const userASalesInitial = await salesService.getSales();
  const userAAlertsInitial = await alertService.getAlerts();
  const userASnapshotInitial = dashboardCacheService.getSnapshot(USER_A);

  console.log(`User A Initial Products: ${userAProductsInitial.length} (Expected: 0)`);
  console.log(`User A Initial Sales: ${userASalesInitial.length} (Expected: 0)`);
  console.log(`User A Initial Alerts: ${userAAlertsInitial.length} (Expected: 0)`);
  console.log(`User A Initial Revenue: ₹${userASnapshotInitial.todayRevenue} (Expected: 0)`);

  if (userAProductsInitial.length !== 0 || userASalesInitial.length !== 0 || userAAlertsInitial.length !== 0 || userASnapshotInitial.todayRevenue !== 0) {
    throw new Error('FAILED: User A did not start with empty data!');
  }
  console.log('PASS: User A starts with a completely clean workspace.\n');

  // --- Step 2: User A adds data ---
  console.log('[Test 2] User A creates 1 product, 1 sale, and 1 alert...');
  const alphaProduct = await inventoryService.addProduct({
    name: 'Alpha Basmati Rice 5kg',
    category: 'Grains',
    sellingPrice: 450,
    purchasePrice: 380,
    stock: 20,
    reorderLevel: 5,
    unit: 'bag'
  });

  await salesService.createSale({
    items: [{
      productId: alphaProduct.id,
      productName: alphaProduct.name,
      quantity: 2,
      price: 450
    }],
    paymentMethod: 'cash',
    customerName: 'Customer A'
  });

  await alertService.createAlert({
    productId: alphaProduct.id,
    productName: alphaProduct.name,
    type: 'LOW_STOCK',
    priority: 'high',
    title: 'Low Stock Alert',
    message: 'Alpha Basmati Rice needs restock soon'
  });

  const userAProductsAfter = await inventoryService.getProducts();
  const userASalesAfter = await salesService.getSales();
  const userAAlertsAfter = await alertService.getAlerts();

  console.log(`User A Products: ${userAProductsAfter.length} (Expected: 1)`);
  console.log(`User A Sales: ${userASalesAfter.length} (Expected: 1)`);
  console.log(`User A Alerts: ${userAAlertsAfter.length} (Expected: 1)`);

  if (userAProductsAfter.length !== 1 || userASalesAfter.length !== 1 || userAAlertsAfter.length !== 1) {
    throw new Error('FAILED: User A data was not saved properly!');
  }
  console.log('PASS: User A data created successfully.\n');

  // --- Step 3: User B Logs In ---
  console.log('[Test 3] Switching session to User B (Independent merchant)...');
  setActiveUserIdForTesting(USER_B);
  await initializeUserWorkspace(USER_B, {
    uid: USER_B,
    email: 'beta@shoppulse.store',
    displayName: 'Beta Pharmacy',
    shopName: "Beta Medicals",
    role: 'owner',
    theme: 'dark',
    language: 'te',
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString()
  });

  const userBProducts = await inventoryService.getProducts();
  const userBSales = await salesService.getSales();
  const userBAlerts = await alertService.getAlerts();
  const userBSnapshot = dashboardCacheService.getSnapshot(USER_B);

  console.log(`User B Products: ${userBProducts.length} (Expected: 0)`);
  console.log(`User B Sales: ${userBSales.length} (Expected: 0)`);
  console.log(`User B Alerts: ${userBAlerts.length} (Expected: 0)`);
  console.log(`User B Revenue: ₹${userBSnapshot.todayRevenue} (Expected: 0)`);

  if (userBProducts.length !== 0) {
    throw new Error(`DATA LEAK DETECTED: User B sees ${userBProducts.length} products from User A!`);
  }
  if (userBSales.length !== 0) {
    throw new Error(`DATA LEAK DETECTED: User B sees ${userBSales.length} sales from User A!`);
  }
  if (userBAlerts.length !== 0) {
    throw new Error(`DATA LEAK DETECTED: User B sees ${userBAlerts.length} alerts from User A!`);
  }
  if (userBSnapshot.todayRevenue !== 0) {
    throw new Error(`DATA LEAK DETECTED: User B sees revenue from User A!`);
  }
  console.log('PASS: Strict Data Isolation confirmed! User B cannot see any of User A data.\n');

  // --- Step 4: User B Adds Data ---
  console.log('[Test 4] User B adds their own products...');
  await inventoryService.addProduct({
    name: 'Beta Paracetamol 500mg',
    category: 'Medicine',
    sellingPrice: 35,
    purchasePrice: 20,
    stock: 100,
    reorderLevel: 20,
    unit: 'strip'
  });

  const userBProductsAfter = await inventoryService.getProducts();
  console.log(`User B Products: ${userBProductsAfter.length} (${userBProductsAfter[0]?.name})`);
  if (userBProductsAfter.length !== 1 || userBProductsAfter[0]?.name !== 'Beta Paracetamol 500mg') {
    throw new Error('FAILED: User B product creation failed!');
  }
  console.log('PASS: User B product created independently.\n');

  // --- Step 5: Switch back to User A ---
  console.log('[Test 5] Switching back to User A...');
  setActiveUserIdForTesting(USER_A);
  const userAReloadedProducts = await inventoryService.getProducts();
  const userAReloadedSales = await salesService.getSales();

  console.log(`User A Reloaded Products: ${userAReloadedProducts.length} (Should be 1: "${userAReloadedProducts[0]?.name}")`);
  console.log(`User A Reloaded Sales: ${userAReloadedSales.length} (Should be 1)`);

  if (userAReloadedProducts.length !== 1 || userAReloadedProducts[0]?.name !== 'Alpha Basmati Rice 5kg') {
    throw new Error('FAILED: User A data corrupted or contains User B items!');
  }
  if (userAReloadedSales.length !== 1 || userAReloadedSales[0]?.totalAmount !== 900) {
    throw new Error('FAILED: User A sales lost or modified!');
  }
  console.log('PASS: User A data perfectly preserved with zero cross-contamination.\n');

  console.log('====================================================');
  console.log('ALL ISOLATION TESTS PASSED WITH 100% INTEGRITY!');
  console.log('====================================================');
}

// Auto-run when executed directly via Node / tsx
if (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.argv?.[1]?.includes('testIsolationMatrix')) {
  runIsolationTest().catch((err) => {
    console.error('Test execution failed:', err);
    (globalThis as any).process.exit(1);
  });
}
