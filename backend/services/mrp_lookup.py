"""
Maximum Retail Price (MRP) lookup against an external product API.

Every lookup returns an explicit status; an HTTP 200 alone never counts as success.
FOUND requires a matched product AND a valid value in the provider's documented MRP field.

Statuses:
  FOUND                    product matched and a valid MRP was returned
  PRODUCT_NOT_FOUND        provider has no matching product
  MRP_UNAVAILABLE          product matched (or provider reachable) but no valid MRP field
  MANUAL_REVIEW_REQUIRED   ambiguous product match, or provider MRP conflicts with the invoice
  API_AUTHENTICATION_ERROR HTTP 401/403 (missing or invalid credentials)
  API_RATE_LIMITED         HTTP 429
  API_TIMEOUT              request timed out
  API_CONFIGURATION_ERROR  provider not configured (missing key / base URL / MRP field)
  API_ERROR                HTTP 5xx, connection failure, malformed JSON
  SKIPPED                  lookup disabled or time budget exhausted

Secrets: API keys are only placed in request headers, never in URLs, logs or responses.
"""

import logging
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from core.config import settings
from services.product_matching import best_name_match, normalize_gtin

logger = logging.getLogger(__name__)

FOUND = "FOUND"
PRODUCT_NOT_FOUND = "PRODUCT_NOT_FOUND"
MRP_UNAVAILABLE = "MRP_UNAVAILABLE"
MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
API_AUTHENTICATION_ERROR = "API_AUTHENTICATION_ERROR"
API_RATE_LIMITED = "API_RATE_LIMITED"
API_TIMEOUT = "API_TIMEOUT"
API_CONFIGURATION_ERROR = "API_CONFIGURATION_ERROR"
API_ERROR = "API_ERROR"
SKIPPED = "SKIPPED"

# A failure that will repeat for every item in the same invoice
BATCH_FATAL = {API_AUTHENTICATION_ERROR, API_RATE_LIMITED, API_CONFIGURATION_ERROR}

MAX_PLAUSIBLE_MRP = 1_000_000.0
CACHE_TTL_SECONDS = 600


@dataclass
class LookupQuery:
    product_name: Optional[str] = None
    gtin: Optional[str] = None
    sku: Optional[str] = None

    def cache_key(self, provider: str) -> str:
        return f"{provider}|{self.gtin or ''}|{(self.product_name or '').strip().lower()}"


