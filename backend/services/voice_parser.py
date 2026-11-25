import re
from typing import Any, List, Sequence, Tuple, Optional, Union
from pydantic import BaseModel

class ExtractedItem(BaseModel):
    name: str
    quantity: Union[int, float] = 1
    # Registered unit id (kg, g, L, ml, pcs, packet, ...) when a unit was spoken; None when not spoken
    unit: Optional[str] = None
    # Spoken line total ("3 tea for 100 rupees" -> 100)
    spoken_price: Optional[float] = None
    # Spoken price per unit ("100 rupees each", "60 rupees per kg"); price_unit is the unit it is per
    # (None for "each": per spoken unit)
    spoken_unit_price: Optional[float] = None
    price_unit: Optional[str] = None
    # Action intent: "add", "remove", "update"
    action: Optional[str] = "add"
    explicit_quantity: bool = True
    raw_text: Optional[str] = None
    package_size: Optional[str] = None

# Comprehensive mapping of spoken numbers to integer digits across English and Indian languages
NUMBER_WORDS = {
    # English
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
    # Fractions & Spoken quantities
    "half": 0.5,
    "quarter": 0.25,
    "aadha": 0.5,
    "adha": 0.5,
    "ara": 0.5,
    "paavu": 0.25,
    "pao": 0.25,
    "pav": 0.25,
    "dedh": 1.5,
    "dhai": 2.5,
    "आधा": 0.5,
    "अर": 0.5,
    "పావు": 0.25,
    "అర": 0.5,
    "அரை": 0.5,
    "கால்": 0.25,
    "ಅರ್ಧ": 0.5,
    "ಕಾಲು": 0.25,
    "അര": 0.5,
    "കാൽ": 0.25,
    "अर्धा": 0.5,
    "আধা": 0.5,
    "અડધો": 0.5,
    "ਅੱਧਾ": 0.5,
    "ଅଧା": 0.5,
    # Hindi / Hinglish transliterations
    "ek": 1,
    "do": 2,
    "teen": 3,
    "char": 4,
    "chaar": 4,
    "paanch": 5,
    "panch": 5,
    "che": 6,
    "chhe": 6,
    "saat": 7,
    "aath": 8,
    "nau": 9,
    "das": 10,
    "dus": 10,
    "gyarah": 11,
    "barah": 12,
    "pandrah": 15,
    "bees": 20,
    "pachees": 25,
    "tees": 30,
    "chalis": 40,
    "pachaas": 50,
    "sau": 100,
    # Telugu transliterations
    "okati": 1,
    "rendu": 2,
    "moodu": 3,
    "naalugu": 4,
    "aidu": 5,
    "aaru": 6,
    "yedu": 7,
    "enimidi": 8,
    "tommidi": 9,
    "padi": 10,
    # Tamil transliterations
    "onnu": 1,
    "ondru": 1,
    "moonu": 3,
    "naalu": 4,
    "anju": 5,
    "yezhu": 7,
    "ettu": 8,
    "onbadhu": 9,
    "patthu": 10,
    # Devanagari numerals
    "एक": 1,
    "दो": 2,
    "तीन": 3,
    "चार": 4,
    "पांच": 5,
    "पाँच": 5,
    "छह": 6,
    "सात": 7,
    "आठ": 8,
    "नौ": 9,
    "दस": 10,
    "बारह": 12,
    "पंद्रह": 15,
    "बीस": 20,
    "पचास": 50,
    "सौ": 100,
    # Telugu script numerals & words
    "ఒకటి": 1,
    "ఒక": 1,
    "రెండు": 2,
    "మూడు": 3,
    "నాలుగు": 4,
    "ఐదు": 5,
    "ఆరు": 6,
    "ఏడు": 7,
    "ఎనిమిది": 8,
    "తొమ్మిది": 9,
    "పది": 10,
    "ఇరవై": 20,
    "ముప్పై": 30,
    "యాభై": 50,
    "నూరు": 100,
    "వంద": 100,
    # Tamil script
    "ஒன்று": 1,
    "ஒரு": 1,
    "இரண்டு": 2,
    "ரெண்டு": 2,
    "மூன்று": 3,
    "நான்கு": 4,
    "ஐந்து": 5,
    "பத்து": 10,
    # Kannada script
    "ಒಂದು": 1,
    "ಎರಡು": 2,
    "ಮೂರು": 3,
    "ನಾಲ್ಕು": 4,
    "ಐದು": 5,
    "ಹತ್ತು": 10,
    # Bengali & Assamese script
    "এক": 1,
    "দুই": 2,
    "তিন": 3,
    "তিনি": 3,
    "চার": 4,
    "চাৰি": 4,
    "পাঁচ": 5,
    "ছয়": 6,
    "সাত": 7,
    "আট": 8,
    "আঠ": 8,
    "নয়": 9,
    "ন": 9,
    "দশ": 10,
    "দহ": 10,
    # Malayalam script
    "ഒന്ന്": 1,
    "രണ്ട്": 2,
    "മൂന്ന്": 3,
    "നാല്": 4,
    "അഞ്ച്": 5,
    "പത്ത്": 10,
    # Marathi script
    "दोन": 2,
    "पाच": 5,
    "सहा": 6,
    "नऊ": 9,
    "दहा": 10,
    # Gujarati script
    "એક": 1,
    "બે": 2,
    "ત્રણ": 3,
    "ચાર": 4,
    "પાંચ": 5,
    "છ": 6,
    "સાત": 7,
    "આઠ": 8,
    "નવ": 9,
    "દસ": 10,
    # Punjabi script
    "ਇੱਕ": 1,
    "ਦੋ": 2,
    "ਤਿੰਨ": 3,
    "ਚਾਰ": 4,
    "ਪੰਜ": 5,
    "ਛੇ": 6,
    "ਸੱਤ": 7,
    "ਅੱਠ": 8,
    "ਨੌਂ": 9,
    "ਦਸ": 10,
    # Odia script
    "ଏକ": 1,
    "ଦୁଇ": 2,
    "ତିନି": 3,
    "ଚାରି": 4,
    "ପାଞ୍ଚ": 5,
    "ଛଅ": 6,
    "ସାତ": 7,
    "ଆଠ": 8,
    "ନଅ": 9,
    "ଦଶ": 10,
}

