import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
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
from services.ocr import OcrUnavailableError

router = APIRouter()
logger = logging.getLogger(__name__)

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
    Extract line items, quantities, prices, and supplier metadata from an uploaded invoice (PDF, image or text).
    Reconstructs the table from OCR/PDF word positions, validates quantity × rate against the line amount,
    matches inventory and reports the external MRP lookup status per line. Stock is not changed here.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    content = await file.read()
    try:
        return invoice_service.extract_invoice_from_bytes(
            file_bytes=content,
            filename=file.filename or "invoice.pdf",
            db=db,
            shop_id=user_shop.id
        )
    except OcrUnavailableError as oe:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"OCR engine unavailable: {oe}",
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception("Invoice extraction failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract invoice: {type(e).__name__}",
        )

@router.post("/confirm", response_model=InvoiceConfirmResponse, status_code=status.HTTP_201_CREATED)
def confirm_invoice(
    *,
    db: Session = Depends(deps.get_db),
    confirm_in: InvoiceConfirmRequest,
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    """
    Confirm reviewed invoice items in one transaction: restocks existing products, creates new ones,
    stores verified MRPs with their source and logs the purchase. The same supplier invoice number
    cannot be confirmed twice.
    """
    user_shop = get_user_shop_or_raise(db, current_user)
    try:
        return invoice_service.confirm_and_update_stock(
            db=db,
            shop_id=user_shop.id,
            confirm_in=confirm_in
        )
    except invoice_service.InvoiceConflictError as ce:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(ce))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception("Invoice confirmation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to confirm invoice stock update: {type(e).__name__}",
        )
