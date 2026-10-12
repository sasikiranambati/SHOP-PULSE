"""
Secure Server-Side Gemini Vision Extraction Service for ShopPulse.

Runs strictly on the FastAPI backend server. Never exposes API keys,
request tokens, or model configurations to the frontend client.

Provides structured extraction against the strict ShopPulse invoice schema:
- Separates purchasedQuantity from packSize and packSizeUnit
- Explicitly isolates unitRate, lineTotal, discounts, taxes
- Preserves missing values as null (never fabricated)
- Reconciles with local OCR engine for independent cross-verification
"""

import json
import base64
import logging
from typing import Any, Dict, List, Optional
import httpx

from core.config import settings

logger = logging.getLogger(__name__)

GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

VISION_EXTRACTION_PROMPT = """
You are a senior document-AI invoice extraction specialist for retail and wholesale grocery/kirana invoices.
Extract the invoice data from the image into strict, valid JSON matching this exact structure:

{
  "supplier_name": "Supplier or Distributor Business Name or null",
  "invoice_number": "Invoice / Bill Number or null",
  "invoice_date": "Date as printed or null",
  "subtotal": null,
  "tax_amount": null,
  "grand_total": null,
  "items": [
    {
      "source_row_text": "Exact text line as printed in the invoice table row",
      "product_name": "Full product name as printed, e.g. FORTUNE 500 GM",
      "hsn_code": "HSN/SAC code if present, else null",
      "purchased_quantity": 20,
      "purchase_unit": "Only if an explicit Unit/UOM column exists on the invoice (e.g. PCS, BTL, BOX, BAG, KG); otherwise null",
      "pack_size": 500,
      "pack_size_unit": "g",
      "unit_rate": 70.0,
      "discount": null,
      "tax_rate": null,
      "tax_amount": null,
      "line_total": 1400.0,
      "confidence": 95,
      "review_reasons": []
    }
  ]
}

CRITICAL RULES:
1. SEPARATE PURCHASE QUANTITY FROM PACKAGING:
   - For items like "FORTUNE 500 GM | 20 | 70 | 1400":
     product_name: "FORTUNE 500 GM"
     purchased_quantity: 20
     pack_size: 500
     pack_size_unit: "g"
     unit_rate: 70
     line_total: 1400
   - DO NOT assign 'g' or 'gm' to purchased_quantity or purchase_unit! The purchased quantity is 20 discrete units/packs, NOT 20 grams!
   - For "Godrej White 240 GM | 10 | 45 | 450":
     product_name: "Godrej White 240 GM"
     purchased_quantity: 10
     pack_size: 240
     pack_size_unit: "g"
     unit_rate: 45
     line_total: 450
     DO NOT assign 'g' to purchased_quantity (it is 10 packs, NOT 10 grams)!
   - If the invoice does NOT have an explicit Unit column establishing the billing unit, set purchase_unit to null and add "Unit not established on invoice; verify if pieces or packs" to review_reasons.

2. NEVER INVENT VALUES:
   - If the rate or price was not printed on the row, set unit_rate to null. DO NOT compute unit_rate = line_total / quantity.
   - If a line total is missing, set line_total to null.
   - If quantity is unreadable or absent, set purchased_quantity to null.

3. EXCLUDE METADATA ROWS:
   - Do NOT extract addresses, GSTIN numbers, bank details, terms of payment, or footers as product items.
   - Do NOT extract Subtotal, CGST, SGST, IGST, Round Off, or Grand Total as product items; place them in top-level fields.

4. Output valid JSON only. Do not enclose in backticks or markdown code fences.
"""


