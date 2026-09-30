/**
 * @file multilingualVoiceParser.ts
 * @description Advanced multilingual natural language voice parser for ShopPulse POS.
 * Supports spoken speech in 12 Indian languages:
 * English, Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Assamese.
 *
 * Extracts structured items, quantities, packaging units, and spoken prices.
 */

import type { Product } from '../types/product';
import type {
  MatchedVoiceItem,
  AmbiguousVoiceItem,
  UnmatchedVoiceItem,
  VoiceProductCandidate,
} from '../api/voice';
import {
  ITEM_TRANSLATIONS,
  PRODUCT_ALIASES,
  UNIT_NORMALIZATION_MAP,
  type CanonicalUnit,
  type VoiceLanguageKey,
} from '../config/voiceLanguages';

/**
 * Indic script numeral characters to standard Arabic digits (0-9).
 */
const INDIC_DIGIT_MAP: Record<string, string> = {
  // Devanagari (Hindi, Marathi)
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  // Telugu
  '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4',
  '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
  // Bengali / Assamese
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  // Gujarati
  '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4',
  '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9',
  // Gurmukhi (Punjabi)
  '੦': '0', '੧': '1', '੨': '2', '੩': '3', '੪': '4',
  '੫': '5', '੬': '6', '੭': '7', '੮': '8', '੯': '9',
  // Odia
  '୦': '0', '୧': '1', '୨': '2', '୩': '3', '୪': '4',
  '୫': '5', '୬': '6', '୭': '7', '୮': '8', '୯': '9',
  // Kannada
  '೦': '0', '೧': '1', '೨': '2', '೩': '3', '೪': '4',
  '೫': '5', '೬': '6', '೭': '7', '೮': '8', '೯': '9',
  // Malayalam
  '൦': '0', '൧': '1', '൨': '2', '൩': '3', '൪': '4',
  '൫': '5', '൬': '6', '൭': '7', '൮': '8', '൯': '9',
  // Tamil
  '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4',
  '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
};

/**
 * Compound spoken number phrases across Indian languages.
 * Ordered from largest/most specific to smallest.
 */
