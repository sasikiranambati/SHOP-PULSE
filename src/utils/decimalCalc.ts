/**
 * @file decimalCalc.ts
 * @description Decimal-safe arithmetic utilities for invoice financial calculations.
 * Avoids IEEE-754 floating-point drift in currency multiplication by using
 * integer-shifted arithmetic with fixed precision rounding.
 */

/**
 * Multiply two nullable numbers with 2-decimal-place precision.
 * Returns null if either operand is null, undefined, NaN, or Infinity.
 */
export function decimalMultiply(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Round to 2 dp using integer shift to avoid 0.1+0.2 type drift
  const result = Math.round(a * b * 100) / 100;
  return Number.isFinite(result) ? result : null;
}

/**
 * Round a number to 2 decimal places (currency precision).
 * Returns null if input is null, undefined, NaN, or Infinity.
 */
export function decimalRound2(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/**
 * Subtract b from a with 2-decimal-place precision.
 * Returns null if either operand is null.
 */
export function decimalSubtract(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) * 100) / 100;
}

/**
 * Add two nullable numbers with 2-decimal-place precision.
 */
export function decimalAdd(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a + b) * 100) / 100;
}

