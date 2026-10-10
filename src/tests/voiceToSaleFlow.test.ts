/**
 * @file voiceToSaleFlow.test.ts
 * @description Frontend End-to-End Test for Voice-to-Bill connecting to Sales Checkout.
 * Verifies:
 * 1. Multilingual voice recognition & matching.
 * 2. Cart conversion from recognized voice items.
 * 3. Sales submission & receipt generation.
 * 4. UI event notifications (shoppulse_sales_changed, shoppulse_inventory_changed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseMultilingualVoiceBill } from '../utils/multilingualVoiceParser';
import { INITIAL_PRODUCTS } from '../data/mockData';
import { createSale, recordSale } from '../services/salesService';
import { salesApi } from '../api/sales';
import type { Product } from '../types';

// Node.js environment polyfill for event listeners
if (typeof window === 'undefined') {
  const listeners: Record<string, Function[]> = {};
  (global as any).window = {
    addEventListener: (type: string, cb: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(cb);
    },
    removeEventListener: (type: string, cb: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(fn => fn !== cb);
      }
    },
    dispatchEvent: (event: any) => {
      const cbs = listeners[event.type] || [];
      cbs.forEach(cb => cb(event));
      return true;
    }
  };
  (global as any).CustomEvent = class {
    constructor(public type: string, public detail?: any) {}
  };
}

describe('Voice-to-Bill to Sales Checkout Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes multilingual voice items, converts to cart, and records sale successfully', async () => {
    // Mock the backend salesApi.createSale endpoint
    const mockBackendSale = {
      id: 'sale-voice-1234',
      shop_id: 'shop-kirana-1',
      total_amount: 140,
      payment_method: 'upi',
      items: [
        {
          id: 'item-1',
          sale_id: 'sale-voice-1234',
          product_id: INITIAL_PRODUCTS[0].id,
          quantity: 2,
          unit_price: INITIAL_PRODUCTS[0].sellingPrice ?? INITIAL_PRODUCTS[0].price,
        }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const createSaleSpy = vi.spyOn(salesApi, 'createSale').mockResolvedValue(mockBackendSale);

    // Track dispatched window events
    const dispatchedEvents: string[] = [];
    const eventListener = (e: any) => dispatchedEvents.push(e.type);
    window.addEventListener('shoppulse_sales_changed', eventListener);
    window.addEventListener('shoppulse_inventory_changed', eventListener);

    // 1. Spoken input in Telugu: "రెండు కిలోల బియ్యం" (2 kg Rice)
    const teluguSpoken = 'రెండు కిలోల బియ్యం';
    const voiceResult = parseMultilingualVoiceBill(teluguSpoken, INITIAL_PRODUCTS, 'telugu');

    expect(voiceResult.matched_items.length).toBeGreaterThan(0);
    const matched = voiceResult.matched_items[0];
    expect(matched.quantity).toBe(2);

    // 2. Map recognized voice items to Cart items (as done in VoiceBillModal)
    const matchedProduct = INITIAL_PRODUCTS.find(p => p.id === matched.product_id) ||
                           INITIAL_PRODUCTS.find(p => p.name.toLowerCase() === matched.name.toLowerCase());
    expect(matchedProduct).toBeDefined();

    const cart = [
      {
        product: matchedProduct as Product,
        quantity: matched.quantity
      }
    ];

    // 3. Complete Sale / Checkout (as done in Sales.tsx handleCompleteSale)
    const { sale, receipt } = await recordSale({
      items: cart.map(item => ({
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.product.sellingPrice ?? item.product.price,
        unit: item.product.unit
      })),
      paymentMethod: 'UPI',
      customerName: 'Voice Customer Ramesh'
    }, 'cashier_01', 'ShopPulse Kirana Store');

    // 4. Verify API called with mapped items
    expect(createSaleSpy).toHaveBeenCalledTimes(1);
    expect(createSaleSpy).toHaveBeenCalledWith({
      items: [
        {
          product_id: matchedProduct!.id,
          quantity: 2,
          unit_price: matchedProduct!.sellingPrice ?? matchedProduct!.price
        }
      ],
      payment_method: 'upi'
    });

    // 5. Verify mapped sale and receipt
    expect(sale.id).toBe('sale-voice-1234');
    expect(sale.customerName).toBe('Voice Customer Ramesh');
    expect(receipt).toBeDefined();
    expect(receipt.billNumber).toMatch(/^SP-/);
    expect(receipt.items.length).toBe(1);

    // 6. Verify UI event notifications were triggered
    expect(dispatchedEvents).toContain('shoppulse_sales_changed');
    expect(dispatchedEvents).toContain('shoppulse_inventory_changed');

    // Cleanup listeners
    window.removeEventListener('shoppulse_sales_changed', eventListener);
    window.removeEventListener('shoppulse_inventory_changed', eventListener);
  });

  it('handles multi-item voice bill with English and Indian units', async () => {
    const mockBackendSale = {
      id: 'sale-voice-multi',
      shop_id: 'shop-kirana-1',
      total_amount: 156,
      payment_method: 'cash',
      items: [
        {
          id: 'item-1',
          sale_id: 'sale-voice-multi',
          product_id: 'prod-salt',
          quantity: 2,
          unit_price: 28,
        },
        {
          id: 'item-2',
          sale_id: 'sale-voice-multi',
          product_id: 'prod-parle',
          quantity: 10,
          unit_price: 10,
        }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(salesApi, 'createSale').mockResolvedValue(mockBackendSale);

    const testCatalog: Product[] = [
      {
        id: 'prod-salt',
        name: 'Tata Salt 1kg',
        price: 28,
        sellingPrice: 28,
        purchasePrice: 22,
        stock: 50,
        reorderLevel: 10,
        minStock: 10,
        category: 'Staples',
        unit: 'pkt'
      },
      {
        id: 'prod-parle',
        name: 'Parle-G',
        price: 10,
        sellingPrice: 10,
        purchasePrice: 8,
        stock: 100,
        reorderLevel: 20,
        minStock: 20,
        category: 'Snacks',
        unit: 'pack'
      }
    ];

    const voiceText = '2 Tata Salt and 10 Parle-G';
    const parsed = parseMultilingualVoiceBill(voiceText, testCatalog, 'english');

    expect(parsed.matched_items.length).toBe(2);
    expect(parsed.matched_items[0].quantity).toBe(2);
    expect(parsed.matched_items[1].quantity).toBe(10);

    const sale = await createSale({
      items: parsed.matched_items.map(m => ({
        productId: m.product_id,
        name: m.name,
        quantity: m.quantity,
        price: m.unit_price,
        unit: m.unit
      })),
      paymentMethod: 'Cash'
    });

    expect(sale.id).toBe('sale-voice-multi');
    expect(sale.total).toBe(156);
  });
});
