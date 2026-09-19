/**
 * @file errorHandler.ts
 * @description Centralized error classification and recovery service for ShopPulse.
 * Normalizes Firestore, Network, Auth, and Storage errors into actionable messages
 * with recommended recovery strategies (e.g. offline queueing, session renewal).
 */

import { getFirebaseErrorMessage } from './firebaseErrorMapper';

export type ErrorCategory = 'NETWORK' | 'FIRESTORE' | 'AUTH' | 'STORAGE' | 'VALIDATION' | 'UNKNOWN';

export interface AppError {
  category: ErrorCategory;
  code: string;
  originalMessage: string;
  userMessage: string;
  isRetryable: boolean;
  recoveryAction?: string;
}

/**
 * Categorize and format any error thrown across ShopPulse services.
 */
export function handleAppError(error: unknown): AppError {
  if (!error) {
    return {
      category: 'UNKNOWN',
      code: 'unknown/none',
      originalMessage: 'An unknown error occurred.',
      userMessage: 'Something went wrong. Please try again.',
      isRetryable: true
    };
  }

  const err = error as any;
  const code: string = String(err.code || err.name || 'UNKNOWN');
  const message: string = String(err.message || err.toString());

  // 1. Network / Offline Errors
  if (
    code.includes('unavailable') ||
    code.includes('network-request-failed') ||
    code.includes('offline') ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('offline') ||
    message.toLowerCase().includes('failed to fetch')
  ) {
    return {
      category: 'NETWORK',
      code: code || 'network/offline',
      originalMessage: message,
      userMessage: 'Internet connection unavailable. Your transactions and updates are safely saved locally.',
      isRetryable: true,
      recoveryAction: 'Changes are queued locally and will sync automatically when connection returns.'
    };
  }

  // 2. Authentication Errors
  if (code.startsWith('auth/') || message.toLowerCase().includes('auth') || code === 'unauthenticated') {
    return {
      category: 'AUTH',
      code,
      originalMessage: message,
      userMessage: getFirebaseErrorMessage(code),
      isRetryable: false,
      recoveryAction: 'Please log in again or check your email and password.'
    };
  }

  // 3. Firestore Permission / Quota Errors
  if (code.includes('permission-denied') || message.toLowerCase().includes('permission denied')) {
    return {
      category: 'FIRESTORE',
      code: 'firestore/permission-denied',
      originalMessage: message,
      userMessage: 'You do not have permission to access or modify this store data.',
      isRetryable: false,
      recoveryAction: 'Ensure you are signed in with the correct store credentials.'
    };
  }

  if (code.includes('resource-exhausted') || message.toLowerCase().includes('quota')) {
    return {
      category: 'FIRESTORE',
      code: 'firestore/resource-exhausted',
      originalMessage: message,
      userMessage: 'Database usage limit reached temporarily. Switched to high-speed local cache.',
      isRetryable: true,
      recoveryAction: 'Local cached copy is active.'
    };
  }

  // 4. Validation Errors
  if (message.toLowerCase().includes('insufficient stock') || message.toLowerCase().includes('invalid')) {
    return {
      category: 'VALIDATION',
      code: 'validation/error',
      originalMessage: message,
      userMessage: message,
      isRetryable: false,
      recoveryAction: 'Please review and adjust input quantities or values.'
    };
  }

  // 5. Default Fallback
  return {
    category: 'UNKNOWN',
    code,
    originalMessage: message,
    userMessage: getFirebaseErrorMessage(code) || message || 'An unexpected error occurred.',
    isRetryable: true,
    recoveryAction: 'If this issue persists, please refresh the page.'
  };
}

/**
 * Quick helper to check if an error is network-related.
 */
export function isOfflineOrNetworkError(error: unknown): boolean {
  return handleAppError(error).category === 'NETWORK';
}