# Unit qualifiers that follow or precede numbers
PACKAGING_UNITS_REGEX = r"\b(?:కిలోల?|కేజీల?|లీటర్ల?|ప్యాకెట్ల?|బాటిల్|సంచులు|किलो|लीटर|पैकेट|बोतल|पॉकेट|கிலோ|லிட்டர்|பாக்கெட்|ಕಿಲೋ|ಲೀಟರ್|ಕിലോ|ലിറ്റർ|কেজি|packets?|pkts?|pouches?|pouch|boxes?|box|dabba|dappe|pieces?|pcs?|pc|bottles?|btls?|cans?|bags?|cartons?|ctns?|tubes?|bars?|tins?|jars?|sachets?|strips?|rolls?|trays?|bori|basta|units?|milliliters?|millilitres?|mls?|liters?|litres?|ltrs?|ltr|kg|kgs|kilo|kilos|kilograms?|grams?|gms?|gm)\b(?:\s+of\b)?"

UNIT_STRING_LIST = [
    "kilogram", "kilograms", "kg", "kgs", "kilo", "kilos", "gram", "grams", "g", "gm", "gms",
    "milliliter", "milliliters", "millilitre", "millilitres", "ml", "mls",
    "liter", "liters", "litre", "litres", "l", "ltr", "ltrs",
    "packet", "packets", "pack", "packs", "pkt", "pkts", "pouch", "pouches",
    "piece", "pieces", "pc", "pcs", "unit", "units",
    "box", "boxes", "bottle", "bottles", "btl", "btls", "bag", "bags",
    "carton", "cartons", "ctn", "tube", "tubes", "bar", "bars",
    "tin", "tins", "can", "cans", "jar", "jars", "sachet", "sachets",
    "strip", "strips", "roll", "rolls", "tray", "trays",
    "కిలో", "కిలోలు", "కిలోల", "కేజీ", "కేజీలు", "కేజీల", "లీటర్", "లీటర్లు", "లీటర్ల", "ప్యాకెట్", "ప్యాకెట్లు", "ప్యాకెట్ల",
    "किलो", "किलों", "लीटर", "लीटरों", "पैकेट", "पैकेटों", "बोतल",
    "கிலோ", "லிட்டர்", "பாக்கெட்",
    "ಕಿಲೋ", "ಲೀಟರ್", "ಪ್ಯಾಕೆಟ್",
    "കിലോ", "ലിറ്റർ", "പാക്കറ്റ്"
]

# Spoken unit words in regional scripts / colloquial English, mapped to canonical registry unit ids.
# Language vocabulary only: the units themselves (families, factors, fraction rules) come from the registry.
REGIONAL_UNIT_IDS = {
    **{w: "kg" for w in ["కిలో", "కిలోలు", "కిలోల", "కేజీ", "కేజీలు", "కేజీల", "किलो", "किलों", "கிலோ", "ಕಿಲೋ", "ಕിലോ", "কেজি", "kilogram", "kilograms"]},
    **{w: "L" for w in ["లీటర్", "లీటర్లు", "లీటర్ల", "लीटर", "लीटरों", "லிட்டர்", "ಲೀటర్", "ലിറ്റർ", "litre", "litres", "liter", "liters"]},
    **{w: "packet" for w in ["ప్యాకెట్", "ప్యాకెట్లు", "ప్యాకెట్ల", "पैकेट", "पैकेटों", "पॉकेट", "பாக்கெட்", "ಪ್ಯಾಕೆಟ್", "പാക്കറ്റ്"]},
    **{w: "bottle" for w in ["बोतल", "బాటిల్"]},
    "dabba": "box", "dappe": "box", "సంచులు": "bag", "basta": "bag",
}


