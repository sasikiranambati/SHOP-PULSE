import re
from typing import List, Tuple, Any, Optional
from uuid import UUID

from schemas.voice import (
    VoiceProductCandidate,
    MatchedVoiceItem,
    AmbiguousVoiceItem,
    UnmatchedVoiceItem,
)
from services.voice_parser import ExtractedItem

def normalize_text_for_search(text: str) -> str:
    """Removes punctuation and lowercases text for fuzzy token search while preserving Indic scripts."""
    cleaned = re.sub(r"[^a-zA-Z0-9\sऀ-ൿ]", " ", text)
    return " ".join(cleaned.lower().split())

PRODUCT_CONCEPT_ALIASES = {
    "Rice": [
        "rice", "basmati rice", "chawal", "white rice",
        "బియ్యం", "బాస్మతి బియ్యం", "రైస్",
        "चावल", "बासमती चावल", "राइस",
        "அரிசி", "பாஸ்மதி அரிசி",
        "ಅಕ್ಕಿ", "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ",
        "അരി", "ബസ്മതി അരി",
        "तांदूळ", "बासमती तांदूळ",
        "চাল", "বাসমতী চাল",
        "ચોખા", "ਬਾਸਮਤੀ ਚੌਲ", "ଚାଉଳ"
    ],
    "Tata Salt": [
        "tata salt", "salt", "tata salt 1kg",
        "టాటా సాల్ట్", "టాటా ఉప్పు", "ఉప్పు", "సాల్ట్",
        "टाटा नमक", "टाटा साल्ट", "नमक", "साल्ट",
        "டாடா உப்பு", "டாடா சால்ட்",
        "ಟಾಟಾ ಉಪ್ಪು", "ಟಾಟಾ ಸಾಲ್ಟ್"
    ],
    "Parle-G": [
        "parle-g", "parle g", "parleg", "parle g biscuits", "biscuits",
        "పార్లే-జి", "పార్లే జి", "పార్లే జీ", "బిస్కెట్లు",
        "पारले-जी", "पारले जी", "पारलेजी", "बिस्कुट",
        "பார்லே-ஜி", "ಪಾರ್ಲೆ-ಜಿ"
    ],
    "Aashirvaad Atta": [
        "aashirvaad atta", "ashirvad atta", "atta", "wheat flour",
        "ఆశీర్వాద్ గోధుమ పిండి", "ఆశీర్వాద్ పిండి", "ఆశీర్వాద్ ఆటా", "గోధుమ పిండి", "పిండి",
        "आशीर्वाद आटा", "आटा", "गेहूं का आटा",
        "ஆசீர்வாத் கோதுமை மாவு", "ஆசீர்வாத் மாவு",
        "ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು"
    ],
    "Toned Milk": [
        "toned milk", "milk", "amul milk",
        "టోన్డ్ పాలు", "పాలు",
        "टोन्ड दूध", "दूध",
        "பால்", "ಹಾಲು", "പാൽ"
    ],
    "Fresh White Bread": [
        "fresh white bread", "white bread", "bread",
        "వైట్ బ్రెడ్", "బ్రెడ్",
        "व्हाइट ब्रेड", "ब्रेड",
        "ரொட்டி", "ರೊಟ್ಟಿ"
    ],
    "Refined Sugar": [
        "refined sugar", "sugar",
        "చక్కెర", "పంచదార",
        "चीनी", "शक्कर",
        "சர்க்கரை", "ಸಕ್ಕರೆ"
    ],
    "Sunflower Cooking Oil": [
        "sunflower cooking oil", "sunflower oil", "oil", "cooking oil",
        "సన్‌ఫ్లవర్ నూనె", "వంట నూనె", "నూనె",
        "सनफ्लावर तेल", "तेल",
        "எண்ணெய்", "ಎಣ್ಣೆ"
    ],
    "Premium Assam Tea": [
        "premium assam tea", "assam tea", "tea",
        "అస్సాం టీ", "టీ", "చాయ్",
        "असम चाय", "चाय",
        "தேநீர்", "ಚಹಾ"
    ]
}

def to_candidate(p: Any) -> VoiceProductCandidate:
    """Converts a database Product or candidate model/dict to a uniform VoiceProductCandidate."""
    if isinstance(p, VoiceProductCandidate):
        return p
    if hasattr(p, "id"):
        return VoiceProductCandidate(
            id=str(p.id),
            name=p.name,
            selling_price=float(p.selling_price if hasattr(p, "selling_price") else getattr(p, "price", 0.0)),
            current_stock=int(p.current_stock if hasattr(p, "current_stock") else getattr(p, "stock", 0)),
            unit=str(p.unit or "pcs"),
            category=getattr(p, "category", None),
            sku=getattr(p, "sku", None),
        )
    return VoiceProductCandidate(
        id=str(p["id"]),
        name=p["name"],
        selling_price=float(p.get("selling_price", p.get("price", 0.0))),
        current_stock=int(p.get("current_stock", p.get("stock", 0))),
        unit=str(p.get("unit", "pcs")),
        category=p.get("category"),
        sku=p.get("sku"),
    )

def make_matched_item(prod: VoiceProductCandidate, item: ExtractedItem) -> MatchedVoiceItem:
    if getattr(item, "spoken_price", None) is not None and item.spoken_price > 0:
        line_total = round(float(item.spoken_price), 2)
        unit_price = round(line_total / float(item.quantity), 2) if item.quantity > 0 else line_total
    else:
        unit_price = prod.selling_price
        line_total = round(unit_price * float(item.quantity), 2)

    unit = getattr(item, "unit", None) or prod.unit

    return MatchedVoiceItem(
        product_id=prod.id,
        name=prod.name,
        quantity=item.quantity,
        unit_price=unit_price,
        total_price=line_total,
        unit=unit,
        current_stock=prod.current_stock,
        is_out_of_stock=prod.current_stock <= 0,
        is_insufficient_stock=float(item.quantity) > prod.current_stock,
        available_stock=max(0, prod.current_stock),
    )

