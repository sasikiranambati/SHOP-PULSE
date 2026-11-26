/**
 * Pricing-basis transition, compatibility validation, and payload builder for EditProductModal.
 *
 * All unit families and conversion factors come from the canonical `UnitIndex` (GET /api/v1/units);
 * no duplicate unit table or implicit package assumption is defined here.
 */
import type { Product, ProductCategory } from '../types/product';
import type { ParsedProductForm } from './validators';
import { cleanUnitText, convertBasisQuantityUsingRegistry, type UnitIndex } from './unitRegistry';

export interface PricingBasisFormState {
  priceBasisQuantity: string;
  priceBasisUnit: string;
  mrp: string;
  mrpBasisQuantity: string;
  mrpBasisUnit: string;
}

export type UnitTransitionKind =
  | 'unchanged'
  | 'unknown_unit'
  | 'compatible_converted'
  | 'compatible_unconverted'
  | 'ambiguous_package'
  | 'incompatible_family';

export interface UnitTransitionResult {
  kind: UnitTransitionKind;
  nextBasis: PricingBasisFormState;
  noticeTitle?: string;
  noticeMessage?: string;
}

export interface BasisValidationResult {
  isValid: boolean;
  unitError?: string;
  priceBasisQuantityError?: string;
  priceBasisUnitError?: string;
  mrpError?: string;
  mrpBasisQuantityError?: string;
  mrpBasisUnitError?: string;
  parsed?: {
    priceBasisQuantity: number;
    priceBasisUnit: string;
    mrp?: number;
    mrpBasisQuantity: number;
    mrpBasisUnit: string;
  };
}

export function getInitialPricingBasisState(product: Product): PricingBasisFormState {
  const unit = product.unit || 'pcs';
  const pbq = typeof product.priceBasisQuantity === 'number' && product.priceBasisQuantity > 0 ? product.priceBasisQuantity : 1;
  const pbu = product.priceBasisUnit || unit;
  const mrpBq =
    typeof product.mrpBasisQuantity === 'number' && product.mrpBasisQuantity > 0 ? product.mrpBasisQuantity : pbq;
  const mrpBu = product.mrpBasisUnit || pbu;
  return {
    priceBasisQuantity: String(pbq),
    priceBasisUnit: pbu,
    mrp: typeof product.mrp === 'number' && product.mrp > 0 ? String(product.mrp) : '',
    mrpBasisQuantity: String(mrpBq),
    mrpBasisUnit: mrpBu,
  };
}

function unitsMatch(a: string, b: string, unitIndex: UnitIndex | null): boolean {
  if (unitIndex) {
    const na = unitIndex.normalize(a);
    const nb = unitIndex.normalize(b);
    if (na && nb) return na === nb;
  }
  return cleanUnitText(a) === cleanUnitText(b);
}

/**
 * Resolve how changing `unit` in the edit form affects selling-price basis and MRP basis.
 *
 * - Compatible convertible units (kg <-> g, L <-> ml): converts basis quantity using exact
 *   canonical registry factors so existing retail price and MRP keep the exact same meaning,
 *   while never altering stock quantities.
 * - Package / ambiguous units (packet -> pcs, box -> pcs, bag -> kg, bottle -> ml): refuses to
 *   guess 1 package = 1 pcs/kg; leaves basis intact and requires explicit compatible basis input.
 * - Incompatible unit families (kg -> pcs, L -> kg): leaves basis intact and explains conflict.
 */