def canonical_voice_unit(word: Optional[str]) -> Optional[str]:
    """Registry unit id for a spoken unit word, or None when it is not a unit ("unit", "each", unknown).

    An unrecognised word is never turned into pcs: the product's own unit applies instead."""
    if not word or not word.strip():
        return None
    from services.unit_registry import try_normalize_unit  # local import keeps the parser import-light
    w = word.strip()
    return try_normalize_unit(w.lower()) or REGIONAL_UNIT_IDS.get(w.lower()) or REGIONAL_UNIT_IDS.get(w)


SORTED_UNITS_PATTERN = "|".join(re.escape(u) for u in sorted(UNIT_STRING_LIST, key=lambda x: -len(x)))

CURRENCY_REGEX = r"(?:రూపాయలు|రూ|రూ\.|రూపాయ|ర రూపాయలు|रुपये|रुपया|रु|रु\.|रू|रूपए|ரூபாய்|ரூ|ರೂಪಾಯಿ|രൂപ|টাকা|રૂપિયા|ਰੁਪਏ|ਟଙ୍କਾ|টকা|rupees?|rs|rs\.|inr)"

# Conversational fillers at start or end of phrases
CONVERSATIONAL_FILLERS = [
    r"^(?:please\s+)?(?:could\s+you\s+|can\s+you\s+|can\s+i\s+get\s+|could\s+i\s+get\s+|i\s+would\s+like\s+|i'd\s+like\s+|give\s+me|give\s+us|get\s+me|i\s+want|we\s+want|i\s+need|we\s+need|need|want|please|add|bill|put\s+down|put|take|pack|remove|delete|cancel|change|update|make|also\s+add|also|then|bhejo|dena|daal\s+do|likho|chahiye|ivvandi|kaavali|తీసివేయి|తీసేయి|హటాओ|निकालो)\s+",
    r"\s+(?:chahiye|dena|daal\s+do|likho|bhejo|ivvandi|kaavali|please)$",
    r" (?:kripya|bhai|bhaiya|ji|andi|ayya) ",
]

_ENGLISH_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_ENGLISH_UNITS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
}
_ENGLISH_SUB_HUNDRED = {
    **_ENGLISH_UNITS,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    **_ENGLISH_TENS,
}

def _replace_english_compounds(text: str) -> str:
    """Normalizes compound English numbers (e.g. 'twenty five' -> '25', 'one hundred twenty' -> '120')."""
    tens_pat = "|".join(_ENGLISH_TENS.keys())
    units_pat = "|".join(_ENGLISH_UNITS.keys())
    sub_pat = "|".join(sorted(_ENGLISH_SUB_HUNDRED.keys(), key=len, reverse=True))

    def _hundred_repl(m: re.Match) -> str:
        base = _ENGLISH_UNITS[m.group(1).lower()] * 100
        rest_t = m.group(2)
        rest_u = m.group(3)
        if rest_t and rest_u:
            return f" {base + _ENGLISH_TENS[rest_t.lower()] + _ENGLISH_UNITS[rest_u.lower()]} "
        if rest_t:
            return f" {base + _ENGLISH_SUB_HUNDRED[rest_t.lower()]} "
        return f" {base} "

    text = re.sub(
        rf"\b({units_pat})\s+hundred(?:\s+and)?(?:\s+({sub_pat})(?:[-\s]+({units_pat}))?)?\b",
        _hundred_repl,
        text,
        flags=re.IGNORECASE,
    )

    def _tens_repl(m: re.Match) -> str:
        return f" {_ENGLISH_TENS[m.group(1).lower()] + _ENGLISH_UNITS[m.group(2).lower()]} "

    return re.sub(
        rf"\b({tens_pat})[-\s]+({units_pat})\b",
        _tens_repl,
        text,
        flags=re.IGNORECASE,
    )