@dataclass
class MrpLookupResult:
    status: str
    provider: str
    message: str
    mrp: Optional[float] = None
    matched_name: Optional[str] = None
    brand: Optional[str] = None
    barcode: Optional[str] = None
    match_method: Optional[str] = None
    match_confidence: Optional[float] = None
    http_status: Optional[int] = None
    looked_up_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_mrp_value(value: Any) -> Optional[float]:
    """Accepts a positive, finite, plausible number (or numeric string such as '₹1,250.00')."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
    elif isinstance(value, str):
        cleaned = re.sub(r"(?i)₹|rs\.?|inr|,|\s", "", value)
        if not re.fullmatch(r"\d+(?:\.\d+)?", cleaned):
            return None
        num = float(cleaned)
    else:
        return None
    if not math.isfinite(num) or num <= 0 or num > MAX_PLAUSIBLE_MRP:
        return None
    return round(num, 2)


def _dig(obj: Any, dotted: Optional[str]) -> Any:
    if not dotted:
        return obj
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def redact(text: str, secret: Optional[str]) -> str:
    out = re.sub(r"(Bearer\s+)\S+", r"\1[REDACTED]", text or "", flags=re.I)
    if secret:
        out = out.replace(secret, "[REDACTED]")
    return out


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------


class OpenMRPProvider:
    """
    OpenMRP (api.openmrp.ai) is an open-source manufacturing / Material Requirements
    Planning platform. Its catalog items describe a tenant's own manufactured parts and
    products; the project documents no Maximum Retail Price field, no Indian retail
    catalogue and no GTIN lookup. Calling it cannot yield an MRP, so no request is made.
    """

    name = "openmrp"

    def lookup(self, query: LookupQuery) -> MrpLookupResult:
        if not (settings.OPENMRP_API_KEY or "").strip():
            return MrpLookupResult(
                API_CONFIGURATION_ERROR, self.name,
                "MRP lookup is not configured: OPENMRP_API_KEY is not set. OpenMRP also does not "
                "publish Maximum Retail Price, so configure an MRP-capable provider (MRP_PROVIDER).",
                looked_up_at=_now(),
            )
        return MrpLookupResult(
            MRP_UNAVAILABLE, self.name,
            "The configured provider, OpenMRP, is a manufacturing (Material Requirements Planning) "
            "platform and does not publish Maximum Retail Price. Enter the MRP manually or configure "
            "an MRP-capable provider.",
            looked_up_at=_now(),
        )


class NoProvider:
    name = "none"

    def lookup(self, query: LookupQuery) -> MrpLookupResult:
        return MrpLookupResult(
            API_CONFIGURATION_ERROR, self.name,
            "No MRP provider is configured (MRP_PROVIDER=none). Enter the MRP manually.",
            looked_up_at=_now(),
        )


class CustomHttpMrpProvider:
    """
    Generic JSON product API. Nothing is guessed: the MRP is read only from the field
    named in MRP_API_MRP_FIELD, which must be the provider's documented MRP field.
    """

    name = "custom_http"

    def __init__(self, client: Optional[httpx.Client] = None):
        self._client = client

    def _config_error(self) -> Optional[str]:
        missing = []
        if not settings.MRP_API_BASE_URL:
            missing.append("MRP_API_BASE_URL")
        if not settings.MRP_API_MRP_FIELD:
            missing.append("MRP_API_MRP_FIELD")
        if not (settings.MRP_API_BARCODE_PATH or settings.MRP_API_SEARCH_PATH):
            missing.append("MRP_API_BARCODE_PATH or MRP_API_SEARCH_PATH")
        if missing:
            return "MRP provider is not fully configured; missing " + ", ".join(missing) + "."
        return None

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json", "User-Agent": "ShopPulse-Backend/1.0"}
        key = (settings.MRP_API_KEY or "").strip()
        if key:
            scheme = (settings.MRP_API_AUTH_SCHEME or "").strip()
            headers[settings.MRP_API_AUTH_HEADER] = f"{scheme} {key}" if scheme else key
        return headers

    def _get(self, path: str, params: Optional[Dict[str, str]] = None) -> Tuple[Optional[Any], Optional[MrpLookupResult]]:
        url = settings.MRP_API_BASE_URL.rstrip("/") + "/" + path.lstrip("/")
        try:
            if self._client is not None:
                resp = self._client.get(url, params=params, headers=self._headers())
            else:
                with httpx.Client(timeout=settings.MRP_API_TIMEOUT_SECONDS, verify=True) as client:
                    resp = client.get(url, params=params, headers=self._headers())
        except httpx.TimeoutException:
            return None, self._result(API_TIMEOUT, "MRP provider did not respond in time.")
        except httpx.RequestError as exc:
            logger.warning("MRP provider connection error: %s", redact(str(exc), settings.MRP_API_KEY))
            return None, self._result(API_ERROR, "Could not connect to the MRP provider.")

        status = resp.status_code
        if status in (401, 403):
            return None, self._result(API_AUTHENTICATION_ERROR,
                                      f"MRP provider rejected the credentials (HTTP {status}). Check MRP_API_KEY.", status)
        if status == 429:
            retry = resp.headers.get("Retry-After")
            return None, self._result(API_RATE_LIMITED, "MRP provider rate limit reached" +
                                      (f"; retry after {retry}s." if retry else "."), status)
        if status == 404:
            return None, self._result(PRODUCT_NOT_FOUND, "Product not found at the MRP provider.", status)
        if status >= 500:
            return None, self._result(API_ERROR, f"MRP provider error (HTTP {status}).", status)
        if status < 200 or status >= 300:
            return None, self._result(API_ERROR, f"Unexpected MRP provider response (HTTP {status}).", status)
        try:
            return resp.json(), None
        except ValueError:
            return None, self._result(API_ERROR, "MRP provider returned malformed JSON.", status)

    def _result(self, status: str, message: str, http_status: Optional[int] = None, **kw: Any) -> MrpLookupResult:
        return MrpLookupResult(status, self.name, message, http_status=http_status, looked_up_at=_now(), **kw)

    def _candidates(self, body: Any) -> List[Dict[str, Any]]:
        data = _dig(body, settings.MRP_API_RESULTS_FIELD) if settings.MRP_API_RESULTS_FIELD else body
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return [c for c in data if isinstance(c, dict)]
        return []

    def _from_candidate(self, cand: Dict[str, Any], method: str, confidence: float) -> MrpLookupResult:
        name = _dig(cand, settings.MRP_API_NAME_FIELD)
        brand = _dig(cand, settings.MRP_API_BRAND_FIELD)
        barcode = _dig(cand, settings.MRP_API_BARCODE_FIELD)
        raw_mrp = _dig(cand, settings.MRP_API_MRP_FIELD)
        mrp = validate_mrp_value(raw_mrp)
        common = dict(matched_name=str(name) if name is not None else None,
                      brand=str(brand) if brand is not None else None,
                      barcode=str(barcode) if barcode is not None else None,
                      match_method=method, match_confidence=round(confidence, 3), http_status=200)
        if mrp is None:
            reason = "is missing" if raw_mrp is None else "is not a valid positive amount"
            return self._result(MRP_UNAVAILABLE,
                                f"Product matched, but the provider's MRP field '{settings.MRP_API_MRP_FIELD}' {reason}.",
                                **common)
        return self._result(FOUND, "MRP retrieved from provider.", mrp=mrp, **common)

    def lookup(self, query: LookupQuery) -> MrpLookupResult:
        err = self._config_error()
        if err:
            return self._result(API_CONFIGURATION_ERROR, err)

        gtin = normalize_gtin(query.gtin)
        if gtin and settings.MRP_API_BARCODE_PATH:
            printed = re.sub(r"\D", "", query.gtin or "")
            body, failure = self._get(settings.MRP_API_BARCODE_PATH.replace("{barcode}", printed))
            if failure and failure.status != PRODUCT_NOT_FOUND:
                return failure
            if body is not None:
                cands = self._candidates(body)
                exact = [c for c in cands if normalize_gtin(str(_dig(c, settings.MRP_API_BARCODE_FIELD) or "")) in (gtin, None)]
                exact_with_code = [c for c in exact if normalize_gtin(str(_dig(c, settings.MRP_API_BARCODE_FIELD) or "")) == gtin]
                chosen = exact_with_code or exact
                if len(chosen) == 1:
                    return self._from_candidate(chosen[0], "GTIN", 1.0)
                if len(chosen) > 1:
                    mrps = {validate_mrp_value(_dig(c, settings.MRP_API_MRP_FIELD)) for c in chosen}
                    if len(mrps) == 1:
                        return self._from_candidate(chosen[0], "GTIN", 1.0)
                    return self._result(MANUAL_REVIEW_REQUIRED,
                                        "Provider returned several records with different MRPs for this barcode.", 200)

        if not query.product_name or not settings.MRP_API_SEARCH_PATH:
            return self._result(PRODUCT_NOT_FOUND, "No barcode match and no name search available for this product.")

        body, failure = self._get(settings.MRP_API_SEARCH_PATH, {settings.MRP_API_SEARCH_PARAM: query.product_name})
        if failure:
            return failure
        cands = self._candidates(body)
        if gtin:
            # A different barcode on the candidate means a different product
            cands = [c for c in cands if normalize_gtin(str(_dig(c, settings.MRP_API_BARCODE_FIELD) or "")) in (gtin, None)]
        if not cands:
            return self._result(PRODUCT_NOT_FOUND, "Provider returned no matching products.", 200)

        match = best_name_match(query.product_name, cands, lambda c: str(_dig(c, settings.MRP_API_NAME_FIELD) or ""))
        if match.method == "AMBIGUOUS":
            return self._result(MANUAL_REVIEW_REQUIRED,
                                f"Several provider products match '{query.product_name}' equally well; choose the MRP manually.", 200,
                                match_method="AMBIGUOUS", match_confidence=round(match.score, 3))
        if match.candidate is None:
            return self._result(PRODUCT_NOT_FOUND,
                                f"No provider product matched '{query.product_name}' closely enough "
                                f"(best similarity {match.score:.2f}).", 200,
                                match_confidence=round(match.score, 3))
        return self._from_candidate(match.candidate, match.method, match.score)


def get_provider():
    name = (settings.MRP_PROVIDER or "openmrp").strip().lower()
    if name == "custom_http":
        return CustomHttpMrpProvider()
    if name == "none":
        return NoProvider()
    return OpenMRPProvider()


# --------------------------------------------------------------------------
# Lookup orchestration
# --------------------------------------------------------------------------

_cache: Dict[str, Tuple[float, MrpLookupResult]] = {}
_cache_lock = threading.Lock()
_CACHEABLE = {FOUND, PRODUCT_NOT_FOUND, MRP_UNAVAILABLE, MANUAL_REVIEW_REQUIRED}


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def lookup_mrp(query: LookupQuery, provider=None) -> MrpLookupResult:
    provider = provider or get_provider()
    key = query.cache_key(provider.name)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    try:
        result = provider.lookup(query)
    except Exception as exc:  # a provider bug must never break invoice scanning
        logger.error("MRP lookup failed unexpectedly: %s", redact(str(exc), settings.MRP_API_KEY))
        result = MrpLookupResult(API_ERROR, provider.name, "Unexpected error during MRP lookup.", looked_up_at=_now())
    if result.status in _CACHEABLE:
        with _cache_lock:
            _cache[key] = (now, result)
    return result


def lookup_mrp_batch(queries: Sequence[LookupQuery], provider=None) -> List[MrpLookupResult]:
    """Looks up several products within MRP_LOOKUP_TIME_BUDGET_SECONDS; never raises."""
    provider = provider or get_provider()
    if not queries:
        return []
    if not settings.MRP_LOOKUP_ENABLED:
        return [MrpLookupResult(SKIPPED, provider.name, "MRP lookup is disabled (MRP_LOOKUP_ENABLED=false).")
                for _ in queries]

    results: List[Optional[MrpLookupResult]] = [None] * len(queries)
    results[0] = lookup_mrp(queries[0], provider)
    if results[0].status in BATCH_FATAL:
        first = results[0]
        return [first] + [MrpLookupResult(first.status, first.provider, first.message, http_status=first.http_status,
                                          looked_up_at=first.looked_up_at) for _ in queries[1:]]

    deadline = time.monotonic() + max(0.0, settings.MRP_LOOKUP_TIME_BUDGET_SECONDS)
    pool = ThreadPoolExecutor(max_workers=4)
    try:
        futures = {pool.submit(lookup_mrp, q, provider): i for i, q in enumerate(queries) if i > 0}
        done, _ = wait(futures, timeout=max(0.0, deadline - time.monotonic()))
        for fut, idx in futures.items():
            if fut in done:
                results[idx] = fut.result()
            else:
                fut.cancel()
                results[idx] = MrpLookupResult(SKIPPED, provider.name,
                                               "MRP lookup skipped: time budget for this invoice was exhausted.")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return [r for r in results if r is not None]


def resolve_line_mrp(
    invoice_mrp: Optional[float],
    api: Optional[MrpLookupResult],
    store_mrp: Optional[float],
) -> Tuple[Optional[float], Optional[str], List[str], bool]:
    """
    Chooses the MRP shown for a scanned line and returns (mrp, source, issues, needs_review).
    - An MRP printed on the invoice is evidence and is kept as-is (source INVOICE).
    - Otherwise a FOUND provider value is used (source API).
    - A conflict between invoice and provider is flagged, never silently resolved.
    - A stored product MRP is never overwritten by a missing value; it is only compared.
    """
    issues: List[str] = []
    review = False
    invoice_valid = validate_mrp_value(invoice_mrp)
    api_mrp = api.mrp if api is not None and api.status == FOUND else None

    if invoice_valid is not None:
        mrp, source = invoice_valid, "INVOICE"
        if api_mrp is not None and abs(api_mrp - invoice_valid) > max(0.5, invoice_valid * 0.005):
            issues.append(f"MRP mismatch: invoice shows ₹{invoice_valid:g}, {api.provider} returned ₹{api_mrp:g}; "
                          "confirm the correct MRP")
            review = True
    elif api_mrp is not None:
        mrp, source = api_mrp, "API"
    else:
        mrp, source = None, None

    if mrp is not None and store_mrp is not None and abs(store_mrp - mrp) > 0.005:
        issues.append(f"MRP differs from the stored product MRP (₹{store_mrp:g}); it will be updated on confirm")
    return mrp, source, issues, review