export function resolveUnitChange(
  previousProduct: Product,
  nextUnitRaw: string,
  currentBasis: PricingBasisFormState,
  unitIndex: UnitIndex | null,
  basisManuallyEdited = false,
): UnitTransitionResult {
  const nextUnit = nextUnitRaw.trim();
  const prevUnit = (previousProduct.unit || 'pcs').trim();
  const initialBasis = getInitialPricingBasisState(previousProduct);
  const baseUnitForProduct = initialBasis.priceBasisUnit.trim();

  if (!nextUnit) {
    return { kind: 'unchanged', nextBasis: currentBasis };
  }

  if (unitsMatch(prevUnit, nextUnit, unitIndex)) {
    if (!basisManuallyEdited) {
      return { kind: 'unchanged', nextBasis: initialBasis };
    }
    return { kind: 'unchanged', nextBasis: currentBasis };
  }

  if (unitIndex) {
    const targetDef = unitIndex.get(nextUnit);
    if (!targetDef) {
      return {
        kind: 'unknown_unit',
        nextBasis: currentBasis,
        noticeTitle: 'Unrecognized unit',
        noticeMessage: `"${nextUnit}" is not in the ShopPulse unit registry. Select a standard unit such as kg, g, L, ml, pcs, or packet.`,
      };
    }

    const prevSpBasisUnit = currentBasis.priceBasisUnit.trim() || baseUnitForProduct;
    const prevSpBasisQty = Number(currentBasis.priceBasisQuantity);
    const spBasisDef = unitIndex.get(prevSpBasisUnit);

    if (unitIndex.areCompatible(targetDef.id, prevSpBasisUnit) && Number.isFinite(prevSpBasisQty) && prevSpBasisQty > 0) {
      const convSp = convertBasisQuantityUsingRegistry(prevSpBasisQty, prevSpBasisUnit, targetDef.id, unitIndex);
      if (convSp.ok && convSp.quantity !== undefined) {
        const nextState: PricingBasisFormState = {
          ...currentBasis,
          priceBasisQuantity: String(convSp.quantity),
          priceBasisUnit: targetDef.id,
        };

        const hasMrp = Boolean(currentBasis.mrp.trim() && Number(currentBasis.mrp) > 0);
        const prevMrpUnit = currentBasis.mrpBasisUnit.trim() || prevSpBasisUnit;
        const prevMrpQty = Number(currentBasis.mrpBasisQuantity);
        if (unitIndex.areCompatible(targetDef.id, prevMrpUnit) && Number.isFinite(prevMrpQty) && prevMrpQty > 0) {
          const convMrp = convertBasisQuantityUsingRegistry(prevMrpQty, prevMrpUnit, targetDef.id, unitIndex);
          if (convMrp.ok && convMrp.quantity !== undefined) {
            nextState.mrpBasisQuantity = String(convMrp.quantity);
            nextState.mrpBasisUnit = targetDef.id;
          }
        } else if (!hasMrp) {
          nextState.mrpBasisQuantity = String(convSp.quantity);
          nextState.mrpBasisUnit = targetDef.id;
        }

        return {
          kind: 'compatible_converted',
          nextBasis: nextState,
          noticeTitle: 'Pricing basis aligned to compatible unit',
          noticeMessage: `Inventory unit changed from ${prevUnit} to ${targetDef.id}. Price basis adjusted from ${prevSpBasisQty} ${prevSpBasisUnit} to ${convSp.quantity} ${targetDef.id} so your selling price keeps the exact same rate. Stock quantity was not altered—confirm it matches ${targetDef.id}.`,
        };
      }

      return {
        kind: 'compatible_unconverted',
        nextBasis: currentBasis,
        noticeTitle: 'Confirm pricing basis for compatible unit change',
        noticeMessage: `Inventory unit changed to ${targetDef.id}, which is compatible with ${prevSpBasisUnit}. ${prevSpBasisQty} ${prevSpBasisUnit} cannot be converted to a whole ${targetDef.id} automatically, so pricing remains per ${prevSpBasisQty} ${prevSpBasisUnit}. Verify stock and confirm before saving.`,
      };
    }

    const involvesPackage = targetDef.kind === 'package' || spBasisDef?.kind === 'package';
    if (involvesPackage) {
      return {
        kind: 'ambiguous_package',
        nextBasis: currentBasis,
        noticeTitle: 'Package size cannot be assumed',
        noticeMessage: `Cannot convert "${prevSpBasisUnit}" to "${targetDef.id}" automatically (e.g. 1 container does not have a fixed weight, volume, or piece count). Update the pricing basis unit to match "${targetDef.id}" and enter the price per ${targetDef.id}, or revert the inventory unit.`,
      };
    }

    return {
      kind: 'incompatible_family',
      nextBasis: currentBasis,
      noticeTitle: 'Incompatible inventory and pricing units',
      noticeMessage: `"${targetDef.id}" (${targetDef.family}) is incompatible with pricing basis "${prevSpBasisUnit}" (${spBasisDef?.family ?? 'other'}). Update the pricing basis unit${currentBasis.mrp.trim() ? ' and MRP basis unit' : ''} to match "${targetDef.id}" and verify prices before saving.`,
    };
  }

  // Offline fallback when canonical registry index has not loaded: never assume equality
  return {
    kind: 'incompatible_family',
    nextBasis: currentBasis,
    noticeTitle: 'Confirm pricing basis for new unit',
    noticeMessage: `Changing the inventory unit may affect how purchase price, selling price, and MRP are calculated. Update the pricing basis unit to match "${nextUnit}" and confirm before saving.`,
  };
}

