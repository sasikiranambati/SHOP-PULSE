/**
 * @file multilingualVoiceParser.ts
 * @description Advanced multilingual natural language voice parser for Shelfora POS.
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
import {
  isConversationalNonProductPhraseClient,
  parseContextQtyTagClient,
  resolveContextualHomophonesClient,
  stripContextTagsToDigitsClient,
} from './voiceContext';

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
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
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
  /^(?:please\s+)?(?:could\s+you\s+|can\s+you\s+|can\s+i\s+get\s+|could\s+i\s+get\s+|i\s+would\s+like\s+|i'd\s+like\s+|give\s+me|give\s+us|get\s+me|i\s+want|we\s+want|i\s+need|we\s+need|need|want|please|add|bill|put\s+down|put|take|pack|remove|delete|cancel|change|update|make|also\s+add|also|then|bhejo|dena|daal\s+do|likho|chahiye|ivvandi|kaavali|veeyandi|thanga|kodu|tha|venum)\s+/i,
  /\s+(?:chahiye|dena|daal\s+do|likho|bhejo|ivvandi|kaavali|veeyandi|thanga|kodu|tha|venum|please)$/i,
  /\b(?:kripya|bhai|bhaiya|ji|andi|ayya|anna)\b/gi,
];

const ENGLISH_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ENGLISH_UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const ENGLISH_SUB_HUNDRED: Record<string, number> = {
  ...ENGLISH_UNITS,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  ...ENGLISH_TENS,
};

function replaceEnglishCompounds(input: string): string {
  const tensPat = Object.keys(ENGLISH_TENS).join('|');
  const unitsPat = Object.keys(ENGLISH_UNITS).join('|');
  const subPat = Object.keys(ENGLISH_SUB_HUNDRED).sort((a, b) => b.length - a.length).join('|');

  let out = input.replace(
    new RegExp(`\\b(${unitsPat})\\s+hundred(?:\\s+and)?(?:\\s+(${subPat})(?:[-\\s]+(${unitsPat}))?)?\\b`, 'gi'),
    (_m, h: string, t?: string, u?: string) => {
      const base = ENGLISH_UNITS[h.toLowerCase()] * 100;
      if (t && u) return ` ${base + ENGLISH_TENS[t.toLowerCase()] + ENGLISH_UNITS[u.toLowerCase()]} `;
      if (t) return ` ${base + ENGLISH_SUB_HUNDRED[t.toLowerCase()]} `;
      return ` ${base} `;
    },
  );

  out = out.replace(
    new RegExp(`\\b(${tensPat})[-\\s]+(${unitsPat})\\b`, 'gi'),
    (_m, t: string, u: string) => ` ${ENGLISH_TENS[t.toLowerCase()] + ENGLISH_UNITS[u.toLowerCase()]} `,
  );

  return out;
}

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

  // 2. Replace compound spoken number phrases & English compound numbers
  for (const [regex, val] of COMPOUND_NUMBER_PHRASES) {
    s = s.replace(regex, ` ${val} `);
  }
  s = replaceEnglishCompounds(s);

  // Contextual "a"/"an" only when directly preceding a measure/package unit
  s = s.replace(
    /\b(?:a|an)\s+(?=(?:kg|kgs|kilo|kilos|kilogram|kilograms|gram|grams|gm|gms|liter|liters|litre|litres|ltr|ltrs|ml|mls|milliliter|milliliters|millilitre|millilitres|packet|packets|pack|packs|pkt|pkts|bottle|bottles|btl|btls|bag|bags|box|boxes|carton|cartons|pouch|pouches|piece|pieces|pc|pcs|tube|tubes|bar|bars|tin|tins|jar|jars|can|cans|dozen)\b)/gi,
    ' 1 ',
  );

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

  // Strip leading unit qualifiers in English and Indic scripts
  name = name.replace(
    /^(?:కిలోల?|కేజీ|లీటర్ల?|ప్యాకెట్ల?|బాటిల్|సంచులు|किलो|लीटर|पैकेट|बोतल|थैला|बोरी|पॉकेट|கிலோ|லிட்டர்|பாக்கெட்|பாட்டில்|பைகள்|ಕಿಲೋ|ಲೀಟರ್|ಪ್ಯಾಕೆಟ್|ಬಾಟಲ್|കിലോ|ലിറ്റർ|പാക്കറ്റ്|കുപ്പി|पाकीट|बाटली|কেজি|প্যাকেট|પેકેટ|પૅકેટ|પੈકેટ|ବୋତଲ|পেকেট|packets?|pkts?|pouches?|pouch|boxes?|box|pieces?|pcs?|pc|bottles?|btls?|cartons?|ctns?|tubes?|bars?|tins?|jars?|cans?|bags?|trays?|units?|milliliters?|millilitres?|mls?|liters?|litres?|ltrs?|ltr|kg|kgs|kilo|kilos|kilograms?|grams?|gms?|g|gm)(?:\s+of)?(?:\s+|$)/gi,
    ''
  ).trim();

  // Remove trailing isolated unit qualifier if not part of a size like 1kg/500g
  name = name.replace(
    /(?<=\s)(?:కిలోల?|కేజీ|లీటర్ల?|ప్యాకెట్ల?|బాటిల్|సంచులు|किलो|लीटर|पैकेट|बोतल|थैला|बोरी|पॉकेट|கிலோ|லிட்டர்|பாக்கெட்|பாட்டில்|பைகள்|ಕಿಲೋ|ಲೀಟರ್|ಪ್ಯಾಕೆಟ್|ಬಾಟಲ್|കിലോ|ലിറ്റർ|പാക്കറ്റ്|കുപ്പി|पाकीट|बाटली|কেজি|প্যাকেট|પેકેટ|પૅકેટ|પੈકેટ|ବୋତଲ|পেকেট|packets?|pkts?|pouches?|pouch|boxes?|box|pieces?|pcs?|pc|bottles?|btls?|cartons?|ctns?|tubes?|bars?|tins?|jars?|cans?|bags?|trays?|units?|milliliters?|millilitres?|mls?|liters?|litres?|ltrs?|ltr|kg|kgs|kilo|kilos|kilograms?|grams?|gms?|g|gm)$/gi,
    ''
  ).trim();

  // Remove "of" / "more" prefixes or leftovers
  name = name.replace(/^\s*(?:of|more)\s+/i, '').replace(/\s+of\s*$/i, '').trim();

  // Singularize safe retail commodity plurals
  name = name
    .split(/\s+/)
    .map((w) => {
      const lw = w.toLowerCase();
      if (['salts', 'attas', 'milks', 'breads', 'butters', 'rices', 'sugars', 'oils', 'biscuits', 'soaps', 'shampoos', 'chocolates', 'tubes', 'bars'].includes(lw)) {
        return w.slice(0, -1);
      }
      return w;
    })
    .join(' ');

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

const DISTINGUISHING_MODIFIERS = new Set(['flour', 'powder', 'free', 'brown', 'black', 'essential']);
const WEIGHT_AND_CONTAINER_TOKENS = new Set([
  '1kg', '2kg', '5kg', '10kg', '500g', '250g', '200g', '100g', '70g', '140g', '50g',
  '1l', '2l', '5l', '500ml', '250ml', '200ml', '100ml',
  'kg', 'g', 'gm', 'gms', 'l', 'ltr', 'liter', 'liters', 'litre', 'litres', 'ml',
  'packet', 'packets', 'pkt', 'pkts', 'pack', 'packs', 'pcs', 'piece', 'pieces',
  'bottle', 'bottles', 'can', 'cans', 'box', 'boxes', 'tin', 'tins', 'pouch', 'pouches',
  'carton', 'cartons', 'tube', 'tubes', 'bar', 'bars', 'loose', 'bag', 'bags',
]);

function stemTokenClient(t: string): string {
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) {
    return t.slice(0, -1);
  }
  return t;
}

function phoneticNormalizeClient(tok: string): string {
  if (!/^[\x00-\x7F]+$/.test(tok)) return tok;
  let s = tok.toLowerCase().replace(/(.)\1+/g, '$1');
  s = s.replace(/ie/g, 'i').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ph/g, 'f').replace(/aa/g, 'a');
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

function levenshteinClient(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length < b.length) [a, b] = [b, a];
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = curr;
  }
  return prev[b.length];
}

function tokenSimilarityClient(a: string, b: string): number {
  const sa = stemTokenClient(a);
  const sb = stemTokenClient(b);
  if (sa === sb) return 1.0;
  if (!sa || !sb || !/^[\x00-\x7F]+$/.test(sa) || !/^[\x00-\x7F]+$/.test(sb)) return 0.0;
  if (/^\d+$/.test(sa) || /^\d+$/.test(sb)) return sa === sb ? 1.0 : 0.0;
  const pa = phoneticNormalizeClient(sa);
  const pb = phoneticNormalizeClient(sb);
  if (pa && pa === pb && Math.min(sa.length, sb.length) >= 3) return 0.92;
  if (Math.abs(sa.length - sb.length) > 3 || Math.min(sa.length, sb.length) < 4) return 0.0;
  const maxLen = Math.max(sa.length, sb.length);
  return Math.max(0.0, 1.0 - levenshteinClient(sa, sb) / maxLen);
}

/**
 * Dynamic catalog-aware matcher returning matched candidates + confidence level for high/medium/low gating.
 */