const COMPOUND_NUMBER_PHRASES: Array<[RegExp, number]> = [
  // Telugu compounds
  [/\bనూట\s+యాభై\b|నూట\s+యాభై/gi, 150],
  [/\bనూట\s+ఇరవై\b|నూట\s+ఇరవై/gi, 120],
  [/\bవంద\s+ఇరవై\b|వంద\s+ఇరవై/gi, 120],
  [/\bనూట\s+పది\b|నూట\s+పది/gi, 110],
  [/\bరెండు\s+వందలు\b|రెండు\s+వందలు/gi, 200],
  [/\bనూరు\b|నూరు/gi, 100],
  [/\bవంద\b|వంద/gi, 100],

  // Hindi compounds
  [/\bएक\s+सौ\s+पचास\b|एक\s+सौ\s+पचास/gi, 150],
  [/\bएक\s+सौ\s+बीस\b|एक\s+सौ\s+बीस/gi, 120],
  [/\bएक\s+सौ\s+दस\b|एक\s+सौ\s+दस/gi, 110],
  [/\bदो\s+सौ\b|दो\s+सौ/gi, 200],
  [/\bएक\s+सौ\b|एक\s+सौ/gi, 100],

  // Tamil compounds
  [/\bநூற்று\s+இருபது\b|நூற்று\s+இருபது/gi, 120],
  [/\bநூற்றைம்பது\b|நூற்றைம்பது/gi, 150],
  [/\bநூறு\b|நூறு/gi, 100],

  // Kannada compounds
  [/\bನೂರ\s+ಇಪ್ಪತ್ತು\b|ನೂರ\s+ಇಪ್ಪತ್ತು/gi, 120],
  [/\bನೂರ\s+ಐವತ್ತು\b|ನೂರ\s+ಐವತ್ತು/gi, 150],
  [/\bನೂರು\b|ನೂರು/gi, 100],

  // Malayalam compounds
  [/\bനൂറ്റി\s+ഇരുപത്\b|നൂറ്റി\s+ഇരുപത്/gi, 120],
  [/\bനൂറ്റി\s+അമ്പത്\b|നൂറ്റി\s+അമ്പത്/gi, 150],
  [/\bനൂറ്\b|നൂറ്/gi, 100],

  // Marathi compounds
  [/\bएकशे\s+वीस\b|एकशे\s+वीस/gi, 120],
  [/\bएकशे\s+पन्नास\b|एकशे\s+पन्नास/gi, 150],
  [/\bशंभर\b|शंभर/gi, 100],

  // Bengali compounds
  [/\bএকশত\s+কুড়ি\b|একশত\s+কুড়ি/gi, 120],
  [/\bএকশ\s+বিশ\b|একশ\s+বিশ/gi, 120],
  [/\bএকশত\s+পঞ্চাশ\b|একশত\s+পঞ্চাশ/gi, 150],
  [/\bএকশ\b|একশ/gi, 100],
  [/\bএকশত\b|একশত/gi, 100],

  // Gujarati compounds
  [/\bએકસો\s+વીસ\b|એકસો\s+વીસ/gi, 120],
  [/\bએકસો\s+પચાસ\b|એકસો\s+પચાસ/gi, 150],
  [/\bએકસો\b|એકસો/gi, 100],
  [/\bસો\b|સો/gi, 100],

  // Punjabi compounds
  [/\bਇੱਕ\s+ਸੌ\s+ਵੀਹ\b|ਇੱਕ\s+ਸੌ\s+ਵੀਹ/gi, 120],
  [/\bਇੱਕ\s+ਸੌ\s+ਪੰਜਾਹ\b|ਇੱਕ\s+ਸੌ\s+ਪੰਜਾਹ/gi, 150],
  [/\bਇੱਕ\s+ਸੌ\b|ਇੱਕ\s+ਸੌ/gi, 100],
  [/\bਸੌ\b|ਸੌ/gi, 100],

  // Odia compounds
  [/\bଏକ\s+ଶହ\s+କୋଡ଼ିଏ\b|ଏକ\s+ଶହ\s+କୋଡ଼ିଏ/gi, 120],
  [/\bଏକ\s+ଶହ\s+ପଚାଶ\b|ଏକ\s+ଶହ\s+ପଚାଶ/gi, 150],
  [/\bଶହେ\b|ଶହେ/gi, 100],

  // Assamese compounds
  [/\bএশ\s+বিশ\b|এশ\s+বিশ/gi, 120],
  [/\bএশ\s+পঞ্চাশ\b|এশ\s+পঞ্চাশ/gi, 150],
  [/\bএশ\b|এশ/gi, 100],

  // English & Hinglish Dozens & Fractions
  [/\b(?:one\s+and\s+a\s+half|one\s+and\s+half|1\s+and\s+a\s+half|1\s+and\s+half)\b/gi, 1.5],
  [/\b(?:two\s+and\s+a\s+half|two\s+and\s+half|2\s+and\s+a\s+half|2\s+and\s+half)\b/gi, 2.5],
  [/\b(?:three\s+and\s+a\s+half|three\s+and\s+half)\b/gi, 3.5],
  [/\b(?:half\s+a\s+kg|half\s+kg|half\s+kilo|half\s+liter|half\s+litre|half\s+ltr)\b/gi, 0.5],
  [/\b(?:quarter\s+kg|quarter\s+kilo|quarter\s+liter|quarter\s+litre)\b/gi, 0.25],
  [/\b(?:three\s+quarters?\s+kg|three\s+fourth\s+kg|3\/4\s*kg)\b/gi, 0.75],
  [/\b(?:1\/2|½)\b/gi, 0.5],
  [/\b(?:1\/4|¼)\b/gi, 0.25],
  [/\b(?:3\/4|¾)\b/gi, 0.75],
  [/\bhalf\s+dozen\b/gi, 6],
  [/\baadha\s+dozen\b/gi, 6],
  [/\baadha\s+darjan\b/gi, 6],
  [/\bone\s+hundred\s+twenty\b/gi, 120],
  [/\bone\s+hundred\b/gi, 100],
  [/\bone\s+dozen\b/gi, 12],
  [/\btwo\s+dozen\b/gi, 24],
  [/\bdozen\b/gi, 12],
  [/\bdarjan\b/gi, 12],

  // Telugu fractions
  [/\bఒకటిన్నర\b|ఒకటిన్నర/gi, 1.5],
  [/\bరెండున్నర\b|రెండున్నర/gi, 2.5],
  [/\bమూడున్నర\b|మూడున్నర/gi, 3.5],
  [/\bఅర\s+కిలో\b|అర\s+కిలో|అర\s+కేజీ\b|అర\s+కేజీ|అర\s+లీటర్\b|అర\s+లీటర్/gi, 0.5],
  [/\bపావు\s+కిలో\b|పావు\s+కిలో|పావు\s+కేజీ\b|పావు\s+కేజీ/gi, 0.25],
  [/\bముప్పావు\s+కిలో\b|ముప్పావు\s+కిలో|ముప్పావు\s+కేజీ\b|ముప్పావు\s+కేజీ/gi, 0.75],
  [/\bఅర\s+డజను\b|అర\s+డజను/gi, 6],

  // Hindi fractions
  [/\bडेढ़\s+सौ\b|डेढ़\s+सौ/gi, 150],
  [/\bढाई\s+सौ\b|ढाई\s+सौ/gi, 250],
  [/\bडेढ़\s+किलो\b|डेढ़\s+किलो|डेढ़\b|डेढ\b/gi, 1.5],
  [/\bढाई\s+किलो\b|ढाई\s+किलो|ढाई\b/gi, 2.5],
  [/\bसाढ़े\s+तीन\b/gi, 3.5],
  [/\bआधा\s+किलो\b|आधा\s+किलो|आधा\s+लीटर\b|आधा\s+लीटर|आधा\s+दर्जन\b/gi, 0.5],
  [/\bपाव\s+किलो\b|पाव\s+किलो/gi, 0.25],
  [/\bपौना\s+किलो\b|पौना\s+किलो/gi, 0.75],

  // Tamil fractions
  [/\bஒன்றரை\b|ஒன்றரை/gi, 1.5],
  [/\bஇரண்டரை\b|இரண்டரை/gi, 2.5],
  [/\bஅரை\s+கிலோ\b|அரை\s+கிலோ|அரை\s+லிட்டர்\b/gi, 0.5],
  [/\bகால்\s+கிலோ\b|கால்\s+கிலோ/gi, 0.25],
  [/\bமுக்கால்\s+கிலோ\b|முக்கால்\s+கிலோ/gi, 0.75],

  // Kannada fractions
  [/\bಒಂದೂವರೆ\b|ಒಂದೂವರೆ/gi, 1.5],
  [/\bಎರಡೂವರೆ\b|ಎರಡೂವರೆ/gi, 2.5],
  [/\bಅರ್ಧ\s+ಕಿಲೋ\b|ಅರ್ಧ\s+ಕಿಲೋ|ಅರ್ಧ\s+ಲೀಟರ್\b/gi, 0.5],
  [/\bಕಾಲು\s+ಕಿಲೋ\b|ಕಾಲು\s+ಕಿಲೋ/gi, 0.25],
  [/\bಮುಕ್ಕಾಲು\s+ಕಿಲೋ\b|ಮುಕ್ಕಾಲು\s+ಕಿಲೋ/gi, 0.75],

  // Malayalam fractions
  [/\bഒന്നര\b|ഒന്നര/gi, 1.5],
  [/\bരണ്ടര\b|രണ്ടര/gi, 2.5],
  [/\bഅര\s+കിലോ\b|അര\s+കിലോ/gi, 0.5],
  [/\bകാൽ\s+കിലോ\b|കാൽ\s+കിലോ/gi, 0.25],
  [/\bമുക്കാൽ\s+കിലോ\b|മുക്കാൽ\s+കിലോ/gi, 0.75],

  // Marathi fractions
  [/\bदीड\b|दीड/gi, 1.5],
  [/\bअडीच\b|अडीच/gi, 2.5],
  [/\bअर्धा\s+किलो\b|अर्धा\s+किलो/gi, 0.5],
  [/\bपाव\s+किलो\b|पाव\s+किलो/gi, 0.25],
  [/\bपाऊण\s+किलो\b|पाऊण\s+किलो/gi, 0.75],

  // Bengali fractions
  [/\bদেড়\b|দেড়/gi, 1.5],
  [/\bআড়াই\b|আড়াই/gi, 2.5],
  [/\bআধ\s+কেজি\b|আধ\s+কেজি|আধা\s+কেজি\b/gi, 0.5],
  [/\bপোয়া\b|পোয়া/gi, 0.25],
];

