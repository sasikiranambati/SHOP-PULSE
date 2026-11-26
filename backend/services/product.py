from datetime import datetime, timezone
from typing import Optional, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models.product import Product
from db.models.sale_item import SaleItem
from db.models.purchase_item import PurchaseItem
from schemas.product import ProductCreate, ProductUpdate
from services.stock import validate_stock_value, validate_unit_text
from services.unit_registry import normalize_unit, are_units_compatible
from services.pricing_engine import (
    evaluate_mrp_ceiling,
    PricingEngineError,
    validate_price,
    validate_quantity,
)
from services.pricing_audit import create_pricing_audit_log
from services.shop_member import get_shop_member, ShopRole


def _check_unit_and_stock(unit, current_stock, reorder_level) -> None:
    """A given unit must be registered; stock and reorder level must suit it (fractions only for kg, g, L, ml)."""
    if unit is not None:
        validate_unit_text(unit, what="Unit")
    if current_stock is not None:
        validate_stock_value(current_stock, unit, label="Stock")
    if reorder_level is not None:
        validate_stock_value(reorder_level, unit, label="Reorder level")


def create_product(
    db: Session,
    product_in: ProductCreate,
    shop_id: UUID,
    acting_user_id: Optional[UUID] = None,
) -> Product:
    _check_unit_and_stock(product_in.unit, product_in.current_stock, product_in.reorder_level)

    basis_qty = product_in.price_basis_quantity if product_in.price_basis_quantity is not None else 1.0
    basis_unit = product_in.price_basis_unit or product_in.unit
    mrp_basis_qty = product_in.mrp_basis_quantity or basis_qty
    mrp_basis_unit = product_in.mrp_basis_unit or basis_unit

    # Universal MRP validation on product creation
    if product_in.mrp is not None and float(product_in.mrp) > 0 and product_in.selling_price is not None and float(product_in.selling_price) > 0:
        try:
            mrp_eval = evaluate_mrp_ceiling(
                selling_price=product_in.selling_price,
                mrp=product_in.mrp,
                price_basis_quantity=basis_qty,
                price_basis_unit=basis_unit,
                mrp_basis_quantity=mrp_basis_qty,
                mrp_basis_unit=mrp_basis_unit,
                product_name=product_in.name,
            )
            if mrp_eval.is_exceeded:
                raise ValueError(
                    f"Selling price ₹{product_in.selling_price} exceeds statutory MRP ceiling ₹{product_in.mrp} for '{product_in.name}'."
                )
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

    # Determine initial pricing status: defaults to NEEDS_REVIEW.
    # An authorized manager or owner may initialize as VERIFIED only if all pricing metadata is complete and valid.
    init_status = "NEEDS_REVIEW"
    if product_in.pricing_status == "VERIFIED" and acting_user_id:
        member = get_shop_member(db, shop_id, acting_user_id)
        if member and member.role in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
            stock_unit = product_in.unit
            sp = product_in.selling_price
            mrp = product_in.mrp

            try:
                norm_basis = normalize_unit(basis_unit) if basis_unit else None
                norm_stock = normalize_unit(stock_unit) if stock_unit else None
                units_ok = bool(norm_basis and norm_stock and are_units_compatible(norm_stock, norm_basis))
                price_ok = sp is not None and float(sp) > 0
                mrp_ok = True
                if mrp is not None and float(mrp) > 0 and price_ok:
                    mrp_eval = evaluate_mrp_ceiling(
                        selling_price=sp,
                        mrp=mrp,
                        price_basis_quantity=basis_qty,
                        price_basis_unit=basis_unit,
                        mrp_basis_quantity=mrp_basis_qty,
                        mrp_basis_unit=mrp_basis_unit,
                        product_name=product_in.name,
                    )
                    mrp_ok = not mrp_eval.is_exceeded

                if units_ok and price_ok and mrp_ok and float(basis_qty) > 0:
                    init_status = "VERIFIED"
            except Exception:
                init_status = "NEEDS_REVIEW"

    # If a previously deleted/archived product with the same name exists, reactivate it
    existing_inactive = db.query(Product).filter(
        Product.shop_id == shop_id,
        Product.name.ilike(product_in.name.strip()),
        Product.is_active.is_(False)
    ).first()

    if existing_inactive:
        existing_inactive.is_active = True
        existing_inactive.category = product_in.category or existing_inactive.category
        existing_inactive.selling_price = product_in.selling_price
        existing_inactive.purchase_price = product_in.purchase_price
        existing_inactive.current_stock = product_in.current_stock
        existing_inactive.reorder_level = product_in.reorder_level
        existing_inactive.unit = product_in.unit or existing_inactive.unit
        existing_inactive.sku = product_in.sku or existing_inactive.sku
        existing_inactive.supplier_id = product_in.supplier_id or existing_inactive.supplier_id
        if product_in.mrp is not None:
            existing_inactive.mrp = product_in.mrp
            existing_inactive.mrp_source = product_in.mrp_source or "MANUAL"
            existing_inactive.mrp_updated_at = datetime.now(timezone.utc)
        if product_in.price_basis_quantity is not None:
            existing_inactive.price_basis_quantity = product_in.price_basis_quantity
        if product_in.price_basis_unit is not None:
            existing_inactive.price_basis_unit = product_in.price_basis_unit
        if product_in.mrp_basis_quantity is not None:
            existing_inactive.mrp_basis_quantity = product_in.mrp_basis_quantity
        if product_in.mrp_basis_unit is not None:
            existing_inactive.mrp_basis_unit = product_in.mrp_basis_unit
        # Always require review when reactivating an inactive product
        existing_inactive.pricing_status = "NEEDS_REVIEW"
        db.add(existing_inactive)
        db.commit()
        db.refresh(existing_inactive)
        return existing_inactive

    db_product = Product(
        name=product_in.name.strip(),
        category=product_in.category,
        selling_price=product_in.selling_price,
        purchase_price=product_in.purchase_price,
        mrp=product_in.mrp,
        mrp_source=(product_in.mrp_source or "MANUAL") if product_in.mrp is not None else None,
        mrp_updated_at=datetime.now(timezone.utc) if product_in.mrp is not None else None,
        price_basis_quantity=basis_qty,
        price_basis_unit=basis_unit,
        mrp_basis_quantity=mrp_basis_qty,
        mrp_basis_unit=mrp_basis_unit,
        pricing_status=init_status,
        current_stock=product_in.current_stock,
        reorder_level=product_in.reorder_level,
        unit=product_in.unit,
        supplier_id=product_in.supplier_id,
        sku=product_in.sku,
        shop_id=shop_id,
        is_active=True,
    )
    db.add(db_product)
    db.commit()
    db.refresh(db_product)

    if init_status == "VERIFIED" and acting_user_id:
        create_pricing_audit_log(
            db=db,
            shop_id=shop_id,
            acting_user_id=acting_user_id,
            action_type="VERIFY_PRICING",
            product_id=db_product.id,
            previous_status="NEEDS_REVIEW",
            new_status="VERIFIED",
            previous_selling_price=db_product.selling_price,
            new_selling_price=db_product.selling_price,
            previous_mrp=db_product.mrp,
            new_mrp=db_product.mrp,
            reason="Initial manager verification on product creation",
        )
        db.commit()

    return db_product

