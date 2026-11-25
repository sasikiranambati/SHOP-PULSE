"""Context-aware speech-to-quantity disambiguation, confidence scoring, and replay diagnostics.

Resolves common English STT homophone errors (e.g. 'to Maggie' -> '2 Maggie',
'for Colgate' -> '4 Colgate', 'tree soaps' -> '3 soaps') ONLY when grammatical context,
unit structure, and live catalog product matching strongly support a billing quantity.
Never applies blind global string replacements and never hardcodes product brand names.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple


HOMOPHONE_QUANTITY_CANDIDATES: Dict[str, Dict[str, Any]] = {
    "to": {"num": 2, "word": "two", "base_prior": 0.80},
    "too": {"num": 2, "word": "two", "base_prior": 0.83},
    "tu": {"num": 2, "word": "two", "base_prior": 0.76},
    "for": {"num": 4, "word": "four", "base_prior": 0.70},
    "fore": {"num": 4, "word": "four", "base_prior": 0.84},
    "won": {"num": 1, "word": "one", "base_prior": 0.80},
    "ate": {"num": 8, "word": "eight", "base_prior": 0.79},
    "tree": {"num": 3, "word": "three", "base_prior": 0.75},
    "sex": {"num": 6, "word": "six", "base_prior": 0.83},
    "sikh": {"num": 6, "word": "six", "base_prior": 0.78},
}

# Ordinary English words that immediately disqualify a preceding homophone from being a quantity.
NON_BILL_FOLLOW_WORDS = {
    "the", "a", "an", "my", "your", "his", "her", "our", "their", "this", "that", "these", "those",
    "him", "them", "us", "me", "you", "it", "everyone", "someone", "anyone", "nobody",
    "go", "went", "going", "come", "came", "coming", "get", "got", "buy", "sell", "pay", "paid",
    "check", "open", "close", "make", "made", "take", "took", "give", "gave", "see", "saw",
    "know", "be", "is", "are", "was", "were", "do", "does", "did", "have", "has", "had",
    "very", "much", "many", "more", "most", "less", "expensive", "cheap", "costly",
    "high", "low", "big", "small", "late", "early", "fast", "slow", "good", "bad", "hot", "cold",
    "counter", "shop", "store", "market", "home", "house", "family", "people", "person", "persons",
    "friend", "friends", "customer", "customers", "today", "tomorrow", "yesterday", "now", "here",
    "there", "please", "thank", "thanks", "sale", "free", "work", "time", "times", "way",
}

# Preceding verbs/words after which "to" (or "for") almost certainly acts as a preposition/infinitive.
INFINITIVE_OR_PREP_PREV_WORDS = {
    "want", "wanted", "need", "needed", "like", "going", "go", "went", "come", "came",
    "give", "gave", "send", "sent", "talk", "speak", "listen", "try", "trying", "used",
    "ready", "able", "add", "added", "change", "changed", "set", "update", "updated", "convert",
}

CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS = NON_BILL_FOLLOW_WORDS | {
    "to", "too", "tu", "for", "of", "in", "on", "at", "by", "from", "with", "and", "or", "but",
    "not", "so", "up", "down", "out", "off", "over", "into", "about", "after", "before", "around",
    "want", "need", "like", "would", "could", "should", "will", "shall", "can", "may", "might",
    "just", "only", "also", "really", "actually", "hey", "hi", "hello", "ok", "okay", "yes", "no",
    "i", "we", "he", "she", "they", "who", "what", "when", "where", "why", "how",
}

FILLER_PREFIX_WORDS = {
    "please", "give", "me", "us", "get", "add", "bill", "pack", "want", "need", "i", "we",
    "could", "can", "you", "would", "like", "put", "take", "also", "then",
}

CONJUNCTION_SEPARATORS = {"and", "plus", "with", "aur", "mariyu", "matrum", "evam", "tatha"}

CONFIDENCE_HIGH_AUTO = 0.82
CONFIDENCE_MODERATE_CONFIRM = 0.60


@dataclass
class ContextualCorrectionDetail:
    token_index: int
    original_token: str
    suggested_quantity: Union_number
    matched_product_name: Optional[str]
    confidence: float
    decision: str  # "auto" | "confirm" | "rejected"
    source: str  # "contextual_homophone" | "stt_alternative"
    reason: str


Union_number = float | int


@dataclass
class ContextualResolutionResult:
    resolved_text: str
    corrections: List[ContextualCorrectionDetail] = field(default_factory=list)
    token_metadata: Dict[int, ContextualCorrectionDetail] = field(default_factory=dict)


def _norm_tok(tok: str) -> str:
    return re.sub(r"[^a-z0-9\u0900-\u0D7F]", "", tok.lower())


def _stem(tok: str) -> str:
    if len(tok) > 3 and tok.endswith("s") and not tok.endswith("ss"):
        return tok[:-1]
    return tok


def _phonetic_key(tok: str) -> str:
    if not tok.isascii():
        return tok
    s = re.sub(r"(.)\1+", r"\1", tok.lower())
    s = s.replace("ie", "i").replace("ee", "i").replace("oo", "u").replace("ph", "f").replace("aa", "a")
    if len(s) > 4 and s.endswith("e"):
        s = s[:-1]
    return s


def _lev_sim(a: str, b: str, *, pa: Optional[str] = None, pb: Optional[str] = None) -> float:
    sa, sb = _stem(a), _stem(b)
    if sa == sb:
        return 1.0
    if not sa or not sb or not sa.isascii() or not sb.isascii():
        return 0.0
    if sa.isdigit() or sb.isdigit():
        return 1.0 if sa == sb else 0.0
    if pa is None:
        pa = _phonetic_key(sa)
    if pb is None:
        pb = _phonetic_key(sb)
    if pa and pa == pb and min(len(sa), len(sb)) >= 3:
        return 0.92
    if abs(len(sa) - len(sb)) > 3 or min(len(sa), len(sb)) < 4:
        return 0.0
    # Fast character-overlap lower bound before running Levenshtein DP
    if len(set(sa) & set(sb)) + 2 < max(len(set(sa)), len(set(sb))) - 2:
        return 0.0
    if len(sa) < len(sb):
        sa, sb = sb, sa
    prev = list(range(len(sb) + 1))
    for i, ca in enumerate(sa, 1):
        curr = [i]
        for j, cb in enumerate(sb, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = curr
    return max(0.0, 1.0 - prev[-1] / max(len(sa), len(sb)))


_RE_CLEAN_CHARS = re.compile(r"[^a-zA-Z0-9\s\u0900-\u0D7F]")


@dataclass
class _IndexedCatalogEntry:
    name: str
    name_norm: str
    name_stems: List[str]
    name_phonetics: List[str]
    all_stems: set[str]
    cat_stems: List[str]
    cat_phonetics: List[str]


def build_light_catalog_index(catalog: Optional[Sequence[Any]]) -> List[_IndexedCatalogEntry]:
    """Builds a lightweight stemmed + phonetic catalog index once per transcript resolution call."""
    if not catalog:
        return []
    out: List[_IndexedCatalogEntry] = []
    for item in catalog:
        name = item.get("name", "") if isinstance(item, dict) else getattr(item, "name", "")
        category = item.get("category", "") if isinstance(item, dict) else getattr(item, "category", "")
        if not name:
            continue
        name_norm = " ".join(_RE_CLEAN_CHARS.sub(" ", str(name).lower()).split())
        toks = [t for t in name_norm.split() if len(t) > 1 or t.isdigit()]
        stems = [_stem(t) for t in toks]
        phonetics = [_phonetic_key(s) for s in stems]
        cat_norm = " ".join(_RE_CLEAN_CHARS.sub(" ", str(category or "").lower()).split())
        cat_stems = [_stem(t) for t in cat_norm.split() if len(t) > 2]
        cat_phonetics = [_phonetic_key(s) for s in cat_stems]
        out.append(_IndexedCatalogEntry(
            name=str(name),
            name_norm=name_norm,
            name_stems=stems,
            name_phonetics=phonetics,
            all_stems=set(stems),
            cat_stems=cat_stems,
            cat_phonetics=cat_phonetics,
        ))
    return out


_DISTINGUISHING_MODS = {"flour", "powder", "free", "brown", "black", "essential"}


def score_catalog_probe(probe_tokens: List[str], catalog_index: List[_IndexedCatalogEntry]) -> Tuple[float, Optional[str], bool]:
    """Scores a candidate product token slice against the shop catalog (0.0..1.0).

    Returns (best_score, matched_name, candidate_contains_first_probe_token).
    """
    if not probe_tokens or not catalog_index:
        return 0.0, None, False
    q_stems = [_stem(_norm_tok(t)) for t in probe_tokens if _norm_tok(t)]
    if not q_stems:
        return 0.0, None, False
    q_phonetics = [_phonetic_key(q) for q in q_stems]
    q_set = set(q_stems)
    q_joined = " ".join(q_stems)

    best_score = 0.0
    best_name: Optional[str] = None
    contains_first = False

    for entry in catalog_index:
        if entry.name_norm == q_joined:
            return 1.0, entry.name, (q_stems[0] in entry.all_stems)

        # Do not match sugar -> sugar-free etc.
        if (entry.all_stems - q_set) & _DISTINGUISHING_MODS:
            continue

        sims: List[float] = []
        primary_hit = False
        for idx_q, qt in enumerate(q_stems):
            qp = q_phonetics[idx_q]
            best_tok_sim = 0.0
            for ct, cp in zip(entry.name_stems, entry.name_phonetics):
                sim = _lev_sim(qt, ct, pa=qp, pb=cp)
                if sim > best_tok_sim:
                    best_tok_sim = sim
            if best_tok_sim >= 0.78:
                primary_hit = True
                sims.append(best_tok_sim)
            elif qt not in _DISTINGUISHING_MODS and entry.cat_stems:
                cat_sim = max((_lev_sim(qt, ct, pa=qp, pb=cp) for ct, cp in zip(entry.cat_stems, entry.cat_phonetics)), default=0.0)
                if cat_sim >= 0.85:
                    primary_hit = True
                    sims.append(0.86)
                else:
                    sims.append(0.0)
            else:
                sims.append(0.0)

        if not primary_hit:
            continue

        coverage = sum(1 for s in sims if s >= 0.78) / len(q_stems)
        avg_sim = sum(sims) / len(q_stems)
        score = min(0.98, 0.55 * coverage + 0.45 * avg_sim) if coverage >= 0.60 else 0.0
        if score > best_score:
            best_score = score
            best_name = entry.name
            contains_first = q_stems[0] in entry.all_stems

    return best_score, best_name, contains_first


def _is_numeric_like(tok: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", tok))


def _has_stt_alternative_corroboration(
    tokens: List[str],
    idx: int,
    expected_num: int,
    alternatives: Optional[Sequence[str]],
) -> bool:
    """Checks if browser Web Speech API alternatives placed the explicit digit/number at the same slot."""
    if not alternatives:
        return False
    num_str = str(expected_num)
    word_str = HOMOPHONE_QUANTITY_CANDIDATES.get(_norm_tok(tokens[idx]), {}).get("word", "")
    next_tok = _norm_tok(tokens[idx + 1]) if idx + 1 < len(tokens) else ""
    for alt in alternatives:
        alt_toks = [_norm_tok(t) for t in alt.split() if _norm_tok(t)]
        for j, at in enumerate(alt_toks):
            if at in {num_str, word_str} and (not next_tok or (j + 1 < len(alt_toks) and _lev_sim(alt_toks[j + 1], next_tok) >= 0.80)):
                return True
    return False


def is_conversational_non_product_phrase(
    phrase: str,
    catalog: Optional[Sequence[Any]] = None,
    *,
    catalog_index: Optional[List[_IndexedCatalogEntry]] = None,
) -> bool:
    """True when an unmatched phrase is purely ordinary conversational English prose (e.g. 'people came').

    Never suppresses unknown retail/brand words (e.g. 'UnknownItem', 'Magic Biscuits').
    """
    toks = [_norm_tok(t) for t in phrase.split() if _norm_tok(t)]
    if not toks:
        return True
    if not all(_stem(t) in CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS or t in CONVERSATIONAL_PROSE_NO_PRODUCT_TOKENS for t in toks):
        return False
    idx = catalog_index if catalog_index is not None else build_light_catalog_index(catalog)
    if idx:
        score, _, _ = score_catalog_probe(toks, idx)
        if score >= 0.65:
            return False
    return True


def resolve_contextual_homophones(
    normalized_text: str,
    catalog: Optional[Sequence[Any]] = None,
    *,
    catalog_index: Optional[List[_IndexedCatalogEntry]] = None,
    unit_words: Optional[set[str]] = None,
    stt_confidence: Optional[float] = None,
    speech_alternatives: Optional[Sequence[str]] = None,
    has_active_bill_context: bool = False,
) -> ContextualResolutionResult:
    """Safely disambiguates STT quantity homophones ('to', 'too', 'for', 'won', 'ate', 'tree', 'sex')
    using catalog evidence, unit context, grammatical boundaries, and optional STT alternatives.

    - Score >= 0.82 -> automatically substitutes the resolved digit so downstream segmentation & parsing treat it cleanly.
    - Score in [0.60, 0.82) -> keeps the homophone record as 'confirm' so matcher/UI can prompt 'Did you mean?'.
    - Score < 0.60 -> leaves the text untouched (zero false-positive corruption on phrases like 'Go to the counter').
    """
    if not normalized_text or not normalized_text.strip():
        return ContextualResolutionResult(resolved_text=normalized_text)

    tokens = normalized_text.split()
    n = len(tokens)
    if n < 2 or not any(_norm_tok(t) in HOMOPHONE_QUANTITY_CANDIDATES for t in tokens):
        return ContextualResolutionResult(resolved_text=normalized_text)

    resolved_catalog_index = catalog_index if catalog_index is not None else build_light_catalog_index(catalog)
    units_set = unit_words or set()
    output_tokens = list(tokens)
    corrections: List[ContextualCorrectionDetail] = []
    token_metadata: Dict[int, ContextualCorrectionDetail] = {}

    i = 0
    while i < n:
        raw_tok = tokens[i]
        low = _norm_tok(raw_tok)
        cand_info = HOMOPHONE_QUANTITY_CANDIDATES.get(low)
        if not cand_info or i + 1 >= n:
            i += 1
            continue

        expected_num = int(cand_info["num"])
        base_prior = float(cand_info["base_prior"])
        prev_raw = tokens[i - 1] if i > 0 else ""
        prev_low = _norm_tok(prev_raw)
        next_low = _norm_tok(tokens[i + 1])

        # 1. Hard grammatical exclusions
        if _is_numeric_like(next_low) or next_low in NON_BILL_FOLLOW_WORDS:
            corrections.append(ContextualCorrectionDetail(
                token_index=i, original_token=raw_tok, suggested_quantity=expected_num,
                matched_product_name=None, confidence=0.0, decision="rejected",
                source="contextual_homophone", reason="Followed by ordinary word or digit",
            ))
            i += 1
            continue

        # Infinitive/preposition guard when previous token is an infinitive-taking verb
        # without an already completed item boundary (e.g. "I want to ...")
        prev2_low = _norm_tok(tokens[i - 2]) if i >= 2 else ""
        if low in {"to", "for"} and prev_low in INFINITIVE_OR_PREP_PREV_WORDS:
            # Allow filler "add" right before homophone+product ("add to Maggie"), reject "want to" / "go to"
            if not (prev_low in {"add", "pack", "bill"} and i <= 1):
                corrections.append(ContextualCorrectionDetail(
                    token_index=i, original_token=raw_tok, suggested_quantity=expected_num,
                    matched_product_name=None, confidence=0.0, decision="rejected",
                    source="contextual_homophone", reason=f"Preceded by grammatical verb/command '{prev_low}'",
                ))
                i += 1
                continue

        # 2. Extract candidate window (skipping optional unit + "of")
        probe_start = i + 1
        has_unit = False
        if next_low in units_set:
            has_unit = True
            probe_start += 1
            if probe_start < n and _norm_tok(tokens[probe_start]) == "of":
                probe_start += 1

        # Build contiguous non-number, non-conjunction candidate window (up to 3 words)
        cand_window: List[str] = []
        for j in range(probe_start, min(n, probe_start + 3)):
            t_j = tokens[j]
            low_j = _norm_tok(t_j)
            if not low_j or _is_numeric_like(low_j) or low_j in CONJUNCTION_SEPARATORS:
                break
            # Stop before a subsequent token that is clearly another homophone + catalog item
            if j > probe_start and low_j in HOMOPHONE_QUANTITY_CANDIDATES and j + 1 < n:
                nxt_after = _norm_tok(tokens[j + 1])
                if nxt_after not in NON_BILL_FOLLOW_WORDS and resolved_catalog_index:
                    nxt_score, _, _ = score_catalog_probe([tokens[j + 1]], resolved_catalog_index)
                    if nxt_score >= 0.75:
                        break
            if low_j in NON_BILL_FOLLOW_WORDS:
                break
            cand_window.append(t_j)

        if not cand_window and not has_unit:
            i += 1
            continue

        # 3. Check product integrity WITH homophone included (e.g. "Tea Tree Oil" / "Tree Soap" brand)
        with_score = 0.0
        contains_self = False
        if resolved_catalog_index and cand_window:
            with_score, _, contains_self = score_catalog_probe([raw_tok] + cand_window[:2], resolved_catalog_index)

        best_prod_score = 0.0
        best_prod_name: Optional[str] = None
        if resolved_catalog_index and cand_window:
            for k in range(1, len(cand_window) + 1):
                sc, name, _ = score_catalog_probe(cand_window[:k], resolved_catalog_index)
                if sc > best_prod_score:
                    best_prod_score = sc
                    best_prod_name = name

        if contains_self and with_score >= best_prod_score:
            corrections.append(ContextualCorrectionDetail(
                token_index=i, original_token=raw_tok, suggested_quantity=expected_num,
                matched_product_name=best_prod_name, confidence=0.0, decision="rejected",
                source="contextual_homophone", reason="Token belongs to catalog product name itself",
            ))
            i += 1
            continue

        # 4. Alternative hypothesis corroboration from browser Web Speech API
        alt_match = _has_stt_alternative_corroboration(tokens, i, expected_num, speech_alternatives)

        # 5. Grammar position context: strong at utterance/clause start, after fillers, comma, conjunction, or completed item
        at_clause_start = (
            i == 0
            or prev_raw.endswith((",", ";"))
            or prev_low in CONJUNCTION_SEPARATORS
            or (prev_low in FILLER_PREFIX_WORDS and (i == 1 or _norm_tok(tokens[i - 2]) in FILLER_PREFIX_WORDS))
        )
        # Completed previous item exists when there is an explicit number earlier in the prefix before prev_low
        has_completed_prev_item = any(
            _is_numeric_like(_norm_tok(t)) or _norm_tok(t) in HOMOPHONE_QUANTITY_CANDIDATES
            for t in tokens[max(0, i - 4):i]
        )

        score = base_prior
        if best_prod_score >= 0.90:
            score += 0.16
        elif best_prod_score >= 0.80:
            score += 0.12
        elif best_prod_score >= 0.72:
            score += 0.06
        elif has_unit and best_prod_score == 0.0 and not resolved_catalog_index:
            # No catalog provided (unit-only structural evidence)
            score -= 0.05
        else:
            # No catalog match at all when catalog is present -> do not invent a quantity
            score -= 0.55

        if at_clause_start or has_completed_prev_item:
            score += 0.08
        elif low in {"to", "for"}:
            # Mid-clause after a bare unquantified noun ("sugar for tea", "milk to tea") is genuinely ambiguous
            score -= 0.14

        if has_unit:
            score += 0.08
        if has_active_bill_context:
            score += 0.04
        if alt_match:
            score += 0.16
        elif stt_confidence is not None:
            if stt_confidence < 0.80:
                score += 0.04
            elif stt_confidence >= 0.96 and low == "for" and not at_clause_start:
                score -= 0.05

        score = max(0.0, min(1.0, round(score, 3)))

        if score >= CONFIDENCE_HIGH_AUTO:
            decision = "auto"
            tag = (
                f"__qauto_{expected_num}_{low}_{int(round(score * 1000))}_"
                f"{'stt_alternative' if alt_match else 'contextual_homophone'}__"
            )
            output_tokens[i] = tag
        elif score >= CONFIDENCE_MODERATE_CONFIRM:
            decision = "confirm"
            tag = (
                f"__qconf_{expected_num}_{low}_{int(round(score * 1000))}_"
                f"{'stt_alternative' if alt_match else 'contextual_homophone'}__"
            )
            output_tokens[i] = tag
        else:
            decision = "rejected"

        detail = ContextualCorrectionDetail(
            token_index=i,
            original_token=raw_tok,
            suggested_quantity=expected_num,
            matched_product_name=best_prod_name,
            confidence=score,
            decision=decision,
            source="stt_alternative" if alt_match else "contextual_homophone",
            reason=(
                f"Catalog match '{best_prod_name}' ({best_prod_score:.2f})"
                if best_prod_name
                else "Insufficient catalog context"
            ),
        )
        corrections.append(detail)
        if decision in {"auto", "confirm"}:
            token_metadata[i] = detail

        i += 1

    return ContextualResolutionResult(
        resolved_text=" ".join(output_tokens),
        corrections=corrections,
        token_metadata=token_metadata,
    )


_TAG_PATTERN = re.compile(r"^__q(auto|conf)_(\d+)_([a-z0-9]+)_(\d+)_([a-z_]+)__$", re.IGNORECASE)


def parse_context_qty_tag(tok: str) -> Optional[Dict[str, Any]]:
    """Parses an internal contextual quantity tag emitted by resolve_contextual_homophones."""
    m = _TAG_PATTERN.match(tok.strip())
    if not m:
        return None
    return {
        "mode": m.group(1).lower(),
        "quantity": int(m.group(2)),
        "original_token": m.group(3),
        "confidence": round(int(m.group(4)) / 1000.0, 3),
        "source": m.group(5),
    }


def strip_context_tags_to_digits(text: str) -> str:
    """Converts internal contextual tags back to readable digits/words for raw_text telemetry."""
    def _repl(m: re.Match) -> str:
        return m.group(2) if m.group(1).lower() == "auto" else m.group(3)
    return re.sub(r"__q(auto|conf)_(\d+)_([a-z0-9]+)_(\d+)_([a-z_]+)__", _repl, text, flags=re.IGNORECASE)


def classify_voice_replay_outcome(
    *,
    spoken_intent: Optional[str],
    stt_transcript: str,
    extracted_pairs: List[Tuple[str, float]],
    expected_pairs: List[Tuple[str, float]],
    ambiguous_count: int = 0,
    matched_items_raw: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """Classifies a replayed utterance to separate STT failures from parser failures (Phase 10).

    Categories:
    - PASS: extracted items/quantities match expected outcome accurately.
    - STT_CORRUPTED_RECOVERED: STT drifted (e.g. 'To Maggie' instead of 'Two Maggie'), yet contextual parsing recovered it.
    - AMBIGUOUS_CONFIRMATION: triggered 'Did you mean?' confirmation for borderline homophone certainty.
    - FALSE_POSITIVE: expected zero items (ordinary prose), yet bill items/quantities were generated.
    - STT_FAILURE: expected non-empty items failed because STT dropped or garbled the core tokens.
    - PARSER_FAILURE: clean STT transcript matched spoken intent, yet parser/matcher failed to produce expected output.
    """
    norm_intent = " ".join((spoken_intent or "").lower().split())
    norm_stt = " ".join((stt_transcript or "").lower().split())
    stt_matched_intent = (not norm_intent) or (norm_intent == norm_stt)

    got_norm = [(name.lower(), round(float(qty), 3)) for name, qty in extracted_pairs]
    exp_norm = [(name.lower(), round(float(qty), 3)) for name, qty in expected_pairs]

    if not exp_norm:
        if got_norm:
            return {"classification": "FALSE_POSITIVE", "stt_drifted": not stt_matched_intent, "got": got_norm}
        return {"classification": "PASS", "stt_drifted": not stt_matched_intent, "got": got_norm}

    if got_norm == exp_norm:
        used_ctx = any(
            getattr(m, "quantity_source", None) in {"contextual_homophone", "stt_alternative"}
            for m in (matched_items_raw or [])
        )
        classification = "STT_CORRUPTED_RECOVERED" if (not stt_matched_intent or used_ctx) else "PASS"
        return {"classification": classification, "stt_drifted": not stt_matched_intent, "got": got_norm}

    if ambiguous_count > 0 and not got_norm:
        return {"classification": "AMBIGUOUS_CONFIRMATION", "stt_drifted": not stt_matched_intent, "got": got_norm}

    return {
        "classification": "PARSER_FAILURE" if stt_matched_intent else "STT_FAILURE",
        "stt_drifted": not stt_matched_intent,
        "got": got_norm,
    }


