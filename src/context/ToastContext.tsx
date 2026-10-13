/**
 * @file ToastContext.tsx
 * @description Provider and on-screen region for success/error notifications.
 * Success and info messages are announced politely; errors use an assertive live region.
 * Messages are never shown before the operation they describe has finished.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  ToastContext,
  defaultToastDuration,
  type ToastApi,
  type ToastItem,
  type ToastOptions,
  type ToastTone,
} from './toastStore';

const MAX_VISIBLE = 4;

const TONE_STYLES: Record<ToastTone, { box: string; icon: React.ReactNode; label: string }> = {
  success: {
    box: 'bg-white border-emerald-300 text-slate-900',
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />,
    label: 'Success',
  },
  error: {
    box: 'bg-white border-rose-300 text-slate-900',
    icon: <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />,
    label: 'Error',
  },
  info: {
    box: 'bg-white border-slate-300 text-slate-900',
    icon: <Info className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />,
    label: 'Notice',
  },
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  const style = TONE_STYLES[toast.tone];
  return (
    <div
      className={`pointer-events-auto w-full rounded-2xl border shadow-lg px-3.5 py-3 flex items-start gap-2.5 animate-fade-in ${style.box}`}
    >
      {style.icon}
      <div className="min-w-0 flex-1 text-sm">
        {/* The visually hidden prefix tells screen-reader users the tone without relying on colour */}
        <p className="font-bold leading-snug">
          <span className="sr-only">{style.label}: </span>
          {toast.message}
        </p>
        {toast.description && <p className="text-xs text-slate-600 mt-0.5 break-words">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            className="mt-2 text-xs font-black text-emerald-700 hover:text-emerald-900 underline underline-offset-2 cursor-pointer"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="p-1 -m-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const duration = options.durationMs ?? defaultToastDuration(tone, Boolean(options.action));
      setToasts((prev) => [...prev, { id, tone, message, ...options }].slice(-MAX_VISIBLE));
      if (duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      info: (message, options) => push('info', message, options),
      dismiss,
    }),
    [push, dismiss]
  );

  const politeToasts = toasts.filter((t) => t.tone !== 'error');
  const errorToasts = toasts.filter((t) => t.tone === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="no-print fixed z-[70] inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-auto md:top-20 md:left-auto md:right-6 md:w-96 flex flex-col gap-2 pointer-events-none"
      >
        <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {errorToasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {politeToasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
};
