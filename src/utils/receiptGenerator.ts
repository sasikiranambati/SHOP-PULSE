/**
 * @file receiptGenerator.ts
 * @description Receipt generator and formatting utilities for ShopPulse POS.
 */

import type { Sale, ReceiptData } from '../types/sale';

/**
 * Format a completed Sale into a clean ReceiptData object.
 */
export function generateReceipt(sale: Sale, shopName: string = 'Kiran General Store'): ReceiptData {
  const saleDate = new Date(sale.createdAt);

  const formattedDate = saleDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const formattedTime = saleDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  return {
    shopName,
    billNumber: sale.billNumber,
    date: formattedDate,
    time: formattedTime,
    customerName: sale.customerName || 'Counter Customer',
    items: sale.items,
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total ?? sale.totalAmount,
    paymentMethod: String(sale.paymentMethod).toUpperCase(),
    cashierId: sale.cashierId || 'Staff'
  };
}

/**
 * Generate formatted plain-text receipt (suitable for thermal printers, clipboard, or SMS/WhatsApp sharing).
 */
export function formatReceiptText(receipt: ReceiptData): string {
  const line = '--------------------------------';
  const doubleLine = '================================';

  const header = [
    receipt.shopName.toUpperCase(),
    'TAX INVOICE / CASH MEMO',
    doubleLine,
    `Bill No: ${receipt.billNumber}`,
    `Date   : ${receipt.date} ${receipt.time}`,
    `Customer: ${receipt.customerName || 'Walk-in'}`,
    `Payment: ${receipt.paymentMethod}`,
    line,
    'ITEM              QTY  RATE   TOTAL',
    line
  ];

  const itemLines = receipt.items.map(item => {
    const name = item.name.length > 15 ? item.name.substring(0, 14) + '…' : item.name.padEnd(16, ' ');
    const qty = String(item.quantity).padStart(3, ' ');
    const price = `₹${item.price}`.padStart(6, ' ');
    const total = `₹${item.total}`.padStart(7, ' ');
    return `${name} ${qty} ${price} ${total}`;
  });

  const footer = [
    line,
    `Subtotal:                 ₹${receipt.subtotal.toFixed(2)}`,
    receipt.discount > 0 ? `Discount:                -₹${receipt.discount.toFixed(2)}` : null,
    receipt.tax > 0 ? `Tax (GST):               +₹${receipt.tax.toFixed(2)}` : null,
    doubleLine,
    `GRAND TOTAL:              ₹${receipt.total.toFixed(2)}`,
    doubleLine,
    'Thank You! Visit Again!',
    'Powered by ShopPulse'
  ].filter(Boolean);

  return [...header, ...itemLines, ...footer].join('\n');
}

/**
 * Generate WhatsApp share URL for digital receipt delivery.
 */
export function generateReceiptWhatsAppUrl(receipt: ReceiptData, phoneNumber?: string): string {
  const text = encodeURIComponent(formatReceiptText(receipt));
  const phoneParam = phoneNumber ? `phone=${phoneNumber.replace(/\D/g, '')}&` : '';
  return `https://api.whatsapp.com/send?${phoneParam}text=${text}`;
}
