"""
AI Interpretation Service for ShopPulse Grocery OCR.
Orchestrates selective AI invocation, caching, timeout/retry handling, strict anti-hallucination validation,
financial data protection, and complete audit logging.
"""

from decimal import Decimal
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from services.grocery_ocr.ai.cache import ProductNormalizationCache
from services.grocery_ocr.ai.providers.base import IAIProvider
from services.grocery_ocr.ai.providers.gemini_provider import GeminiAIProvider
from services.grocery_ocr.ai.providers.groq_provider import GroqAIProvider
from services.grocery_ocr.ai.providers.mock_provider import MockAIProvider
from services.grocery_ocr.ai.schemas import (
    AIAuditEntry,
    AIHeaderSuggestionRequest,
    AIHeaderSuggestionResponse,
    AIProductSuggestionRequest,
    AIProductSuggestionResponse,
    AITelemetry,
)
from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import (
    AIAssistanceError,
    AIHallucinationSecurityViolation,
    AIProviderUnavailableError,
    AIRateLimitError,
    AIResponseValidationError,
    AITimeoutError,
)
from services.grocery_ocr.intelligence.brand_recognizer import BrandRecognizer
from services.grocery_ocr.intelligence.package_size_extractor import PackageSizeExtractor
from services.grocery_ocr.intelligence.taxonomy import ALL_GROCERY_CATEGORIES
from services.grocery_ocr.logger import get_logger
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem, PackageSize

logger = get_logger("ai.service")


