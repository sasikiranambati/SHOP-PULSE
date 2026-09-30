import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X, Check } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import type { LanguageCode } from '../i18n/languages';

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({ isOpen, onClose }) => {
  const { language, setLanguage, languages, t } = useLanguage();

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
    onClose();
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 animate-slide-up sm:animate-fade-in overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shrink-0 shadow-sm">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg tracking-tight">
                {t('languageModal.title')}
              </h3>
              <p className="text-xs text-slate-300 font-medium">
                {t('languageModal.subtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Languages Scrollable List */}
        <div className="p-3 overflow-y-auto divide-y divide-slate-100 flex-1 space-y-1">
          {languages.map((item) => {
            const isActive = language === item.code;
            return (
              <button
                key={item.code}
                onClick={() => handleSelect(item.code)}
                className={`w-full p-3.5 rounded-2xl flex items-center justify-between transition-all cursor-pointer text-left active:scale-[0.99] min-h-[52px] ${
                  isActive
                    ? 'bg-emerald-50/90 text-emerald-900 font-black border border-emerald-300 shadow-2xs'
                    : 'bg-white hover:bg-slate-50 text-slate-800 font-bold border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-base sm:text-lg font-black min-w-[70px] ${isActive ? 'text-emerald-700' : 'text-slate-900'}`}>
                    {item.nativeName}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold border-l border-slate-200 pl-3">
                    {item.name}
                  </span>
                </div>

                {isActive && (
                  <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 shrink-0 text-center">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-sm transition-colors cursor-pointer"
          >
            {t('languageModal.close')}
          </button>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
