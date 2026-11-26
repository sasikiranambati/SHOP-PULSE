/**
 * Lookup helpers over the canonical unit registry returned by GET /api/v1/units (Phase 4, workstream 1).
 *
 * Every answer comes from the registry data passed in; there is no built-in unit list and no fallback:
 * an unknown unit is reported as unknown (null), never replaced by "pcs". Quantity conversion stays in the
 * backend (exact Decimal arithmetic) and is not done here.
 */
import type { UnitDefinition, UnitRegistry } from '../api/units';

/** Same normalisation as the backend (clean_unit_text): drop punctuation / spaces, lower case. */
export function cleanUnitText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
}

export interface UnitIndex {
  /** Canonical unit id for a spelling ("KGS" -> "kg"), or null when it is not a registered unit. */
  normalize(raw: string | null | undefined): string | null;
  get(raw: string | null | undefined): UnitDefinition | null;
  areCompatible(a: string, b: string): boolean;
  allowsFraction(raw: string): boolean | null;
  /** Decimal places allowed for fractional units (registry max_fraction_digits). */
  maxFractionDigits: number;
  units: UnitDefinition[];
}

export interface BasisConversionResult {
  ok: boolean;
  quantity?: number;
  reason?: 'unknown' | 'package' | 'incompatible' | 'inexact';
}

/**
 * Convert a basis quantity between two registry units strictly using canonical registry metadata
 * (`factor_to_base`, `convertible`, `allows_fraction`, `maxFractionDigits`).
 * Never assumes package sizes or guesses conversions across incompatible families.
 */
export function convertBasisQuantityUsingRegistry(
  qty: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  unitIndex: UnitIndex | null,
): BasisConversionResult {
  if (!unitIndex || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: 'unknown' };
  }
  const src = unitIndex.get(fromUnit);
  const dst = unitIndex.get(toUnit);
  if (!src || !dst) return { ok: false, reason: 'unknown' };
  if (src.id === dst.id) return { ok: true, quantity: qty };
  if (src.family !== dst.family) {
    return {
      ok: false,
      reason: src.kind === 'package' || dst.kind === 'package' ? 'package' : 'incompatible',
    };
  }
  if (!src.convertible || !dst.convertible) {
    return { ok: false, reason: 'package' };
  }

  const rawScaled = (qty * src.factor_to_base) / dst.factor_to_base;
  if (!Number.isFinite(rawScaled) || rawScaled <= 0) {
    return { ok: false, reason: 'inexact' };
  }
  if (!dst.allows_fraction) {
    if (Math.abs(rawScaled - Math.round(rawScaled)) > 1e-9) {
      return { ok: false, reason: 'inexact' };
    }
    return { ok: true, quantity: Math.round(rawScaled) };
  }

  const scale = 10 ** unitIndex.maxFractionDigits;
  const rounded = Math.round(rawScaled * scale) / scale;
  if (rounded <= 0 || Math.abs(rounded * dst.factor_to_base - qty * src.factor_to_base) > 1e-9) {
    return { ok: false, reason: 'inexact' };
  }
  return { ok: true, quantity: rounded };
}

export function createUnitIndex(registry: UnitRegistry): UnitIndex {
  const byId = new Map<string, UnitDefinition>();
  const byAlias = new Map<string, UnitDefinition>();
  for (const unit of registry.units) {
    byId.set(unit.id, unit);
    for (const alias of [cleanUnitText(unit.id), ...unit.aliases]) byAlias.set(alias, unit);
  }
  const get = (raw: string | null | undefined): UnitDefinition | null => {
    const key = cleanUnitText(raw);
    return key ? byAlias.get(key) ?? null : null;
  };
  return {
    normalize: (raw) => get(raw)?.id ?? null,
    get,
    areCompatible: (a, b) => {
      const ua = get(a);
      const ub = get(b);
      return Boolean(ua && ub && ua.family === ub.family);
    },
    allowsFraction: (raw) => get(raw)?.allows_fraction ?? null,
    maxFractionDigits: registry.max_fraction_digits,
    units: registry.units,
  };
}