/**
 * Single spoken number words across all 12 supported Indian languages.
 */
const SINGLE_NUMBER_WORDS: Record<string, number> = {
  // English
  zero: 0,
  a: 1,
  an: 1,
  half: 0.5,
  quarter: 0.25,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  hundred: 100,

  // Telugu
  ఒకటి: 1,
  ఒక: 1,
  రెండు: 2,
  మూడు: 3,
  నాలుగు: 4,
  ఐదు: 5,
  ఆరు: 6,
  ఏడు: 7,
  ఎనిమిది: 8,
  తొమ్మిది: 9,
  పది: 10,
  ఇరవై: 20,
  ముప్పై: 30,
  నలభై: 40,
  యాభై: 50,

  // Hindi
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  छः: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ग्यारह: 11,
  बारह: 12,
  पंद्रह: 15,
  बीस: 20,
  पच्चीस: 25,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  सौ: 100,

  // Tamil
  ஒன்று: 1,
  ஒரு: 1,
  இரண்டு: 2,
  ரெண்டு: 2,
  மூன்று: 3,
  மூணு: 3,
  நான்கு: 4,
  நாலு: 4,
  ஐந்து: 5,
  அஞ்சு: 5,
  ஆறு: 6,
  ஏழு: 7,
  எட்டு: 8,
  ஒன்பது: 9,
  பத்து: 10,
  இருபது: 20,
  ஐம்பது: 50,

  // Kannada
  ಒಂದು: 1,
  ಎರಡು: 2,
  ಮೂರು: 3,
  ನಾಲ್ಕು: 4,
  ಐದು: 5,
  ಆರು: 6,
  ಏಳು: 7,
  ಎಂಟು: 8,
  ಒಂಬತ್ತು: 9,
  ಹತ್ತು: 10,
  ಇಪ್ಪತ್ತು: 20,
  ಐವತ್ತು: 50,

  // Malayalam
  ഒന്ന്: 1,
  രണ്ട്: 2,
  മൂന്ന്: 3,
  നാല്: 4,
  അഞ്ച്: 5,
  ആറ്: 6,
  ഏഴ്: 7,
  എട്ട്: 8,
  ഒമ്പത്: 9,
  ഒൻപത്: 9,
  പത്ത്: 10,
  ഇരുപത്: 20,

  // Marathi
  दोन: 2,
  पाच: 5,
  सहा: 6,
  नऊ: 9,
  दहा: 10,
  वीस: 20,
  पन्नास: 50,

  // Bengali
  দুই: 2,
  চার: 4,
  ছয়: 6,
  আট: 8,
  নয়: 9,
  দশ: 10,
  কুড়ি: 20,
  বিশ: 20,
  পঞ্চাশ: 50,

  // Gujarati
  બે: 2,
  ત્રણ: 3,
  છ: 6,
  આઠ: 8,
  નવ: 9,
  દસ: 10,
  વીસ: 20,
  પચાસ: 50,

  // Punjabi
  ਇੱਕ: 1,
  ਤਿੰਨ: 3,
  ਛੇ: 6,
  ਸੱਤ: 7,
  ਨੌਂ: 9,
  ਵੀਹ: 20,
  ਪੰਜਾਹ: 50,

  // Odia
  ଦୁଇ: 2,
  ତିନି: 3,
  ଚାରି: 4,
  ଛଅ: 6,
  ଆଠ: 8,
  ନଅ: 9,
  ଦଶ: 10,
  କୋଡ଼ିଏ: 20,

  // Assamese
  তিনি: 3,
  চাৰি: 4,
  ছয়: 6,
  আঠ: 8,
  ন: 9,
  দহ: 10,

  // Transliterations
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  dus: 10,
  bees: 20,
  sau: 100,
  rendu: 2,
  moodu: 3,
  naalugu: 4,
  aidu: 5,
  aaru: 6,
  padi: 10,
  onnu: 1,
  moonu: 3,
  naalu: 4,
  anju: 5,
  aadha: 0.5,
  adha: 0.5,
  ara: 0.5,
  paavu: 0.25,
  pao: 0.25,
  pav: 0.25,
  dedh: 1.5,
  dhai: 2.5,
  'आधा': 0.5,
  'अర': 0.5,
  'పావు': 0.25,
  'அரை': 0.5,
  'கால்': 0.25,
  'ಅರ್ಧ': 0.5,
  'ಕಾಲು': 0.25,
  'അര': 0.5,
  'കാൽ': 0.25,
  'अर्धा': 0.5,
  'আধা': 0.5,
  'અડધો': 0.5,
  'ਅੱਧਾ': 0.5,
  'ଅଧା': 0.5,
};

