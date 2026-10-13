/**
 * @file toastStore.ts
 * @description Types and React context for app-wide success/error notifications.
 */

import { createContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Optional second line with detail (never a stack trace). */
  description?: string;
  /** Optional button, e.g. "Retry". */
  action?: ToastAction;
  /** Milliseconds before auto-dismiss; 0 keeps the toast until dismissed. */
  durationMs?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => number;
  error: (message: string, options?: ToastOptions) => number;
  info: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Default display time per tone: errors stay longer, toasts with an action longer still. */
export function defaultToastDuration(tone: ToastTone, hasAction: boolean): number {
  if (hasAction) return 10000;
  return tone === 'error' ? 8000 : 4500;
}
