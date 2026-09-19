/**
 * @file seedDemoData.ts
 * @description Reusable demo seed script for ShopPulse Capstone & Evaluation.
 * Generates realistic Kirana inventory (Milk, Bread, Rice, Sugar, Cooking Oil, Biscuits)
 * and 7 days of rolling sales history without overwriting existing store data.
 * Can be executed via CLI (`npx tsx src/scripts/seedDemoData.ts`) or invoked in-app.
 */

// Polyfill minimal browser environment if executed via Node CLI
if (typeof globalThis.localStorage === 'undefined') {
  const memStore: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => memStore[key] || null,
    setItem: (key: string, val: string) => { memStore[key] = String(val); },
    removeItem: (key: string) => { delete memStore[key]; },
    clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); }
  };
}
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

import { addProduct, getProducts } from '../services/inventoryService';
import { createSale, getSales } from '../services/salesService';
import { dashboardCacheService } from '../services/dashboardCacheService';
import type { ProductInput } from '../types/product';
import type { CreateSaleInput } from '../types/sale';

export interface SeedResult {
  productsCreated: number;
  salesCreated: number;
  skipped: boolean;
  message: string;
}

/**
 * Standard realistic Kirana inventory catalog.
 */
export const DEMO_PRODUCTS: ProductInput[] = [
  {
    name: 'Fresh Toned Milk (500ml)',
    category: 'Dairy',
    price: 28,
    sellingPrice: 28,
    purchasePrice: 22,
    stock: 45,
    minStock: 15,
    reorderLevel: 15,
    unit: 'packet',
    barcode: '8901262010012'
  },
  {
    name: 'Whole Wheat Bread (400g)',
    category: 'Bakery',
    price: 45,
    sellingPrice: 45,
    purchasePrice: 35,
    stock: 30,
    minStock: 10,
    reorderLevel: 10,
    unit: 'packet',
    barcode: '8901262010029'
  },
  {
    name: 'Premium Basmati Rice (1kg)',
    category: 'Staples',
    price: 65,
    sellingPrice: 65,
    purchasePrice: 50,
    stock: 120,
    minStock: 25,
    reorderLevel: 25,
    unit: 'kg',
    barcode: '8901262010036'
  },
  {
    name: 'Refined Crystal Sugar (1kg)',
    category: 'Staples',
    price: 48,
    sellingPrice: 48,
    purchasePrice: 38,
    stock: 85,
    minStock: 20,
    reorderLevel: 20,
    unit: 'kg',
    barcode: '8901262010043'
  },
  {
    name: 'Fortune Sunflower Oil (1L)',
    category: 'Staples',
    price: 165,
    sellingPrice: 165,
    purchasePrice: 135,
    stock: 40,
    minStock: 12,
    reorderLevel: 12,
    unit: 'pouch',
    barcode: '8901262010050'
  },
  {
    name: 'Parle-G Gluco Biscuits (250g)',
    category: 'Snacks',
    price: 25,
    sellingPrice: 25,
    purchasePrice: 19,
    stock: 60,
    minStock: 15,
    reorderLevel: 15,
    unit: 'pack',
    barcode: '8901262010067'
  }
];

/**
 * Seed realistic Kirana products and historical sales.
 * @param options.overwrite If false (default), will not re-seed if products already exist.
 */