def match_items_to_inventory(
    extracted_items: List[ExtractedItem],
    catalog: List[Any],
) -> Tuple[List[MatchedVoiceItem], List[AmbiguousVoiceItem], List[UnmatchedVoiceItem], float, float, float]:
    """
    Matches extracted natural language items against inventory products.
    Returns: (matched_items, ambiguous_items, unmatched_items, subtotal, tax, total).
    """
    candidates_catalog = [to_candidate(p) for p in catalog]

    matched_items: List[MatchedVoiceItem] = []
    ambiguous_items: List[AmbiguousVoiceItem] = []
    unmatched_items: List[UnmatchedVoiceItem] = []

    weights = ["1kg", "500g", "200g", "5kg", "100g", "400g", "1l", "2l"]

    for item in extracted_items:
        query_norm = normalize_text_for_search(item.name)
        if not query_norm:
            continue

        q_tokens = [w for w in query_norm.split() if len(w) > 1]
        query_weights = [w for w in weights if w in query_norm]
        
        # 0. Check Multilingual Concept Aliases (e.g. బియ్యం -> Rice, टाटा नमक -> Tata Salt)
        alias_matched_prod = None
        for concept_name, aliases in PRODUCT_CONCEPT_ALIASES.items():
            if any(alias in query_norm or query_norm in alias for alias in aliases):
                # Search candidates matching this concept
                concept_lower = concept_name.lower()
                c_matches = [
                    c for c in candidates_catalog
                    if concept_lower in c.name.lower() or (c.category and concept_lower in str(c.category).lower())
                ]
                if len(c_matches) == 1:
                    alias_matched_prod = c_matches[0]
                    break
                elif len(c_matches) > 1:
                    if query_weights:
                        weight_match = next((c for c in c_matches if any(w in normalize_text_for_search(c.name) and w in query_weights for w in query_weights)), None)
                        if weight_match:
                            alias_matched_prod = weight_match
                            break
                    ambiguous_items.append(
                        AmbiguousVoiceItem(
                            queried_name=item.name,
                            quantity=item.quantity,
                            candidates=c_matches,
                        )
                    )
                    alias_matched_prod = "AMBIGUOUS"
                    break

        if alias_matched_prod == "AMBIGUOUS":
            continue
        elif alias_matched_prod:
            matched_items.append(make_matched_item(alias_matched_prod, item))
            continue

        # 1. Check for exact full-name match (case-insensitive)
        exact_matches = [
            c for c in candidates_catalog 
            if normalize_text_for_search(c.name) == query_norm
        ]

        if len(exact_matches) == 1:
            matched_items.append(make_matched_item(exact_matches[0], item))
            continue

        # 2. Token containment search
        # Find candidates whose name contains all tokens of query
        all_token_matches = []
        for c in candidates_catalog:
            c_norm = normalize_text_for_search(c.name)
            if all(token in c_norm for token in q_tokens):
                all_token_matches.append(c)

        if len(all_token_matches) > 1 and query_weights:
            variant_filtered = [
                c for c in all_token_matches
                if any(w in normalize_text_for_search(c.name) for w in query_weights)
            ]
            if len(variant_filtered) == 1:
                all_token_matches = variant_filtered

        if len(all_token_matches) == 1:
            matched_items.append(make_matched_item(all_token_matches[0], item))
            continue
        elif len(all_token_matches) > 1:
            ambiguous_items.append(
                AmbiguousVoiceItem(
                    queried_name=item.name,
                    quantity=item.quantity,
                    candidates=all_token_matches,
                )
            )
            continue

        # 3. Partial overlap search (at least significant brand token matches)
        scored_matches = []
        for c in candidates_catalog:
            c_norm = normalize_text_for_search(c.name)
            match_count = sum(1 for token in q_tokens if token in c_norm)
            if match_count > 0:
                scored_matches.append((match_count, c))

        if scored_matches:
            scored_matches.sort(key=lambda x: -x[0])
            max_score = scored_matches[0][0]
            best_candidates = [c for score, c in scored_matches if score == max_score and score >= len(q_tokens) * 0.5]

            if len(best_candidates) > 1 and query_weights:
                variant_filtered = [
                    c for c in best_candidates
                    if any(w in normalize_text_for_search(c.name) for w in query_weights)
                ]
                if len(variant_filtered) == 1:
                    best_candidates = variant_filtered

            if len(best_candidates) == 1:
                matched_items.append(make_matched_item(best_candidates[0], item))
            elif len(best_candidates) > 1:
                ambiguous_items.append(
                    AmbiguousVoiceItem(
                        queried_name=item.name,
                        quantity=item.quantity,
                        candidates=best_candidates,
                    )
                )
            else:
                unmatched_items.append(
                    UnmatchedVoiceItem(
                        queried_name=item.name,
                        quantity=item.quantity,
                        reason="Product not found in shop inventory",
                    )
                )
        else:
            unmatched_items.append(
                UnmatchedVoiceItem(
                    queried_name=item.name,
                    quantity=item.quantity,
                    reason="Product not found in shop inventory",
                )
            )

    subtotal = round(sum(m.total_price for m in matched_items), 2)
    tax = 0.0  # ShopPulse standard GST calculation default
    total = round(subtotal + tax, 2)

    return matched_items, ambiguous_items, unmatched_items, subtotal, tax, total
