import React, { useId } from 'react';
import { X, Printer, Share2, Receipt as ReceiptIcon } from 'lucide-react';
import { Button } from './Button';
import { PrintPortal } from './PrintPortal';
import { SaleReceiptDocument } from './PrintDocuments';
import { useDialog } from '../hooks/useDialog';
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
  const titleId = useId();
  const panelRef = useDialog<HTMLDivElement>({ isOpen: isOpen && Boolean(sale), onClose });

  if (!isOpen || !sale) return null;

  const receipt = generateReceipt(sale, shopName);

  // While this dialog is open, printing outputs only the receipt document below.
  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    const url = generateReceiptWhatsAppUrl(receipt);
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#141E18]/60 backdrop-blur-xs" onClick={onClose}>
      <div 
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-[#E3E5DE] animate-in zoom-in-95 duration-150 flex flex-col max-h-[90dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#E3E5DE]">
          <div className="flex items-center gap-2.5 text-[#202923] font-bold text-base">
            <div className="w-8 h-8 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <ReceiptIcon className="w-4 h-4" />
            </div>
            <h2 id={titleId}>Digital Receipt</h2>
          </div>
          <button 
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#69736C] hover:text-[#202923] hover:bg-[#F7F5EF] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt Paper Card */}
        <div className="my-3 p-4 bg-[#F7F5EF]/60 rounded-xl border border-[#E3E5DE] overflow-y-auto font-mono text-xs text-[#202923] space-y-2 shadow-inner">
          <div className="text-center border-b border-dashed border-[#E3E5DE] pb-2">
            <h4 className="font-black text-sm uppercase tracking-wide text-[#202923]">{receipt.shopName}</h4>
            <p className="text-[10px] text-[#69736C] font-medium">TAX INVOICE / CASH MEMO</p>
            <p className="text-[10px] font-bold text-[#234B3A] mt-1 bg-[#E5EEE6] py-0.5 px-2.5 rounded-full inline-block border border-[#234B3A]/25">
              {receipt.billNumber}
            </p>
          </div>

          <div className="text-[11px] text-[#69736C] space-y-0.5 border-b border-dashed border-[#E3E5DE] pb-2">
            <div className="flex justify-between">
              <span>Date: {receipt.date}</span>
              <span>{receipt.time}</span>
            </div>
            <div className="flex justify-between">
              <span>Customer: {receipt.customerName}</span>
              <span>Pay: <strong className="text-[#202923]">{receipt.paymentMethod}</strong></span>
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-1.5 py-1 border-b border-dashed border-[#E3E5DE]">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="flex items-start justify-between gap-1 text-[11px]">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#202923] truncate">{item.name}</p>
                  <p className="text-[10px] text-[#69736C]">{item.quantity} × ₹{item.price}</p>
                </div>
                <span className="font-bold text-[#202923] shrink-0">₹{item.total}</span>
              </div>
            ))}
          </div>

          {/* Financials */}
          <div className="space-y-1 pt-1 text-[11px]">
            <div className="flex justify-between text-[#69736C]">
              <span>Subtotal:</span>
              <span>₹{receipt.subtotal.toFixed(2)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between text-[#B93838] font-semibold">
                <span>Discount:</span>
                <span>-₹{receipt.discount.toFixed(2)}</span>
              </div>
            )}
            {receipt.tax > 0 && (
              <div className="flex justify-between text-[#69736C]">
                <span>Tax (GST):</span>
                <span>+₹{receipt.tax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-[#202923] pt-1 border-t border-[#E3E5DE]">
              <span>TOTAL:</span>
              <span className="text-[#234B3A]">₹{receipt.total.toFixed(2)}</span>
            </div>
          </div>

          <div className="text-center pt-2 text-[10px] text-[#69736C] border-t border-dashed border-[#E3E5DE]">
            Thank you for shopping! Powered by ShopPulse
          </div>
        </div>

        {/* Modal Actions */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E3E5DE]">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            icon={<Printer className="w-4 h-4" />}
            className="rounded-lg font-bold justify-center border-[#E3E5DE] text-[#202923] hover:bg-[#F7F5EF]"
          >
            Print
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleWhatsAppShare}
            icon={<Share2 className="w-4 h-4" />}
            className="rounded-lg font-bold justify-center bg-[#234B3A] hover:bg-[#1D3E30] text-white"
          >
            WhatsApp
          </Button>
        </div>
      </div>

      <PrintPortal label="Receipt print view">
        <SaleReceiptDocument sale={sale} shopName={shopName} />
      </PrintPortal>
    </div>
  );
};