/**
 * Currency terms across all 12 supported Indian languages.
 */
const CURRENCY_REGEX =
  /(?:రూపాయలు|రూ\b|రూ\.|రూపాయ|ర రూపాయలు|रुपये|रुपया|रु\b|रु\.|रू\b|रूपए|ரூபாய்|ரூ\b|ರೂಪಾಯಿ|രൂപ|টাকা|રૂપિયા|ਰੁਪਏ|ਟଙ୍କା|টকা|rupees?|rs\b|rs\.|inr\b)/i;

/**
 * Conversational filler words at beginning or ending of voice commands.
 */
const CONVERSATIONAL_FILLERS = [
  /^(?:please\s+)?(?:give\s+me|give\s+us|i\s+want|we\s+need|add|bill|put|take|pack|bhejo|dena|daal\s+do|likho|chahiye|ivvandi|kaavali|veeyandi|thanga|kodu|tha|venum)\s+/i,
  /\s+(?:chahiye|dena|daal\s+do|likho|bhejo|ivvandi|kaavali|veeyandi|thanga|kodu|tha|venum|please)$/i,
  /\b(?:kripya|bhai|bhaiya|ji|andi|ayya|anna)\b/gi,
];

/**
 * Normalizes digits and number words in any supported Indian script/language.
 */
