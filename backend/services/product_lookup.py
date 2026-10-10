"""
Product and MRP Lookup Service for ShopPulse.
Looks up the shop's own inventory first, then the configured external MRP provider
(services/mrp_lookup.py), which reports an explicit lookup status.

Core Safety Rules:
1. Purchase Price, Selling Price, and MRP must remain separate fields.
2. Never substitute MRP for Purchase Price.
3. Never automatically set Selling Price equal to MRP.
4. Never fabricate missing values.
5. Reject ambiguous matches instead of selecting an arbitrary product.
6. Display the source of retrieved data ('SHOP_INVENTORY', provider name, 'NONE').
"""

import difflib
from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.product import Product
from schemas.product import ProductLookupResponse
from services import mrp_lookup
from services.product_matching import normalize_gtin


def lookup_product(
    db: Session,
    shop_id: UUID,
    barcode: Optional[str] = None,
    name: Optional[str] = None
) -> ProductLookupResponse:
    """
    Looks up product details across local shop inventory first, and falls back to
    configured external catalog systems (OpenMRP) if not present locally.
    """
    clean_barcode = barcode.strip() if barcode else None
    clean_name = name.strip() if name else None

    if not clean_barcode and not clean_name:
        return ProductLookupResponse(
            found=False,
            source="NONE",
            confidence=0.0,
            notes="No barcode or product name provided for lookup."
        )

    # 1. Exact Barcode Match in Shop Inventory (Highest Precedence)
    if clean_barcode:
        local_by_barcode = db.query(Product).filter(
            Product.shop_id == shop_id,
            Product.sku == clean_barcode
        ).first()

        if local_by_barcode:
            return ProductLookupResponse(
                found=True,
                name=local_by_barcode.name,
                barcode=local_by_barcode.sku,
                unit=local_by_barcode.unit or "pcs",
                purchase_price=local_by_barcode.purchase_price,
                selling_price=local_by_barcode.selling_price,
                mrp=local_by_barcode.mrp,
                mrp_source=local_by_barcode.mrp_source,
                source="SHOP_INVENTORY",
                confidence=1.0,
                matched_product_id=local_by_barcode.id,
                notes="Exact barcode match from shop inventory."
            )

    # 2. Exact or High-Confidence Name Match in Shop Inventory
    if clean_name:
        # Case-insensitive exact name match
        local_by_name = db.query(Product).filter(
            Product.shop_id == shop_id,
            Product.name.ilike(clean_name)
        ).first()

        if local_by_name:
            return ProductLookupResponse(
                found=True,
                name=local_by_name.name,
                barcode=local_by_name.sku,
                unit=local_by_name.unit or "pcs",
                purchase_price=local_by_name.purchase_price,
                selling_price=local_by_name.selling_price,
                mrp=local_by_name.mrp,
                mrp_source=local_by_name.mrp_source,
                source="SHOP_INVENTORY",
                confidence=0.98,
                matched_product_id=local_by_name.id,
                notes="Exact name match from shop inventory."
            )

        # Fuzzy match in shop inventory (reject ambiguous matches)
        shop_products = db.query(Product).filter(Product.shop_id == shop_id).all()
        scored_matches = []
        name_lower = clean_name.lower()

        for p in shop_products:
            score = difflib.SequenceMatcher(None, name_lower, p.name.lower()).ratio()
            if score >= 0.85:
                scored_matches.append((score, p))

        scored_matches.sort(key=lambda x: x[0], reverse=True)

        # Only accept if single top match or clear lead (> 0.15 higher than second match)
        if scored_matches:
            top_score, top_prod = scored_matches[0]
            is_unambiguous = (
                len(scored_matches) == 1 or
                (top_score - scored_matches[1][0] >= 0.12)
            )

            if is_unambiguous and top_score >= 0.88:
                return ProductLookupResponse(
                    found=True,
                    name=top_prod.name,
                    barcode=top_prod.sku,
                    unit=top_prod.unit or "pcs",
                    purchase_price=top_prod.purchase_price,
                    selling_price=top_prod.selling_price,
                    mrp=top_prod.mrp,
                    mrp_source=top_prod.mrp_source,
                    source="SHOP_INVENTORY",
                    confidence=round(top_score, 2),
                    matched_product_id=top_prod.id,
                    notes=f"Fuzzy match ({int(top_score * 100)}% match) from shop inventory."
                )

    # 3. External MRP provider. Only a FOUND result (matched product + valid MRP field)
    #    counts as found; purchase and selling prices are never taken from the provider.
    ext = mrp_lookup.lookup_mrp(mrp_lookup.LookupQuery(product_name=clean_name, gtin=normalize_gtin(clean_barcode)))
    if ext.status == mrp_lookup.FOUND:
        return ProductLookupResponse(
            found=True,
            name=ext.matched_name,
            barcode=ext.barcode,
            mrp=ext.mrp,
            mrp_source="API",
            mrp_lookup_status=ext.status,
            source=ext.provider,
            confidence=ext.match_confidence or 0.0,
            notes=ext.message,
        )

    # 4. Not Found
    return ProductLookupResponse(
        found=False,
        source="NONE",
        confidence=0.0,
        mrp_lookup_status=ext.status,
        notes=f"Product not found in shop inventory. External MRP lookup: {ext.message}",
    )
