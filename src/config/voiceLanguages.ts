/**
 * @file voiceLanguages.ts
 * @description Centralized language configuration, BCP-47 speech recognition codes,
 * and display localization dictionary for the Multilingual Voice-to-Bill feature.
 */

export type VoiceLanguageKey =
  | 'english'
  | 'telugu'
  | 'hindi'
  | 'tamil'
  | 'kannada'
  | 'malayalam'
  | 'marathi'
  | 'bengali'
  | 'gujarati'
  | 'punjabi'
  | 'odia'
  | 'assamese';

export interface VoiceLanguageConfig {
  name: string;
  nativeName: string;
  speechCode: string;
}

export const SPEECH_LANGUAGES: Record<VoiceLanguageKey, VoiceLanguageConfig> = {
  english: {
    name: "English",
    nativeName: "English",
    speechCode: "en-IN"
  },
  telugu: {
    name: "Telugu",
    nativeName: "తెలుగు",
    speechCode: "te-IN"
  },
  hindi: {
    name: "Hindi",
    nativeName: "हिन्दी",
    speechCode: "hi-IN"
  },
  tamil: {
    name: "Tamil",
    nativeName: "தமிழ்",
    speechCode: "ta-IN"
  },
  kannada: {
    name: "Kannada",
    nativeName: "ಕನ್ನಡ",
    speechCode: "kn-IN"
  },
  malayalam: {
    name: "Malayalam",
    nativeName: "മലയാളം",
    speechCode: "ml-IN"
  },
  marathi: {
    name: "Marathi",
    nativeName: "मराठी",
    speechCode: "mr-IN"
  },
  bengali: {
    name: "Bengali",
    nativeName: "বাংলা",
    speechCode: "bn-IN"
  },
  gujarati: {
    name: "Gujarati",
    nativeName: "ગુજરાતી",
    speechCode: "gu-IN"
  },
  punjabi: {
    name: "Punjabi",
    nativeName: "ਪੰਜਾਬੀ",
    speechCode: "pa-IN"
  },
  odia: {
    name: "Odia",
    nativeName: "ଓଡ଼ିଆ",
    speechCode: "or-IN"
  },
  assamese: {
    name: "Assamese",
    nativeName: "অসমীয়া",
    speechCode: "as-IN"
  }
};

