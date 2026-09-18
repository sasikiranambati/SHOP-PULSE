/**
 * @file formatCurrency.ts
 * @description Currency and number formatting helper functions for ShopPulse.
 * Belongs in `src/utils/formatCurrency.ts`.
 */

/**
 * Format a numeric value as currency (e.g. ₹4,850.00 or $45.00).
 * 
 * @param amount - The numeric amount to format.
 * @param currency - The ISO currency code (default: 'INR').
 * @param locale - BCP 47 language tag (default: 'en-IN').
 * @returns Formatted currency string.
 */
export function formatCurrency(
  amount: number, 
  currency: string = 'INR', 
  locale: string = 'en-IN'
): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '₹0.00';
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }).format(amount);
  } catch (_err) {
    return `₹${amount.toFixed(2)}`;
  }

}

/**
 * Format large numbers into compact human-readable strings (e.g. 1.2K, 3.4M).
 * 
 * @param num - The number to format.
 * @returns Compact formatted string.
 */
export function formatCompactNumber(num: number): string {
  if (isNaN(num)) return '0';
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    compactDisplay: 'short'
  }).format(num);
}
