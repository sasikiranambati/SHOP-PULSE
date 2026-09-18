/**
 * @file firebaseErrorMapper.ts
 * @description Centralized Firebase error code to user-friendly message mapper.
 * Supports English ('en') and future Telugu ('te') translations.
 * Belongs in `src/utils/firebaseErrorMapper.ts`.
 */

export type SupportedLanguage = 'en' | 'te';

interface ErrorTranslation {
  en: string;
  te: string;
}

/**
 * Registry of Firebase error codes and user-friendly localized messages.
 */
const ERROR_MAP: Record<string, ErrorTranslation> = {
  'auth/user-not-found': {
    en: 'No account found with this email address.',
    te: 'ఈ ఇమెయిల్ చిరునామాతో ఏ ఖాతా కనుగొనబడలేదు.'
  },
  'auth/wrong-password': {
    en: 'Incorrect password. Please try again.',
    te: 'తప్పు పాస్‌వర్డ్. దయచేసి మళ్లీ ప్రయత్నించండి.'
  },
  'auth/invalid-credential': {
    en: 'Invalid login credentials. Please check email and password.',
    te: 'చెల్లని లాగిన్ వివరాలు. దయచేసి ఇమెయిల్ మరియు పాస్‌వర్డ్‌ను తనిఖీ చేయండి.'
  },
  'auth/email-already-in-use': {
    en: 'An account with this email already exists.',
    te: 'ఈ ఇమెయిల్‌తో ఇప్పటికే ఒక ఖాతా ఉంది.'
  },
  'auth/weak-password': {
    en: 'Password should be at least 6 characters long.',
    te: 'పాస్‌వర్డ్ కనీసం 6 అక్షరాలు ఉండాలి.'
  },
  'auth/invalid-email': {
    en: 'Please enter a valid email address.',
    te: 'దయచేసి ఒక చెల్లుబాటు అయ్యే ఇమెయిల్ చిరునామాను నమోదు చేయండి.'
  },
  'auth/too-many-requests': {
    en: 'Too many unsuccessful attempts. Please try again later.',
    te: 'చాలా ఎక్కువ ప్రయత్నాలు జరిగాయి. దయచేసి కాసేపటి తర్వాత ప్రయత్నించండి.'
  },
  'permission-denied': {
    en: 'You do not have permission to perform this action.',
    te: 'ఈ చర్యను చేయడానికి మీకు అనుమతి లేదు.'
  },
  'network-request-failed': {
    en: 'Network error. Please check your internet connection.',
    te: 'నెట్‌వర్క్ లోపం. దయచేసి మీ ఇంటర్నెట్ కనెక్షన్‌ని తనిఖీ చేయండి.'
  },
  'unavailable': {
    en: 'Service is temporarily offline. Working in cached mode.',
    te: 'సేవ తాత్కాలికంగా ఆఫ్‌లైన్‌లో ఉంది. క్యాష్ మోడ్‌లో పనిచేస్తోంది.'
  },
  'not-found': {
    en: 'Requested document was not found.',
    te: 'కోరిన పత్రం కనుగొనబడలేదు.'
  }
};

/**
 * Map Firebase error code or Error instance to user-friendly message.
 * 
 * @param error - Firebase error object or error string.
 * @param lang - Target language ('en' | 'te', default: 'en').
 * @returns User-friendly localized error string.
 */
export function getFirebaseErrorMessage(
  error: any, 
  lang: SupportedLanguage = 'en'
): string {
  if (!error) return 'An unexpected error occurred.';

  const code = typeof error === 'string' 
    ? error 
    : error?.code || error?.message || 'unknown';

  if (ERROR_MAP[code]) {
    return ERROR_MAP[code][lang] || ERROR_MAP[code].en;
  }

  // Fallback for unmapped errors
  if (typeof error?.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return lang === 'te' 
    ? 'ఒక వింత లోపం సంభవించింది. దయచేసి మళ్లీ ప్రయత్నించండి.' 
    : 'An unexpected error occurred. Please try again.';
}
