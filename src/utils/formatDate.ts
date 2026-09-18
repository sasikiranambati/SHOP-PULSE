/**
 * @file formatDate.ts
 * @description Date and timestamp formatting helpers for ShopPulse.
 * Belongs in `src/utils/formatDate.ts`.
 */

/**
 * Format an ISO date string or Date object into localized date string.
 * 
 * @param dateInput - ISO string or Date instance.
 * @param locale - BCP 47 language tag (default: 'en-IN').
 * @returns Formatted date string (e.g. "18 Sep 2026").
 */
export function formatDate(dateInput: string | Date, locale: string = 'en-IN'): string {
  if (!dateInput) return 'N/A';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return 'Invalid Date';

  return d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Format timestamp to clock time string (e.g. "10:25 AM").
 */
export function formatTime(dateInput: string | Date, locale: string = 'en-IN'): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format a past date as relative time string (e.g. "5 mins ago", "2 hours ago").
 */
export function formatRelativeTime(dateInput: string | Date): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} mins ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;

  return formatDate(d);
}
