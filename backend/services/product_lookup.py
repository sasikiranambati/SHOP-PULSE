"""
Product and MRP Lookup Service for ShopPulse.
Coordinates local inventory lookup and optional external OpenMRP catalog synchronization.

Core Safety Rules:
1. Purchase Price, Selling Price, and MRP must remain separate fields.
2. Never substitute MRP for Purchase Price.
3. Never automatically set Selling Price equal to MRP.
4. Never fabricate missing values.
5. Reject ambiguous matches instead of selecting an arbitrary product.
6. Display the source of retrieved data ('SHOP_INVENTORY', 'OPENMRP_CATALOG', 'NONE').
"""

import difflib
from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session

from db.models.product import Product
from schemas.product import ProductLookupResponse
from services.openmrp_client import openmrp_client


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
                    source="SHOP_INVENTORY",
                    confidence=round(top_score, 2),
                    matched_product_id=top_prod.id,
                    notes=f"Fuzzy match ({int(top_score * 100)}% match) from shop inventory."
                )

    # 3. External OpenMRP Catalog Lookup (when configured)
    query_term = clean_name or clean_barcode
    if query_term and openmrp_client.is_configured:
        ext_result = openmrp_client.search_products(query_term, limit=5)
        if ext_result.get("success") and ext_result.get("items"):
            items = ext_result["items"]
            # Check for ambiguity
            if len(items) == 1:
                item = items[0]
                return ProductLookupResponse(
                    found=True,
                    name=item.get("name"),
                    barcode=item.get("sku"),
                    unit="pcs",
                    purchase_price=item.get("unit_cost"),
                    selling_price=item.get("unit_value"),
                    mrp=None,  # OpenMRP is manufacturing ERP; does NOT supply retail MRP
                    source="OPENMRP_CATALOG",
                    confidence=0.85,
                    notes="Retrieved from OpenMRP tenant catalog. Note: OpenMRP is a manufacturing ERP and does not supply retail MRP."
                )
            elif len(items) > 1:
                # Multiple matches: reject ambiguity
                return ProductLookupResponse(
                    found=False,
                    source="OPENMRP_CATALOG",
                    confidence=0.0,
                    notes=f"Ambiguous match: {len(items)} items matched in OpenMRP catalog. Manual review required."
                )

    # 4. Not Found
    return ProductLookupResponse(
        found=False,
        source="NONE",
        confidence=0.0,
        notes="Product not found in local inventory or external catalogs. Enter prices and MRP manually."
    )