export function validateEditPricingBasis(
  unitRaw: string,
  sellingPrice: number | undefined,
  basis: PricingBasisFormState,
  unitIndex: UnitIndex | null,
): BasisValidationResult {
  const unit = unitRaw.trim();
  const pbUnit = basis.priceBasisUnit.trim();
  const pbQty = Number(basis.priceBasisQuantity.trim());
  const mrpText = basis.mrp.trim();
  const mrpVal = mrpText ? Number(mrpText) : undefined;
  const mrpQty = Number(basis.mrpBasisQuantity.trim());
  const mrpUnit = (basis.mrpBasisUnit.trim() || pbUnit).trim();

  let unitError: string | undefined;
  let priceBasisQuantityError: string | undefined;
  let priceBasisUnitError: string | undefined;
  let mrpError: string | undefined;
  let mrpBasisQuantityError: string | undefined;
  let mrpBasisUnitError: string | undefined;

  if (!unit) {
    unitError = 'Enter an inventory unit.';
  } else if (unitIndex && !unitIndex.get(unit)) {
    unitError = `"${unit}" is not a registered unit (e.g. kg, g, L, ml, pcs, packet).`;
  }

  if (!basis.priceBasisQuantity.trim() || !Number.isFinite(pbQty) || pbQty <= 0) {
    priceBasisQuantityError = 'Price basis quantity must be greater than 0.';
  }

  if (!pbUnit) {
    priceBasisUnitError = 'Enter a pricing basis unit.';
  } else if (unitIndex) {
    if (!unitIndex.get(pbUnit)) {
      priceBasisUnitError = `"${pbUnit}" is not a registered unit.`;
    } else if (unit && unitIndex.get(unit) && !unitIndex.areCompatible(unit, pbUnit)) {
      priceBasisUnitError = `Price basis unit "${pbUnit}" is incompatible with inventory unit "${unit}".`;
    }
  }

  if (mrpText) {
    if (!Number.isFinite(mrpVal) || (mrpVal as number) <= 0) {
      mrpError = 'MRP must be greater than ₹0 (or leave blank if unprinted).';
    } else {
      if (!basis.mrpBasisQuantity.trim() || !Number.isFinite(mrpQty) || mrpQty <= 0) {
        mrpBasisQuantityError = 'MRP basis quantity must be greater than 0.';
      }
      if (!mrpUnit) {
        mrpBasisUnitError = 'Enter an MRP basis unit.';
      } else if (unitIndex) {
        if (!unitIndex.get(mrpUnit)) {
          mrpBasisUnitError = `"${mrpUnit}" is not a registered unit.`;
        } else if (pbUnit && unitIndex.get(pbUnit) && !unitIndex.areCompatible(pbUnit, mrpUnit)) {
          mrpBasisUnitError = `MRP basis unit "${mrpUnit}" must be compatible with price basis unit "${pbUnit}".`;
        }
      }

      if (
        !priceBasisQuantityError &&
        !priceBasisUnitError &&
        !mrpBasisQuantityError &&
        !mrpBasisUnitError &&
        typeof sellingPrice === 'number' &&
        Number.isFinite(sellingPrice) &&
        sellingPrice > 0
      ) {
        const spUnitDef = unitIndex?.get(pbUnit);
        const mrpUnitDef = unitIndex?.get(mrpUnit);
        if (spUnitDef && mrpUnitDef && spUnitDef.family === mrpUnitDef.family) {
          const spRatePerBase = sellingPrice / (pbQty * spUnitDef.factor_to_base);
          const mrpRatePerBase = (mrpVal as number) / (mrpQty * mrpUnitDef.factor_to_base);
          if (spRatePerBase - mrpRatePerBase > 1e-6) {
            mrpError = `Selling price (₹${sellingPrice} per ${pbQty} ${pbUnit}) cannot exceed MRP (₹${mrpVal} per ${mrpQty} ${mrpUnit}).`;
          }
        } else if (!unitIndex && cleanUnitText(pbUnit) === cleanUnitText(mrpUnit)) {
          if (sellingPrice / pbQty > (mrpVal as number) / mrpQty + 1e-6) {
            mrpError = `Selling price cannot exceed MRP for the same basis.`;
          }
        }
      }
    }
  }

  const isValid =
    !unitError &&
    !priceBasisQuantityError &&
    !priceBasisUnitError &&
    !mrpError &&
    !mrpBasisQuantityError &&
    !mrpBasisUnitError;

  return {
    isValid,
    unitError,
    priceBasisQuantityError,
    priceBasisUnitError,
    mrpError,
    mrpBasisQuantityError,
    mrpBasisUnitError,
    parsed: isValid
      ? {
          priceBasisQuantity: pbQty,
          priceBasisUnit: unitIndex?.normalize(pbUnit) ?? pbUnit,
          mrp: mrpVal,
          mrpBasisQuantity: mrpVal !== undefined ? mrpQty : pbQty,
          mrpBasisUnit: mrpVal !== undefined ? (unitIndex?.normalize(mrpUnit) ?? mrpUnit) : (unitIndex?.normalize(pbUnit) ?? pbUnit),
        }
      : undefined,
  };
}

