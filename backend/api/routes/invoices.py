from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session

from api import deps
from db.models.user import User
from schemas.invoice import (
    InvoiceExtractResponse,
    InvoiceConfirmRequest,
    InvoiceConfirmResponse,
)
from services import shop as shop_service
from services import invoice as invoice_service

router = APIRouter()

def get_user_shop_or_raise(db: Session, user: User):
    shop = shop_service.get_shop_by_owner(db, owner_id=user.id)
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must create a shop profile before scanning invoices.",
        )
    return shop

@router.post("/extract", response_model=InvoiceExtractResponse)
async def extract_invoice(
    *,
    db: Session = Depends(deps.get_db),
    file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Extract line items, quantities, prices, and supplier metadata from an uploaded invoice (PDF or Image).
    Performs layout zoning, semantic column identification, and inventory matching.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    try:
        content = await file.read()
        return invoice_service.extract_invoice_from_bytes(
            file_bytes=content,
            filename=file.filename or "invoice.pdf",
            db=db,
            shop_id=user_shop.id
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to extract invoice: {str(e)}"
        )

@router.post("/confirm", response_model=InvoiceConfirmResponse, status_code=status.HTTP_201_CREATED)
def confirm_invoice(
    *,
    db: Session = Depends(deps.get_db),
    confirm_in: InvoiceConfirmRequest,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Confirm reviewed invoice items: atomically updates stock for existing items,
    creates any new products, and logs a comprehensive purchase record.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    try:
        return invoice_service.confirm_and_update_stock(
            db=db,
            shop_id=user_shop.id,
            confirm_in=confirm_in
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to confirm invoice stock update: {str(e)}"
        )