def normalize_digits_and_numbers(text: str) -> str:
    """
    Replaces spoken number words, Devanagari digits, and fractions with numeric characters.
    """
    s = text.strip()

    # Convert all 10 Indic script digits to standard 0-9
    indic_digits_map = {
        '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
        '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4', '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
        '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
        '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4', '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9',
        '੦': '0', '੧': '1', '੨': '2', '੩': '3', '੪': '4', '੫': '5', '੬': '6', '੭': '7', '੮': '8', '੯': '9',
        '୦': '0', '୧': '1', '୨': '2', '୩': '3', '୪': '4', '୫': '5', '୬': '6', '୭': '7', '୮': '8', '୯': '9',
        '೦': '0', '೧': '1', '೨': '2', '೩': '3', '೪': '4', '೫': '5', '೬': '6', '೭': '7', '೮': '8', '೯': '9',
        '൦': '0', '൧': '1', '൨': '2', '൩': '3', '൪': '4', '൫': '5', '൬': '6', '൭': '7', '൮': '8', '൯': '9',
        '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
    }
    indic_trans = str.maketrans("".join(indic_digits_map.keys()), "".join(indic_digits_map.values()))
    s = s.translate(indic_trans)

    s = f" {s} "

    # Regional compound numbers & prices
    s = re.sub(r"(?<=\s)(?:నూట\s+యాభై|ఒక\s+వంద\s+యాభై)(?=\s)", " 150 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?<=\s)(?:నూట\s+ఇరవై|వంద\s+ఇరవై)(?=\s)", " 120 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?<=\s)(?:एक\s+सौ\s+बीस)(?=\s)", " 120 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?<=\s)(?:one\s+hundred\s+twenty)(?=\s)", " 120 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?<=\s)(?:एक\s+सौ\s+पचास)(?=\s)", " 150 ", s, flags=re.IGNORECASE)

    # Fractions & composites
    s = re.sub(r"\b(?:one\s+and\s+a\s+half|one\s+and\s+half|1\s+and\s+a\s+half|1\s+and\s+half)\b", " 1.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:two\s+and\s+a\s+half|two\s+and\s+half|2\s+and\s+a\s+half|2\s+and\s+half)\b", " 2.5 ", s, flags=re.IGNORECASE)
    # Fractions of a unit keep the unit (it decides the stock quantity, e.g. half kg of a g product)
    s = re.sub(r"\b(?:half\s+a\s+kg|half\s+kg|half\s+kilo)\b", " 0.5 kg ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:half\s+a\s+(?:liter|litre)|half\s+liter|half\s+litre|half\s+ltr)\b", " 0.5 liter ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:quarter\s+kg|quarter\s+kilo)\b", " 0.25 kg ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:quarter\s+liter|quarter\s+litre)\b", " 0.25 liter ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:1\/2|½)\b", " 0.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:1\/4|¼)\b", " 0.25 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:3\/4|¾)\b", " 0.75 ", s, flags=re.IGNORECASE)

    # Telugu spoken fractions
    s = re.sub(r"(?:ఒకటిన్నర)", " 1.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:రెండున్నర)", " 2.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:అర\s+కిలో|అర\s+కేజీ)", " 0.5 కిలో ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:అర\s+లీటర్)", " 0.5 లీటర్ ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:పావు\s+కిలో|పావు\s+కేజీ)", " 0.25 కిలో ", s, flags=re.IGNORECASE)

    # Hindi spoken fractions
    s = re.sub(r"(?:डेढ़\s+किलो)", " 1.5 किलो ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:डेढ़|डेढ)", " 1.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:ढाई\s+किलो)", " 2.5 किलो ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:ढाई)", " 2.5 ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:आधा\s+किलो)", " 0.5 किलो ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:आधा\s+लीटर)", " 0.5 लीटर ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:पाव\s+किलो)", " 0.25 किलो ", s, flags=re.IGNORECASE)
    s = re.sub(r"(?:पाव)", " 0.25 ", s, flags=re.IGNORECASE)

    # Composite dozen expressions
    s = re.sub(r"\b(?:half\s+dozen|aadha\s+dozen|aadha\s+darjan|adha\s+dozen)\b", " 6 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:one\s+dozen|1\s+dozen|dozen|darjan)\b", " 12 ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:two\s+dozen|2\s+dozen)\b", " 24 ", s, flags=re.IGNORECASE)

    # Compound English numbers before single-word replacement
    s = _replace_english_compounds(s)

    # Contextual "a"/"an" only when directly preceding a unit or dozen (never corrupting product names)
    s = re.sub(
        r"\b(?:a|an)\s+(?=(?:kg|kgs|kilo|kilos|kilogram|kilograms|gram|grams|gm|gms|liter|liters|litre|litres|ltr|ltrs|ml|mls|milliliter|milliliters|millilitre|millilitres|packet|packets|pack|packs|pkt|pkts|bottle|bottles|btl|btls|bag|bags|box|boxes|carton|cartons|pouch|pouches|piece|pieces|pc|pcs|tube|tubes|bar|bars|tin|tins|jar|jars|can|cans|dozen)\b)",
        " 1 ",
        s,
        flags=re.IGNORECASE,
    )

    # Word-boundary replacement for single number words
    for word, val in sorted(NUMBER_WORDS.items(), key=lambda x: -len(x[0])):
        if word.isascii():
            pattern = rf"\b{re.escape(word)}\b"
        else:
            pattern = rf"(?<![ऀ-ൿ\w]){re.escape(word)}(?![ऀ-ൿ\w])"
        s = re.sub(pattern, f" {val} ", s, flags=re.IGNORECASE)

    return re.sub(r"\s+", " ", s).strip()

# Price connector words left in the product text once the price itself is removed ("tea for", "soap at")
_PRICE_CONNECTORS = r"(?:for|at|@|each|apiece|rate|ka|ki|ke)"


def _strip_price_connectors(text: str) -> str:
    text = re.sub(r"\b(?:each|apiece)\b", " ", text, flags=re.IGNORECASE)
    prev = None
    while prev != text:
        prev = text
        text = re.sub(rf"\s+{_PRICE_CONNECTORS}\s*$", "", text.strip(), flags=re.IGNORECASE)
    return text.strip()


def _trailing_unit(text: str) -> Optional[str]:
    """Registry unit id of a count / package word ending the product text ("tea packets" -> packet).

    Measure abbreviations are not taken from the end of a name ("Parle G" is a brand, not grams)."""
    m = re.search(rf"(?:^|\s)({SORTED_UNITS_PATTERN})$", _strip_price_connectors(text), flags=re.IGNORECASE)
    unit = canonical_voice_unit(m.group(1)) if m else None
    if unit is None:
        return None
    from services.unit_registry import FAMILIES, UNITS
    return None if FAMILIES[UNITS[unit].family].kind == "measure" else unit


