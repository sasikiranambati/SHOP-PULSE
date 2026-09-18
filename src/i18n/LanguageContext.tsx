import React, { createContext, useContext, useState, useEffect } from 'react';
import type { LanguageCode, LanguageMeta } from './languages';
import { LANGUAGES } from './languages';
import { translationsMap } from './locales';
import { en } from './locales/en';

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  currentLanguageMeta: LanguageMeta;
  isRtl: boolean;
  languages: LanguageMeta[];
}

const STORAGE_KEY = 'shoppulse_language';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGUAGES.some((l) => l.code === saved)) {
        return saved as LanguageCode;
      }
    } catch {
      // Ignore localStorage errors
    }
    return 'en';
  });

  const currentLanguageMeta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];
  const isRtl = currentLanguageMeta.dir === 'rtl';

  useEffect(() => {
    document.documentElement.dir = currentLanguageMeta.dir;
    document.documentElement.lang = language;
  }, [language, currentLanguageMeta.dir]);

  const setLanguage = (code: LanguageCode) => {
    setLanguageState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Ignore localStorage errors
    }
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split('.');
    
    // Try current language
    let result: any = translationsMap[language];
    for (const k of keys) {
      if (result && typeof result === 'object' && k in result) {
        result = result[k];
      } else {
        result = undefined;
        break;
      }
    }

    // Fallback to English if undefined or missing
    if (result === undefined || typeof result !== 'string') {
      result = en;
      for (const k of keys) {
        if (result && typeof result === 'object' && k in result) {
          result = result[k];
        } else {
          result = key; // Ultimate fallback to key string
          break;
        }
      }
    }

    if (typeof result !== 'string') {
      return key;
    }

    // Replace parameter templates like {count}
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        result = (result as string).replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }

    return result;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        currentLanguageMeta,
        isRtl,
        languages: LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