export function matchCatalogCandidates(
  query: string,
  catalog: Product[],
  packageSize?: string | null,
): { candidates: Product[]; confidence: number } {
  const clean = normalizeForMatch(query);
  if (!clean || catalog.length === 0) return { candidates: [], confidence: 0 };

  const qTokens = clean.split(/\s+/).filter((w) => w.length > 1 || /^\d+$/.test(w));
  const qMeaningful = qTokens.filter((t) => !WEIGHT_AND_CONTAINER_TOKENS.has(t)).map(stemTokenClient);
  const effectiveQ = qMeaningful.length > 0 ? qMeaningful : qTokens.map(stemTokenClient);

  const filterByPkg = (list: Product[]): Product[] => {
    if (!packageSize || list.length <= 1) return list;
    const compactPkg = packageSize.toLowerCase().replace(/\s+/g, '');
    const spacedPkg = compactPkg.replace(/(\d+(?:\.\d+)?)([a-z]+)/, '$1 $2');
    const hits = list.filter((p) => {
      const pn = normalizeForMatch(p.name);
      return pn.includes(spacedPkg) || pn.replace(/\s+/g, '').includes(compactPkg);
    });
    return hits.length > 0 ? hits : list;
  };

  // 1. Exact match
  const exacts = catalog.filter((p) => normalizeForMatch(p.name) === clean);
  if (exacts.length > 0) return { candidates: filterByPkg(exacts), confidence: 1.0 };

  // 2. PRODUCT_ALIASES concept match (if query explicitly equals/tokens an alias)
  for (const aliasConfig of PRODUCT_ALIASES) {
    const canonicalNorm = normalizeForMatch(aliasConfig.canonicalName);
    const allAliases = Object.values(aliasConfig.aliases).flat().filter(Boolean) as string[];
    const matchesAlias = allAliases.some((a) => normalizeForMatch(a) === clean) || clean === canonicalNorm;
    if (matchesAlias) {
      const hits = catalog.filter((p) => {
        const pn = normalizeForMatch(p.name);
        const pStems = pn.split(/\s+/).map(stemTokenClient);
        const cStems = canonicalNorm.split(/\s+/).map(stemTokenClient);
        const extraMod = pStems.some((t) => !cStems.includes(t) && DISTINGUISHING_MODIFIERS.has(t));
        if (extraMod) return false;
        return pn.includes(canonicalNorm) || allAliases.some((a) => normalizeForMatch(a) === pn);
      });
      if (hits.length > 0) return { candidates: filterByPkg(hits), confidence: 0.95 };
    }
  }

  // 3. ITEM_TRANSLATIONS exact Indic/English dictionary match
  for (const [canonicalKey, translations] of Object.entries(ITEM_TRANSLATIONS)) {
    const isTransMatch = Object.values(translations).some((trans) => trans && normalizeForMatch(trans) === clean);
    if (isTransMatch) {
      const cKeyNorm = normalizeForMatch(canonicalKey);
      const hits = catalog.filter((p) => {
        const pn = normalizeForMatch(p.name);
        const pStems = pn.split(/\s+/).map(stemTokenClient);
        if (pStems.some((t) => DISTINGUISHING_MODIFIERS.has(t) && !cKeyNorm.includes(t))) return false;
        return pn.includes(cKeyNorm);
      });
      if (hits.length > 0) return { candidates: filterByPkg(hits), confidence: 0.94 };
    }
  }

  // 4. Dynamic token + phonetic scoring across the live catalog
  const scored: Array<{ conf: number; cov: number; unmatchedMod: boolean; product: Product }> = [];
  const qSet = new Set(effectiveQ);

  for (const p of catalog) {
    const pNorm = normalizeForMatch(p.name);
    const pStemsRaw = pNorm.split(/\s+/).filter((t) => !WEIGHT_AND_CONTAINER_TOKENS.has(t));
    const pStems = (pStemsRaw.length > 0 ? pStemsRaw : pNorm.split(/\s+/)).map(stemTokenClient);
    const catStems = normalizeForMatch(String(p.category || '')).split(/\s+/).filter((t) => t.length > 2).map(stemTokenClient);

    // Block bleed onto products with unrequested distinguishing modifiers (e.g. Sugar -> Sugar-Free Gold, Oil -> Essential Oil)
    const extraCandMod = pStems.some((t) => !qSet.has(t) && DISTINGUISHING_MODIFIERS.has(t));
    if (extraCandMod) continue;

    let matchedPrimary = false;
    let unmatchedMod = false;
    const sims: number[] = [];

    for (const qt of effectiveQ) {
      let bestSim = 0;
      for (const ct of pStems) {
        bestSim = Math.max(bestSim, tokenSimilarityClient(qt, ct));
      }
      if (bestSim >= 0.78) {
        matchedPrimary = true;
        sims.push(bestSim);
      } else if (!DISTINGUISHING_MODIFIERS.has(qt) && catStems.length > 0) {
        const catSim = Math.max(...catStems.map((ct) => tokenSimilarityClient(qt, ct)), 0);
        if (catSim >= 0.85) {
          matchedPrimary = true;
          sims.push(0.86);
        } else {
          sims.push(0);
        }
      } else {
        if (DISTINGUISHING_MODIFIERS.has(qt)) unmatchedMod = true;
        sims.push(0);
      }
    }

    if (!matchedPrimary || effectiveQ.length === 0) continue;

    const matchedCount = sims.filter((v) => v >= 0.78).length;
    let coverage = matchedCount / effectiveQ.length;
    let avgSim = sims.reduce((a, b) => a + b, 0) / effectiveQ.length;

    const qCompact = effectiveQ.join('').replace(/\s+/g, '');
    const pCompact = pStems.join('').replace(/\s+/g, '');
    if (qCompact.length >= 4 && pCompact.length >= 4) {
      const compactSim = tokenSimilarityClient(qCompact, pCompact);
      if (compactSim > avgSim) {
        avgSim = compactSim;
        if (compactSim >= 0.80) coverage = Math.max(coverage, 1.0);
      }
    }

    const conf = Math.min(0.94, 0.55 * coverage + 0.45 * avgSim);
    if (coverage >= 0.60 && conf >= 0.60) {
      scored.push({ conf, cov: coverage, unmatchedMod, product: p });
    }
  }

  if (scored.length === 0) return { candidates: [], confidence: 0 };

  scored.sort((a, b) => b.conf - a.conf || b.cov - a.cov);
  const topConf = scored[0].conf;
  const topGroup = scored.filter((s) => s.conf >= topConf - 0.05);
  const topCands = filterByPkg(topGroup.map((s) => s.product));

  if (topCands.length === 1) {
    const chosen = topGroup.find((g) => g.product.id === topCands[0].id) || topGroup[0];
    if (chosen.unmatchedMod) return { candidates: topCands, confidence: Math.min(chosen.conf, 0.75) };
    return { candidates: topCands, confidence: chosen.conf };
  }
  return { candidates: topCands, confidence: Math.min(topConf, 0.78) };
}

