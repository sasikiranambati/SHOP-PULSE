import React from 'react';
import type { Product, Sale } from '../types';
import type { PurchaseBackend } from '../api/purchases';
import { formatCurrency } from '../utils/formatCurrency';

/**
 * Print-only documents. They only display values that already exist on the record; amounts are
 * formatted, never recalculated, and a value that was not recorded prints as "—" rather than ₹0.
 */

const money = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : formatCurrency(Number(value));

const dateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const DocHeader: React.FC<{ shopName: string; title: string; meta?: React.ReactNode }> = ({ shopName, title, meta }) => (
  <header className="print-doc-header">
    <div>
      <p className="print-shop">{shopName}</p>
      <h1 className="print-title">{title}</h1>
    </div>
    {meta && <div className="print-meta">{meta}</div>}
  </header>
);

const Footer: React.FC = () => (
  <footer className="print-footer">Printed {dateTime(new Date().toISOString())} · ShopPulse</footer>
);

export const SaleReceiptDocument: React.FC<{ sale: Sale; shopName: string }> = ({ sale, shopName }) => (
  <article className="print-doc print-doc--receipt">
    <DocHeader
      shopName={shopName}
      title="Tax Invoice / Cash Memo"
      meta={
        <dl>
          <div><dt>Bill No.</dt><dd>{sale.billNumber}</dd></div>
          <div><dt>Date</dt><dd>{dateTime(sale.createdAt)}</dd></div>
          <div><dt>Customer</dt><dd>{sale.customerName || 'Counter Customer'}</dd></div>
          <div><dt>Payment</dt><dd>{String(sale.paymentMethod)}</dd></div>
        </dl>
      }
    />
    <table className="print-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Item</th>
          <th scope="col" className="num">Qty</th>
          <th scope="col" className="num">Rate</th>
          <th scope="col" className="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        {sale.items.map((item, idx) => (
          <tr key={`${item.productId}-${idx}`}>
            <td>{idx + 1}</td>
            <td className="wrap">{item.name}</td>
            <td className="num">{item.quantity} {item.unit && item.unit !== 'pcs' ? item.unit : ''}</td>
            <td className="num">{money(item.price)}</td>
            <td className="num">{money(item.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr><th scope="row" colSpan={4} className="num">Subtotal</th><td className="num">{money(sale.subtotal)}</td></tr>
        {sale.discount > 0 && (
          <tr><th scope="row" colSpan={4} className="num">Discount</th><td className="num">−{money(sale.discount)}</td></tr>
        )}
        {sale.tax > 0 && (
          <tr><th scope="row" colSpan={4} className="num">Tax (GST)</th><td className="num">{money(sale.tax)}</td></tr>
        )}
        <tr className="grand"><th scope="row" colSpan={4} className="num">Total</th><td className="num">{money(sale.total ?? sale.totalAmount)}</td></tr>
      </tfoot>
    </table>
    <p className="print-note">Thank you for shopping with us.</p>
    <Footer />
  </article>
);

export const PurchaseRecordDocument: React.FC<{ purchase: PurchaseBackend; shopName: string }> = ({ purchase, shopName }) => (
  <article className="print-doc">
    <DocHeader
      shopName={shopName}
      title="Purchase Record (Supplier Invoice)"
      meta={
        <dl>
          <div><dt>Supplier</dt><dd>{purchase.supplier_name || '—'}</dd></div>
          <div><dt>Invoice No.</dt><dd>{purchase.invoice_number || '—'}</dd></div>
          <div><dt>Invoice Date</dt><dd>{purchase.invoice_date || '—'}</dd></div>
          <div><dt>Recorded</dt><dd>{dateTime(purchase.created_at)}</dd></div>
        </dl>
      }
    />
    <table className="print-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Product</th>
          <th scope="col" className="num">Qty</th>
          <th scope="col">Unit</th>
          <th scope="col" className="num">Purchase Price</th>
          <th scope="col" className="num">MRP</th>
          <th scope="col" className="num">Line Amount</th>
        </tr>
      </thead>
      <tbody>
        {purchase.items.map((item, idx) => (
          <tr key={item.id}>
            <td>{idx + 1}</td>
            <td className="wrap">{item.product_name || 'Product no longer in catalog'}</td>
            <td className="num">{item.quantity}</td>
            <td>{item.product_unit || '—'}</td>
            <td className="num">{money(item.purchase_price)}</td>
            <td className="num">{money(item.mrp)}</td>
            <td className="num">{money(item.line_amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="grand">
          <th scope="row" colSpan={6} className="num">Recorded total</th>
          <td className="num">{money(purchase.total_amount)}</td>
        </tr>
      </tfoot>
    </table>
    <p className="print-note">Line amounts are as recorded from the supplier invoice; "—" means the amount was not recorded.</p>
    <Footer />
  </article>
);

export const InventoryReportDocument: React.FC<{ products: Product[]; shopName: string; filterLabel: string }> = ({
  products,
  shopName,
  filterLabel,
}) => {
  const lowStock = products.filter((p) => p.status !== 'In Stock').length;
  return (
    <article className="print-doc print-doc--wide">
      <DocHeader
        shopName={shopName}
        title="Stock Report"
        meta={
          <dl>
            <div><dt>Products</dt><dd>{products.length}</dd></div>
            <div><dt>Need attention</dt><dd>{lowStock}</dd></div>
            <div><dt>Showing</dt><dd>{filterLabel}</dd></div>
          </dl>
        }
      />
      <table className="print-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">SKU / Barcode</th>
            <th scope="col">Category</th>
            <th scope="col" className="num">Stock</th>
            <th scope="col" className="num">Purchase Price</th>
            <th scope="col" className="num">Selling Price</th>
            <th scope="col" className="num">MRP</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td className="wrap">{p.name}</td>
              <td className="wrap">{p.barcode || '—'}</td>
              <td>{p.category}</td>
              <td className="num">{p.stock} {p.unit}</td>
              {/* 0 means the purchase price was never recorded */}
              <td className="num">{p.purchasePrice > 0 ? money(p.purchasePrice) : '—'}</td>
              <td className="num">{money(p.sellingPrice ?? p.price)}</td>
              <td className="num">{money(p.mrp)}</td>
              <td>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Footer />
    </article>
  );
};

export const SalesReportDocument: React.FC<{
  sales: Sale[];
  shopName: string;
  filterLabel: string;
  totals: { revenue: number; items: number; count: number };
}> = ({ sales, shopName, filterLabel, totals }) => (
  <article className="print-doc print-doc--wide">
    <DocHeader
      shopName={shopName}
      title="Sales Report"
      meta={
        <dl>
          <div><dt>Bills</dt><dd>{totals.count}</dd></div>
          <div><dt>Items sold</dt><dd>{totals.items}</dd></div>
          <div><dt>Revenue</dt><dd>{money(totals.revenue)}</dd></div>
          <div><dt>Showing</dt><dd>{filterLabel}</dd></div>
        </dl>
      }
    />
    <table className="print-table">
      <thead>
        <tr>
          <th scope="col">Bill No.</th>
          <th scope="col">Date &amp; Time</th>
          <th scope="col">Items</th>
          <th scope="col">Payment</th>
          <th scope="col" className="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((sale) => (
          <tr key={sale.id}>
            <td>{sale.billNumber}</td>
            <td>{dateTime(sale.createdAt)}</td>
            <td className="wrap">{sale.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}</td>
            <td>{String(sale.paymentMethod)}</td>
            <td className="num">{money(sale.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="grand"><th scope="row" colSpan={4} className="num">Total revenue</th><td className="num">{money(totals.revenue)}</td></tr>
      </tfoot>
    </table>
    <Footer />
  </article>
);
