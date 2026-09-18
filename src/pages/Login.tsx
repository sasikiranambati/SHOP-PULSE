import React, { useState } from 'react';
import { ArrowLeft, Store, ShieldCheck } from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';

interface LoginProps {
  setActivePage: (page: PageRoute) => void;
  onLoginSuccess: (name: string) => void;
}

export const Login: React.FC<LoginProps> = ({ setActivePage, onLoginSuccess }) => {
  const { t, language, setLanguage } = useLanguage();
  const [phoneNumber, setPhoneNumber] = useState('98490 12345');
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      onLoginSuccess('Kiran General Store');
      setActivePage('dashboard');
    }, 350);
  };

  const handleGoogleLogin = () => {
    setIsLoading(true);
    setTimeout(() => {
      onLoginSuccess('Kiran General Store');
      setActivePage('dashboard');
    }, 350);
  };

  return (
    <div className="min-h-screen bg-[#F8FAF8] flex flex-col justify-between items-center p-4 sm:p-6 relative text-slate-900">
      
      {/* Top Header Row: Back button & Segmented Language Switcher */}
      <div className="w-full max-w-md flex items-center justify-between pt-2 pb-4">
        <button 
          onClick={() => setActivePage('landing')}
          className="flex items-center gap-1.5 text-xs font-black text-slate-600 hover:text-slate-900 transition-colors cursor-pointer bg-white px-3 py-1.5 rounded-full border border-slate-200/80 shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4 text-emerald-700" />
          <span>{t('common.back')}</span>
        </button>

        {/* Compact Segmented Control */}
        <div className="flex items-center bg-slate-200/80 p-1 rounded-2xl gap-1 text-xs font-bold border border-slate-200">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-3 py-1 rounded-xl transition-all cursor-pointer font-black ${
              language === 'en' 
                ? 'bg-emerald-600 text-white shadow-xs' 
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage('te')}
            className={`px-3 py-1 rounded-xl transition-all cursor-pointer font-black ${
              language === 'te' 
                ? 'bg-emerald-600 text-white shadow-xs' 
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            తెలుగు
          </button>
          <button
            type="button"
            onClick={() => setIsLangModalOpen(true)}
            className="px-2 py-1 text-emerald-800 hover:text-emerald-950 font-black cursor-pointer text-[11px]"
          >
            🌐
          </button>
        </div>
      </div>

      {/* Main Login Card (Centered & Mobile-First) */}
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm my-auto">
        
        {/* Rounded Store Icon Container */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center border border-emerald-200/80 mb-3.5 shadow-2xs">
            <Store className="w-7 h-7" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {t('auth.kiranaLoginTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-bold mt-1.5 max-w-xs leading-relaxed">
            {t('auth.kiranaLoginSub')}
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">
              {t('auth.mobileNumberLabel')}
            </label>
            
            <div className="flex items-center rounded-2xl border border-slate-300 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-500/20 bg-white transition-all overflow-hidden shadow-2xs">
              <div className="px-3.5 py-3.5 bg-slate-50 border-r border-slate-200 flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-black text-slate-500">IN</span>
                <span className="text-sm font-black text-slate-900">+91</span>
              </div>
              <input
                type="tel"
                required
                placeholder={t('auth.enterPhonePlaceholder')}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full px-3.5 py-3.5 text-base sm:text-lg font-black text-slate-900 bg-transparent focus:outline-none tracking-wide"
              />
            </div>
          </div>

          {/* Primary CTA: Get OTP */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-black text-base shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-75"
          >
            {isLoading ? (
              <span className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            ) : (
              <span>{t('auth.getOtp')}</span>
            )}
          </button>
        </form>

        {/* OR Divider */}
        <div className="relative my-6 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <span className="relative bg-white px-3 text-[11px] font-black text-slate-400 uppercase tracking-widest">
            {t('auth.or')}
          </span>
        </div>

        {/* Google Authentication Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full py-3.5 px-4 rounded-2xl border border-slate-300 bg-white hover:bg-slate-50 active:scale-[0.99] transition-all flex items-center justify-center gap-3 font-extrabold text-sm text-slate-700 shadow-2xs cursor-pointer"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          <span>{t('auth.continueGoogle')}</span>
        </button>

        {/* Switch to Signup */}
        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-500 font-bold">
            {t('auth.noAccount')}{' '}
            <button
              onClick={() => setActivePage('signup')}
              className="text-emerald-700 font-black hover:underline cursor-pointer"
            >
              {t('auth.createAccount')}
            </button>
          </p>
        </div>

      </div>

      {/* Security Footer */}
      <div className="w-full text-center pt-4 pb-2">
        <p className="text-[11px] font-bold text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 inline-block" />
          <span>{t('auth.encryptedFooter')}</span>
        </p>
      </div>

      {/* Language Selector Modal */}
      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </div>
  );
};