def get_product_by_id(db: Session, product_id: UUID) -> Optional[Product]:
    return db.query(Product).filter(Product.id == product_id).first()

def get_products_by_shop(
    db: Session,
    shop_id: UUID,
    search: Optional[str] = None,
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 10,
    include_inactive: bool = False
) -> Tuple[List[Product], int]:
    query = db.query(Product).filter(Product.shop_id == shop_id)
    if not include_inactive:
        query = query.filter(Product.is_active.is_(True))
    
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(Product.name.ilike(search_pattern))
        
    if category:
        query = query.filter(Product.category.ilike(category))
        
    total = query.count()
    items = query.order_by(Product.created_at.desc()).offset(skip).limit(limit).all()
    return items, total

def _build_pricing_audit_reason(changes: List[Tuple[str, str, object, object]]) -> str:
    """Format a deterministic old -> new summary fitting PricingAuditLog.reason (255 chars)."""
    full = "Product update: " + "; ".join(f"{full_name}: {old!r} -> {new!r}" for full_name, _, old, new in changes)
    if len(full) <= 255:
        return full
    compact = "Product update: " + "; ".join(f"{short_name}: {old!r}->{new!r}" for _, short_name, old, new in changes)
    return compact[:255]


def update_product(
    db: Session,
    db_product: Product,
    product_in: ProductUpdate,
    acting_user_id: Optional[UUID] = None,
) -> Product:
    update_data = product_in.model_dump(exclude_unset=True)
    # Never allow generic product updates to modify pricing_status directly
    update_data.pop("pricing_status", None)

    old_status = getattr(db_product, "pricing_status", None)
    old_sp = db_product.selling_price
    old_mrp = db_product.mrp
    old_unit = db_product.unit
    old_pbq = db_product.price_basis_quantity
    old_pbu = db_product.price_basis_unit
    old_mrp_bq = getattr(db_product, "mrp_basis_quantity", None)
    old_mrp_bu = getattr(db_product, "mrp_basis_unit", None)

    sp_changed = ("selling_price" in update_data and update_data["selling_price"] != old_sp)
    mrp_changed = ("mrp" in update_data and update_data["mrp"] != old_mrp)
    unit_changed = ("unit" in update_data and update_data["unit"] != old_unit)
    pbq_changed = ("price_basis_quantity" in update_data and update_data["price_basis_quantity"] != old_pbq)
    pbu_changed = ("price_basis_unit" in update_data and update_data["price_basis_unit"] != old_pbu)
    mrp_bq_changed = ("mrp_basis_quantity" in update_data and update_data["mrp_basis_quantity"] != old_mrp_bq)
    mrp_bu_changed = ("mrp_basis_unit" in update_data and update_data["mrp_basis_unit"] != old_mrp_bu)

    basis_or_unit_changed = unit_changed or pbq_changed or pbu_changed or mrp_bq_changed or mrp_bu_changed
    pricing_changed = sp_changed or mrp_changed or basis_or_unit_changed

    # Require OWNER or MANAGER role BEFORE validation/mutations when altering any pricing interpretation field on a VERIFIED product
    if pricing_changed and old_status == "VERIFIED" and acting_user_id:
        member = get_shop_member(db, db_product.shop_id, acting_user_id)
        if not member or member.role not in [ShopRole.OWNER.value, ShopRole.MANAGER.value]:
            changed_labels = []
            if sp_changed:
                changed_labels.append("selling price")
            if mrp_changed:
                changed_labels.append("MRP")
            if unit_changed:
                changed_labels.append("unit")
            if pbq_changed or pbu_changed:
                changed_labels.append("pricing basis")
            if mrp_bq_changed or mrp_bu_changed:
                changed_labels.append("MRP basis")
            summary = ", ".join(changed_labels)
            raise PermissionError(
                f"User does not have authorization to override {summary} for verified product '{db_product.name}'. Manager or Owner role required."
            )

    if {"unit", "current_stock", "reorder_level"} & set(update_data):
        # Check the resulting unit, stock and reorder level together (a unit change must suit the stock)
        final_unit = update_data["unit"] if "unit" in update_data else db_product.unit
        if "unit" in update_data:
            validate_unit_text(update_data["unit"], what="Unit")
        stock = update_data.get("current_stock", db_product.current_stock)
        if stock is not None and ("current_stock" in update_data or "unit" in update_data):
            validate_stock_value(stock, final_unit, label="Stock")
        reorder = update_data.get("reorder_level", db_product.reorder_level)
        if reorder is not None and ("reorder_level" in update_data or "unit" in update_data):
            validate_stock_value(reorder, final_unit, label="Reorder level")
    else:
        final_unit = db_product.unit

    if "selling_price" in update_data:
        try:
            sp_dec = validate_price(update_data["selling_price"], name=f"Selling price for '{db_product.name}'")
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe
        if old_status == "VERIFIED" and sp_dec <= 0:
            raise ValueError(f"Verified product '{db_product.name}' selling price must be greater than zero.")

    if "mrp" in update_data and update_data["mrp"] is not None:
        try:
            validate_price(update_data["mrp"], name=f"MRP for '{db_product.name}'")
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

    if "price_basis_quantity" in update_data:
        try:
            validate_quantity(update_data["price_basis_quantity"], name=f"Price basis quantity for '{db_product.name}'")
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

    if "price_basis_unit" in update_data:
        validate_unit_text(update_data["price_basis_unit"], what="Price basis unit")

    if "mrp_basis_quantity" in update_data and update_data["mrp_basis_quantity"] is not None:
        try:
            validate_quantity(update_data["mrp_basis_quantity"], name=f"MRP basis quantity for '{db_product.name}'")
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

    if "mrp_basis_unit" in update_data and update_data["mrp_basis_unit"] is not None:
        validate_unit_text(update_data["mrp_basis_unit"], what="MRP basis unit")

    final_sp = update_data.get("selling_price", old_sp)
    raw_sp_basis_qty = update_data["price_basis_quantity"] if "price_basis_quantity" in update_data else old_pbq
    final_sp_basis_qty = raw_sp_basis_qty if raw_sp_basis_qty is not None else 1.0
    raw_sp_basis_unit = update_data["price_basis_unit"] if "price_basis_unit" in update_data else old_pbu
    final_sp_basis_unit = raw_sp_basis_unit or final_unit

    final_mrp = update_data.get("mrp", old_mrp)
    raw_mrp_basis_qty = update_data["mrp_basis_quantity"] if "mrp_basis_quantity" in update_data else old_mrp_bq
    if "mrp_basis_quantity" in update_data and update_data["mrp_basis_quantity"] is None and final_mrp is not None and float(final_mrp) > 0:
        raise ValueError(f"MRP basis quantity for '{db_product.name}' cannot be null when MRP is set.")
    final_mrp_basis_qty = raw_mrp_basis_qty if raw_mrp_basis_qty is not None else final_sp_basis_qty

    raw_mrp_basis_unit = update_data["mrp_basis_unit"] if "mrp_basis_unit" in update_data else old_mrp_bu
    final_mrp_basis_unit = raw_mrp_basis_unit or final_sp_basis_unit

    # Validate unit registry compatibility across inventory unit, pricing basis unit, and MRP basis unit
    if old_status == "VERIFIED" or ({"unit", "price_basis_unit", "price_basis_quantity", "mrp_basis_unit", "mrp_basis_quantity"} & set(update_data)):
        try:
            validate_quantity(final_sp_basis_qty, name=f"Price basis quantity for '{db_product.name}'")
            validate_quantity(final_mrp_basis_qty, name=f"MRP basis quantity for '{db_product.name}'")
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

        norm_stock_unit = validate_unit_text(final_unit, what="Inventory unit")
        norm_sp_basis_unit = validate_unit_text(final_sp_basis_unit, what="Price basis unit")
        if not are_units_compatible(norm_stock_unit, norm_sp_basis_unit):
            raise ValueError(
                f"Inventory unit '{final_unit}' and price basis unit '{final_sp_basis_unit}' are incompatible."
            )

        norm_mrp_basis_unit = validate_unit_text(final_mrp_basis_unit, what="MRP basis unit")
        if not are_units_compatible(norm_sp_basis_unit, norm_mrp_basis_unit):
            raise ValueError(
                f"Price basis unit '{final_sp_basis_unit}' and MRP basis unit '{final_mrp_basis_unit}' are incompatible."
            )

    # Universal MRP validation on product update
    if final_mrp is not None and float(final_mrp) > 0 and final_sp is not None and float(final_sp) > 0:
        try:
            mrp_eval = evaluate_mrp_ceiling(
                selling_price=final_sp,
                mrp=final_mrp,
                price_basis_quantity=final_sp_basis_qty,
                price_basis_unit=final_sp_basis_unit,
                mrp_basis_quantity=final_mrp_basis_qty,
                mrp_basis_unit=final_mrp_basis_unit,
                product_name=db_product.name,
            )
            if mrp_eval.is_exceeded:
                if "mrp" in update_data and update_data["mrp"] != old_mrp and final_sp == old_sp:
                    raise ValueError(
                        f"MRP reduction to ₹{final_mrp} is below existing selling price ₹{final_sp} for '{db_product.name}'. Selling price must be reduced first or updated."
                    )
                raise ValueError(
                    f"Selling price ₹{final_sp} exceeds statutory MRP ceiling ₹{final_mrp} for '{db_product.name}'."
                )
        except PricingEngineError as pe:
            raise ValueError(str(pe)) from pe

    mrp_source = update_data.pop("mrp_source", None)
    if "mrp" in update_data and update_data["mrp"] != old_mrp:
        # Track where the MRP came from whenever it changes
        db_product.mrp_source = (mrp_source or "MANUAL") if update_data["mrp"] is not None else None
        db_product.mrp_updated_at = datetime.now(timezone.utc)
    for field, value in update_data.items():
        setattr(db_product, field, value)

    db.add(db_product)

    # Server-side audit log for price, MRP, pricing basis, or unit modifications
    if pricing_changed and acting_user_id:
        if sp_changed:
            action = "SELLING_PRICE_OVERRIDE"
        elif mrp_changed:
            action = "MRP_UPDATE"
        else:
            action = "PRICING_BASIS_UPDATE"

        audit_changes: List[Tuple[str, str, object, object]] = []
        if sp_changed:
            audit_changes.append(("selling_price", "sp", old_sp, final_sp))
        if mrp_changed:
            audit_changes.append(("mrp", "mrp", old_mrp, final_mrp))
        if unit_changed:
            audit_changes.append(("unit", "unit", old_unit, db_product.unit))
        if pbq_changed:
            audit_changes.append(("price_basis_quantity", "pbq", old_pbq, db_product.price_basis_quantity))
        if pbu_changed:
            audit_changes.append(("price_basis_unit", "pbu", old_pbu, db_product.price_basis_unit))
        if mrp_bq_changed:
            audit_changes.append(("mrp_basis_quantity", "mrp_bq", old_mrp_bq, getattr(db_product, "mrp_basis_quantity", None)))
        if mrp_bu_changed:
            audit_changes.append(("mrp_basis_unit", "mrp_bu", old_mrp_bu, getattr(db_product, "mrp_basis_unit", None)))

        create_pricing_audit_log(
            db=db,
            shop_id=db_product.shop_id,
            acting_user_id=acting_user_id,
            action_type=action,
            product_id=db_product.id,
            previous_status=old_status,
            new_status=db_product.pricing_status,
            previous_selling_price=old_sp,
            new_selling_price=final_sp,
            previous_mrp=old_mrp,
            new_mrp=final_mrp,
            reason=_build_pricing_audit_reason(audit_changes),
        )

    db.commit()
    db.refresh(db_product)
    return db_product

