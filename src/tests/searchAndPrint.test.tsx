/**
 * Global search list behaviour and print documents.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupSearchResults, flattenSearchGroups, nextActiveIndex, searchOptionDomId } from '../utils/searchResults';
import { searchApi, type SearchResults } from '../api/search';
import { PurchaseRecordDocument, SaleReceiptDocument, InventoryReportDocument } from '../components/PrintDocuments';
import type { Product, Sale } from '../types';

afterEach(() => vi.unstubAllGlobals());

const results: SearchResults = {
  query: 'milk',
  products: [
    { id: 'p1', name: 'Amul Milk', category: 'Dairy', sku: null, unit: 'pkts', current_stock: 4, selling_price: 28 },
    { id: 'p2', name: 'Milky Mist', category: 'Dairy', sku: null, unit: 'pcs', current_stock: 9, selling_price: 90 },
  ],
  purchases: [],
  sales: [{ id: 's1', bill_number: 'SP-1A2B3C4D', total_amount: 56, payment_method: 'cash', item_count: 2, matched_product: 'Amul Milk' }],
  totals: { products: 7, purchases: 0, sales: 1 },
};

describe('search results list', () => {
  it('groups results in a fixed order and drops empty groups', () => {
    const groups = groupSearchResults(results);
    expect(groups.map((g) => g.key)).toEqual(['product', 'sale']);
    expect(groups[0].total).toBe(7);
    expect(flattenSearchGroups(groups).map((o) => o.id)).toEqual(['p1', 'p2', 's1']);
  });

  it('returns no groups when there are no results', () => {
    expect(groupSearchResults(null)).toEqual([]);
    expect(groupSearchResults({ ...results, products: [], sales: [] })).toEqual([]);
  });

  it('moves the active option with arrow keys, wrapping at both ends', () => {
    expect(nextActiveIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(nextActiveIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(1, 'Home', 3)).toBe(0);
    expect(nextActiveIndex(1, 'End', 3)).toBe(2);
    expect(nextActiveIndex(0, 'ArrowDown', 0)).toBe(-1);
  });

  it('gives every option a unique DOM id for aria-activedescendant', () => {
    const ids = flattenSearchGroups(groupSearchResults(results)).map(searchOptionDomId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sends the query to the server instead of filtering locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(results), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    await searchApi.search('Milk & Bread', { limit: 5 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/v1/search?');
    expect(url).toContain('q=Milk+%26+Bread');
    expect(url).toContain('limit=5');
  });
});

describe('print documents', () => {
  it('prints a purchase record with "—" for amounts that were not recorded', () => {
    const html = renderToStaticMarkup(
      <PurchaseRecordDocument
        shopName="Gupta Kirana"
        purchase={{
          id: 'pu1',
          shop_id: 's',
          supplier_name: 'Sri Balaji Traders',
          invoice_number: 'SBW-1021',
          invoice_date: '05/10/2026',
          total_amount: 1680,
          created_at: '2026-10-05T10:00:00Z',
          items: [
            { id: 'i1', purchase_id: 'pu1', product_id: 'p1', quantity: 12, purchase_price: 140, product_name: 'Sunflower Oil 1L', line_amount: 1680, mrp: null },
            { id: 'i2', purchase_id: 'pu1', product_id: 'p2', quantity: 5, purchase_price: 30, product_name: 'Salt', line_amount: null, mrp: null },
          ],
        }}
      />
    );
    expect(html).toContain('SBW-1021');
    expect(html).toContain('Sri Balaji Traders');
    expect(html).toContain('Sunflower Oil 1L');
    expect(html).toContain('<thead>');
    // The missing line amount and MRP are shown as unknown, never as ₹0.00
    expect(html).not.toContain('₹0.00');
    expect(html).toContain('—');
  });

  it('prints a sales receipt with every line and the recorded total', () => {
    const sale = {
      id: 's1', billNumber: 'SP-1A2B3C4D', customerName: 'Counter Customer', paymentMethod: 'UPI',
      items: [{ productId: 'p1', name: 'Amul Milk', quantity: 2, unit: 'pkts', price: 28, total: 56 }],
      subtotal: 56, discount: 0, tax: 0, total: 56, createdAt: '2026-10-05T10:00:00Z',
    } as unknown as Sale;
    const html = renderToStaticMarkup(<SaleReceiptDocument sale={sale} shopName="Gupta Kirana" />);
    expect(html).toContain('SP-1A2B3C4D');
    expect(html).toContain('Amul Milk');
    expect(html).toContain('56.00');
  });

  it('prints an unrecorded purchase price in the stock report as "—"', () => {
    const product = {
      id: 'p1', name: 'Parle-G', category: 'Snacks', stock: 3, unit: 'pkts', sellingPrice: 10, price: 10,
      purchasePrice: 0, reorderLevel: 5, minStock: 5, status: 'Low Stock', createdAt: '', updatedAt: '',
    } as Product;
    const html = renderToStaticMarkup(<InventoryReportDocument products={[product]} shopName="Shop" filterLabel="All categories" />);
    expect(html).toContain('Parle-G');
    expect(html).toContain('₹10.00');
    expect(html).not.toContain('₹0.00');
  });
});
