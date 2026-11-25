/**
 * Invoice review: pack size -> physical quantity -> cost per standard unit (display), and the confirm
 * payload for one line.
 *
 * The backend is authoritative: it extracts the pack size, computes physical quantity and cost per
 * standard unit with its unit registry and pricing engine (services/invoice_pack_pricing.py), and
 * recomputes everything again when the purchase is confirmed. This module only re-derives the same
 * display values when the reviewer edits a line, using the unit factors served by GET /api/v1/units.
 *
 * Selling prices are never invented here: no MRP fallback and no margin on the purchase cost. A
 * selling price is sent only when the reviewer entered one.
 */
import type { UnitIndex } from './unitRegistry';
import { round3 } from './invoiceReliability';

export interface PackLine {
  product_name: string;
  quantity: number | null;
  unit: string;
  purchase_price: number | null;
  amount: number | null;
  mrp: number | null;
  selling_price?: number | null;
  /** True once the reviewer typed a selling price (only then is it sent). */
  selling_price_edited?: boolean;
  matched_product_id?: string | null;
  pack_size?: number | null;
  pack_size_unit?: string | null;
  physical_quantity?: number | null;
  standard_unit?: string | null;
  cost_per_standard_unit?: number | null;
  /** Unit the printed rate is quoted per (usually the purchase unit; kg when detected as per kg). */
  rate_basis_unit?: string | null;
  pack_conversion?: string | null;
  /** New products: keep stock in purchase units (bags) or in the physical unit (kg / L). */
  stock_mode?: 'purchase' | 'physical';
}

export interface PackDisplay {
  /** Content of one purchase unit, e.g. "25 kg per bag". */
  packText: string | null;
  physicalQuantity: number | null;
  standardUnit: string | null;
  costPerStandardUnit: number | null;
  /** Package unit + measure pack: stock can be kept in kg / L (PACK_CONVERTED). */
  convertible: boolean;
}

/** The standard costing unit of a measure family as served by the registry: kg for mass, L for volume. */
function standardUnitOf(index: UnitIndex, unitId: string): string | null {
  const unit = index.get(unitId);
  if (!unit || unit.kind !== 'measure') return null;
  const std = index.units.find((u) => u.family === unit.family && u.factor_to_base === 1000);
  return std ? std.id : null;
}

function inUnit(index: UnitIndex, qty: number, from: string, to: string): number | null {
  const a = index.get(from);
  const b = index.get(to);
  if (!a || !b || a.family !== b.family) return null;
  return (qty * a.factor_to_base) / b.factor_to_base;
}

/** Physical quantity and cost per standard unit for the line as currently edited. */
export function packDisplay(line: PackLine, index: UnitIndex | null): PackDisplay {
  const none: PackDisplay = { packText: null, physicalQuantity: null, standardUnit: null, costPerStandardUnit: null, convertible: false };
  if (!index) {
    // Registry not loaded yet: show what the backend computed, unchanged
    return {
      ...none,
      packText: line.pack_size && line.pack_size_unit && line.unit ? `${line.pack_size} ${line.pack_size_unit} per ${line.unit}` : null,
      physicalQuantity: line.physical_quantity ?? null,
      standardUnit: line.standard_unit ?? null,
      costPerStandardUnit: line.cost_per_standard_unit ?? null,
      convertible: line.pack_conversion === 'PACK_CONVERTED',
    };
  }
  const unitId = index.normalize(line.unit);
  const packUnitId = index.normalize(line.pack_size_unit);
  const qty = line.quantity;
  const rate = line.purchase_price;
  const pack = line.pack_size;
  if (!unitId || !packUnitId || !pack || pack <= 0) return none;
  const std = standardUnitOf(index, packUnitId);
  if (!std) return none;
  const packStd = inUnit(index, pack, packUnitId, std);
  if (packStd === null || packStd <= 0) return none;
  const purchaseKind = index.get(unitId)?.kind;
  const convertible = purchaseKind === 'package';
  const physicalQuantity = typeof qty === 'number' && qty > 0 && purchaseKind !== 'measure' ? round3(qty * packStd) : null;
  let costPerStandardUnit: number | null = null;
  if (typeof rate === 'number' && rate >= 0) {
    const rateUnit = index.normalize(line.rate_basis_unit) ?? unitId;
    const perStd = index.get(rateUnit)?.kind === 'measure' ? inUnit(index, 1, std, rateUnit) : null;
    costPerStandardUnit = perStd !== null ? round3(rate * perStd) : round3(rate / packStd);
  }
  return {
    packText: `${pack} ${packUnitId} per ${unitId}`,
    physicalQuantity,
    standardUnit: std,
    costPerStandardUnit,
    convertible,
  };
}

/** New products (no match) that still need a selling price typed by the reviewer. */
export function newProductsWithoutSellingPrice(lines: PackLine[]): PackLine[] {
  return lines.filter(
    (l) => !l.matched_product_id && !(typeof l.selling_price === 'number' && l.selling_price > 0)
  );
}

/**
 * Pack fields of the confirm payload. Sent only for a package unit with a measure pack size, the
 * conversion the backend applies to stock and cost (e.g. 2 bag x 25 kg = 50 kg at Rs 94/kg).
 */
export function packPayload(line: PackLine, index: UnitIndex | null): Record<string, unknown> {
  const d = packDisplay(line, index);
  if (!d.convertible || !line.pack_size || !line.pack_size_unit) return {};
  const payload: Record<string, unknown> = {
    pack_size: line.pack_size,
    pack_size_unit: index?.normalize(line.pack_size_unit) ?? line.pack_size_unit,
  };
  if (line.rate_basis_unit) payload.rate_basis_unit = line.rate_basis_unit;
  if (!line.matched_product_id && line.stock_mode === 'physical' && d.standardUnit) {
    payload.stock_unit = d.standardUnit;
  }
  return payload;
}

/**
 * Selling-price fields of the confirm payload: only a price the reviewer entered is sent, and only
 * then may it update an existing product. Purchase cost and MRP are never used as a selling price.
 */
export function sellingPricePayload(line: PackLine): Record<string, unknown> {
  const entered = typeof line.selling_price === 'number' && line.selling_price > 0;
  if (!entered) return { update_selling_price: false };
  if (line.matched_product_id && !line.selling_price_edited) return { update_selling_price: false };
  return { selling_price: line.selling_price, update_selling_price: Boolean(line.matched_product_id) };
}

/**
 * Price basis sent with a line. The confirm API reads price_basis as the basis of the printed purchase
 * rate, so it must be a unit the line's quantity converts to. A loose-product guess of "per kg" on a
 * line bought in pcs (e.g. 'Jeera Powder 100g', 10 pcs) is replaced by the line's own unit; a line
 * with a printed pack size is costed through the pack conversion and keeps the reviewer's basis.
 */
export function priceBasisFor(
  line: PackLine,
  basisQty: number,
  basisUnit: string,
  index: UnitIndex | null
): { quantity: number; unit: string } {
  if (!index || packDisplay(line, index).convertible) return { quantity: basisQty, unit: basisUnit };
  const unit = index.normalize(line.unit);
  const basis = index.normalize(basisUnit);
  // An unregistered basis (e.g. left over from a unit the reviewer has since corrected) or one that does
  // not suit the line's unit falls back to the line's own unit
  if (unit && (!basis || !index.areCompatible(unit, basis))) return { quantity: 1, unit: line.unit.trim() };
  return { quantity: basisQty, unit: basisUnit };
}
