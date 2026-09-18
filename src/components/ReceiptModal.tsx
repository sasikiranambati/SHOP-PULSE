import React from 'react';
import { X, Printer, Share2, Receipt as ReceiptIcon } from 'lucide-react';
import { Button } from './Button';
import type { Sale } from '../types/sale';
import { generateReceipt, generateReceiptWhatsAppUrl } from '../utils/receiptGenerator';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale | null;
  shopName?: string;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  shopName = 'Kiran General Store'
}) => {
  if (!isOpen || !sale) return null;

  const receipt = generateReceipt(sale, shopName);

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    const url = generateReceiptWhatsAppUrl(receipt);
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-extrabold text-base">
            <ReceiptIcon className="w-5 h-5 text-emerald-600" />
            <span>Digital Receipt</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Receipt Paper Card */}
        <div className="my-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 overflow-y-auto font-mono text-xs text-slate-800 space-y-2 shadow-inner">
          <div className="text-center border-b border-dashed border-slate-300 pb-2">
            <h4 className="font-black text-sm uppercase tracking-wide text-slate-900">{receipt.shopName}</h4>
            <p className="text-[10px] text-slate-500 font-medium">TAX INVOICE / CASH MEMO</p>
            <p className="text-[10px] font-bold text-emerald-800 mt-1 bg-emerald-100/60 py-0.5 px-2 rounded-full inline-block">
              {receipt.billNumber}
            </p>
          </div>

          <div className="text-[11px] text-slate-600 space-y-0.5 border-b border-dashed border-slate-300 pb-2">
            <div className="flex justify-between">
              <span>Date: {receipt.date}</span>
              <span>{receipt.time}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer: {receipt.customerName}</span>
              <span>Pay: <strong className="text-slate-900">{receipt.paymentMethod}</strong></span>
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-1.5 py-1 border-b border-dashed border-slate-300">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="flex items-start justify-between gap-1 text-[11px]">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 truncate">{item.name}</p>
                  <p className="text-[10px] text-slate-500">{item.quantity} × ₹{item.price}</p>
                </div>
                <span className="font-bold text-slate-900 shrink-0">₹{item.total}</span>
              </div>
            ))}
          </div>

          {/* Financials */}
          <div className="space-y-1 pt-1 text-[11px]">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span>₹{receipt.subtotal.toFixed(2)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Discount:</span>
                <span>-₹{receipt.discount.toFixed(2)}</span>
              </div>
            )}
            {receipt.tax > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Tax (GST):</span>
                <span>+₹{receipt.tax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-slate-900 pt-1 border-t border-slate-300">
              <span>TOTAL:</span>
              <span className="text-emerald-700">₹{receipt.total.toFixed(2)}</span>
            </div>
          </div>

          <div className="text-center pt-2 text-[10px] text-slate-400 border-t border-dashed border-slate-300">
            Thank you for shopping! Powered by ShopPulse
          </div>
        </div>

        {/* Modal Actions */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            icon={<Printer className="w-4 h-4" />}
            className="rounded-xl font-bold justify-center"
          >
            Print
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleWhatsAppShare}
            icon={<Share2 className="w-4 h-4" />}
            className="rounded-xl font-bold justify-center bg-emerald-600 hover:bg-emerald-700"
          >
            WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
};