export function normalizeIndianSpeechNumbers(text: string): string {
  let s = text.trim();

  // 1. Convert Indic numerals to 0-9
  for (const [char, digit] of Object.entries(INDIC_DIGIT_MAP)) {
    if (s.includes(char)) {
      s = s.split(char).join(digit);
    }
  }

  // 2. Replace compound spoken number phrases
  for (const [regex, val] of COMPOUND_NUMBER_PHRASES) {
    s = s.replace(regex, ` ${val} `);
  }

  // 3. Replace single spoken number words
  const sortedWords = Object.keys(SINGLE_NUMBER_WORDS).sort((a, b) => b.length - a.length);
  for (const word of sortedWords) {
    const val = SINGLE_NUMBER_WORDS[word];
    const isAscii = /^[a-z0-9]+$/i.test(word);
    const pattern = isAscii ? new RegExp(`\\b${word}\\b`, 'gi') : new RegExp(word, 'gi');
    s = s.replace(pattern, ` ${val} `);
  }

  // Clean extra whitespace
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes text for matching comparison: lowercases, removes dashes and punctuation.
 */
export function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .replace(/[-_.]/g, ' ')
    .replace(/[^a-z0-9\s\u0900-\u0D7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fast character bigram similarity (Dice coefficient) for phonetic & typo resilience.
 */
export function stringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0;
  if (str1.length < 2 || str2.length < 2) return 0;

  const pairs1 = new Map<string, number>();
  for (let i = 0; i < str1.length - 1; i++) {
    const pair = str1.substring(i, i + 2);
    pairs1.set(pair, (pairs1.get(pair) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < str2.length - 1; i++) {
    const pair = str2.substring(i, i + 2);
    const count = pairs1.get(pair) || 0;
    if (count > 0) {
      pairs1.set(pair, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (str1.length + str2.length - 2);
}

/**
 * Cleans extracted product names by removing leftover units, currency tokens, and fillers,
 * while strictly preserving package weights/sizes (like 1kg, 500g, 5kg, 1L, 200ml).
 */
export function cleanExtractedProductName(raw: string): string {
  let name = raw.trim();

  // Remove conversational fillers
  for (const filler of CONVERSATIONAL_FILLERS) {
    name = name.replace(filler, ' ').trim();
  }

  // Remove leading unit qualifiers in English and Indic scripts (e.g. "kg rice" -> "rice")
  name = name.replace(
    /^(?:కిలోల?|కేజీ|లీటర్ల?|ప్యాకెట్ల?|బాటిల్|సంచులు|किलो|लीटर|पैकेट|बोतल|थैला|बोरी|पॉकेट|கிலோ|லிட்டர்|பாக்கெட்|பாட்டில்|பைகள்|ಕಿಲೋ|ಲೀಟರ್|ಪ್ಯಾಕೆಟ್|ಬಾಟಲ್|കിലോ|ലിറ്റർ|പാക്കറ്റ്|കുപ്പി|पाकीट|बाटली|কেজি|প্যাকেট|પેકેટ|પૅકેટ|પੈકેટ|ବୋତଲ|পেকেট|packets?|pkts?|pouches?|pouch|boxes?|box|pieces?|pcs?|pc|bottles?|btls?|cans?|bags?|trays?|units?|liters?|ltrs?|ltr|kg|kilo|grams?|gms?)(?:\s+of)?(?:\s+|$)/gi,
    ''
  ).trim();

  // Remove trailing isolated unit qualifier if not part of a size like 1kg/500g (e.g. "rice kg" -> "rice")
  name = name.replace(
    /(?<=\s)(?:కిలోల?|కేజీ|లీటర్ల?|ప్యాకెట్ల?|బాటిల్|సంచులు|किलो|लीटर|पैकेट|बोतल|थैला|बोरी|पॉकेट|கிலோ|லிட்டர்|பாக்கெட்|பாட்டில்|பைகள்|ಕಿಲೋ|ಲೀಟರ್|ಪ್ಯಾಕೆಟ್|ಬಾಟಲ್|കിലോ|ലിറ്റർ|പാക്കറ്റ്|കുപ്പി|पाकीट|बाटली|কেজি|প্যাকেট|પેકેટ|પૅકેટ|પੈકેટ|ବୋତଲ|পেকেট|packets?|pkts?|pouches?|pouch|boxes?|box|pieces?|pcs?|pc|bottles?|btls?|cans?|bags?|trays?|units?|liters?|ltrs?|ltr|kg|kilo|grams?|gms?)$/gi,
    ''
  ).trim();

  // Remove "of" prefixes or leftovers
  name = name.replace(/^\s*of\s+/i, '').replace(/\s+of\s*$/i, '').trim();

  // Standardize common brand aliases
  const lower = name.toLowerCase().replace(/[-_.]/g, ' ').trim();
  if (
    lower === 'parle g' ||
    lower === 'parleg' ||
    lower === 'parle g biscuits' ||
    lower === 'పార్లే జి' ||
    lower === 'పార్లే జీ' ||
    lower === 'पारले जी' ||
    lower === 'பார்லே ஜி'
  ) {
    return 'Parle-G';
  }
  if (
    lower === 'tata salt' ||
    lower === 'tata namak' ||
    lower === 'టాటా ఉప్పు' ||
    lower === 'టాటా సాల్ట్' ||
    lower === 'टाटा नमक' ||
    lower === 'टाटा साल्ट' ||
    lower === 'டாடா உப்பு' ||
    lower === 'டாடா சால்ట్' ||
    lower === 'ಟಾಟಾ ಉಪ್ಪು' ||
    lower === 'ಟಾಟಾ ಸಾಲ್ಟ್'
  ) {
    return 'Tata Salt 1kg';
  }
  if (
    lower === 'aashirvaad atta' ||
    lower === 'ashirvad atta' ||
    lower === 'aashirwad atta' ||
    lower === 'ఆశీర్వాద్ గోధుమ పిండి' ||
    lower === 'ఆశీర్వాద్ పిండి' ||
    lower === 'ఆశీర్వాద్ ఆటా' ||
    lower === 'आशीर्वाद आटा'
  ) {
    return 'Aashirvaad Atta';
  }
  if (lower === 'toned milk' || lower === 'amul milk' || lower === 'టోన్డ్ పాలు' || lower === 'टोन्ड दूध') {
    return 'Toned Milk (500ml)';
  }

  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Finds the best matching catalog product using canonical English names,
 * brand aliases, native Indian language item keywords, and fuzzy similarity.
 */
export function matchCatalogProduct(query: string, catalog: Product[]): Product | null {
  const clean = normalizeForMatch(query);
  if (!clean || catalog.length === 0) return null;

  // 1. Direct name match (normalized comparison)
  const exact = catalog.find((p) => {
    const pNorm = normalizeForMatch(p.name);
    return pNorm === clean || pNorm.includes(clean) || clean.includes(pNorm);
  });
  if (exact) return exact;

  // 2. PRODUCT_ALIASES match across all 12 Indian languages
  for (const aliasConfig of PRODUCT_ALIASES) {
    const canonicalNorm = normalizeForMatch(aliasConfig.canonicalName);

    // Check if query matches any alias in any language
    const isAliasMatch = Object.values(aliasConfig.aliases).some((aliasList) => {
      if (!aliasList) return false;
      return aliasList.some((alias) => {
        const aNorm = normalizeForMatch(alias);
        return clean === aNorm || clean.includes(aNorm) || aNorm.includes(clean);
      });
    });

    if (isAliasMatch || clean.includes(canonicalNorm) || canonicalNorm.includes(clean)) {
      // Find matching product in catalog
      const matchedProd = catalog.find((p) => {
        const pNorm = normalizeForMatch(p.name);
        return pNorm.includes(canonicalNorm) || canonicalNorm.includes(pNorm);
      });
      if (matchedProd) return matchedProd;

      // Special fallback per canonical concept
      if (aliasConfig.canonicalName === 'Rice') {
        const riceProd = catalog.find((p) => normalizeForMatch(p.name).includes('rice'));
        if (riceProd) return riceProd;
      }
      if (aliasConfig.canonicalName === 'Tata Salt') {
        const saltProd = catalog.find((p) => normalizeForMatch(p.name).includes('salt'));
        if (saltProd) return saltProd;
      }
      if (aliasConfig.canonicalName === 'Toned Milk') {
        const milkProd = catalog.find((p) => normalizeForMatch(p.name).includes('milk'));
        if (milkProd) return milkProd;
      }
      if (aliasConfig.canonicalName === 'Fresh White Bread') {
        const breadProd = catalog.find((p) => normalizeForMatch(p.name).includes('bread'));
        if (breadProd) return breadProd;
      }
      if (aliasConfig.canonicalName === 'Refined Sugar') {
        const sugarProd = catalog.find((p) => normalizeForMatch(p.name).includes('sugar'));
        if (sugarProd) return sugarProd;
      }
      if (aliasConfig.canonicalName === 'Sunflower Cooking Oil') {
        const oilProd = catalog.find((p) => normalizeForMatch(p.name).includes('oil'));
        if (oilProd) return oilProd;
      }
      if (aliasConfig.canonicalName === 'Premium Assam Tea') {
        const teaProd = catalog.find((p) => normalizeForMatch(p.name).includes('tea'));
        if (teaProd) return teaProd;
      }
    }
  }

  // 3. Multilingual dictionary match via ITEM_TRANSLATIONS
  for (const [canonicalKey, translations] of Object.entries(ITEM_TRANSLATIONS)) {
    const isMatch = Object.values(translations).some((trans) => {
      if (!trans) return false;
      const transNorm = normalizeForMatch(trans);
      return clean === transNorm || clean.includes(transNorm) || transNorm.includes(clean);
    });

    if (isMatch) {
      const canonicalNorm = normalizeForMatch(canonicalKey);
      const matchedProd = catalog.find((p) => {
        const pNorm = normalizeForMatch(p.name);
        const catNorm = normalizeForMatch(p.category);
        return pNorm.includes(canonicalNorm) || catNorm.includes(canonicalNorm);
      });
      if (matchedProd) return matchedProd;
    }
  }

  // 4. Token containment match on product name
  const queryTokens = clean.split(/\s+/).filter((w) => w.length > 2);
  if (queryTokens.length > 0) {
    let bestProduct: Product | null = null;
    let maxMatch = 0;

    for (const p of catalog) {
      const pNorm = normalizeForMatch(p.name);
      let matchCount = 0;
      for (const token of queryTokens) {
        if (pNorm.includes(token)) matchCount++;
      }
      if (matchCount > maxMatch) {
        maxMatch = matchCount;
        bestProduct = p;
      }
    }

    if (bestProduct && maxMatch > 0) {
      return bestProduct;
    }
  }

  // 5. Fuzzy phonetic/spelling similarity match (handles speech recognition variants)
  let bestFuzzyProd: Product | null = null;
  let highestSim = 0;
  for (const p of catalog) {
    const pNorm = normalizeForMatch(p.name);
    const sim = stringSimilarity(clean, pNorm);
    if (sim > highestSim && sim >= 0.70) {
      highestSim = sim;
      bestFuzzyProd = p;
    }
  }
  if (bestFuzzyProd) return bestFuzzyProd;

  // 6. Category fallback (e.g. "Dairy" for milk, "Staples" for rice/salt)
  const catMatch = catalog.find((p) => normalizeForMatch(p.category).includes(clean));
  if (catMatch) return catMatch;

  return null;
}

export interface ExtractedVoiceClause {
  raw: string;
  quantity: number;
  unit: CanonicalUnit | null;
  productName: string;
  price: number | null;
}

const SORTED_UNIT_TOKENS = Object.keys(UNIT_NORMALIZATION_MAP)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * Extracts multiple item clauses from natural spoken speech clauses.
 * Supports forward order, reverse order, units, and spoken currency prices.
 */
export function extractItemsFromClause(clause: string): ExtractedVoiceClause[] {
  let text = clause.trim();
  if (!text) return [];

  const items: ExtractedVoiceClause[] = [];

  // Split on clause conjunctions first: and, aur, mariyu, matrum, commas, semicolons, +, &, newlines
  const subChunks = text
    .split(/[,;\n\+]|\b(?:and|aur|mariyu|matrum|mattu|tatha|evam|plus)\b|&/gi)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const chunk of subChunks) {
    let s = chunk;

    while (s.length > 0) {
      s = s.trim();
      if (!s) break;

      // Extract spoken price if present
      let extractedPrice: number | null = null;
      const priceBeforeMatch = s.match(new RegExp(`(?:${CURRENCY_REGEX.source})\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
      const priceAfterMatch = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${CURRENCY_REGEX.source})`, 'i'));

      if (priceAfterMatch) {
        extractedPrice = parseFloat(priceAfterMatch[1]);
        s = s.replace(priceAfterMatch[0], ' ').trim();
      } else if (priceBeforeMatch) {
        extractedPrice = parseFloat(priceBeforeMatch[1]);
        s = s.replace(priceBeforeMatch[0], ' ').trim();
      }

      // Pattern 1: Leading quantity (e.g. "2 kg rice", "2 Tata Salt", "2 Tata Salt 1kg", "0.5 kg sugar")
      const leadRegex = new RegExp(
        `^(\\d+(?:\\.\\d+)?)\\s*(?:(${SORTED_UNIT_TOKENS})(?:\\s+of)?)?\\s+(.+?)(?=(?:\\s+\\d+(?:\\.\\d+)?(?:\\s+(?:${SORTED_UNIT_TOKENS}))?\\s+[a-zA-Z\\u0900-\\u0D7F])|$)`,
        'i'
      );
      const leadMatch = s.match(leadRegex);

      if (leadMatch) {
        const qty = parseFloat(leadMatch[1]);
        const unitWord = leadMatch[2]?.toLowerCase();
        const prod = leadMatch[3].trim();
        const matchedUnit = unitWord ? UNIT_NORMALIZATION_MAP[unitWord] || null : null;

        items.push({
          raw: leadMatch[0].trim(),
          quantity: qty > 0 ? qty : 1,
          unit: matchedUnit,
          productName: prod,
          price: extractedPrice,
        });

        s = s.slice(leadMatch[0].length).trim();
        continue;
      }

      // Pattern 2: Trailing quantity (e.g. "Rice 2 kg", "Sugar 1 kg", "Tata Salt 2 packets", "Parle-G 3")
      const trailRegex = new RegExp(
        `^([a-zA-Z\\u0900-\u0D7F0-9\\s\\-\\(\\)]+?)\\s+(\\d+(?:\\.\\d+)?)(?:\\s+(${SORTED_UNIT_TOKENS}))?(?=(?:\\s+\\d+)|\\s+[a-zA-Z\\u0900-\\u0D7F].*?\\s+\\d+|$)`,
        'i'
      );
      const trailMatch = s.match(trailRegex);

      if (trailMatch) {
        const prod = trailMatch[1].trim();
        const qty = parseFloat(trailMatch[2]);
        const unitWord = trailMatch[3]?.toLowerCase();
        const matchedUnit = unitWord ? UNIT_NORMALIZATION_MAP[unitWord] || null : null;

        items.push({
          raw: trailMatch[0].trim(),
          quantity: qty > 0 ? qty : 1,
          unit: matchedUnit,
          productName: prod,
          price: extractedPrice,
        });

        s = s.slice(trailMatch[0].length).trim();
        continue;
      }

      // Pattern 3: Fallback single item without explicit number (e.g. "Tata Salt", "Aashirvaad Atta")
      items.push({
        raw: s,
        quantity: 1,
        unit: null,
        productName: s,
        price: extractedPrice,
      });
      break;
    }
  }

  return items;
}

export interface MultilingualParseResult {
  transcript: string;
  matched_items: MatchedVoiceItem[];
  ambiguous_items: AmbiguousVoiceItem[];
  unmatched_items: UnmatchedVoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * End-to-end high-efficiency multilingual voice parsing pipeline.
 * Extracts items, quantities, packaging units, and spoken prices (e.g. "₹120 rupees").
 */
export function parseMultilingualVoiceBill(
  transcript: string,
  catalog: Product[],
  _spokenLang?: VoiceLanguageKey
): MultilingualParseResult {
  if (!transcript || !transcript.trim()) {
    return {
      transcript: transcript || '',
      matched_items: [],
      ambiguous_items: [],
      unmatched_items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
    };
  }

  // 1. Normalize numbers and fractions across all supported Indian languages
  const normalized = normalizeIndianSpeechNumbers(transcript);

  // 2. High-efficiency sequential item extraction
  const extractedClauses = extractItemsFromClause(normalized);

  const matchedItems: MatchedVoiceItem[] = [];
  const ambiguousItems: AmbiguousVoiceItem[] = [];
  const unmatchedItems: UnmatchedVoiceItem[] = [];

  for (const itemClause of extractedClauses) {
    const cleanName = cleanExtractedProductName(itemClause.productName);
    if (!cleanName) continue;

    const quantity = itemClause.quantity;
    const spokenPrice = itemClause.price;
    const detectedUnit = itemClause.unit;

    // Match against catalog products
    const matchedProduct = matchCatalogProduct(cleanName, catalog);

    if (matchedProduct) {
      // Check for ambiguity (e.g. Tata Salt 1kg vs Tata Salt 500g)
      const potentialCandidates = catalog.filter((p) =>
        normalizeForMatch(p.name).includes(normalizeForMatch(matchedProduct.name).split(' ')[0])
      );

      if (
        potentialCandidates.length > 1 &&
        !cleanName.toLowerCase().includes('1kg') &&
        !cleanName.toLowerCase().includes('500g') &&
        !cleanName.toLowerCase().includes('400g') &&
        !cleanName.toLowerCase().includes('5kg')
      ) {
        const candidatesList: VoiceProductCandidate[] = potentialCandidates.map((c) => ({
          id: c.id,
          name: c.name,
          selling_price: c.sellingPrice ?? c.price ?? 0,
          current_stock: c.stock ?? 0,
          unit: c.unit || detectedUnit || 'pcs',
          category: c.category,
        }));

        ambiguousItems.push({
          queried_name: cleanName,
          quantity,
          candidates: candidatesList,
        });
        continue;
      }

      // Single clear match
      const catalogPrice = matchedProduct.sellingPrice ?? matchedProduct.price ?? 0;
      // If a spoken total price was explicitly stated in speech (e.g. "₹120"), use it directly
      const lineTotal = spokenPrice !== null ? spokenPrice : Math.round(catalogPrice * quantity * 100) / 100;
      const unitPrice = spokenPrice !== null ? Math.round((spokenPrice / quantity) * 100) / 100 : catalogPrice;

      matchedItems.push({
        product_id: matchedProduct.id,
        name: matchedProduct.name,
        quantity,
        unit_price: unitPrice,
        total_price: lineTotal,
        unit: detectedUnit !== null ? detectedUnit : matchedProduct.unit || 'pcs',
        current_stock: matchedProduct.stock ?? 10,
        is_out_of_stock: (matchedProduct.stock ?? 0) <= 0,
        is_insufficient_stock: quantity > (matchedProduct.stock ?? 0),
        available_stock: Math.max(0, matchedProduct.stock ?? 0),
      });
    } else {
      // Never invent product information: unmatched items belong in unmatched_items
      unmatchedItems.push({
        queried_name: cleanName,
        quantity,
        reason: 'Item not found in current inventory catalog',
      });
    }
  }

  const subtotal = Math.round(matchedItems.reduce((acc, item) => acc + item.total_price, 0) * 100) / 100;
  const total = subtotal;

  return {
    transcript,
    matched_items: matchedItems,
    ambiguous_items: ambiguousItems,
    unmatched_items: unmatchedItems,
    subtotal,
    tax: 0,
    total,
  };
}