/**
 * Finds the best matching catalog product using canonical English names,
 * brand aliases, native Indian language item keywords, and fuzzy similarity.
 */
export function matchCatalogProduct(query: string, catalog: Product[]): Product | null {
  const { candidates, confidence } = matchCatalogCandidates(query, catalog);
  if (candidates.length === 1 && confidence >= 0.85) return candidates[0];
  if (candidates.length > 0 && confidence >= 0.90) return candidates[0];
  return null;
}

export interface ExtractedVoiceClause {
  raw: string;
  quantity: number;
  unit: CanonicalUnit | null;
  productName: string;
  price: number | null;
  action?: 'add' | 'update' | 'remove';
  explicit_quantity?: boolean;
  package_size?: string | null;
  quantity_source?: 'explicit' | 'contextual_homophone' | 'stt_alternative' | 'default';
  quantity_confidence?: number;
  original_quantity_token?: string | null;
  needs_quantity_confirmation?: boolean;
}

export interface VoiceParseContextOptions {
  sttConfidence?: number | null;
  speechAlternatives?: string[];
  hasActiveBillContext?: boolean;
}

const EXTRA_PACKAGE_UNIT_MAP: Record<string, CanonicalUnit> = {
  carton: 'box', cartons: 'box', ctn: 'box',
  tube: 'piece', tubes: 'piece',
  bar: 'piece', bars: 'piece',
  tin: 'box', tins: 'box',
  can: 'bottle', cans: 'bottle',
  jar: 'bottle', jars: 'bottle',
  sachet: 'packet', sachets: 'packet',
  strip: 'packet', strips: 'packet',
  roll: 'piece', rolls: 'piece',
  tray: 'box', trays: 'box',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
};