class AIInterpretationService:
    """
    Orchestrator for AI-assisted grocery interpretation.
    Enforces deterministic-first principles: AI assists only ambiguous data and cannot touch financials.
    """

    def __init__(
        self,
        config: Optional[GroceryOCRConfig] = None,
        provider: Optional[IAIProvider] = None,
        cache: Optional[ProductNormalizationCache] = None,
    ):
        self.config = config or default_config
        self.cache = cache if cache is not None else ProductNormalizationCache(max_size=self.config.ai_cache_max_size)
        self.package_size_extractor = PackageSizeExtractor(self.config)
        self.brand_recognizer = BrandRecognizer()

        # Resolve provider
        if provider:
            self.provider = provider
        else:
            p_type = getattr(self.config, "ai_provider", "mock").lower()
            if p_type == "gemini":
                self.provider = GeminiAIProvider()
            elif p_type == "groq":
                self.provider = GroqAIProvider()
            else:
                self.provider = MockAIProvider()

        self.audit_log: List[AIAuditEntry] = []
        self.telemetry = AITelemetry()

    def should_invoke_for_item(self, item: ExtractedInvoiceItem) -> bool:
        """
        Determines whether an item genuinely requires AI interpretation.
        Avoids unnecessary AI calls to optimize performance and prevent costs.
        """
        if not getattr(self.config, "enable_ai_assistant", True):
            return False

        # Do not invoke AI if deterministic classification and name confidence are already confident (>= 85%)
        if item.classification_status == "GROCERY_CONFIDENT" and (item.name_confidence or 0.0) >= 85.0:
            return False

        # Trigger 1: Unknown or review-required classification status
        if item.classification_status in ("UNKNOWN_REVIEW_REQUIRED", "GROCERY_REVIEW_REQUIRED", "UNKNOWN_REVIEW"):
            return True

        # Trigger 2: Very low OCR confidence or name confidence
        if item.ocr_confidence < getattr(self.config, "ai_confidence_threshold", 75.0):
            return True

        if item.name_confidence < getattr(self.config, "ai_confidence_threshold", 75.0):
            return True

        # Trigger 3: Raw product name has obvious OCR garble or spelling corruption
        raw = item.raw_product_name.strip()
        if re.search(r"[a-z][A-Z]|[0-9]{3,}[A-Za-z]+", raw) and len(raw) > 5:
            return True

        return False

    def validate_suggestion_against_evidence(
        self,
        raw_text: str,
        suggestion: AIProductSuggestionResponse
    ) -> tuple[bool, Optional[str]]:
        """
        Enforces strict anti-hallucination guards against raw OCR evidence.
        1. Brand must have token overlap or registered alias in raw text.
        2. Package size numeric magnitude must exist in raw text.
        3. Category must be in retail grocery taxonomy.
        4. Absolutely no financial fields allowed.
        """
        raw_lower = raw_text.lower()

        # 1. Category validation
        if suggestion.suggested_category and suggestion.suggested_category not in ALL_GROCERY_CATEGORIES:
            if suggestion.suggested_category != "Groceries":
                return False, f"Category '{suggestion.suggested_category}' not in recognized grocery taxonomy"

        # 2. Brand hallucination guard
        if suggestion.suggested_brand:
            brand_clean = suggestion.suggested_brand.lower().strip()
            brand_words = [w for w in re.split(r"\W+", brand_clean) if len(w) > 1]
            raw_tokens = [w for w in re.split(r"\W+", raw_lower) if len(w) > 1]

            has_brand_evidence = any(w in raw_lower for w in brand_words) or brand_clean in raw_lower

            # Check fuzzy spelling tolerance for OCR errors (e.g. "ttaa" vs "tata", "fortuen" vs "fortune")
            if not has_brand_evidence:
                for bw in brand_words:
                    for rw in raw_tokens:
                        # Character set match for transposed or doubled letters (e.g. ttaa vs tata)
                        if set(bw) == set(rw) and abs(len(bw) - len(rw)) <= 1:
                            has_brand_evidence = True
                            break
                        # Levenshtein distance <= 2 for words with len >= 3
                        if abs(len(bw) - len(rw)) <= 2:
                            diff = sum(1 for a, b in zip(bw, rw) if a != b) + abs(len(bw) - len(rw))
                            if diff <= 2 and len(bw) >= 3:
                                has_brand_evidence = True
                                break
                    if has_brand_evidence:
                        break

            if not has_brand_evidence:
                return False, f"Brand '{suggestion.suggested_brand}' hallucinated: zero token overlap with '{raw_text}'"

        # 3. Package size magnitude guard
        if suggestion.suggested_package_size:
            # Extract numbers from suggested package size
            digits = re.findall(r"\d+(?:\.\d+)?", suggestion.suggested_package_size)
            for d in digits:
                if d not in raw_text:
                    return False, f"Package size magnitude '{d}' hallucinated: not found in raw OCR text '{raw_text}'"

        return True, None

    def interpret_product(
        self,
        item: ExtractedInvoiceItem,
        invoice_id: Optional[str] = None
    ) -> Optional[AIProductSuggestionResponse]:
        """
        Executes AI product interpretation with caching, timeout, retry, and validation.
        Returns validated suggestion or None if skipped/rejected/fallback.
        """
        raw_text = item.raw_product_name.strip()
        if not raw_text:
            return None

        # 1. Check Cache
        if getattr(self.config, "ai_cache_enabled", True):
            cached = self.cache.get(raw_text)
            if cached:
                self.telemetry.record_success(0.0, was_corrected=True, was_cache_hit=True)
                self._record_audit(
                    invoice_id=invoice_id,
                    stage="product_normalization_cached",
                    raw_text=raw_text,
                    suggestion=cached,
                    accepted=True,
                    rejection_reason=None,
                    requires_review=cached.requires_review
                )
                return cached

        # 2. Build privacy-safe minimal request
        request = AIProductSuggestionRequest(
            original_description=raw_text,
            raw_ocr_tokens=[w for w in item.raw_row_text.split() if len(w) > 1][:10],
            hsn_hint=item.hsn_code,
            existing_brand_hint=item.brand,
            catalogue_candidates=[]
        )

        start_time = time.time()
        suggestion: Optional[AIProductSuggestionResponse] = None
        rejection_reason: Optional[str] = None
        accepted = False
        max_retries = getattr(self.config, "ai_max_retries", 1)
        timeout_sec = getattr(self.config, "ai_timeout_seconds", 5)

        for attempt in range(max_retries + 1):
            try:
                suggestion = self.provider.suggest_product(request, timeout_seconds=timeout_sec)
                break
            except AITimeoutError as exc:
                logger.warning("AI provider timeout on attempt %d: %s", attempt + 1, exc)
                if attempt == max_retries:
                    self.telemetry.record_failure((time.time() - start_time) * 1000.0)
                    self._record_audit(
                        invoice_id=invoice_id,
                        stage="product_normalization_timeout",
                        raw_text=raw_text,
                        suggestion=None,
                        accepted=False,
                        rejection_reason=f"Timeout after {max_retries + 1} attempts",
                        requires_review=True
                    )
                    return None
            except AIRateLimitError as exc:
                logger.warning("AI rate limit encountered: %s", exc)
                self.telemetry.record_failure((time.time() - start_time) * 1000.0)
                self._record_audit(
                    invoice_id=invoice_id,
                    stage="product_normalization_rate_limit",
                    raw_text=raw_text,
                    suggestion=None,
                    accepted=False,
                    rejection_reason="Rate limit (HTTP 429)",
                    requires_review=True
                )
                return None
            except AIProviderUnavailableError as exc:
                logger.warning("AI provider unavailable: %s", exc)
                self.telemetry.record_failure((time.time() - start_time) * 1000.0)
                self._record_audit(
                    invoice_id=invoice_id,
                    stage="product_normalization_unavailable",
                    raw_text=raw_text,
                    suggestion=None,
                    accepted=False,
                    rejection_reason="Provider unavailable (HTTP 503)",
                    requires_review=True
                )
                return None
            except (AIResponseValidationError, ValueError) as exc:
                logger.warning("AI response validation failed: %s", exc)
                self.telemetry.record_failure((time.time() - start_time) * 1000.0)
                self._record_audit(
                    invoice_id=invoice_id,
                    stage="product_normalization_validation_error",
                    raw_text=raw_text,
                    suggestion=None,
                    accepted=False,
                    rejection_reason=f"Validation error: {exc}",
                    requires_review=True
                )
                return None
            except Exception as exc:
                logger.error("AI unexpected error on attempt %d: %s", attempt + 1, exc)
                if attempt == max_retries:
                    self.telemetry.record_failure((time.time() - start_time) * 1000.0)
                    return None

        duration_ms = (time.time() - start_time) * 1000.0

        if not suggestion:
            self.telemetry.record_failure(duration_ms)
            return None

        # 3. Post-Validation Hallucination Guards
        is_valid, reason = self.validate_suggestion_against_evidence(raw_text, suggestion)
        if not is_valid:
            accepted = False
            rejection_reason = reason
            logger.warning("AI suggestion rejected for '%s': %s", raw_text, reason)
            self.telemetry.record_failure(duration_ms)
            self._record_audit(
                invoice_id=invoice_id,
                stage="product_normalization_rejected",
                raw_text=raw_text,
                suggestion=suggestion,
                accepted=False,
                rejection_reason=rejection_reason,
                requires_review=True
            )
            return None

        # 4. Accepted
        accepted = True
        self.telemetry.record_success(duration_ms, was_corrected=True, was_cache_hit=False)

        # Cache safe result
        if getattr(self.config, "ai_cache_enabled", True):
            self.cache.set(raw_text, suggestion)

        self._record_audit(
            invoice_id=invoice_id,
            stage="product_normalization_accepted",
            raw_text=raw_text,
            suggestion=suggestion,
            accepted=True,
            rejection_reason=None,
            requires_review=suggestion.requires_review
        )

        return suggestion

    def apply_to_item(
        self,
        item: ExtractedInvoiceItem,
        suggestion: AIProductSuggestionResponse
    ) -> ExtractedInvoiceItem:
        """
        Safely applies approved AI suggestion to item.
        CRITICAL INVARIANT: Financial fields and quantities are STRICTLY PRESERVED.
        Any modification to quantities, rates, MRP, or amounts is an explicit failure.
        """
        # Snapshot deterministic numeric values before application
        orig_qty = item.quantity
        orig_unit = item.unit
        orig_p_price = item.purchase_price
        orig_s_price = item.selling_price
        orig_mrp = item.mrp
        orig_disc = item.discount
        orig_disc_pct = item.discount_pct
        orig_tax = item.tax_amount
        orig_gst = item.gst_rate
        orig_printed = item.printed_amount
        orig_calc = item.calculated_amount

        updates: Dict[str, Any] = {}

        # 1. Update normalized product name
        if suggestion.suggested_normalized_name:
            sugg_conf = round(suggestion.confidence * 100.0, 1)
            is_weak_fallback = suggestion.reason and "Generic heuristic normalization" in suggestion.reason
            if not is_weak_fallback and sugg_conf >= 70.0:
                updates["normalized_product_name"] = suggestion.suggested_normalized_name
                updates["name_confidence"] = sugg_conf

        # 2. Update brand
        if suggestion.suggested_brand:
            updates["brand"] = suggestion.suggested_brand
            updates["brand_confidence"] = round(suggestion.confidence * 100.0, 1)

        # 3. Update category
        if suggestion.suggested_category:
            updates["category"] = suggestion.suggested_category
            updates["category_confidence"] = round(suggestion.confidence * 100.0, 1)
            updates["classification_status"] = "GROCERY_HIGH_CONFIDENCE"

        # 4. Update package size if valid
        if suggestion.suggested_package_size:
            parsed_ps, _ = self.package_size_extractor.extract_package_size(suggestion.suggested_package_size)
            if parsed_ps:
                updates["package_size"] = parsed_ps
                updates["package_size_confidence"] = round(suggestion.confidence * 100.0, 1)

        # 5. Metadata tracking
        meta = dict(item.metadata)
        meta["ai_assisted"] = True
        meta["ai_model"] = self.provider.model_identifier
        meta["ai_provider"] = self.provider.provider_name
        meta["ai_confidence"] = suggestion.confidence
        meta["ai_reason"] = suggestion.reason
        updates["metadata"] = meta

        # Add audit explanation to suggestions or validation issues
        suggestions_list = list(item.suggestions)
        suggestions_list.append(f"AI Normalization ({self.provider.provider_name}): {suggestion.reason}")
        updates["suggestions"] = suggestions_list

        if suggestion.requires_review and item.validation_status != "INVALID":
            updates["validation_status"] = "REVIEW_REQUIRED"

        new_item = item.model_copy(update=updates)

        # STRICT VERIFICATION: Ensure financial data protection invariant
        assert new_item.quantity == orig_qty, "CRITICAL: AI altered item quantity!"
        assert new_item.unit == orig_unit, "CRITICAL: AI altered item unit!"
        assert new_item.purchase_price == orig_p_price, "CRITICAL: AI altered purchase price!"
        assert new_item.selling_price == orig_s_price, "CRITICAL: AI altered selling price!"
        assert new_item.mrp == orig_mrp, "CRITICAL: AI altered MRP!"
        assert new_item.discount == orig_disc, "CRITICAL: AI altered discount!"
        assert new_item.discount_pct == orig_disc_pct, "CRITICAL: AI altered discount percentage!"
        assert new_item.tax_amount == orig_tax, "CRITICAL: AI altered tax amount!"
        assert new_item.gst_rate == orig_gst, "CRITICAL: AI altered GST rate!"
        assert new_item.printed_amount == orig_printed, "CRITICAL: AI altered printed amount!"
        assert new_item.calculated_amount == orig_calc, "CRITICAL: AI altered calculated amount!"

        return new_item

    def _record_audit(
        self,
        invoice_id: Optional[str],
        stage: str,
        raw_text: str,
        suggestion: Optional[AIProductSuggestionResponse],
        accepted: bool,
        rejection_reason: Optional[str],
        requires_review: bool
    ):
        """Records auditable entry in memory."""
        entry = AIAuditEntry(
            decision_id=str(uuid.uuid4()),
            invoice_id=invoice_id,
            stage=stage,
            input_summary={"raw_product_name": raw_text},
            ai_suggestion=suggestion.model_dump() if suggestion else {},
            model_id=self.provider.model_identifier,
            provider=self.provider.provider_name,
            accepted=accepted,
            rejection_reason=rejection_reason,
            requires_manual_review=requires_review
        )
        self.audit_log.append(entry)
