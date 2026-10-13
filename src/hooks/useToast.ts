/**
 * @file useToast.ts
 * @description Access the app-wide notification API (success, error, info).
 */

import { useContext } from 'react';
import { ToastContext, type ToastApi } from '../context/toastStore';

const noop = () => 0;

// Outside a provider (e.g. isolated component tests) notifications are silently skipped.
const fallback: ToastApi = { success: noop, error: noop, info: noop, dismiss: () => {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? fallback;
}