const ALL_CLIENT_UNITS_MAP: Record<string, CanonicalUnit> = {
  ...UNIT_NORMALIZATION_MAP,
  ...EXTRA_PACKAGE_UNIT_MAP,
};

const CLIENT_CURRENCY_WORDS = new Set([
  'rupees', 'rupee', 'rs', 'rs.', 'inr',
  'రూపాయలు', 'రూ', 'రూపాయ', 'रुपये', 'रुपया', 'रु', 'रूपए',
  'ரூபாய்', 'ರೂಪಾಯಿ', 'രൂപ', 'টাকা', 'રૂપિયા', 'ਰੁਪਏ', 'ଟଙ୍କਾ', 'টকা',
]);

const CLIENT_NON_PRODUCT_WORDS = new Set([
  ...Object.keys(ALL_CLIENT_UNITS_MAP),
  ...CLIENT_CURRENCY_WORDS,
  'of', 'for', 'at', '@', 'per', 'each', 'apiece', 'more', 'the', 'please',
]);

const SORTED_UNIT_TOKENS = Object.keys(ALL_CLIENT_UNITS_MAP)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

function buildClientCatalogPhraseSet(catalog?: Product[]): Set<string> {
  const phrases = new Set<string>();
  if (!catalog) return phrases;
  for (const p of catalog) {
    if (!p?.name) continue;
    const norm = normalizeForMatch(p.name);
    if (!norm) continue;
    phrases.add(norm);
    phrases.add(norm.replace(/\s+/g, ''));
    phrases.add(norm.replace(/(\d+(?:\.\d+)?)(kg|g|gm|ml|l)\b/g, '$1 $2'));
  }
  return phrases;
}

function isDigitOnlyTok(tok: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(tok);
}

function isNumericTok(tok: string): boolean {
  return isDigitOnlyTok(tok) || parseContextQtyTagClient(tok) !== null;
}

function isProdWordTok(tok: string): boolean {
  const low = tok.toLowerCase().replace(/^[,.;:-]+|[,.;:-]+$/g, '');
  if (!low || isNumericTok(low) || low.startsWith('__q')) return false;
  if (CLIENT_NON_PRODUCT_WORDS.has(low)) return false;
  return /[a-zA-Z\u0900-\u0D7F]/.test(low);
}

function numberBelongsToCatalogProduct(
  curTokens: string[],
  tokens: string[],
  idx: number,
  catalogPhrases: Set<string>,
): boolean {
  if (catalogPhrases.size === 0) return false;
  const numTok = tokens[idx].toLowerCase();
  const nextTok = idx + 1 < tokens.length ? tokens[idx + 1].toLowerCase() : '';
  const next2Tok = idx + 2 < tokens.length ? tokens[idx + 2].toLowerCase() : '';

  const rawTail = curTokens
    .slice(-4)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9\u0900-\u0D7F]/g, ''));
  const prefixWords = rawTail.filter((w) => w && !isNumericTok(w) && !CLIENT_NON_PRODUCT_WORDS.has(w));

  if (prefixWords.length === 0) return false;

  const probes: string[] = [];
  for (let k = 1; k <= Math.min(3, prefixWords.length); k++) {
    const subPrefix = prefixWords.slice(-k);
    if (nextTok in ALL_CLIENT_UNITS_MAP) {
      probes.push([...subPrefix, numTok, nextTok].join(' '));
      probes.push([...subPrefix, `${numTok}${nextTok}`].join(' '));
    }
    if (nextTok) {
      probes.push([...subPrefix, numTok, nextTok].join(' '));
      if (next2Tok) {
        probes.push([...subPrefix, numTok, nextTok, next2Tok].join(' '));
      }
    }
  }

  for (const probe of probes) {
    for (const cp of catalogPhrases) {
      if (cp.includes(probe)) return true;
    }
  }
  return false;
}