export const VOICE_LANGUAGES: Record<VoiceLanguageKey, VoiceLanguageConfig & { key: VoiceLanguageKey; label: string }> = {
  english: { ...SPEECH_LANGUAGES.english, key: 'english', label: 'English' },
  telugu: { ...SPEECH_LANGUAGES.telugu, key: 'telugu', label: 'Telugu (తెలుగు)' },
  hindi: { ...SPEECH_LANGUAGES.hindi, key: 'hindi', label: 'Hindi (हिन्दी)' },
  tamil: { ...SPEECH_LANGUAGES.tamil, key: 'tamil', label: 'Tamil (தமிழ்)' },
  kannada: { ...SPEECH_LANGUAGES.kannada, key: 'kannada', label: 'Kannada (ಕನ್ನಡ)' },
  malayalam: { ...SPEECH_LANGUAGES.malayalam, key: 'malayalam', label: 'Malayalam (മലയാളം)' },
  marathi: { ...SPEECH_LANGUAGES.marathi, key: 'marathi', label: 'Marathi (मराठी)' },
  bengali: { ...SPEECH_LANGUAGES.bengali, key: 'bengali', label: 'Bengali (বাংলা)' },
  gujarati: { ...SPEECH_LANGUAGES.gujarati, key: 'gujarati', label: 'Gujarati (ગુજરાતી)' },
  punjabi: { ...SPEECH_LANGUAGES.punjabi, key: 'punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  odia: { ...SPEECH_LANGUAGES.odia, key: 'odia', label: 'Odia (ଓଡ଼ିଆ)' },
  assamese: { ...SPEECH_LANGUAGES.assamese, key: 'assamese', label: 'Assamese (অসমীয়া)' },
};

export const VOICE_LANGUAGES_LIST = Object.values(VOICE_LANGUAGES);

/**
 * Standard Indian retail units normalized internally.
 */
export type CanonicalUnit =
  | 'kg'
  | 'g'
  | 'L'
  | 'ml'
  | 'piece'
  | 'packet'
  | 'box'
  | 'bottle'
  | 'dozen';

/**
 * Centralized mapping of Indian language spoken units to internal canonical units.
 */
export const UNIT_NORMALIZATION_MAP: Record<string, CanonicalUnit> = {
  // Kilogram
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  'కిలో': 'kg',
  'కిలోలు': 'kg',
  'కిలోల': 'kg',
  'కేజీ': 'kg',
  'కేజీలు': 'kg',
  'కేజీల': 'kg',
  'किलो': 'kg',
  'किलों': 'kg',
  'किलोग्राम': 'kg',
  'கிலோ': 'kg',
  'கிலோக்கள்': 'kg',
  'ಕಿಲೋ': 'kg',
  'ಕಿಲೋಗಳು': 'kg',
  'കിലോ': 'kg',
  'केजी': 'kg',
  'কেজি': 'kg',
  'કિલો': 'kg',
  'ਕਿਲੋ': 'kg',
  'କିଲୋ': 'kg',

  // Gram
  g: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  'గ్రాము': 'g',
  'గ్రాములు': 'g',
  'గ్రాం': 'g',
  'ग्राम': 'g',
  'கிராம்': 'g',
  'ಗ್ರಾಂ': 'g',
  'ഗ്രാം': 'g',
  'গ্রাম': 'g',
  'ગામ': 'g',
  'ਗ੍ਰਾਮ': 'g',
  'ଗ୍ରାମ': 'g',

  // Liter / Litre
  l: 'L',
  ltr: 'L',
  ltrs: 'L',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
  'లీటర్': 'L',
  'లీటర్లు': 'L',
  'లీటర్ల': 'L',
  'लीटर': 'L',
  'लीटरों': 'L',
  'லிட்டர்': 'L',
  'ಲೀಟರ್': 'L',
  'ലിറ്റർ': 'L',
  'लिटर': 'L',
  'লিটার': 'L',
  'લીટર': 'L',
  'ਲੀਟਰ': 'L',
  'ଲିଟର': 'L',
  'লিটাৰ': 'L',

  // Milliliter
  ml: 'ml',
  mls: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  'మిల్లీలీటర్': 'ml',
  'మి.లీ': 'ml',
  'मिलीलीटर': 'ml',
  'மில்லிலிட்டர்': 'ml',
  'ಮಿಲಿಲೀಟರ್': 'ml',
  'മില്ലിലിറ്റർ': 'ml',

  // Piece
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  unit: 'piece',
  units: 'piece',
  item: 'piece',
  items: 'piece',
  'ముక్క': 'piece',
  'ముక్కలు': 'piece',
  'నగ': 'piece',
  'నగ్': 'piece',
  'పీస్': 'piece',
  'నగలు': 'piece',
  'नग': 'piece',
  'पीस': 'piece',
  'துண்டு': 'piece',
  'துண்டுகள்': 'piece',
  'ತುಂಡು': 'piece',
  'കഷണം': 'piece',
  'पिस': 'piece',
  'পিস': 'piece',
  'નંગ': 'piece',
  'ਨਗ': 'piece',
  'ଖଣ୍ଡ': 'piece',
  'টুকুৰা': 'piece',

  // Packet
  packet: 'packet',
  packets: 'packet',
  pack: 'packet',
  packs: 'packet',
  pkt: 'packet',
  pkts: 'packet',
  pouch: 'packet',
  pouches: 'packet',
  'ప్యాకెట్': 'packet',
  'ప్యాకెట్లు': 'packet',
  'ప్యాకెట్ల': 'packet',
  'ప్యాక్': 'packet',
  'పౌచ్': 'packet',
  'पैकेट': 'packet',
  'पॉकेट': 'packet',
  'पाउच': 'packet',
  'पाकीट': 'packet',
  'பாக்கெட்': 'packet',
  'பவுச்': 'packet',
  'ಪ್ಯಾಕೆಟ್': 'packet',
  'ಪ್ಯಾಕ್': 'packet',
  'പാക്കറ്റ്': 'packet',
  'প্যাকেট': 'packet',
  'પેકેટ': 'packet',
  'પૅકેટ': 'packet',
  'ਪੈਕੇਟ': 'packet',
  'ପ୍ୟାକେଟ': 'packet',
  'পেকেট': 'packet',

  // Box
  box: 'box',
  boxes: 'box',
  dabba: 'box',
  dappe: 'box',
  'డబ్బా': 'box',
  'డబ్బాలు': 'box',
  'పెట్టె': 'box',
  'డిబ్బా': 'box',
  'डिब्बा': 'box',
  'डब्बा': 'box',
  'പെട്ടി': 'box',
  'ಪೆಟ್ಟಿಗೆ': 'box',
  'பெட்டி': 'box',
  'বাক্স': 'box',
  'બોક્સ': 'box',
  'ਡੱਬਾ': 'box',
  'ବାକ୍ସ': 'box',

  // Bottle
  bottle: 'bottle',
  bottles: 'bottle',
  btl: 'bottle',
  btls: 'bottle',
  'బాటిల్': 'bottle',
  'బాటిళ్ళు': 'bottle',
  'సీసా': 'bottle',
  'సీసాలు': 'bottle',
  'बोतल': 'bottle',
  'बोतलें': 'bottle',
  'பாட்டில்': 'bottle',
  'பாட்டில்கள்': 'bottle',
  'ಬಾಟಲ್': 'bottle',
  'ಬಾಟಲಿಗಳು': 'bottle',
  'കുപ്പി': 'bottle',
  'കുപ്പികൾ': 'bottle',
  'बाटली': 'bottle',
  'बाटल्या': 'bottle',
  'বোতল': 'bottle',
  'બોટલ': 'bottle',
  'ਬੋਤਲ': 'bottle',
  'ବୋତଲ': 'bottle',
  'বটল': 'bottle',

  // Dozen
  dozen: 'dozen',
  dozens: 'dozen',
  darjan: 'dozen',
  'డజన్': 'dozen',
  'డజన్లు': 'dozen',
  'दर्जन': 'dozen',
  'டஜன்': 'dozen',
  'ಡಜನ್': 'dozen',
  'ഡസൻ': 'dozen',
  'डझन': 'dozen',
  'ডজন': 'dozen',
  'ડઝન': 'dozen',
  'ਦਰਜਨ': 'dozen',
  'ଡଜନ': 'dozen',
};

/**
 * Normalizes any spoken unit in any Indian language to canonical form.
 */
export function normalizeSpokenUnit(rawUnit: string): CanonicalUnit {
  if (!rawUnit) return 'piece';
  const clean = rawUnit.toLowerCase().trim().replace(/[-_.]/g, '');
  return UNIT_NORMALIZATION_MAP[clean] || 'piece';
}

/**
 * Centralized Product Alias structure mapping canonical inventory concepts
 * to their multilingual variations and brand names.
 */
export interface ProductAliasConfig {
  canonicalName: string;
  aliases: Partial<Record<VoiceLanguageKey, string[]>>;
}

export const PRODUCT_ALIASES: ProductAliasConfig[] = [
  {
    canonicalName: 'Rice',
    aliases: {
      english: ['rice', 'basmati rice', 'chawal', 'white rice', 'brown rice'],
      telugu: ['బియ్యం', 'బాస్మతి బియ్యం', 'రైస్'],
      hindi: ['चावल', 'बासमती चावल', 'राइस'],
      tamil: ['அரிசி', 'பாஸ்மதி அரிசி'],
      kannada: ['ಅಕ್ಕಿ', 'ಬಾಸ್ಮತಿ ಅಕ್ಕಿ'],
      malayalam: ['അരി', 'ബസ്മതി അരി'],
      marathi: ['तांदूळ', 'बासमती तांदूळ', 'भात'],
      bengali: ['চাল', 'বাসমতী চাল'],
      gujarati: ['ચોખા', 'બાસમતી ચોખા'],
      punjabi: ['ਚੌਲ', 'ਬਾਸਮਤੀ ਚੌਲ'],
      odia: ['ଚାଉଳ', 'ବାସମତୀ ଚାଉଳ'],
      assamese: ['চাউল', 'বাসমতী চাউল'],
    },
  },
  {
    canonicalName: 'Tata Salt',
    aliases: {
      english: ['tata salt', 'tata salt 1kg', 'salt', 'iodized salt'],
      telugu: ['టాటా సాల్ట్', 'టాటా ఉప్పు', 'ఉప్పు', 'సాల్ట్'],
      hindi: ['टाटा नमक', 'टाटा साल्ट', 'नमक', 'साल्ट'],
      tamil: ['டாடா உப்பு', 'டாடா சால்ட்', 'உப்பு'],
      kannada: ['ಟಾಟಾ ಉಪ್ಪು', 'ಟಾಟಾ ಸಾಲ್ಟ್', 'ಉಪ್ಪು'],
      malayalam: ['ടാറ്റ ഉപ്പ്', 'ടാറ്റ സോൾട്ട്', 'ഉപ്പ്'],
      marathi: ['टाटा मीठ', 'टाटा सॉल्ट', 'मीठ'],
      bengali: ['টাটা লবণ', 'টাটা নুন', 'লবণ', 'নুন'],
      gujarati: ['ટાટા મીઠું', 'ટાટા સોલ્ટ', 'મીઠું'],
      punjabi: ['ਟਾਟਾ ਲੂਣ', 'ਟਾਟਾ ਸਾਲਟ', 'ਲੂਣ'],
      odia: ['ଟାଟା ଲୁଣ', 'ଲୁଣ'],
      assamese: ['টাটা নিমখ', 'নিমখ'],
    },
  },
  {
    canonicalName: 'Parle-G',
    aliases: {
      english: ['parle-g', 'parle g', 'parleg', 'parle g biscuits', 'biscuits'],
      telugu: ['పార్లే-జి', 'పార్లే జి', 'పార్లే జీ', 'బిస్కెట్లు', 'బిస్కట్'],
      hindi: ['पारले-जी', 'पारले जी', 'पारलेजी', 'बिस्कुट'],
      tamil: ['பார்லே-ஜி', 'பார்லே ஜி', 'பிஸ்கட்'],
      kannada: ['ಪಾರ್ಲೆ-ಜಿ', 'ಪಾರ್ಲೆ ಜಿ', 'ಬಿಸ್ಕತ್ತು'],
      malayalam: ['പാർലെ-ജി', 'പാർലെ ജി', 'ബിസ്‌ക്കറ്റ്'],
      marathi: ['पारले-जी', 'पारले जी', 'बिस्कीट'],
      bengali: ['পার্লে-জি', 'পার্লে জি', 'বিস্কুট'],
      gujarati: ['પાર્લે-જી', 'પાર્લે જી', 'બિસ્કિટ'],
      punjabi: ['ਪਾਰਲੇ-ਜੀ', 'ਪਾਰਲੇ ਜੀ', 'ਬਿਸਕੁਟ'],
      odia: ['ପାର୍ଲେ-ଜି', 'ପାର୍ଲେ ଜି', 'ବିସ୍କୁଟ'],
      assamese: ['পাৰ্লে-জি', 'পাৰ্লে জি', 'বিস্কুট'],
    },
  },
  {
    canonicalName: 'Aashirvaad Atta',
    aliases: {
      english: ['aashirvaad atta', 'ashirvad atta', 'atta', 'wheat flour', 'flour'],
      telugu: ['ఆశీర్వాద్ గోధుమ పిండి', 'ఆశీర్వాద్ పిండి', 'ఆశీర్వాద్ ఆటా', 'గోధుమ పిండి', 'పిండి', 'ఆటా'],
      hindi: ['आशीर्वाद आटा', 'आटा', 'गेहूं का आटा'],
      tamil: ['ஆசீர்வாத் கோதுமை மாவு', 'ஆசீர்வாத் மாவு', 'கோதுமை மாவு', 'மாவு'],
      kannada: ['ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು', 'ಆಶೀರ್ವಾದ್ ಹಿಟ್ಟು', 'ಗೋಧಿ ಹಿಟ್ಟು', 'ಹಿಟ್ಟು'],
      malayalam: ['ആശീർവാദ് ഗോതമ്പ് മാവ്', 'ഗോതമ്പ് മാവ്'],
      marathi: ['आशीर्वाद आटा', 'गव्हाचे पीठ', 'आटा'],
      bengali: ['আশীর্বাদ আটা', 'গম আটা', 'আটা'],
      gujarati: ['આશીર્વાદ લોટ', 'ઘઉંનો લોਟ', 'લોટ'],
      punjabi: ['ਆਸ਼ੀਰਵਾਦ ਆਟਾ', 'ਕਣਕ ਦਾ ਆਟਾ', 'ਆਟਾ'],
      odia: ['ଆଶୀର୍ବାଦ ଅଟା', 'ଗହମ ଅଟା', 'ଅଟା'],
      assamese: ['আশীৰ্বাদ আটা', 'আটা'],
    },
  },
  {
    canonicalName: 'Toned Milk',
    aliases: {
      english: ['toned milk', 'toned milk (500ml)', 'milk', 'amul milk'],
      telugu: ['టోన్డ్ పాలు', 'పాలు', 'మిల్క్'],
      hindi: ['टोन्ड दूध', 'दूध', 'मिल्क'],
      tamil: ['டோன்ட் பால்', 'பால்'],
      kannada: ['ಟೋನ್ಡ್ ಹಾಲು', 'ಹಾಲು'],
      malayalam: ['ടോൺഡ് പാൽ', 'പാൽ'],
      marathi: ['टोन्ड दूध', 'दूध'],
      bengali: ['টোনড দুধ', 'দুধ'],
      gujarati: ['ટોન્ડ દૂધ', 'દૂધ'],
      punjabi: ['ਟੋਨਡ ਦੁੱਧ', 'ਦੁੱਧ'],
      odia: ['ଟୋନଡ୍ କ୍ଷୀର', 'କ୍ଷୀର'],
      assamese: ['টোনড গাখীৰ', 'গাখীৰ'],
    },
  },
  {
    canonicalName: 'Fresh White Bread',
    aliases: {
      english: ['fresh white bread', 'white bread', 'bread', 'loaf of bread'],
      telugu: ['వైట్ బ్రెడ్', 'బ్రెడ్'],
      hindi: ['व्हाइट ब्रेड', 'ब्रेड'],
      tamil: ['வெள்ளை ரொட்டி', 'ரொட்டி', 'பிரெட்'],
      kannada: ['ವೈಟ್ ಬ್ರೆಡ್', 'ಬ್ರೆಡ್'],
      malayalam: ['വൈറ്റ് ബ്രെഡ്', 'ബ്രെഡ്'],
      marathi: ['व्हाईट ब्रेड', 'ब्रेड'],
      bengali: ['সাদা পাউরুটি', 'পাউরুটি'],
      gujarati: ['વ્હાઇટ બ્રેડ', 'બ્રેડ'],
      punjabi: ['ਵਾਈਟ ਬਰੈੱਡ', 'ਬਰੈੱਡ'],
      odia: ['ହ୍ୱାଇଟ୍ ବ୍ରେଡ୍', 'ବ୍ରେଡ୍'],
      assamese: ['বগা পাউৰুটী', 'পাউৰুটী'],
    },
  },
  {
    canonicalName: 'Refined Sugar',
    aliases: {
      english: ['refined sugar', 'sugar', 'sugar (1kg)'],
      telugu: ['చక్కెర', 'పంచదార', 'షుగర్'],
      hindi: ['चीनी', 'शक्कर', 'शुगर'],
      tamil: ['சர்க்கரை', 'சீனி'],
      kannada: ['ಸಕ್ಕರೆ'],
      malayalam: ['പഞ്ചസാര'],
      marathi: ['साखर'],
      bengali: ['চিনি'],
      gujarati: ['ખાંડ'],
      punjabi: ['ਖੰਡ'],
      odia: ['ଚିନି'],
      assamese: ['চেনি'],
    },
  },
  {
    canonicalName: 'Sunflower Cooking Oil',
    aliases: {
      english: ['sunflower cooking oil', 'sunflower oil', 'cooking oil', 'oil'],
      telugu: ['సన్‌ఫ్లవర్ నూనె', 'వంట నూనె', 'నూనె', 'ఆయిల్'],
      hindi: ['सनफ्लावर तेल', 'खाना पकाने का तेल', 'तेल', 'ऑयल'],
      tamil: ['சூரியகாந்தி எண்ணெய்', 'சமையல் எண்ணெய்', 'எண்ணெய்'],
      kannada: ['ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ', 'ಅಡುಗೆ ಎಣ್ಣೆ', 'ಎಣ್ಣೆ'],
      malayalam: ['സൂര്യകാന്തി എണ്ണ', 'പാചക എണ്ണ', 'എണ്ണ'],
      marathi: ['सूर्यफूल तेल', 'खाद्यतेल', 'तेल'],
      bengali: ['সূর্যমুখী তেল', 'রান্নার তেল', 'তেল'],
      gujarati: ['સૂર્યમુખી તેલ', 'તેલ'],
      punjabi: ['ਸੂਰਜਮੁਖੀ ਤੇਲ', 'ਤੇਲ'],
      odia: ['ସୂର୍ଯ୍ୟମୁଖୀ ତେଲ', 'ତେଲ'],
      assamese: ['সূৰ্য্যমুখী তেল', 'তেল'],
    },
  },
  {
    canonicalName: 'Premium Assam Tea',
    aliases: {
      english: ['premium assam tea', 'assam tea', 'tea', 'tea powder'],
      telugu: ['అస్సాం టీ', 'టీ', 'చాయ్', 'టీ పొడి'],
      hindi: ['असम चाय', 'चाय', 'चाय पत्ती'],
      tamil: ['அசாம் தேநீர்', 'தேநீர்', 'டீ'],
      kannada: ['ಅಸ್ಸಾಂ ಚಹಾ', 'ಚಹಾ', 'ಟೀ'],
      malayalam: ['അസം ചായ', 'ചായ'],
      marathi: ['आसाम चहा', 'चहा'],
      bengali: ['আসাম চা', 'চা'],
      gujarati: ['આસામ ચા', 'ચા'],
      punjabi: ['ਅਸਾਮ ਚਾਹ', 'ਚਾਹ'],
      odia: ['ଆସାମ ଚା', 'ଚା'],
      assamese: ['অসম চাহ', 'চাহ'],
    },
  },
  {
    canonicalName: 'Coca Cola',
    aliases: {
      english: ['coca cola', 'coke', 'cola', 'cold drink'],
      telugu: ['కోకా కోలా', 'కోక్', 'కూల్ డ్రింక్'],
      hindi: ['कोका कोला', 'कोक', 'कोल्ड ड्रिंक'],
      tamil: ['கோகோ கோலா', 'கோக்'],
      kannada: ['ಕೋಕಾ ಕೋಲಾ', 'ಕೋಕ್'],
      malayalam: ['കൊക്കകോള', 'കോക്ക്'],
      marathi: ['कोका कोला', 'कोक'],
      bengali: ['কোকা কোলা', 'কোক'],
      gujarati: ['કોકા કોલા', 'કોક'],
      punjabi: ['ਕੋਕਾ ਕੋਲਾ', 'ਕੋਕ'],
      odia: ['କୋକା କୋଲା', 'କୋକ୍'],
      assamese: ['কোকা কোলা', 'কোক'],
    },
  },
  {
    canonicalName: 'Maggi 2-Min Noodles',
    aliases: {
      english: ['maggi 2-min noodles', 'maggi noodles', 'maggi', 'noodles'],
      telugu: ['మ్యాగీ నూడుల్స్', 'మ్యాగీ', 'నూడుల్స్'],
      hindi: ['मैगी नूडल्स', 'मैगी', 'नूडल्स'],
      tamil: ['மேகி நூடுல்ஸ்', 'மேகி', 'நூடுல்ஸ்'],
      kannada: ['ಮ್ಯಾಗಿ ನೂಡಲ್ಸ್', 'ಮ್ಯಾಗಿ', 'ನೂಡಲ್ಸ್'],
      malayalam: ['മാഗി നൂഡിൽസ്', 'മാഗി', 'നൂഡിൽസ്'],
      marathi: ['मॅगी नूडल्स', 'मॅगी', 'नूडल्स'],
      bengali: ['ম্যাগি নুডলস', 'ম্যাগি', 'নুডলস'],
      gujarati: ['મેગી નૂડલ્સ', 'મેગી', 'નૂડલ્સ'],
      punjabi: ['ਮੈਗੀ ਨੂਡਲਜ਼', 'ਮੈਗੀ', 'ਨੂਡਲਜ਼'],
      odia: ['ମ୍ୟାଗି ନୁଡଲ୍ସ', 'ମ୍ୟାଗି', 'ନୁଡଲ୍ସ'],
      assamese: ['মেগী নুডলছ', 'মেগী', 'নুডলছ'],
    },
  },
  {
    canonicalName: 'Amul Butter',
    aliases: {
      english: ['amul butter', 'butter'],
      telugu: ['అమూల్ వెన్న', 'వెన్న', 'బటర్'],
      hindi: ['अमूल मक्खन', 'मक्खन', 'बटर'],
      tamil: ['அமுல் வெண்ணெய்', 'வெண்ணெய்', 'பட்டர்'],
      kannada: ['ಅಮುಲ್ ಬೆಣ್ಣೆ', 'ಬೆಣ್ಣೆ'],
      malayalam: ['അമുൽ വെണ്ണ', 'വെണ്ണ'],
      marathi: ['अमूल लोणी', 'लोणी', 'बटर'],
      bengali: ['আমুল মাখন', 'মাখন'],
      gujarati: ['અમૂલ માખણ', 'માખણ'],
      punjabi: ['ਅਮੂਲ ਮੱਖਣ', 'ਮੱਖਣ'],
      odia: ['ଅମୂଲ ଲହୁଣୀ', 'ଲହୁଣୀ'],
      assamese: ['আমুল মাখন', 'মাখন'],
    },
  },
  {
    canonicalName: 'Dettol Soap',
    aliases: {
      english: ['dettol soap', 'dettol', 'soap'],
      telugu: ['డెట్టాల్ సబ్బు', 'సబ్బు', 'డెట్టాల్'],
      hindi: ['डेटॉल साबुन', 'साबुन', 'डेटॉल'],
      tamil: ['டெட்டால் சோப்', 'சோப்'],
      kannada: ['ಡೆಟ್ಟಾಲ್ ಸೋಪ್', 'ಸೋಪ್'],
      malayalam: ['ഡെറ്റോൾ സോപ്പ്', 'സോപ്പ്'],
      marathi: ['डेटॉल साबण', 'साबण'],
      bengali: ['ডেটোল সাবান', 'সাবান'],
      gujarati: ['ડેટોલ સાબુ', 'સાબુ'],
      punjabi: ['ਡੈਟੋਲ ਸਾਬਣ', 'ਸਾਬਣ'],
      odia: ['ଡେଟୋଲ ସାବୁନ', 'ସାବୁନ'],
      assamese: ['ডেটোল চাবোন', 'চাবোন'],
    },
  },
];

/**
 * Common FMCG & Kirana item name translations across supported Indian languages.
 */
export const ITEM_TRANSLATIONS: Record<string, Partial<Record<VoiceLanguageKey, string>>> = {
  rice: {
    english: 'Rice',
    telugu: 'బియ్యం',
    hindi: 'चावल',
    tamil: 'அரிசி',
    kannada: 'ಅಕ್ಕಿ',
    malayalam: 'അരി',
    marathi: 'तांदूळ',
    bengali: 'চাল',
    gujarati: 'ચોખા',
    punjabi: 'ਚੌਲ',
    odia: 'ଚାଉଳ',
    assamese: 'চাউল',
  },
  'basmati rice': {
    english: 'Basmati Rice',
    telugu: 'బాస్మతి బియ్యం',
    hindi: 'बासमती चावल',
    tamil: 'பாஸ்மதி அரிசி',
    kannada: 'ಬಾಸ್ಮತಿ ಅಕ್ಕಿ',
    malayalam: 'ബസ്മതി അരി',
    marathi: 'बासमती तांदूळ',
    bengali: 'বাসমতী চাল',
    gujarati: 'બાસમતી ચોખા',
    punjabi: 'ਬਾਸਮਤੀ ਚੌਲ',
    odia: 'ବାସମତୀ ଚାଉଳ',
    assamese: 'বাসমতী চাউল',
  },
  salt: {
    english: 'Salt',
    telugu: 'ఉప్పు',
    hindi: 'नमक',
    tamil: 'உப்பு',
    kannada: 'ಉಪ್ಪು',
    malayalam: 'ഉപ്പ്',
    marathi: 'मीठ',
    bengali: 'লবণ',
    gujarati: 'મીઠું',
    punjabi: 'ਲੂਣ',
    odia: 'ଲୁଣ',
    assamese: 'নিমখ',
  },
  'tata salt': {
    english: 'Tata Salt',
    telugu: 'టాటా ఉప్పు',
    hindi: 'टाटा नमक',
    tamil: 'டாடா உப்பு',
    kannada: 'ಟಾಟಾ ಉಪ್ಪು',
    malayalam: 'ടാറ്റ ഉപ്പ്',
    marathi: 'टाटा मीठ',
    bengali: 'টাটা লবণ',
    gujarati: 'ટાટા મીઠું',
    punjabi: 'ਟਾਟਾ ਲੂਣ',
    odia: 'ଟାଟା ଲୁଣ',
    assamese: 'টাটা নিমখ',
  },
  milk: {
    english: 'Milk',
    telugu: 'పాలు',
    hindi: 'दूध',
    tamil: 'பால்',
    kannada: 'ಹಾಲು',
    malayalam: 'പാൽ',
    marathi: 'दूध',
    bengali: 'দুধ',
    gujarati: 'દૂધ',
    punjabi: 'ਦੁੱਧ',
    odia: 'କ୍ଷୀର',
    assamese: 'গাখীৰ',
  },
  'toned milk': {
    english: 'Toned Milk',
    telugu: 'టోన్డ్ పాలు',
    hindi: 'टोन्ड दूध',
    tamil: 'டோன்ட் பால்',
    kannada: 'ಟೋನ್ಡ್ ಹಾಲು',
    malayalam: 'ടോൺഡ് പാൽ',
    marathi: 'टोन्ड दूध',
    bengali: 'টোনড দুধ',
    gujarati: 'ટોન્ડ દૂધ',
    punjabi: 'ਟੋਨਡ ਦੁੱਧ',
    odia: 'ଟୋନଡ୍ କ୍ଷୀର',
    assamese: 'টোনড গাখীৰ',
  },
  bread: {
    english: 'Bread',
    telugu: 'బ్రెడ్',
    hindi: 'ब्रेड',
    tamil: 'ரொட்டி',
    kannada: 'ಬ್ರೆಡ್',
    malayalam: 'ബ്രെഡ്',
    marathi: 'ब्रेड',
    bengali: 'পাউরুটি',
    gujarati: 'બ્રેડ',
    punjabi: 'ਬਰੈੱਡ',
    odia: 'ବ୍ରେଡ୍',
    assamese: 'পাউৰুটী',
  },
  'white bread': {
    english: 'White Bread',
    telugu: 'వైట్ బ్రెడ్',
    hindi: 'व्हाइट ब्रेड',
    tamil: 'வெள்ளை ரொட்டி',
    kannada: 'ವೈಟ್ ಬ್ರೆಡ್',
    malayalam: 'വൈറ്റ് ബ്രെഡ്',
    marathi: 'व्हाईट ब्रेड',
    bengali: 'সাদা পাউরুটি',
    gujarati: 'વ્હાઇટ બ્રેડ',
    punjabi: 'ਵਾਈਟ ਬਰੈੱਡ',
    odia: 'ହ୍ୱାଇଟ୍ ବ୍ରେଡ୍',
    assamese: 'বগা পাউৰুটী',
  },
  sugar: {
    english: 'Sugar',
    telugu: 'చక్కెర / పంచదార',
    hindi: 'चीनी',
    tamil: 'சர்க்கரை',
    kannada: 'ಸಕ್ಕರೆ',
    malayalam: 'പഞ്ചസാര',
    marathi: 'साखर',
    bengali: 'চিনি',
    gujarati: 'ખાંડ',
    punjabi: 'ਖੰਡ',
    odia: 'ଚିନି',
    assamese: 'চেনি',
  },
  tea: {
    english: 'Tea',
    telugu: 'టీ',
    hindi: 'चाय',
    tamil: 'தேநீர்',
    kannada: 'ಚಹಾ',
    malayalam: 'ചായ',
    marathi: 'चहा',
    bengali: 'চা',
    gujarati: 'ચા',
    punjabi: 'ਚਾਹ',
    odia: 'ଚା',
    assamese: 'চাহ',
  },
  oil: {
    english: 'Cooking Oil',
    telugu: 'వంట నూనె',
    hindi: 'खाना पकाने का तेल',
    tamil: 'சமையல் எண்ணெய்',
    kannada: 'ಅಡುಗೆ ಎಣ್ಣೆ',
    malayalam: 'പാചക എണ്ണ',
    marathi: 'खाद्यतेल',
    bengali: 'রান্নার তেল',
    gujarati: 'તેલ',
    punjabi: 'ਤੇਲ',
    odia: 'ତେଲ',
    assamese: 'তেল',
  },
  atta: {
    english: 'Atta / Wheat Flour',
    telugu: 'గోధుమ పిండి',
    hindi: 'आटा',
    tamil: 'கோதுமை மாவு',
    kannada: 'ಗೋಧಿ ಹಿಟ್ಟು',
    malayalam: 'ഗോതമ്പ് മാവ്',
    marathi: 'गव्हाचे पीठ',
    bengali: 'আটা',
    gujarati: 'ઘઉંનો લોટ',
    punjabi: 'ਕਣਕ ਦਾ ਆਟਾ',
    odia: 'ଗହମ ଅଟା',
    assamese: 'আটা',
  },
  'aashirvaad atta': {
    english: 'Aashirvaad Atta',
    telugu: 'ఆశీర్వాద్ గోధుమ పిండి',
    hindi: 'आशीर्वाद आटा',
    tamil: 'ஆசீர்வாத் கோதுமை மாவு',
    kannada: 'ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು',
    malayalam: 'ആശീർവാദ് ഗോതമ്പ് മാവ്',
    marathi: 'आशीर्वाद आटा',
    bengali: 'আশীর্বাদ আটা',
    gujarati: 'આશીર્વાદ લોટ',
    punjabi: 'ਆਸ਼ੀਰਵਾਦ ਆਟਾ',
    odia: 'ଆଶୀର୍ବାଦ ଅଟା',
    assamese: 'আশীৰ্বাদ আটা',
  },
  biscuits: {
    english: 'Biscuits',
    telugu: 'బిస్కెట్లు',
    hindi: 'बिस्कुट',
    tamil: 'பிஸ்கட்',
    kannada: 'ಬಿಸ್ಕತ್ತು',
    malayalam: 'ബിസ്‌ക്കറ്റ്',
    marathi: 'बिस्किट',
    bengali: 'বিস্কুট',
    gujarati: 'બિસ્કિટ',
    punjabi: 'ਬਿਸਕੁਟ',
    odia: 'ବିସ୍କୁଟ',
    assamese: 'বিস্কুট',
  },
  'parle-g': {
    english: 'Parle-G Biscuits',
    telugu: 'పార్లే-జి బిస్కెట్లు',
    hindi: 'पारले-जी बिस्कुट',
    tamil: 'பார்லே-ஜி பிஸ்கட்',
    kannada: 'ಪಾರ್ಲೆ-ಜಿ ಬಿಸ್ಕತ್ತು',
    malayalam: 'പാർലെ-ജി ബിസ്‌ക്കറ്റ്',
    marathi: 'पारले-जी बिस्किट',
    bengali: 'পার্লে-জি বিস্কুট',
    gujarati: 'પાર્લે-જી બિસ્કિટ',
    punjabi: 'ਪਾਰਲੇ-ਜੀ ਬਿਸਕੁਟ',
    odia: 'ପାର୍ଲେ-ଜି ବିସ୍କୁଟ',
    assamese: 'পাৰ্লে-জি বিস্কুট',
  },
  soap: {
    english: 'Soap',
    telugu: 'సబ్బు',
    hindi: 'साबुन',
    tamil: 'சோப்பு',
    kannada: 'ಸೋಪು',
    malayalam: 'സോപ്പ്',
    marathi: 'साबण',
    bengali: 'সাবান',
    gujarati: 'સાબુ',
    punjabi: 'ਸਾਬਣ',
    odia: 'ସାବୁନ',
    assamese: 'চাবোন',
  },
  eggs: {
    english: 'Eggs',
    telugu: 'గుడ్లు',
    hindi: 'अंडे',
    tamil: 'முட்டை',
    kannada: 'ಮೊಟ್ಟೆ',
    malayalam: 'മുട്ട',
    marathi: 'अंडी',
    bengali: 'ডিম',
    gujarati: 'ઈંડા',
    punjabi: 'ਆਂਡੇ',
    odia: 'ଅଣ୍ଡା',
    assamese: 'কণী',
  },
  noodles: {
    english: 'Maggi Noodles',
    telugu: 'మ్యాగీ నూడుల్స్',
    hindi: 'मैगी नूडल्स',
    tamil: 'மேகி நூடுல்ஸ்',
    kannada: 'ಮ್ಯಾಗಿ ನೂಡಲ್ಸ್',
    malayalam: 'മാഗി നൂഡിൽസ്',
    marathi: 'मॅगी नुडल्स',
    bengali: 'ম্যাগি নুডলস',
    gujarati: 'મેગી નૂડલ્સ',
    punjabi: 'ਮੈਗੀ ਨੂਡਲਸ',
    odia: 'ମ୍ୟାଗି ନୁଡୁଲ୍ସ',
    assamese: 'মেগি নুডলছ',
  },
  butter: {
    english: 'Butter',
    telugu: 'వెన్న',
    hindi: 'मक्खन',
    tamil: 'வெண்ணெய்',
    kannada: 'ಬೆಣ್ಣೆ',
    malayalam: 'വെണ്ണ',
    marathi: 'लोणी',
    bengali: 'মাখন',
    gujarati: 'માખણ',
    punjabi: 'ਮੱਖਣ',
    odia: 'ଲହୁଣୀ',
    assamese: 'মাখন',
  },
};

/**
 * Standard unit translations across supported Indian languages.
 */
export const UNIT_TRANSLATIONS: Record<string, Partial<Record<VoiceLanguageKey, string>>> = {
  kg: {
    english: 'kg',
    telugu: 'కిలో',
    hindi: 'किलो',
    tamil: 'கிலோ',
    kannada: 'ಕಿಲೋ',
    malayalam: 'കിലോ',
    marathi: 'किलो',
    bengali: 'কেজি',
    gujarati: 'કિલો',
    punjabi: 'ਕਿਲੋ',
    odia: 'କିଲୋ',
    assamese: 'কেজি',
  },
  pkts: {
    english: 'packets',
    telugu: 'ప్యాకెట్లు',
    hindi: 'पैकेट',
    tamil: 'பாக்கெட்',
    kannada: 'ಪ್ಯಾಕೆಟ್',
    malayalam: 'പാക്കറ്റ്',
    marathi: 'पाकीट',
    bengali: 'প্যাকেট',
    gujarati: 'પેકેટ',
    punjabi: 'ਪੈਕੇਟ',
    odia: 'ପ୍ୟାକେଟ',
    assamese: 'পেকেট',
  },
  packets: {
    english: 'packets',
    telugu: 'ప్యాకెట్లు',
    hindi: 'पैकेट',
    tamil: 'பாக்கெட்',
    kannada: 'ಪ್ಯಾಕೆಟ್',
    malayalam: 'പാക്കറ്റ്',
    marathi: 'पाकीट',
    bengali: 'প্যাকেট',
    gujarati: 'પેકેટ',
    punjabi: 'ਪੈਕੇਟ',
    odia: 'ପ୍ୟାକେଟ',
    assamese: 'পেকেট',
  },
  pkt: {
    english: 'pkt',
    telugu: 'ప్యాకెట్',
    hindi: 'पैकेट',
    tamil: 'பாக்கெட்',
    kannada: 'ಪ್ಯಾಕೆಟ್',
    malayalam: 'പാക്കറ്റ്',
    marathi: 'पाकीट',
    bengali: 'প্যাকেট',
    gujarati: 'પેકેટ',
    punjabi: 'ਪੈਕੇਟ',
    odia: 'ପ୍ୟାକେଟ',
    assamese: 'পেকেট',
  },
  bottles: {
    english: 'bottles',
    telugu: 'సీసాలు',
    hindi: 'बोतलें',
    tamil: 'பாட்டில்கள்',
    kannada: 'ಬಾಟಲಿಗಳು',
    malayalam: 'കുപ്പികൾ',
    marathi: 'बाटल्या',
    bengali: 'বোতল',
    gujarati: 'બોટલ',
    punjabi: 'ਬੋਤਲਾਂ',
    odia: 'ବୋତଲ',
    assamese: 'বটল',
  },
  liters: {
    english: 'liters',
    telugu: 'లీటర్లు',
    hindi: 'लीटर',
    tamil: 'லிட்டர்',
    kannada: 'ಲೀಟರ್',
    malayalam: 'ലിറ്റർ',
    marathi: 'लिटर',
    bengali: 'লিটার',
    gujarati: 'લીટર',
    punjabi: 'ਲੀਟਰ',
    odia: 'ଲିଟର',
    assamese: 'লিটাৰ',
  },
  pouches: {
    english: 'pouches',
    telugu: 'పౌచ్‌లు',
    hindi: 'पाउच',
    tamil: 'பவுச்',
    kannada: 'ಪೌಚ್',
    malayalam: 'പൗച്ച്',
    marathi: 'पाउच',
    bengali: 'পাউচ',
    gujarati: 'પાઉચ',
    punjabi: 'ਪਾਉਚ',
    odia: 'ପାଉଚ୍',
    assamese: 'পাউচ',
  },
  pcs: {
    english: 'pcs',
    telugu: 'ముక్కలు',
    hindi: 'नग',
    tamil: 'நகம்',
    kannada: 'ತುಂಡು',
    malayalam: 'എണ്ണം',
    marathi: 'नग',
    bengali: 'পিস',
    gujarati: 'નંગ',
    punjabi: 'ਨਗ',
    odia: 'ଖଣ୍ଡ',
    assamese: 'টুকুৰা',
  },
  bags: {
    english: 'bags',
    telugu: 'సంచులు',
    hindi: 'थैले / बोरी',
    tamil: 'பைகள்',
    kannada: 'ಚೀಲಗಳು',
    malayalam: 'ബാഗുകൾ',
    marathi: 'पिशव्या',
    bengali: 'ব্যাগ',
    gujarati: 'થેલી',
    punjabi: 'ਥੈਲੇ',
    odia: 'ବ୍ୟାଗ',
    assamese: 'বেগ',
  },
  trays: {
    english: 'trays',
    telugu: 'ట్రేలు',
    hindi: 'ट्रे',
    tamil: 'ட்ரே',
    kannada: 'ಟ್ರೇ',
    malayalam: 'ട്രേ',
    marathi: 'ट्रे',
    bengali: 'ট্রে',
    gujarati: 'ટ્રે',
    punjabi: 'ਟਰੇ',
    odia: 'ଟ୍ରେ',
    assamese: 'ট্ৰে',
  },
};

/**
 * Localized Bill UI labels across all 12 supported Indian languages.
 */
export const BILL_UI_LABELS: Record<string, Record<VoiceLanguageKey, string>> = {
  billTitle: {
    english: 'Voice-to-Bill',
    telugu: 'వాయిస్ టు బిల్లు (Voice-to-Bill)',
    hindi: 'बोलकर बिल बनाएं (Voice-to-Bill)',
    tamil: 'குரல் வழி பில் (Voice-to-Bill)',
    kannada: 'ಧ್ವನಿ ಬಿಲ್ (Voice-to-Bill)',
    malayalam: 'ശബ്ദ ബിൽ (Voice-to-Bill)',
    marathi: 'आवाज बिल (Voice-to-Bill)',
    bengali: 'ভয়েস বিল (Voice-to-Bill)',
    gujarati: 'અવાજ બિલ (Voice-to-Bill)',
    punjabi: 'ਆਵਾਜ਼ ਬਿੱਲ (Voice-to-Bill)',
    odia: 'ଭଏସ୍ ବିଲ୍ (Voice-to-Bill)',
    assamese: 'ভয়েচ বিল (Voice-to-Bill)',
  },
  customerBill: {
    english: 'Customer Bill',
    telugu: 'వినియోగదారు బిల్లు',
    hindi: 'ग्राहक बिल',
    tamil: 'வாடிக்கையாளர் பில்',
    kannada: 'ಗ್ರಾಹಕರ ಬಿಲ್',
    malayalam: 'ഉപഭോക്തൃ ബിൽ',
    marathi: 'ग्राहक बिल',
    bengali: 'গ্রাহকের বিল',
    gujarati: 'ગ્રાહક બિલ',
    punjabi: 'ਗਾਹਕ ਬਿੱਲ',
    odia: 'ଗ୍ରାହକ ବିଲ୍',
    assamese: 'গ্ৰাহকৰ বিল',
  },
  recognizedItems: {
    english: 'Recognized Bill Items',
    telugu: 'గుర్తించబడిన వస్తువులు',
    hindi: 'पहचाने गए बिल आइटम',
    tamil: 'கண்டறியப்பட்ட பொருட்கள்',
    kannada: 'ಗುರುತಿಸಲಾದ ವಸ್ತುಗಳು',
    malayalam: 'തിരിച്ചറിഞ്ഞ ഇനങ്ങൾ',
    marathi: 'ओळखल्या गेलेल्या वस्तू',
    bengali: 'শনাক্তকৃত আইটেম',
    gujarati: 'ઓળખાયેલી વસ્તુઓ',
    punjabi: 'ਪਛਾਣੇ ਗਏ ਆਈਟਮ',
    odia: 'ଚିହ୍ନଟ ହୋଇଥିବା ଆଇଟମ୍',
    assamese: 'চিনাক্ত কৰা সামগ্ৰী',
  },
  subtotal: {
    english: 'Subtotal',
    telugu: 'ఉపమొత్తం',
    hindi: 'उप-योग',
    tamil: 'துணைக் கூட்டுத்தொகை',
    kannada: 'ಉಪಮೊತ್ತ',
    malayalam: 'ഉപആകെ',
    marathi: 'उपबेरीज',
    bengali: 'উপমোট',
    gujarati: 'પેટાસરવાળો',
    punjabi: 'ਉਪ-ਜੋੜ',
    odia: 'ଉପମୋଟ',
    assamese: 'উপ-মুঠ',
  },
  total: {
    english: 'Total',
    telugu: 'మొత్తం',
    hindi: 'कुल',
    tamil: 'மொத்தம்',
    kannada: 'ಒಟ್ಟು',
    malayalam: 'ആകെ',
    marathi: 'एकूण',
    bengali: 'মোট',
    gujarati: 'કુલ',
    punjabi: 'ਕੁੱਲ',
    odia: 'ମୋଟ',
    assamese: 'মুঠ',
  },
  grandTotal: {
    english: 'Grand Total',
    telugu: 'మొత్తం బిల్లు',
    hindi: 'कुल राशि',
    tamil: 'மொத்த தொகை',
    kannada: 'ಒಟ್ಟು ಮೊತ್ತ',
    malayalam: 'ആകെ തുക',
    marathi: 'एकूण रक्कम',
    bengali: 'সর্বমোট',
    gujarati: 'કુલ રકમ',
    punjabi: 'ਕੁੱਲ ਰਕਮ',
    odia: 'ସର୍ବମୋଟ',
    assamese: 'সৰ্বমুঠ',
  },
  tax: {
    english: 'Tax (GST)',
    telugu: 'పన్ను (GST)',
    hindi: 'कर (GST)',
    tamil: 'வரி (GST)',
    kannada: 'ತೆರಿಗೆ (GST)',
    malayalam: 'നികുതി (GST)',
    marathi: 'कर (GST)',
    bengali: 'কর (GST)',
    gujarati: 'કર (GST)',
    punjabi: 'ਕਰ (GST)',
    odia: 'କର (GST)',
    assamese: 'কৰ (GST)',
  },
  discount: {
    english: 'Discount',
    telugu: 'రాయితీ',
    hindi: 'छूट',
    tamil: 'தள்ளுபடி',
    kannada: 'ರಿಯಾಯಿತಿ',
    malayalam: 'കിഴിവ്',
    marathi: 'सवलत',
    bengali: 'ছাড়',
    gujarati: 'ડિસ્કાઉન્ટ',
    punjabi: 'ਛੋਟ',
    odia: 'ରିହାତି',
    assamese: 'ৰেহাই',
  },
  quantity: {
    english: 'Qty',
    telugu: 'పరిమాణం',
    hindi: 'मात्रा',
    tamil: 'அளவு',
    kannada: 'ಪ್ರಮಾಣ',
    malayalam: 'അളവ്',
    marathi: 'प्रमाण',
    bengali: 'পরিমাণ',
    gujarati: 'જથ્થો',
    punjabi: 'ਮਾਤਰਾ',
    odia: 'ପରିମାଣ',
    assamese: 'পৰিমাণ',
  },
  price: {
    english: 'Price',
    telugu: 'ధర',
    hindi: 'मूल्य',
    tamil: 'விலை',
    kannada: 'ಬೆಲೆ',
    malayalam: 'വില',
    marathi: 'किंमत',
    bengali: 'দাম',
    gujarati: 'કિંમત',
    punjabi: 'ਕੀਮਤ',
    odia: 'ମୂଲ୍ୟ',
    assamese: 'দাম',
  },
  remove: {
    english: 'Remove',
    telugu: 'తొలగించు',
    hindi: 'हटाएं',
    tamil: 'நீக்கு',
    kannada: 'ತೆಗೆದುಹಾಕಿ',
    malayalam: 'ഒഴിവാക്കുക',
    marathi: 'काढून टाका',
    bengali: 'মুছুন',
    gujarati: 'દૂર કરો',
    punjabi: 'ਹਟਾਓ',
    odia: 'ହଟାନ୍ତୁ',
    assamese: 'আঁতৰাওক',
  },
  addToBill: {
    english: 'Add to Bill',
    telugu: 'బిల్లుకు జోడించు',
    hindi: 'बिल में जोड़ें',
    tamil: 'பில்லில் சேர்',
    kannada: 'ಬಿಲ್‌ಗೆ ಸೇರಿಸಿ',
    malayalam: 'ബില്ലിൽ ചേർക്കുക',
    marathi: 'बिलामध्ये जोडा',
    bengali: 'বিলে যুক্ত করুন',
    gujarati: 'બિલમાં ઉમેરો',
    punjabi: 'ਬਿੱਲ ਵਿੱਚ ਸ਼ਾਮਲ ਕਰੋ',
    odia: 'ବିଲ୍‌ରେ ଯୋଡନ୍ତୁ',
    assamese: 'বিলত যোগ কৰক',
  },
  confirmAndPay: {
    english: 'Confirm & Pay',
    telugu: 'నిర్ధారించి చెల్లించండి',
    hindi: 'पुष्टि करें और भुगतान करें',
    tamil: 'உறுதிசெய்து செலுத்தவும்',
    kannada: 'ದೃಢೀಕರಿಸಿ ಮತ್ತು ಪಾವತಿಸಿ',
    malayalam: 'സ്ഥിരീകരിച്ച് പണം നൽകുക',
    marathi: 'पुष्टी करा आणि पैसे द्या',
    bengali: 'নিশ্চিত করুন এবং প্রদান করুন',
    gujarati: 'પુષ્ટિ કરો અને ચૂકવો',
    punjabi: 'ਪੁਸ਼ਟੀ ਕਰੋ ਅਤੇ ਭੁਗਤਾਨ ਕਰੋ',
    odia: 'ନିଶ୍ଚିତ କରନ୍ତୁ ଏବଂ ଦେୟ ଦିଅନ୍ତୁ',
    assamese: 'নিশ্চিত কৰক আৰু পৰিশোধ কৰক',
  },
  cancel: {
    english: 'Cancel',
    telugu: 'రద్దు చేయి',
    hindi: 'रद्द करें',
    tamil: 'ரத்து செய்',
    kannada: 'ರದ್ದುಮಾಡು',
    malayalam: 'റദ്ദാക്കുക',
    marathi: 'रद्द करा',
    bengali: 'বাতিল',
    gujarati: 'રદ કરો',
    punjabi: 'ਰੱਦ ਕਰੋ',
    odia: 'ବାତିଲ୍ କରନ୍ତୁ',
    assamese: 'বাতিল কৰক',
  },
  noItemsYet: {
    english: 'No items recognized yet',
    telugu: 'ఇంకా వస్తువులేవీ గుర్తించబడలేదు',
    hindi: 'अभी तक कोई आइटम नहीं पहचाना गया',
    tamil: 'இன்னும் பொருட்கள் எதுவும் கண்டறியப்படவில்லை',
    kannada: 'ಇನ್ನೂ ಯಾವುದೇ ವಸ್ತುಗಳನ್ನು ಗುರುತಿಸಲಾಗಿಲ್ಲ',
    malayalam: 'ഇതുവരെ ഇനങ്ങളൊന്നും തിരിച്ചറിഞ്ഞിട്ടില്ല',
    marathi: 'अद्याप कोणत्याही वस्तू ओळखल्या गेल्या नाहीत',
    bengali: 'এখনও কোনো আইটেম শনাক্ত করা হয়নি',
    gujarati: 'હજી સુધી કોઈ વસ્તુઓ ઓળખાઈ નથી',
    punjabi: 'ਅਜੇ ਤੱਕ ਕੋਈ ਆਈਟਮ ਪਛਾਣਿਆ ਨਹੀਂ ਗਿਆ',
    odia: 'ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ଆଇଟମ୍ ଚିହ୍ନଟ ହୋଇନାହିଁ',
    assamese: 'এতিয়ালৈকে কোনো সামগ্ৰী চিনাক্ত হোৱা নাই',
  },
  speakHint: {
    english: 'Tap the microphone or choose a simulated voice preset below',
    telugu: 'మైక్రోఫోన్‌ను నొక్కండి లేదా క్రింద ఒక నమూనాను ఎంచుకోండి',
    hindi: 'माइक्रोफ़ोन टैप करें या नीचे दिए गए प्रीसेट में से चुनें',
    tamil: 'மைக்ரோஃபோனைத் தட்டவும் அல்லது கீழே உள்ள மாதிரியைத் தேர்ந்தெடுக்கவும்',
    kannada: 'ಮೈಕ್ರೊಫೋನ್ ಟ್ಯಾಪ್ ಮಾಡಿ ಅಥವಾ ಮಾದರಿಯನ್ನು ಆರಿಸಿ',
    malayalam: 'മൈക്രോഫോൺ ടാപ്പ് ചെയ്യുക അല്ലെങ്കിൽ താഴെയുള്ള പ്രീസെറ്റ് തിരഞ്ഞെടുക്കുക',
    marathi: 'मायक्रोफोन टॅप करा किंवा खालील नमुना निवडा',
    bengali: 'মাইক্রোফোনে ট্যাপ করুন বা নীচের প্রিসেট নির্বাচন করুন',
    gujarati: 'માઇક્રોફોન ટેપ કરો અથવા નીચે આપેલ પ્રીસેટ પસંદ કરો',
    punjabi: 'ਮਾਈਕ੍ਰੋਫੋਨ ਟੈਪ ਕਰੋ ਜਾਂ ਹੇਠਾਂ ਦਿੱਤੇ ਪ੍ਰੀਸੈਟ ਚੁਣੋ',
    odia: 'ମାଇକ୍ରୋଫୋନ୍ ଟ୍ୟାପ୍ କରନ୍ତୁ କିମ୍ବା ତଳେ ଥିବା ପ୍ରିସେଟ୍ ଚୟନ କରନ୍ତୁ',
    assamese: 'মাইক্ৰ\'ফ\'নত টেপ কৰক বা তলৰ প্ৰিচেট বাছক',
  },
  inStock: {
    english: 'in stock',
    telugu: 'స్టాక్‌లో ఉంది',
    hindi: 'स्टॉक में उपलब्ध',
    tamil: 'கையிருப்பில் உள்ளது',
    kannada: 'ದಾಸ್ತಾನು ಇದೆ',
    malayalam: 'സ്റ്റോക്കിൽ ഉണ്ട്',
    marathi: 'स्टॉकमध्ये उपलब्ध',
    bengali: 'স্টকে আছে',
    gujarati: 'સ્ટોકમાં છે',
    punjabi: 'ਸਟਾਕ ਵਿੱਚ ਉਪਲਬਧ',
    odia: 'ଷ୍ଟକରେ ଅଛି',
    assamese: 'ষ্টকত আছে',
  },
  outOfStock: {
    english: 'Out of stock',
    telugu: 'స్టాక్ అయిపోయింది',
    hindi: 'स्टॉक समाप्त',
    tamil: 'கையிருப்பில் இல்லை',
    kannada: 'ದಾಸ್ತಾನು ಮುಗಿದಿದೆ',
    malayalam: 'സ്റ്റോക്ക് തീർന്നു',
    marathi: 'स्टॉक संपला',
    bengali: 'স্টক শেষ',
    gujarati: 'સ્ટોક ખાલી',
    punjabi: 'ਸਟਾਕ ਖਤਮ',
    odia: 'ଷ୍ଟକ୍ ସରିଯାଇଛି',
    assamese: 'ষ্টক শেষ',
  },
  itemsReady: {
    english: 'items ready to transfer to billing',
    telugu: 'వస్తువులు బిల్లింగ్‌కు సిద్ధంగా ఉన్నాయి',
    hindi: 'आइटम बिलिंग के लिए तैयार हैं',
    tamil: 'பொருட்கள் பில்லிங்கிற்கு தயாராக உள்ளன',
    kannada: 'ವಸ್ತುಗಳು ಬಿಲ್ಲಿಂಗ್‌ಗೆ ಸಿದ್ಧವಾಗಿವೆ',
    malayalam: 'ഇനങ്ങൾ ബില്ലിംഗിനായി തയ്യാറാണ്',
    marathi: 'वस्तू बिलिंगसाठी तयार आहेत',
    bengali: 'আইটেম বিলিংয়ের জন্য প্রস্তুত',
    gujarati: 'વસ્તુઓ બિલિંગ માટે તૈયાર છે',
    punjabi: 'ਆਈਟਮ ਬਿਲਿੰਗ ਲਈ ਤਿਆਰ ਹਨ',
    odia: 'ଆଇଟମ୍ ବିଲିଂ ପାଇଁ ପ୍ରସ୍ତୁତ',
    assamese: 'সামগ্ৰী বিলিংৰ বাবে সাজু',
  },
};

/**
 * Returns localized item name if available in the dictionary,
 * otherwise cleans and returns the catalog name.
 */
export function getLocalizedItemName(rawName: string, displayLang: VoiceLanguageKey): string {
  if (displayLang === 'english' || !rawName) return rawName;

  const clean = rawName.toLowerCase().trim();

  // 1. Direct dictionary match
  for (const [key, translations] of Object.entries(ITEM_TRANSLATIONS)) {
    if (clean === key || clean.includes(key)) {
      const localized = translations[displayLang];
      if (localized) return localized;
    }
  }

  // 2. Word-level partial match for staples
  for (const [key, translations] of Object.entries(ITEM_TRANSLATIONS)) {
    const keyWords = key.split(' ');
    if (keyWords.some((w) => w.length > 2 && clean.includes(w))) {
      const localized = translations[displayLang];
      if (localized) return localized;
    }
  }

  return rawName;
}

/**
 * Returns localized unit string if available.
 */
export function getLocalizedUnit(unit: string, displayLang: VoiceLanguageKey): string {
  if (displayLang === 'english' || !unit) return unit;
  const clean = unit.toLowerCase().trim();

  const found = UNIT_TRANSLATIONS[clean];
  if (found && found[displayLang]) {
    return found[displayLang]!;
  }

  return unit;
}

/**
 * Returns localized UI label for bill items.
 */
export function getLocalizedBillLabel(labelKey: string, displayLang: VoiceLanguageKey): string {
  const group = BILL_UI_LABELS[labelKey];
  if (group && group[displayLang]) {
    return group[displayLang];
  }
  if (group && group.english) {
    return group.english;
  }
  return labelKey;
}