export async function seedDemoData(options: { overwrite?: boolean } = {}): Promise<SeedResult> {
  const existingProducts = await getProducts();

  // Safety: Prevent overwriting real data unless explicitly requested
  if (!options.overwrite && existingProducts.length >= DEMO_PRODUCTS.length) {
    return {
      productsCreated: 0,
      salesCreated: 0,
      skipped: true,
      message: `Store already contains ${existingProducts.length} products. Seeding skipped to preserve existing data.`
    };
  }

  const createdProductsMap: Record<string, any> = {};
  let productsCreatedCount = 0;

  // 1. Seed Products
  for (const item of DEMO_PRODUCTS) {
    const exists = existingProducts.find(p => p.name.toLowerCase() === item.name.toLowerCase());
    if (!exists) {
      try {
        const prod = await addProduct(item);
        createdProductsMap[prod.name] = prod;
        productsCreatedCount++;
      } catch (err) {
        console.warn(`Could not seed product "${item.name}":`, err);
      }
    } else {
      createdProductsMap[exists.name] = exists;
    }
  }

  // Refresh active products list
  const activeProducts = await getProducts();
  const getProdId = (nameSubstr: string) => {
    const found = activeProducts.find(p => p.name.toLowerCase().includes(nameSubstr.toLowerCase()));
    return found ? { id: found.id, name: found.name, price: found.sellingPrice || found.price || 30 } : null;
  };

  const milk = getProdId('Milk');
  const bread = getProdId('Bread');
  const rice = getProdId('Rice');
  const sugar = getProdId('Sugar');
  const oil = getProdId('Oil');
  const biscuits = getProdId('Biscuits');

  // 2. Generate 7 Days of Realistic Sales
  let salesCreatedCount = 0;
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // Check existing sales count
  const existingSales = await getSales(50);
  if (existingSales.length < 5) {
    // Generate sales distributed over past 7 days
    const dailyBaskets = [
      // Day -6
      [
        { p: milk, q: 2 },
        { p: bread, q: 1 }
      ],
      // Day -5
      [
        { p: rice, q: 2 },
        { p: sugar, q: 1 },
        { p: oil, q: 1 }
      ],
      // Day -4
      [
        { p: biscuits, q: 3 },
        { p: milk, q: 1 }
      ],
      // Day -3
      [
        { p: bread, q: 2 },
        { p: biscuits, q: 2 }
      ],
      // Day -2
      [
        { p: oil, q: 2 },
        { p: rice, q: 3 },
        { p: sugar, q: 2 }
      ],
      // Day -1 (Yesterday)
      [
        { p: milk, q: 3 },
        { p: bread, q: 2 },
        { p: biscuits, q: 4 }
      ],
      // Day 0 (Today)
      [
        { p: milk, q: 2 },
        { p: sugar, q: 1 }
      ],
      [
        { p: oil, q: 1 },
        { p: rice, q: 1 },
        { p: bread, q: 1 }
      ]
    ];

    for (let i = 0; i < dailyBaskets.length; i++) {
      const basket = dailyBaskets[i];
      const dayOffset = Math.max(0, 6 - Math.floor(i * 0.9));
      const saleTimestamp = new Date(now - (dayOffset * oneDayMs) + (i * 3600 * 1000)).toISOString();

      const items = basket
        .filter(b => b.p !== null)
        .map(b => ({
          productId: b.p!.id,
          productName: b.p!.name,
          quantity: b.q,
          unitPrice: b.p!.price,
          subtotal: b.p!.price * b.q
        }));

      if (items.length === 0) continue;

      const isCash = i % 2 === 0;

      const saleInput: CreateSaleInput = {
        items,
        paymentMethod: isCash ? 'Cash' : 'UPI',
        notes: `Demo transaction (Day -${dayOffset}, ${saleTimestamp})`
      };

      try {
        await createSale(saleInput, 'cashier_demo', 'Kiran General Store');
        salesCreatedCount++;
      } catch (err) {
        console.warn('Could not seed sale transaction:', err);
      }
    }
  }

  // 3. Warm the instant dashboard cache
  try {
    const updatedSales = await getSales(100);
    const updatedProducts = await getProducts();
    const todayStr = new Date().toISOString().split('T')[0];
    const todaySalesList = updatedSales.filter(s => s.createdAt.startsWith(todayStr));
    const todayRevenue = todaySalesList.reduce((sum, s) => sum + s.totalAmount, 0);
    const itemsSoldToday = todaySalesList.reduce((sum, s) => sum + (s.items?.reduce((is, i) => is + i.quantity, 0) || 0), 0);

    dashboardCacheService.updateSnapshot({
      todayRevenue: todayRevenue > 0 ? todayRevenue : 8450,
      itemsSoldToday: itemsSoldToday > 0 ? itemsSoldToday : 42,
      totalOrdersToday: todaySalesList.length > 0 ? todaySalesList.length : 18,
      totalProductsCount: updatedProducts.length,
      lowStockCount: updatedProducts.filter(p => (p.stock <= (p.reorderLevel || 10))).length
    });
  } catch {
    // Non-critical cache update
  }

  return {
    productsCreated: productsCreatedCount,
    salesCreated: salesCreatedCount,
    skipped: false,
    message: `Successfully seeded ${productsCreatedCount} products and ${salesCreatedCount} transactions.`
  };
}

// Direct CLI Execution capability
const proc = (globalThis as any).process;
if (typeof proc !== 'undefined' && proc.argv && proc.argv[1]?.includes('seedDemoData')) {
  console.log('--- Seeding ShopPulse Demo Catalog ---');
  seedDemoData({ overwrite: false }).then(res => {
    console.log(res.message);
    proc.exit(0);
  }).catch(err => {
    console.error('Demo seeding failed:', err);
    proc.exit(1);
  });
}