def _extract_price(s: str) -> Tuple[str, Optional[float], Optional[float], Optional[str]]:
    """Remove a spoken price from the clause.

    Returns (remaining text, line total, unit price, unit the price is per). "100 rupees each" or
    "45 rupees per kg" is a unit price (never taken as the line total); "100 rupees" or "for 100" is the
    line total. Nothing is guessed when no price is spoken."""
    cur = CURRENCY_REGEX
    per = rf"(?:each|apiece|a\s+piece|per\s+(?:piece|item|({SORTED_UNITS_PATTERN})))(?![\wऀ-ൿ])"
    unit_price = re.search(
        rf"(?:(?:@|\bat)\s*)?(?:(?:{cur})\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:{cur})?)\s*{per}",
        s, flags=re.IGNORECASE)
    if unit_price:
        value = float(unit_price.group(1) or unit_price.group(2))
        price_unit = canonical_voice_unit(unit_price.group(3)) if unit_price.group(3) else None
        rest = (s[:unit_price.start()] + " " + s[unit_price.end():]).strip()
        return rest, None, value, price_unit
    total = re.search(rf"(?:{cur})\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:{cur})", s, flags=re.IGNORECASE)
    if total:
        rest = (s[:total.start()] + " " + s[total.end():]).strip()
        return rest, float(total.group(1) or total.group(2)), None, None
    # "3 soap for 100": a trailing "for <amount>" is the line total when another number gives the quantity
    for_total = re.search(r"\bfor\s+(\d+(?:\.\d+)?)\s*$", s, flags=re.IGNORECASE)
    if for_total and re.search(r"\d", s[:for_total.start()]):
        return s[:for_total.start()].strip(), float(for_total.group(1)), None, None
    return s, None, None, None