function segmentContinuousClauseClient(clause: string, catalogPhrases: Set<string>): string[] {
  const tokens = clause.split(/\s+/).filter(Boolean);
  if (tokens.length <= 2) return [clause];

  const slices: string[] = [];
  const n = tokens.length;
  let start = 0;
  const measureUnits = new Set(['g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'ml', 'mls', 'l', 'ltr', 'litre', 'litres', 'liter', 'liters']);

  while (start < n) {
    const hasLeadingQty = isNumericTok(tokens[start]);
    let hasProd = false;
    let i = start;
    if (hasLeadingQty) {
      i += 1;
      if (i < n && tokens[i].toLowerCase() in ALL_CLIENT_UNITS_MAP) {
        i += 1;
        if (i < n && tokens[i].toLowerCase() === 'of') {
          i += 1;
        }
      }
    }

    let splitAt: number | null = null;
    while (i < n) {
      const tok = tokens[i];
      const low = tok.toLowerCase();

      if (isProdWordTok(tok)) {
        hasProd = true;
        i += 1;
        continue;
      }

      if (
        CLIENT_CURRENCY_WORDS.has(low) &&
        i + 1 < n &&
        !['each', 'apiece', 'per'].includes(tokens[i + 1].toLowerCase()) &&
        hasProd &&
        (isNumericTok(tokens[i + 1]) || isProdWordTok(tokens[i + 1]))
      ) {
        splitAt = i + 1;
        break;
      }

      if (isNumericTok(tok) && hasProd) {
        if (parseContextQtyTagClient(tok) !== null) {
          if (i + 1 < n) {
            splitAt = i;
            break;
          }
          i += 1;
          continue;
        }
        const prevLow = i > start ? tokens[i - 1].toLowerCase() : '';
        const nextLow = i + 1 < n ? tokens[i + 1].toLowerCase() : '';

        if (['for', 'at', '@', 'rs', 'rs.', 'inr'].includes(prevLow) || prevLow.includes('₹')) {
          i += 1;
          continue;
        }
        if (prevLow === 'of' && measureUnits.has(nextLow)) {
          i += 1;
          continue;
        }
        if (CLIENT_CURRENCY_WORDS.has(nextLow) || ['each', 'apiece', 'per'].includes(nextLow)) {
          i += 1;
          continue;
        }
        if (numberBelongsToCatalogProduct(tokens.slice(start, i), tokens, i, catalogPhrases)) {
          i += 1;
          continue;
        }

        if (hasLeadingQty) {
          if (i + 1 < n) {
            splitAt = i;
            break;
          }
        } else {
          let endIdx = i + 1;
          if (endIdx < n && tokens[endIdx].toLowerCase() in ALL_CLIENT_UNITS_MAP) {
            endIdx += 1;
          }
          if (
            endIdx < n &&
            (['for', 'at', '@'].includes(tokens[endIdx].toLowerCase()) ||
              (isDigitOnlyTok(tokens[endIdx]) &&
                endIdx + 1 < n &&
                (CLIENT_CURRENCY_WORDS.has(tokens[endIdx + 1].toLowerCase()) ||
                  ['each', 'apiece', 'per'].includes(tokens[endIdx + 1].toLowerCase()))))
          ) {
            i = endIdx;
            continue;
          }
          if (endIdx < n) {
            splitAt = endIdx;
            break;
          }
        }
      }

      i += 1;
    }

    if (splitAt !== null && splitAt > start) {
      slices.push(tokens.slice(start, splitAt).join(' ').trim());
      start = splitAt;
    } else {
      slices.push(tokens.slice(start).join(' ').trim());
      break;
    }
  }

  return slices.filter(Boolean);
}

function extractPackageSizeClient(text: string): { cleaned: string; pkgSize: string | null } {
  const m = text.match(
    /\bof\s+(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|gram|grams|ml|mls|l|ltr|litre|litres|liter|liters)\b(?:\s+(?:each|packs?|packets?))?/i,
  );
  if (!m) return { cleaned: text, pkgSize: null };
  const canonU = ALL_CLIENT_UNITS_MAP[m[2].toLowerCase()] || m[2].toLowerCase();
  const pkgSize = `${m[1]}${canonU}`;
  const cleaned = (text.slice(0, m.index) + ' ' + text.slice((m.index || 0) + m[0].length)).replace(/\s+/g, ' ').trim();
  return { cleaned, pkgSize };
}

/**
 * Extracts multiple item clauses from natural spoken speech clauses.
 * Supports continuous multi-items, catalog-aware segmentation, forward & reverse order,
 * package-size preservation, update/remove commands, and spoken currency prices.
 */
export function extractItemsFromClause(
  clause: string,
  catalog?: Product[],
  options: VoiceParseContextOptions = {},
): ExtractedVoiceClause[] {
  const text = clause.trim();
  if (!text) return [];

  const catalogPhrases = buildClientCatalogPhraseSet(catalog);
  const items: ExtractedVoiceClause[] = [];

  const preSplit = text.replace(/\s+\b(?:and\s+also|and\s+then|also\s+add|also|then|add)\s+(?=\d+(?:\.\d+)?\b)/gi, ', ');

  const subChunks = preSplit
    .split(/[,;\n+]|\b(?:and|aur|mariyu|matrum|mattu|tatha|evam|plus)\b|&/gi)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);

  const clientUnitSet = new Set(Object.keys(ALL_CLIENT_UNITS_MAP));

  for (const chunk of subChunks) {
    let s = chunk.trim();
    let itemAction: 'add' | 'update' | 'remove' = 'add';
    let explicitQty = true;

    const makeItMatch = s.match(/^(?:make|change|update|set)\s+(?:it\s+(?:to\s+)?|to\s+)?(\d+(?:\.\d+)?.*)$/i);
    const chMatch = s.match(/^(?:change|update|modify|make|set|increase|decrease|reduce)\s+(.+?)(?:\s+(?:quantity|qty))?(?:\s+to|\s+(?:quantity|qty))\s+(\d+(?:\.\d+)?.*)$/i);
    if (makeItMatch) {
      s = makeItMatch[1].replace(/\s+instead\s+of\s+\d+(?:\.\d+)?(?:\s+\w+)?$/i, '').replace(/[.!?]+$/, '').trim();
      itemAction = 'update';
    } else if (chMatch) {
      s = `${chMatch[2].replace(/[.!?]+$/, '')} ${chMatch[1].replace(/[.!?]+$/, '')}`.trim();
      itemAction = 'update';
    } else if (/^(?:remove|delete|cancel|drop)\s+/i.test(s)) {
      s = s.replace(/^(?:remove|delete|cancel|drop)\s+/i, '').trim();
      itemAction = 'remove';
      explicitQty = /\b\d+(?:\.\d+)?\b/.test(s);
    }

    for (let pass = 0; pass < 2; pass++) {
      for (const filler of CONVERSATIONAL_FILLERS) {
        s = s.replace(filler, ' ').trim();
      }
    }

    if (!s) continue;

    if (catalog && catalog.length > 0) {
      const ctxRes = resolveContextualHomophonesClient(s, catalog, {
        unitWords: clientUnitSet,
        sttConfidence: options.sttConfidence,
        speechAlternatives: options.speechAlternatives,
        hasActiveBillContext: options.hasActiveBillContext,
      });
      s = ctxRes.resolvedText;
    }

    const segmented = segmentContinuousClauseClient(s, catalogPhrases);

    for (const seg of segmented) {
      const { cleaned: subInitial, pkgSize } = extractPackageSizeClient(seg);
      let sub = subInitial;

      while (sub.length > 0) {
        sub = sub.trim();
        if (!sub) break;

        const subTokens = sub.split(/\s+/);
        const firstTag = subTokens.length > 0 ? parseContextQtyTagClient(subTokens[0]) : null;
        let qtySource: ExtractedVoiceClause['quantity_source'] = 'explicit';
        let qtyConfidence = 1.0;
        let originalQtyToken: string | null = null;
        let needsQtyConfirmation = false;

        if (firstTag) {
          sub = [String(firstTag.quantity), ...subTokens.slice(1)].join(' ');
          qtySource = firstTag.source;
          qtyConfidence = firstTag.confidence;
          originalQtyToken = firstTag.originalToken;
          needsQtyConfirmation = firstTag.mode === 'conf';
        }

        let extractedPrice: number | null = null;
        const priceBeforeMatch = sub.match(new RegExp(`(?:${CURRENCY_REGEX.source})\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
        const priceAfterMatch = sub.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${CURRENCY_REGEX.source})`, 'i'));

        if (priceAfterMatch) {
          extractedPrice = parseFloat(priceAfterMatch[1]);
          sub = sub.replace(priceAfterMatch[0], ' ').trim();
        } else if (priceBeforeMatch) {
          extractedPrice = parseFloat(priceBeforeMatch[1]);
          sub = sub.replace(priceBeforeMatch[0], ' ').trim();
        }

        // Pattern 1: Leading quantity (already segmented per item)
        const leadRegex = new RegExp(
          `^(\\d+(?:\\.\\d+)?)\\s*(?:(${SORTED_UNIT_TOKENS})(?:\\s+of)?)?\\s+(.+)$`,
          'i'
        );
        const leadMatch = sub.match(leadRegex);

        if (leadMatch) {
          const qty = parseFloat(leadMatch[1]);
          const unitWord = leadMatch[2]?.toLowerCase();
          let matchedUnit: CanonicalUnit | null = unitWord ? ALL_CLIENT_UNITS_MAP[unitWord] || null : null;
          if (!matchedUnit) {
            const trailUnitMatch = leadMatch[3].trim().match(new RegExp(`(?:^|\\s)(${SORTED_UNIT_TOKENS})$`, 'i'));
            if (trailUnitMatch) {
              const candUnit = ALL_CLIENT_UNITS_MAP[trailUnitMatch[1].toLowerCase()] || null;
              if (candUnit && !['kg', 'g', 'L', 'ml'].includes(candUnit)) {
                matchedUnit = candUnit;
              }
            }
          }
          const prod = leadMatch[3].trim();
          const skipProse =
            Boolean(catalog && catalog.length > 0 && matchedUnit === null && !pkgSize) &&
            isConversationalNonProductPhraseClient(cleanExtractedProductName(prod), catalog);

          if (!skipProse) {
            items.push({
              raw: stripContextTagsToDigitsClient(leadMatch[0].trim()),
              quantity: qty > 0 ? qty : 1,
              unit: matchedUnit,
              productName: prod,
              price: extractedPrice,
              action: itemAction,
              explicit_quantity: explicitQty,
              package_size: pkgSize,
              quantity_source: qtySource,
              quantity_confidence: qtyConfidence,
              original_quantity_token: originalQtyToken,
              needs_quantity_confirmation: needsQtyConfirmation,
            });
          }

          sub = sub.slice(leadMatch[0].length).trim();
          continue;
        }

        // Pattern 2: Trailing quantity
        const trailRegex = new RegExp(
          `^([a-zA-Z\\u0900-\u0D7F0-9\\s\\-\\(\\)]+?)\\s+(\\d+(?:\\.\\d+)?)(?:\\s+(${SORTED_UNIT_TOKENS}))?(?=(?:\\s+\\d+)|\\s+[a-zA-Z\\u0900-\\u0D7F].*?\\s+\\d+|$)`,
          'i'
        );
        const trailMatch = sub.match(trailRegex);

        if (trailMatch) {
          const prod = trailMatch[1].trim();
          const qty = parseFloat(trailMatch[2]);
          const unitWord = trailMatch[3]?.toLowerCase();
          const matchedUnit = unitWord ? ALL_CLIENT_UNITS_MAP[unitWord] || null : null;
          const skipProse =
            Boolean(catalog && catalog.length > 0 && matchedUnit === null && !pkgSize) &&
            isConversationalNonProductPhraseClient(cleanExtractedProductName(prod), catalog);

          if (!skipProse) {
            items.push({
              raw: stripContextTagsToDigitsClient(trailMatch[0].trim()),
              quantity: qty > 0 ? qty : 1,
              unit: matchedUnit,
              productName: prod,
              price: extractedPrice,
              action: itemAction,
              explicit_quantity: explicitQty,
              package_size: pkgSize,
              quantity_source: qtySource,
              quantity_confidence: qtyConfidence,
              original_quantity_token: originalQtyToken,
              needs_quantity_confirmation: needsQtyConfirmation,
            });
          }

          sub = sub.slice(trailMatch[0].length).trim();
          continue;
        }

        // Pattern 3: Fallback single item without explicit number
        const cleanedFallback = cleanExtractedProductName(sub);
        const skipFallbackProse =
          Boolean(catalog && catalog.length > 0 && !pkgSize) &&
          isConversationalNonProductPhraseClient(cleanedFallback, catalog);
        if (!skipFallbackProse) {
          items.push({
            raw: stripContextTagsToDigitsClient(sub),
            quantity: 1,
            unit: null,
            productName: sub,
            price: extractedPrice,
            action: itemAction,
            explicit_quantity: false,
            package_size: pkgSize,
            quantity_source: 'default',
            quantity_confidence: 1.0,
            original_quantity_token: null,
            needs_quantity_confirmation: false,
          });
        }
        break;
      }
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
 * End-to-end high-efficiency voice parsing pipeline.
 * Extracts items, quantities, packaging units, and spoken prices (e.g. "₹120 rupees").
 */
export function parseMultilingualVoiceBill(
  transcript: string,
  catalog: Product[],
  _spokenLang?: VoiceLanguageKey,
  options: VoiceParseContextOptions = {},
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

  // 1. Normalize numbers and fractions
  const normalized = normalizeIndianSpeechNumbers(transcript);

  // 2. High-efficiency catalog-aware sequential item extraction with context homophone scoring
  const extractedClauses = extractItemsFromClause(normalized, catalog, options);

  const matchedItems: MatchedVoiceItem[] = [];
  const ambiguousItems: AmbiguousVoiceItem[] = [];
  const unmatchedItems: UnmatchedVoiceItem[] = [];

  for (const itemClause of extractedClauses) {
    const cleanName = cleanExtractedProductName(itemClause.productName);
    if (!cleanName) continue;

    const quantity = itemClause.quantity;
    const spokenPrice = itemClause.price;
    const detectedUnit = itemClause.unit;

    // Match against catalog products using dynamic confidence tiers
    const { candidates, confidence } = matchCatalogCandidates(cleanName, catalog, itemClause.package_size);

    if (candidates.length === 1 && confidence >= 0.85) {
      const matchedProduct = candidates[0];
      const pricingStatus = String((matchedProduct as any).pricingStatus ?? (matchedProduct as any).pricing_status ?? 'VERIFIED').toUpperCase();
      if (pricingStatus === 'NEEDS_REVIEW') {
        unmatchedItems.push({
          queried_name: cleanName,
          quantity,
          reason: `Product '${matchedProduct.name}' requires manager pricing review before checkout.`,
        });
        continue;
      }
      if (pricingStatus === 'INCOMPLETE') {
        unmatchedItems.push({
          queried_name: cleanName,
          quantity,
          reason: `Product '${matchedProduct.name}' has incomplete pricing (₹0.00). Cannot be sold.`,
        });
        continue;
      }

      // Support standard metric conversions (500 g -> 0.5 kg, 500 ml -> 0.5 L)
      const productUnit = ALL_CLIENT_UNITS_MAP[(matchedProduct.unit || '').trim().toLowerCase()] ?? null;
      const isWeight = (u: CanonicalUnit | null) => u === 'kg' || u === 'g';
      const isVolume = (u: CanonicalUnit | null) => u === 'L' || u === 'ml';
      const isMeasure = (u: CanonicalUnit | null) => isWeight(u) || isVolume(u);

      let effectiveQuantity = quantity;
      if (detectedUnit !== null && detectedUnit !== productUnit) {
        if (detectedUnit === 'g' && productUnit === 'kg') {
          effectiveQuantity = Math.round((quantity / 1000) * 1000) / 1000;
        } else if (detectedUnit === 'kg' && productUnit === 'g') {
          effectiveQuantity = quantity * 1000;
        } else if (detectedUnit === 'ml' && productUnit === 'L') {
          effectiveQuantity = Math.round((quantity / 1000) * 1000) / 1000;
        } else if (detectedUnit === 'L' && productUnit === 'ml') {
          effectiveQuantity = quantity * 1000;
        } else if (isMeasure(detectedUnit) || isMeasure(productUnit)) {
          unmatchedItems.push({
            queried_name: cleanName,
            quantity,
            reason: `Said in ${detectedUnit}, but ${matchedProduct.name} is sold in ${matchedProduct.unit || 'its own unit'}: check the quantity`,
          });
          continue;
        }
      }

      // Single clear match
      const catalogPrice = matchedProduct.sellingPrice ?? matchedProduct.price ?? 0;
      const basisQty = (matchedProduct.priceBasisQuantity ?? (matchedProduct as any).price_basis_quantity) || 1.0;
      const basisUnit = (matchedProduct.priceBasisUnit ?? (matchedProduct as any).price_basis_unit) || matchedProduct.unit || 'pcs';

      let normalizedBasisQty = basisQty;
      if (productUnit === 'kg' && basisUnit === 'g') {
        normalizedBasisQty = basisQty / 1000;
      } else if (productUnit === 'g' && basisUnit === 'kg') {
        normalizedBasisQty = basisQty * 1000;
      } else if (productUnit === 'L' && basisUnit === 'ml') {
        normalizedBasisQty = basisQty / 1000;
      } else if (productUnit === 'ml' && basisUnit === 'L') {
        normalizedBasisQty = basisQty * 1000;
      }

      const effectiveBasis = normalizedBasisQty > 0 ? normalizedBasisQty : 1.0;
      const buildReadyLine = (qtyValue: number, isExplicit: boolean, qtySrc: MatchedVoiceItem['quantity_source']): MatchedVoiceItem => {
        const calculatedLineTotal = Math.round(((catalogPrice * qtyValue) / effectiveBasis) * 100) / 100;
        const lineTotalVal = spokenPrice !== null ? spokenPrice : calculatedLineTotal;
        const unitPriceExact = spokenPrice !== null ? spokenPrice / qtyValue : (catalogPrice / effectiveBasis);
        return {
          product_id: matchedProduct.id,
          name: matchedProduct.name,
          quantity: qtyValue,
          unit_price: Math.round(unitPriceExact * 1000) / 1000,
          unit_price_exact: unitPriceExact,
          price_source: spokenPrice !== null ? 'spoken' : 'catalogue',
          total_price: lineTotalVal,
          unit: matchedProduct.unit || 'pcs',
          current_stock: matchedProduct.stock ?? 10,
          is_out_of_stock: (matchedProduct.stock ?? 0) <= 0,
          is_insufficient_stock: qtyValue > (matchedProduct.stock ?? 0),
          available_stock: Math.max(0, matchedProduct.stock ?? 0),
          action: itemClause.action || 'add',
          explicit_quantity: isExplicit,
          match_confidence: Math.round(confidence * 1000) / 1000,
          quantity_source: qtySrc,
          quantity_confidence: itemClause.quantity_confidence ?? 1.0,
          original_quantity_token: itemClause.original_quantity_token ?? null,
          raw_text: itemClause.raw,
          package_size: itemClause.package_size ?? null,
        };
      };

      if (itemClause.needs_quantity_confirmation) {
        const candSummary: VoiceProductCandidate = {
          id: matchedProduct.id,
          name: matchedProduct.name,
          selling_price: catalogPrice,
          current_stock: matchedProduct.stock ?? 0,
          unit: matchedProduct.unit || 'pcs',
          category: matchedProduct.category,
        };
        const displayRaw =
          itemClause.original_quantity_token && itemClause.raw.startsWith(String(itemClause.quantity))
            ? `${itemClause.original_quantity_token}${itemClause.raw.slice(String(itemClause.quantity).length)}`
            : itemClause.raw;
        ambiguousItems.push({
          queried_name: cleanName,
          quantity: effectiveQuantity,
          candidates: [candSummary],
          spoken_price: spokenPrice,
          ambiguity_type: 'quantity',
          suggested_quantity: effectiveQuantity,
          fallback_quantity: 1,
          raw_phrase: displayRaw,
          reason: `Did you mean ${effectiveQuantity} × ${matchedProduct.name}, or add without quantity?`,
          options: [
            buildReadyLine(effectiveQuantity, true, itemClause.quantity_source || 'contextual_homophone'),
            buildReadyLine(1, false, 'default'),
          ],
        });
      } else {
        matchedItems.push(
          buildReadyLine(
            effectiveQuantity,
            itemClause.explicit_quantity ?? true,
            itemClause.quantity_source || 'explicit',
          ),
        );
      }
    } else if (candidates.length > 0 && confidence >= 0.60) {
      const candidatesList: VoiceProductCandidate[] = candidates.map((c) => ({
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
        spoken_price: spokenPrice,
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