def verify_product(
    db: Session,
    product: Product,
    acting_user_id: UUID,
    reason: Optional[str] = None
) -> Product:
    """Verify product pricing metadata by an authorized manager or owner.
    
    Validates price basis, units, selling price, and statutory MRP ceiling.
    Atomically updates pricing_status to VERIFIED and records an immutable audit log.
    """
    if product.pricing_status == "VERIFIED":
        return product

    if product.price_basis_quantity is None or float(product.price_basis_quantity) <= 0:
        raise ValueError(f"Product '{product.name}' has invalid price basis quantity: {product.price_basis_quantity}. Must be > 0.")

    if not product.price_basis_unit or not product.price_basis_unit.strip():
        raise ValueError(f"Product '{product.name}' lacks a price basis unit.")

    if not product.unit or not product.unit.strip():
        raise ValueError(f"Product '{product.name}' lacks an inventory stock unit.")

    try:
        norm_basis_unit = normalize_unit(product.price_basis_unit)
    except Exception as e:
        raise ValueError(f"Product '{product.name}' has invalid price basis unit '{product.price_basis_unit}': {e}")

    try:
        norm_stock_unit = normalize_unit(product.unit)
    except Exception as e:
        raise ValueError(f"Product '{product.name}' has invalid stock unit '{product.unit}': {e}")

    if not are_units_compatible(norm_stock_unit, norm_basis_unit):
        raise ValueError(
            f"Product stock unit '{product.unit}' and pricing basis unit '{product.price_basis_unit}' are incompatible."
        )

    if product.selling_price is None or float(product.selling_price) <= 0:
        raise ValueError(f"Product '{product.name}' selling price must be greater than zero.")

    if product.mrp is not None and float(product.mrp) > 0:
        mrp_basis_qty = getattr(product, "mrp_basis_quantity", None) or product.price_basis_quantity
        mrp_basis_u = getattr(product, "mrp_basis_unit", None) or product.price_basis_unit
        mrp_eval = evaluate_mrp_ceiling(
            selling_price=product.selling_price,
            mrp=product.mrp,
            price_basis_quantity=product.price_basis_quantity,
            price_basis_unit=product.price_basis_unit,
            mrp_basis_quantity=mrp_basis_qty,
            mrp_basis_unit=mrp_basis_u,
            product_name=product.name
        )
        if mrp_eval.is_exceeded:
            raise ValueError(
                f"Selling price ₹{product.selling_price} exceeds statutory MRP ceiling ₹{product.mrp} for '{product.name}'."
            )

    prev_status = product.pricing_status
    product.pricing_status = "VERIFIED"
    product.updated_at = datetime.now(timezone.utc)
    db.add(product)

    # Server-side immutable audit log
    create_pricing_audit_log(
        db=db,
        shop_id=product.shop_id,
        acting_user_id=acting_user_id,
        action_type="VERIFY_PRICING",
        product_id=product.id,
        previous_status=prev_status,
        new_status="VERIFIED",
        previous_selling_price=product.selling_price,
        new_selling_price=product.selling_price,
        previous_mrp=product.mrp,
        new_mrp=product.mrp,
        reason=reason or "Manager product verification"
    )

    db.commit()
    db.refresh(product)
    return product

def delete_product(db: Session, db_product: Product) -> None:
    # Check if this product has historical financial records (sales or purchases)
    has_sales = db.query(SaleItem.id).filter(SaleItem.product_id == db_product.id).first() is not None
    has_purchases = db.query(PurchaseItem.id).filter(PurchaseItem.product_id == db_product.id).first() is not None

    if has_sales or has_purchases:
        # Soft delete / archive to preserve historical transaction records and avoid FK violation
        db_product.is_active = False
        db.add(db_product)
        db.commit()
    else:
        # Safe to hard-delete as no foreign references exist
        db.delete(db_product)
        db.commit()

def get_low_stock_products_by_shop(
    db: Session,
    shop_id: UUID,
    skip: int = 0,
    limit: int = 10
) -> Tuple[List[Product], int]:
    query = db.query(Product).filter(
        Product.shop_id == shop_id,
        Product.is_active.is_(True),
        Product.current_stock <= Product.reorder_level
    )
    total = query.count()
    items = query.order_by(Product.current_stock.asc()).offset(skip).limit(limit).all()
    return items, total