export function hasPricingOrUnitChanges(
  product: Product,
  parsedForm: ParsedProductForm,
  parsedBasis: NonNullable<BasisValidationResult['parsed']>,
  unitIndex: UnitIndex | null,
): boolean {
  const origUnit = product.unit || 'pcs';
  const origSp = product.sellingPrice ?? product.price ?? 0;
  const origPbq = typeof product.priceBasisQuantity === 'number' && product.priceBasisQuantity > 0 ? product.priceBasisQuantity : 1;
  const origPbu = product.priceBasisUnit || origUnit;
  const origMrp = typeof product.mrp === 'number' && product.mrp > 0 ? product.mrp : undefined;
  const origMrpBq =
    typeof product.mrpBasisQuantity === 'number' && product.mrpBasisQuantity > 0 ? product.mrpBasisQuantity : origPbq;
  const origMrpBu = product.mrpBasisUnit || origPbu;

  const targetUnit = unitIndex?.normalize(parsedForm.unit) ?? parsedForm.unit;
  const unitChanged = !unitsMatch(origUnit, targetUnit, unitIndex) && parsedForm.unit !== origUnit;
  const spChanged = parsedForm.sellingPrice !== origSp;
  const pbqChanged = parsedBasis.priceBasisQuantity !== origPbq;
  const pbuChanged = !unitsMatch(origPbu, parsedBasis.priceBasisUnit, unitIndex) && parsedBasis.priceBasisUnit !== origPbu;
  const mrpChanged = (parsedBasis.mrp ?? undefined) !== origMrp;
  const mrpBasisChanged =
    parsedBasis.mrp !== undefined &&
    (parsedBasis.mrpBasisQuantity !== origMrpBq ||
      (!unitsMatch(origMrpBu, parsedBasis.mrpBasisUnit, unitIndex) && parsedBasis.mrpBasisUnit !== origMrpBu));

  return unitChanged || spChanged || pbqChanged || pbuChanged || mrpChanged || mrpBasisChanged;
}

export function buildProductUpdatePayload(
  product: Product,
  parsedForm: ParsedProductForm,
  parsedBasis: NonNullable<BasisValidationResult['parsed']>,
  unitIndex: UnitIndex | null,
): Partial<Product> {
  let status: 'In Stock' | 'Low Stock' | 'Out of Stock' = 'In Stock';
  if (parsedForm.stock === 0) status = 'Out of Stock';
  else if (parsedForm.stock <= parsedForm.minStock) status = 'Low Stock';

  const updates: Partial<Product> = {
    name: parsedForm.name,
    category: parsedForm.category as ProductCategory,
    stock: parsedForm.stock,
    minStock: parsedForm.minStock,
    reorderLevel: parsedForm.minStock,
    barcode: parsedForm.barcode,
    status,
    updatedAt: new Date().toISOString(),
  };

  if (parsedForm.purchasePrice !== undefined) {
    updates.purchasePrice = parsedForm.purchasePrice;
  }

  // Only emit pricing / unit / basis fields when pricing interpretation or prices changed,
  // preserving untouched basis metadata and avoiding unnecessary VERIFIED overrides on normal edits.
  if (hasPricingOrUnitChanges(product, parsedForm, parsedBasis, unitIndex)) {
    const normalizedUnit = unitIndex?.normalize(parsedForm.unit) ?? parsedForm.unit;
    updates.unit = normalizedUnit;
    updates.price = parsedForm.sellingPrice;
    updates.sellingPrice = parsedForm.sellingPrice;
    updates.priceBasisQuantity = parsedBasis.priceBasisQuantity;
    updates.priceBasisUnit = parsedBasis.priceBasisUnit;

    if (parsedBasis.mrp !== undefined) {
      updates.mrp = parsedBasis.mrp;
      updates.mrpBasisQuantity = parsedBasis.mrpBasisQuantity;
      updates.mrpBasisUnit = parsedBasis.mrpBasisUnit;
    }
  }

  return updates;
}
