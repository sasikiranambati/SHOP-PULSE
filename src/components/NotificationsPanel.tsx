import React, { useState, useEffect, useRef } from 'react';
import { 
  Bell, 
  X, 
  AlertTriangle, 
  CheckCircle2, 
  Check 
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useAlerts } from '../hooks/useAlerts';

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  setActivePage: (page: PageRoute) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

function formatAlertTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  } catch {
    return 'Recently';
  }
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  isOpen,
  onClose,
  setActivePage,
  triggerRef,
}) => {
  const [alertTab, setAlertTab] = useState<'unread' | 'all'>('unread');
  const panelRef = useRef<HTMLDivElement>(null);
  const { alerts, unreadCount, markAsRead, markAllAsRead } = useAlerts();

  // Close on Escape and return focus to bell trigger
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        triggerRef?.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, triggerRef]);

  // Click outside listener for desktop popover
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const panel = panelRef.current;
      const trigger = triggerRef?.current;
      if (
        panel && 
        !panel.contains(e.target as Node) && 
        trigger && 
        !trigger.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const displayedAlerts = alertTab === 'unread'
    ? alerts.filter(a => !a.isRead && !a.resolvedAt)
    : alerts;

  return (
    <>
      {/* Mobile backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-slate-900/20 sm:hidden" 
        onClick={onClose} 
        aria-hidden="true"
      />

      <div 
        ref={panelRef}
        id="notifications-panel" 
        role="region" 
        aria-label="Notifications" 
        className="fixed inset-x-2.5 top-15 sm:inset-x-auto sm:right-0 sm:top-12 w-auto sm:w-96 max-w-[calc(100vw-1.25rem)] bg-white rounded-xl border border-[#E3E5DE] shadow-dropdown p-3.5 z-50 animate-fade-in max-h-[75vh] sm:max-h-[480px] flex flex-col"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[#E3E5DE] mb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAlertTab('unread')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                alertTab === 'unread'
                  ? 'bg-[#234B3A] text-white shadow-xs'
                  : 'bg-[#F2EFE9] text-[#69736C] hover:bg-[#E5EEE6]'
              }`}
            >
              Unread ({unreadCount})
            </button>
            <button
              type="button"
              onClick={() => setAlertTab('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                alertTab === 'all'
                  ? 'bg-[#234B3A] text-white shadow-xs'
                  : 'bg-[#F2EFE9] text-[#69736C] hover:bg-[#E5EEE6]'
              }`}
            >
              All ({alerts.length})
            </button>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                className="text-[11px] font-semibold text-[#234B3A] hover:underline cursor-pointer"
              >
                Mark all read
              </button>
            )}
            <button 
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="text-[#69736C] hover:text-[#202923] cursor-pointer p-0.5 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2 overflow-y-auto pr-1 flex-1 max-h-[380px]">
          {displayedAlerts.slice(0, 15).map((alertItem) => {
            const isResolved = Boolean(alertItem.resolvedAt);
            const isCritical = alertItem.priority === 'critical' || alertItem.type === 'OUT_OF_STOCK';
            const isLowStock = alertItem.type === 'LOW_STOCK' || alertItem.priority === 'high';
            const timeAgo = formatAlertTime(alertItem.createdAt);

            return (
              <div
                key={alertItem.id}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
                onClick={() => {
                  if (!alertItem.isRead) markAsRead(alertItem.id);
                  onClose();
                  if (alertItem.type === 'LOW_STOCK' || alertItem.type === 'OUT_OF_STOCK') {
                    setActivePage('inventory');
                  } else {
                    setActivePage('dashboard');
                  }
                }}
                className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  isResolved
                    ? 'bg-[#E5EEE6]/60 border-[#52745D]/30 text-[#18382B]'
                    : !alertItem.isRead
                    ? isCritical
                      ? 'bg-[#FDF2F2] border-[#B93838]/30 text-[#B93838]'
                      : isLowStock
                      ? 'bg-[#FEF9EB] border-[#A66A16]/30 text-[#A66A16]'
                      : 'bg-[#F7F5EF] border-[#E3E5DE] text-[#202923]'
                    : 'bg-white border-[#E3E5DE] text-[#69736C] opacity-80 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between font-bold mb-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    {isResolved ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#287A4B] shrink-0" />
                    ) : isCritical ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#B93838] shrink-0" />
                    ) : isLowStock ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#A66A16] shrink-0" />
                    ) : (
                      <Bell className="w-3.5 h-3.5 text-[#234B3A] shrink-0" />
                    )}
                    <span className="truncate font-semibold">
                      {alertItem.title || alertItem.type.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {isResolved && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#E5EEE6] text-[#18382B] text-[9px] font-bold uppercase">
                        Resolved
                      </span>
                    )}
                    {!isResolved && isCritical && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#FDF2F2] text-[#B93838] text-[9px] font-bold uppercase">
                        Critical
                      </span>
                    )}
                    {!isResolved && !isCritical && isLowStock && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#FEF9EB] text-[#A66A16] text-[9px] font-bold uppercase">
                        Low Stock
                      </span>
                    )}
                    
                    {!alertItem.isRead && !isResolved && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(alertItem.id);
                        }}
                        title="Mark as read"
                        aria-label="Mark notification as read"
                        className="p-1 rounded-md bg-white hover:bg-[#F2EFE9] text-[#69736C] hover:text-[#234B3A] border border-[#E3E5DE] transition-all cursor-pointer flex items-center gap-1 text-[10px] font-semibold"
                      >
                        <Check className="w-3 h-3 text-[#287A4B]" />
                        <span className="hidden sm:inline">Read</span>
                      </button>
                    )}

                    <span className="text-[10px] text-[#69736C] font-normal ml-1">
                      {timeAgo}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] font-normal leading-relaxed mt-0.5 text-[#202923]">
                  {alertItem.message}
                </p>
              </div>
            );
          })}

          {displayedAlerts.length === 0 && (
            <div className="py-8 text-center text-[#69736C] space-y-1">
              <CheckCircle2 className="w-8 h-8 text-[#287A4B] mx-auto" />
              <p className="font-bold text-[#202923] text-xs">All caught up!</p>
              <p className="text-[11px] text-[#69736C]">
                {alertTab === 'unread' ? 'No unread notifications.' : 'No alerts recorded.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