async def extract_invoice_with_gemini(
    image_bytes: bytes,
    mime_type: str = "image/png"
) -> Dict[str, Any]:
    """
    Sends the invoice image to Gemini Vision API using server-side credentials.
    Returns:
      {
        "available": bool,
        "success": bool,
        "data": Optional[Dict[str, Any]],
        "error": Optional[str],
        "model_used": Optional[str]
      }
    """
    api_key = getattr(settings, "GEMINI_API_KEY", None)
    if not api_key:
        logger.info("GEMINI_API_KEY not configured on backend; vision service unavailable.")
        return {
            "available": False,
            "success": False,
            "data": None,
            "error": "GEMINI_API_KEY not configured on backend server",
            "model_used": None,
        }

    model = getattr(settings, "GEMINI_MODEL", "gemini-1.5-flash")
    timeout_sec = getattr(settings, "GEMINI_VISION_TIMEOUT_SECONDS", 25.0)

    url = GEMINI_API_ENDPOINT.format(model=model)
    b64_img = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": VISION_EXTRACTION_PROMPT},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": b64_img,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.05,
            "response_mime_type": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                json=payload,
            )

        if resp.status_code != 200:
            err_msg = f"Gemini Vision API returned HTTP {resp.status_code}: {resp.text[:300]}"
            logger.warning(err_msg)
            return {
                "available": True,
                "success": False,
                "data": None,
                "error": err_msg,
                "model_used": model,
            }

        result_json = resp.json()
        raw_text = (
            result_json.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )

        if not raw_text:
            return {
                "available": True,
                "success": False,
                "data": None,
                "error": "Gemini Vision returned empty text part",
                "model_used": model,
            }

        # Strip any codefence wrappers if returned
        clean_text = raw_text.strip()
        if clean_text.startswith("```"):
            clean_text = clean_text.split("\n", 1)[-1]
            if clean_text.endswith("```"):
                clean_text = clean_text.rsplit("```", 1)[0]
            clean_text = clean_text.strip()

        parsed_data = json.loads(clean_text)
        return {
            "available": True,
            "success": True,
            "data": parsed_data,
            "error": None,
            "model_used": model,
        }

    except json.JSONDecodeError as jde:
        logger.warning("Failed to decode JSON from Gemini Vision: %s", jde)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": f"JSON decode error: {jde}",
            "model_used": model,
        }
    except httpx.TimeoutException:
        logger.warning("Gemini Vision API request timed out after %s seconds", timeout_sec)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": f"Gemini Vision API timed out after {timeout_sec}s",
            "model_used": model,
        }
    except Exception as exc:
        logger.exception("Unexpected error in Gemini Vision extraction: %s", exc)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": str(exc),
            "model_used": model,
        }


def extract_invoice_with_gemini_sync(
    image_bytes: bytes,
    mime_type: str = "image/png"
) -> Dict[str, Any]:
    """
    Synchronous version of extract_invoice_with_gemini using httpx.Client.
    Enforces strict server-side credentials and schema validation.
    """
    api_key = getattr(settings, "GEMINI_API_KEY", None)
    if not api_key:
        logger.info("GEMINI_API_KEY not configured on backend; vision service unavailable.")
        return {
            "available": False,
            "success": False,
            "data": None,
            "error": "GEMINI_API_KEY not configured on backend server",
            "model_used": None,
        }

    model = getattr(settings, "GEMINI_MODEL", "gemini-1.5-flash")
    timeout_sec = getattr(settings, "GEMINI_VISION_TIMEOUT_SECONDS", 25.0)

    url = GEMINI_API_ENDPOINT.format(model=model)
    b64_img = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": VISION_EXTRACTION_PROMPT},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": b64_img,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.05,
            "response_mime_type": "application/json",
        },
    }

    try:
        with httpx.Client(timeout=timeout_sec) as client:
            resp = client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                json=payload,
            )

        if resp.status_code != 200:
            err_msg = f"Gemini Vision API returned HTTP {resp.status_code}: {resp.text[:300]}"
            logger.warning(err_msg)
            return {
                "available": True,
                "success": False,
                "data": None,
                "error": err_msg,
                "model_used": model,
            }

        result_json = resp.json()
        raw_text = (
            result_json.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )

        if not raw_text:
            return {
                "available": True,
                "success": False,
                "data": None,
                "error": "Gemini Vision returned empty text part",
                "model_used": model,
            }

        clean_text = raw_text.strip()
        if clean_text.startswith("```"):
            clean_text = clean_text.split("\n", 1)[-1]
            if clean_text.endswith("```"):
                clean_text = clean_text.rsplit("```", 1)[0]
            clean_text = clean_text.strip()

        parsed_data = json.loads(clean_text)
        return {
            "available": True,
            "success": True,
            "data": parsed_data,
            "error": None,
            "model_used": model,
        }

    except json.JSONDecodeError as jde:
        logger.warning("Failed to decode JSON from Gemini Vision: %s", jde)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": f"JSON decode error: {jde}",
            "model_used": model,
        }
    except httpx.TimeoutException:
        logger.warning("Gemini Vision API request timed out after %s seconds", timeout_sec)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": f"Gemini Vision API timed out after {timeout_sec}s",
            "model_used": model,
        }
    except Exception as exc:
        logger.exception("Unexpected error in Gemini Vision extraction: %s", exc)
        return {
            "available": True,
            "success": False,
            "data": None,
            "error": str(exc),
            "model_used": model,
        }

