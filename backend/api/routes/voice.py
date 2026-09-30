import base64
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Header
from sqlalchemy.orm import Session
import jwt

from api import deps
from core.config import settings
from db.models.user import User
from db.models.product import Product
from schemas.voice import (
    VoiceProcessRequest,
    VoiceProcessResponse,
    VoiceStatusResponse,
)
from services import shop as shop_service
from services.speech import get_speech_service
from services.voice_parser import extract_items_from_transcript
from services.inventory_matcher import match_items_to_inventory, to_candidate

router = APIRouter()

SUPPORTED_LANGUAGES = [
    {"code": "en-IN", "name": "English (India)", "nativeName": "English"},
    {"code": "hi-IN", "name": "Hindi", "nativeName": "हिन्दी"},
    {"code": "te-IN", "name": "Telugu", "nativeName": "తెలుగు"},
    {"code": "ta-IN", "name": "Tamil", "nativeName": "தமிழ்"},
    {"code": "kn-IN", "name": "Kannada", "nativeName": "ಕನ್ನಡ"},
    {"code": "ml-IN", "name": "Malayalam", "nativeName": "മലയാളം"},
    {"code": "mr-IN", "name": "Marathi", "nativeName": "मराठी"},
    {"code": "bn-IN", "name": "Bengali", "nativeName": "বাংলা"},
    {"code": "gu-IN", "name": "Gujarati", "nativeName": "ગુજરાતી"},
    {"code": "pa-IN", "name": "Punjabi", "nativeName": "ਪੰਜਾਬੀ"},
    {"code": "or-IN", "name": "Odia", "nativeName": "ଓଡ଼ିଆ"},
]

def get_optional_current_user(db: Session, token: Optional[str]) -> Optional[User]:
    """Helper to retrieve user if a valid bearer token is provided, without failing if absent."""
    if not token:
        return None
    try:
        clean_token = token.replace("Bearer ", "").strip()
        payload = jwt.decode(clean_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if user_id:
            import uuid
            return db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    except Exception:
        return None
    return None

def resolve_catalog_products(
    db: Session,
    current_user: Optional[User],
    custom_products: Optional[List[Any]] = None
) -> List[Any]:
    """
    Resolves product catalog:
    1. If user is authenticated with a shop profile, fetch the shop's live products from DB.
    2. If custom_products are provided in the payload (e.g. from frontend active inventory or tests), use them.
    3. Fallback to all products available in DB for the workspace.
    """
    catalog = []
    if current_user:
        user_shop = shop_service.get_shop_by_owner(db, owner_id=current_user.id)
        if user_shop:
            catalog = db.query(Product).filter(Product.shop_id == user_shop.id).all()

    if not catalog and custom_products:
        return custom_products

    if not catalog:
        # Fallback to any products in DB
        catalog = db.query(Product).limit(100).all()

    return catalog

@router.get("/status", response_model=VoiceStatusResponse)
def get_voice_status() -> Any:
    """
    Returns the current status, provider mode (mock or sarvam),
    and whether external Speech-to-Text credentials are configured.
    """
    mode = (settings.VOICE_MODE or "mock").strip().lower()
    has_sarvam = bool(settings.SARVAM_API_KEY and settings.SARVAM_API_KEY.strip())
    is_mock = mode != "sarvam" or not has_sarvam

    return VoiceStatusResponse(
        voice_mode=mode,
        provider="mock" if is_mock else "sarvam",
        is_mock=is_mock,
        sarvam_configured=has_sarvam,
        supported_languages=SUPPORTED_LANGUAGES,
    )

@router.post("/process", response_model=VoiceProcessResponse)
async def process_voice_bill(
    request: VoiceProcessRequest,
    db: Session = Depends(deps.get_db),
    authorization: Optional[str] = Header(None),
) -> Any:
    """
    End-to-End Voice-to-Bill Pipeline:
    1. Speech-to-Text via configured provider (MockSpeechService or SarvamSpeechService).
    2. Natural Language Extraction of items and quantities.
    3. Inventory Matching against ShopPulse product database.
    4. Categorization into matched, ambiguous, and unmatched items with pricing & stock checks.
    """
    speech_service = get_speech_service()

    # Decode audio if provided as base64
    audio_bytes: Optional[bytes] = None
    if request.audio_base64:
        try:
            # Handle data:audio/...;base64, prefix if present
            raw_b64 = request.audio_base64
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            audio_bytes = base64.b64decode(raw_b64)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid base64 audio data: {str(e)}"
            )

    try:
        # Step 1: Transcribe speech or simulated text
        stt_result = await speech_service.transcribe(
            audio_data=audio_bytes,
            language_code=request.language_code or "en-IN",
            simulation_text=request.simulation_text,
            content_type=request.audio_content_type,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech-to-Text processing failed: {str(e)}"
        )

    # Step 2: Parse transcript into structured items
    transcript_text = stt_result.transcript or ""
    extracted_items = extract_items_from_transcript(transcript_text)

    # Step 3: Match with catalog (live authenticated user shop or provided custom products)
    current_user = get_optional_current_user(db, authorization)
    catalog = resolve_catalog_products(db, current_user=current_user, custom_products=request.custom_products)

    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted_items=extracted_items,
        catalog=catalog,
    )

    return VoiceProcessResponse(
        transcript=transcript_text,
        detected_language=stt_result.detected_language,
        provider=stt_result.provider,
        is_mock=stt_result.is_mock,
        matched_items=matched,
        ambiguous_items=ambiguous,
        unmatched_items=unmatched,
        subtotal=subtotal,
        tax=tax,
        total=total,
    )

@router.post("/upload-audio", response_model=VoiceProcessResponse)
async def process_voice_audio_upload(
    file: Optional[UploadFile] = File(None),
    simulation_text: Optional[str] = Form(None),
    language_code: Optional[str] = Form("en-IN"),
    db: Session = Depends(deps.get_db),
    authorization: Optional[str] = Header(None),
) -> Any:
    """
    Multipart form-data endpoint allowing direct browser audio recording upload.
    """
    audio_bytes = None
    content_type = "audio/webm"
    if file:
        audio_bytes = await file.read()
        content_type = file.content_type or "audio/webm"

    speech_service = get_speech_service()
    stt_result = await speech_service.transcribe(
        audio_data=audio_bytes,
        language_code=language_code,
        simulation_text=simulation_text,
        content_type=content_type,
    )

    transcript_text = stt_result.transcript or ""
    extracted_items = extract_items_from_transcript(transcript_text)

    current_user = get_optional_current_user(db, authorization)
    catalog = resolve_catalog_products(db, current_user=current_user, custom_products=None)
    matched, ambiguous, unmatched, subtotal, tax, total = match_items_to_inventory(
        extracted_items=extracted_items,
        catalog=catalog,
    )

    return VoiceProcessResponse(
        transcript=transcript_text,
        detected_language=stt_result.detected_language,
        provider=stt_result.provider,
        is_mock=stt_result.is_mock,
        matched_items=matched,
        ambiguous_items=ambiguous,
        unmatched_items=unmatched,
        subtotal=subtotal,
        tax=tax,
        total=total,
    )
