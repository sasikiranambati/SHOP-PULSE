import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X, Check } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useDialog } from '../hooks/useDialog';
import type { LanguageCode } from '../i18n/languages';

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({ isOpen, onClose }) => {
  const { language, setLanguage, languages, t } = useLanguage();
  const titleId = useId();
  const panelRef = useDialog<HTMLDivElement>({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
    onClose();
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#141E18]/60 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div 
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-t-2xl sm:rounded-xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl border border-[#E3E5DE] animate-slide-up sm:animate-fade-in overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#202923] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#234B3A] flex items-center justify-center text-white shrink-0 shadow-sm">
              <Globe className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id={titleId} className="font-bold text-base sm:text-lg tracking-tight">
                {t('languageModal.title')}
              </h2>
              <p className="text-xs text-[#E3E5DE]/80 font-medium">
                {t('languageModal.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close language selector"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Languages Scrollable List */}
        <div className="p-3 overflow-y-auto divide-y divide-[#E3E5DE]/50 flex-1 space-y-1" role="listbox" aria-label="Available languages">
          {languages.map((item) => {
            const isActive = language === item.code;
            return (
              <button
                key={item.code}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(item.code)}
                className={`w-full p-3.5 rounded-xl flex items-center justify-between transition-all cursor-pointer text-left active:scale-[0.99] min-h-[52px] ${
                  isActive
                    ? 'bg-[#E5EEE6] text-[#202923] font-bold border border-[#234B3A]/30 shadow-2xs'
                    : 'bg-white hover:bg-[#F7F5EF] text-[#202923] font-medium border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-base sm:text-lg font-bold min-w-[70px] ${isActive ? 'text-[#234B3A]' : 'text-[#202923]'}`}>
                    {item.nativeName}
                  </span>
                  <span className="text-xs text-[#69736C] font-semibold border-l border-[#E3E5DE] pl-3">
                    {item.name}
                  </span>
                </div>

                {isActive && (
                  <div className="w-6 h-6 rounded-full bg-[#234B3A] text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <Check className="w-4 h-4" aria-hidden="true" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#F7F5EF] border-t border-[#E3E5DE] shrink-0 text-center">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-white border border-[#E3E5DE] hover:bg-[#F7F5EF] text-[#202923] font-bold text-sm transition-colors cursor-pointer min-h-[44px]"
          >
            {t('languageModal.close')}
          </button>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