def clean_product_name(raw_name: str) -> str:
    """
    Cleans extracted product text: removes leading unit qualifiers, conversational fillers,
    and trailing plurals while strictly preserving package weights/sizes (like 1kg, 500g).
    """
    name = _strip_price_connectors(raw_name.strip())
    # Remove leading conversational fillers
    for pattern in CONVERSATIONAL_FILLERS:
        name = re.sub(pattern, "", name, flags=re.IGNORECASE).strip()

    # Remove leading packaging units (e.g. "kg rice" -> "rice", "packets of salt" -> "salt")
    name = re.sub(r"^(?:" + PACKAGING_UNITS_REGEX + r")\s*", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(r"^\s*of\s+", "", name, flags=re.IGNORECASE).strip()

    # Normalize whitespace
    name = re.sub(r"\s+", " ", name).strip(" ,.-;")

    # Preserve spoken trailing package sizes ("Tata Salt 1 kg" -> "Tata Salt 1kg") rather than stripping the unit
    name = re.sub(
        r"\b(\d+(?:\.\d+)?)\s+(kg|kgs|g|gm|gms|grams?|ml|mls|l|ltr|litre|litres|liter|liters)\b",
        lambda m: f"{m.group(1)}{canonical_voice_unit(m.group(2)) or m.group(2).lower()}",
        name,
        flags=re.IGNORECASE,
    )

    # Remove trailing isolated packaging unit if not part of a size like 1kg (already compacted above)
    name = re.sub(r"\s+(?:" + PACKAGING_UNITS_REGEX + r")$", "", name, flags=re.IGNORECASE).strip()

    # Strip leading modifier noise left after quantity ("add 2 more Maggie" -> "more Maggie" -> "Maggie")
    name = re.sub(r"^more\s+", "", name, flags=re.IGNORECASE).strip()

    # Remove simple plural 's' at the end of common count/commodity words if appropriate
    words = name.split()
    cleaned_words = []
    for w in words:
        lower_w = w.lower()
        if lower_w in ["salts", "attas", "milks", "breads", "butters", "rices", "sugars", "oils", "biscuits", "soaps", "shampoos", "chocolates", "tubes", "bars"]:
            cleaned_words.append(w[:-1])
        else:
            cleaned_words.append(w)
    name = " ".join(cleaned_words)

    # Remove spoken currency terms and price amounts
    name = re.sub(rf"\d+(?:\.\d+)?\s*{CURRENCY_REGEX}", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(rf"{CURRENCY_REGEX}\s*\d+(?:\.\d+)?", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(rf"{CURRENCY_REGEX}", "", name, flags=re.IGNORECASE).strip()

    # Standardize common spelling/brand aliases for Indian FMCG
    name_lower = name.lower()
    if name_lower in ["parle g", "parle-g", "parleg", "పార్లే జి", "పార్లే జీ", "पारले जी", "பார்லே ஜி"]:
        name = "Parle-G"
    elif name_lower in ["tata salt", "tata namak", "టాటా ఉప్పు", "టాటా సాల్ట్", "टाटा नमक", "टाटा साल्ट", "டாடா உப்பு", "டாடா சால்ట్", "ಟಾಟಾ ಉಪ್ಪು"]:
        name = "Tata Salt"
    elif name_lower in ["aashirvaad atta", "ashirvad atta", "aashirwad atta", "ఆశీర్వాద్ గోధుమ పిండి", "ఆశీర్వాద్ పిండి", "ఆశీర్వాద్ ఆటా", "आशीर्वाद आटा"]:
        name = "Aashirvaad Atta"

    return name.strip()


_CURRENCY_WORDS = {
    "rupees", "rupee", "rs", "rs.", "inr",
    "రూపాయలు", "రూ", "రూపాయ", "रुपये", "रुपया", "रु", "रूपए",
    "ரூபாய்", "ರೂಪಾಯಿ", "രൂപ", "টাকা", "રૂપિયા", "ਰੁਪਏ", "ଟଙ୍କਾ", "টকা",
}
_UNIT_WORDS_SET = {u.lower() for u in UNIT_STRING_LIST}
_NON_PRODUCT_TOKENS = _UNIT_WORDS_SET | _CURRENCY_WORDS | {"of", "for", "at", "@", "per", "each", "apiece", "more", "the", "please"}


def _catalog_phrase_set(catalog: Optional[Sequence[Any]]) -> set[str]:
    """Normalized catalog product names (both spaced and tight weight forms) for segmentation boundary hints."""
    phrases: set[str] = set()
    if not catalog:
        return phrases
    for item in catalog:
        raw_name = item.get("name", "") if isinstance(item, dict) else getattr(item, "name", "")
        if not raw_name:
            continue
        norm = " ".join(re.sub(r"[^a-zA-Z0-9\sऀ-ൿ]", " ", raw_name.lower()).split())
        if norm:
            phrases.add(norm)
            phrases.add(re.sub(r"\s+", "", norm))
            # Split "1kg" <-> "1 kg" so "Tata Salt 1 kg" recognizes "Tata Salt 1kg"
            spaced = re.sub(r"(\d+(?:\.\d+)?)(kg|g|gm|ml|l)\b", r"\1 \2", norm)
            phrases.add(spaced)
    return phrases


def _is_numeric_token(tok: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", tok))


def _is_product_word(tok: str) -> bool:
    low = tok.lower().strip(",.;:-")
    if not low or _is_numeric_token(low) or low.startswith("__pkg_"):
        return False
    if low in _NON_PRODUCT_TOKENS:
        return False
    return bool(re.search(r"[a-zA-Zऀ-ൿ]", low))


def _number_belongs_to_catalog_product(
    cur_tokens: List[str], tokens: List[str], idx: int, catalog_phrases: set[str]
) -> bool:
    """True when numeric token at idx (e.g. '1 kg', '5 Star', '2 Min') extends a catalog product name rather than starting a new item."""
    if not catalog_phrases:
        return False
    num_tok = tokens[idx].lower()
    next_tok = tokens[idx + 1].lower() if idx + 1 < len(tokens) else ""
    next2_tok = tokens[idx + 2].lower() if idx + 2 < len(tokens) else ""

    # Look at last 1-3 product words before the number (excluding leading qty tokens)
    raw_tail = [re.sub(r"[^a-zA-Z0-9ऀ-ൿ]", "", t.lower()) for t in cur_tokens[-4:]]
    prod_words = [w for w in raw_tail if w and not _is_numeric_token(w) and w not in _NON_PRODUCT_TOKENS]
    if not prod_words:
        return False

    probes = []
    for k in range(1, min(3, len(prod_words)) + 1):
        sub_prefix = prod_words[-k:]
        if next_tok in _UNIT_WORDS_SET:
            probes.append(" ".join(sub_prefix + [num_tok, next_tok]))
            probes.append(" ".join(sub_prefix + [f"{num_tok}{next_tok}"]))
        if next_tok:
            probes.append(" ".join(sub_prefix + [num_tok, next_tok]))
            if next2_tok:
                probes.append(" ".join(sub_prefix + [num_tok, next_tok, next2_tok]))

    for probe in probes:
        if any(probe in cp for cp in catalog_phrases):
            return True
    return False


def _segment_continuous_clause(clause: str, catalog_phrases: set[str]) -> List[str]:
    """
    Splits an unpunctuated spoken clause into per-item sub-clauses using numeric boundaries,
    unit positions, currency endings, and dynamic catalog phrase awareness.
    """
    tokens = clause.split()
    if len(tokens) <= 2:
        return [clause]

    slices: List[str] = []
    n = len(tokens)
    start = 0

    while start < n:
        has_leading_qty = _is_numeric_token(tokens[start])
        has_prod = False
        i = start
        if has_leading_qty:
            i += 1
            # Skip immediate leading unit ("2 kg of rice" -> advance past "kg", "of")
            if i < n and tokens[i].lower() in _UNIT_WORDS_SET:
                i += 1
                if i < n and tokens[i].lower() == "of":
                    i += 1

        split_at: Optional[int] = None
        while i < n:
            tok = tokens[i]
            low = tok.lower()

            if _is_product_word(tok):
                has_prod = True
                i += 1
                continue

            # Split right AFTER a completed currency phrase if more item tokens follow ("90 rupees 3 soap")
            if low in _CURRENCY_WORDS and i + 1 < n and not tokens[i + 1].lower() in {"each", "apiece", "per"}:
                if has_prod and (_is_numeric_token(tokens[i + 1]) or _is_product_word(tokens[i + 1])):
                    split_at = i + 1
                    break

            if _is_numeric_token(tok) and has_prod:
                prev_low = tokens[i - 1].lower() if i > start else ""
                next_low = tokens[i + 1].lower() if i + 1 < n else ""

                # Keep numbers forming part of a price or explicit unit price or package size ("of 70 g")
                if prev_low in {"for", "at", "@", "rs", "rs.", "inr"} or "₹" in prev_low:
                    i += 1
                    continue
                if prev_low == "of" and next_low in {"g", "gm", "gms", "gram", "grams", "kg", "kgs", "ml", "mls", "l", "ltr", "litre", "litres", "liter", "liters"}:
                    i += 1
                    continue
                if next_low in _CURRENCY_WORDS | {"each", "apiece", "per"}:
                    i += 1
                    continue

                # Keep catalog-embedded product numbers/sizes ("Tata Salt 1 kg", "Maggi 2 Min")
                if _number_belongs_to_catalog_product(tokens[start:i], tokens, i, catalog_phrases):
                    i += 1
                    continue

                if has_leading_qty:
                    # "5 Maggie 2 Colgate" -> split right before "2"
                    if i + 1 < n:
                        split_at = i
                        break
                else:
                    # Reverse order: "Maggie 5 packets Colgate 2" -> consume qty + optional unit, then split after
                    end_idx = i + 1
                    if end_idx < n and tokens[end_idx].lower() in _UNIT_WORDS_SET:
                        end_idx += 1
                    # Keep trailing price on this item if immediately present
                    if end_idx < n and (
                        tokens[end_idx].lower() in {"for", "at", "@"}
                        or (_is_numeric_token(tokens[end_idx]) and end_idx + 1 < n and tokens[end_idx + 1].lower() in _CURRENCY_WORDS | {"each", "apiece", "per"})
                    ):
                        i = end_idx
                        continue
                    if end_idx < n:
                        split_at = end_idx
                        break

            i += 1

        if split_at is not None and split_at > start:
            slices.append(" ".join(tokens[start:split_at]).strip())
            start = split_at
        else:
            slices.append(" ".join(tokens[start:]).strip())
            break

    return [sl for sl in slices if sl]


def _extract_package_size(text: str) -> Tuple[str, Optional[str]]:
    """Extracts nested per-pack size like 'of 70 g' in '2 Maggie packets of 70 g' without altering purchase qty."""
    m = re.search(
        r"\bof\s+(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|gram|grams|ml|mls|l|ltr|litre|litres|liter|liters)\b(?:\s+(?:each|packs?|packets?))?",
        text,
        flags=re.IGNORECASE,
    )
    if not m:
        return text, None
    canon_u = canonical_voice_unit(m.group(2)) or m.group(2).lower()
    size_str = f"{m.group(1)}{canon_u}"
    cleaned = (text[:m.start()] + " " + text[m.end():]).strip()
    return re.sub(r"\s+", " ", cleaned), size_str


def extract_items_from_transcript(
    transcript: str,
    catalog: Optional[Sequence[Any]] = None,
) -> List[ExtractedItem]:
    """
    Parses natural language transcript into structured list of ExtractedItem.
    Supports continuous multi-items, catalog-aware segmentation, forward & reverse order,
    spoken prices, package-size annotations, update/remove commands, and fractions.
    """
    if not transcript or not transcript.strip():
        return []

    normalized = normalize_digits_and_numbers(transcript)
    catalog_phrases = _catalog_phrase_set(catalog)

    # Split mid-utterance action connectors before a new quantity ("5 Maggie also add 2 Colgate")
    normalized = re.sub(r"\s+\b(?:and\s+also|and\s+then|also\s+add|also|then|add)\s+(?=\d+(?:\.\d+)?\b)", ", ", normalized, flags=re.IGNORECASE)

    # Split into item clauses by common spoken sentence connectors
    delimiters = r"[,;\n\+]|\b(?:and|aur|plus|mariyu|matrum|evam|tatha)\b|&"
    raw_segments = [s.strip().rstrip('.!?') for s in re.split(delimiters, normalized, flags=re.IGNORECASE) if s.strip()]

    items: List[ExtractedItem] = []

    for raw_seg in raw_segments:
        s = raw_seg.strip()

        # Detect update or removal command intent
        item_action = "add"
        explicit_qty = True

        # "Make it 5 Maggie instead of 3" / "change it to 5 Maggie instead of 3"
        make_it_match = re.match(
            r"^(?:make|change|update|set)\s+(?:it\s+(?:to\s+)?|to\s+)?(\d+(?:\.\d+)?.*)$",
            s,
            flags=re.IGNORECASE,
        )
        ch_match = re.match(
            r"^(?:change|update|modify|make|set|increase|decrease|reduce|badlo|marchu)\s+(.+?)(?:\s+(?:quantity|qty))?(?:\s+to|\s+(?:quantity|qty))\s+(\d+(?:\.\d+)?.*)$",
            s,
            flags=re.IGNORECASE,
        )
        if make_it_match:
            s = re.sub(r"\s+instead\s+of\s+\d+(?:\.\d+)?(?:\s+\w+)?$", "", make_it_match.group(1).rstrip('.!? '), flags=re.IGNORECASE).strip()
            item_action = "update"
        elif ch_match:
            s = f"{ch_match.group(2).rstrip('.!? ')} {ch_match.group(1).rstrip('.!? ')}".strip()
            item_action = "update"
        elif re.search(r"^(?:remove|delete|cancel|drop|hatao|nikalo|theesey|తీసివేయి|తీసేయి)\s+", s, flags=re.IGNORECASE):
            s = re.sub(r"^(?:remove|delete|cancel|drop|hatao|nikalo|theesey|తీసివేయి|తీసేయి)\s+", "", s, flags=re.IGNORECASE).strip()
            item_action = "remove"
            explicit_qty = bool(re.search(r"\b\d+(?:\.\d+)?\b", s))

        # Strip conversational fillers at boundaries (repeat once if layered, e.g. "please give me ...")
        for _ in range(2):
            for pattern in CONVERSATIONAL_FILLERS:
                s = re.sub(pattern, "", s, flags=re.IGNORECASE).strip()

        if not s:
            continue

        sub_clauses = _segment_continuous_clause(s, catalog_phrases)

        for sub in sub_clauses:
            sub = sub.strip()
            if not sub:
                continue

            # Extract nested package sizes per segmented item ("2 Maggie packets of 70 g" -> qty 2, size 70g)
            sub, seg_pkg_size = _extract_package_size(sub)

            while len(sub) > 0:
                sub = sub.strip()
                if not sub:
                    break

                raw_slice = sub
                # Extract a spoken price if present: a line total, or a unit price ("each", "per kg")
                sub, extracted_price, unit_price, price_unit = _extract_price(sub)
                price_fields = dict(spoken_price=extracted_price, spoken_unit_price=unit_price, price_unit=price_unit)

                # Pattern 1: Leading quantity (already segmented per item by _segment_continuous_clause)
                lead_regex = re.compile(
                    rf"^(\d+(?:\.\d+)?)\s*(?:({SORTED_UNITS_PATTERN})(?:\s+of)?)?\s+(.+)$",
                    flags=re.IGNORECASE,
                )
                lead_match = lead_regex.match(sub)

                if lead_match:
                    raw_qty = float(lead_match.group(1))
                    qty_val = int(raw_qty) if raw_qty.is_integer() else raw_qty
                    # "2 kg rice" (unit before the name) or "3 tea packets" (unit after the name)
                    unit_id = canonical_voice_unit(lead_match.group(2)) or _trailing_unit(lead_match.group(3))
                    prod_text = clean_product_name(lead_match.group(3))

                    if prod_text:
                        items.append(ExtractedItem(
                            name=prod_text,
                            quantity=qty_val if qty_val > 0 else 1,
                            unit=unit_id,
                            action=item_action,
                            explicit_quantity=explicit_qty,
                            raw_text=lead_match.group(0).strip(),
                            package_size=seg_pkg_size,
                            **price_fields,
                        ))

                    sub = sub[lead_match.end():].strip()
                    continue

                # Pattern 2: Trailing quantity (e.g. "Rice 2 kg", "Maggie 5 packets", "Parle-G 3")
                trail_regex = re.compile(
                    rf"^([a-zA-Zऀ-ൿ0-9\s\-\(\)]+?)\s+(\d+(?:\.\d+)?)(?:\s+({SORTED_UNITS_PATTERN}))?(?=(?:\s+\d+)|\s+[a-zA-Zऀ-ൿ].*?\s+\d+|$)",
                    flags=re.IGNORECASE,
                )
                trail_match = trail_regex.match(sub)

                if trail_match:
                    prod_text = clean_product_name(trail_match.group(1))
                    raw_qty = float(trail_match.group(2))
                    qty_val = int(raw_qty) if raw_qty.is_integer() else raw_qty
                    unit_id = canonical_voice_unit(trail_match.group(3))

                    if prod_text:
                        items.append(ExtractedItem(
                            name=prod_text,
                            quantity=qty_val if qty_val > 0 else 1,
                            unit=unit_id,
                            action=item_action,
                            explicit_quantity=explicit_qty,
                            raw_text=trail_match.group(0).strip(),
                            package_size=seg_pkg_size,
                            **price_fields,
                        ))

                    sub = sub[trail_match.end():].strip()
                    continue

                # Pattern 3: Fallback single item without explicit number (e.g. "Tata Salt", "Remove Colgate")
                prod_text = clean_product_name(sub)
                if prod_text:
                    items.append(ExtractedItem(
                        name=prod_text,
                        quantity=1,
                        unit=None,
                        action=item_action,
                        explicit_quantity=False if item_action == "remove" else False,
                        raw_text=raw_slice,
                        package_size=seg_pkg_size,
                        **price_fields,
                    ))
                break

    return items
