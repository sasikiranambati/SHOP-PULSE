import React, { useState } from 'react';
import { 
  Activity, 
  ArrowRight, 
  Store,
  Globe,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { Button } from '../components/Button';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';

interface LandingProps {
  setActivePage: (page: PageRoute) => void;
}

export const Landing: React.FC<LandingProps> = ({ setActivePage }) => {
  const { t, currentLanguageMeta } = useLanguage();
  const { firebaseUser } = useAuth();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7F5EF] text-[#202923] font-sans">
      
      {/* ========================================================= */}
      {/* 1. MOBILE NATIVE ONBOARDING VIEW (Shown on mobile devices) */}
      {/* ========================================================= */}
      <div className="md:hidden min-h-[100dvh] flex flex-col justify-between p-5 sm:p-6 select-none pt-[calc(1.25rem+env(safe-area-inset-top,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        
        {/* Mobile Top Header */}
        <div className="flex items-center justify-between pt-1">
          <span className="inline-flex items-center text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#234B3A] bg-[#E5EEE6] px-3 py-1 rounded-full border border-[#52745D]/30">
            {t('landing.kiranaTechBadge')}
          </span>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#234B3A]">
              <ShieldCheck className="w-4 h-4 text-[#234B3A] shrink-0" />
              <span>{t('landing.madeForBharat')}</span>
            </span>

            <button
              onClick={() => setIsLangModalOpen(true)}
              aria-label="Change Language"
              className="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-[#E5EEE6] text-[#69736C] transition-colors cursor-pointer"
              title="Change Language"
            >
              <Globe className="w-4 h-4 text-[#234B3A]" />
            </button>
          </div>
        </div>

        {/* Mobile Center Hero Card */}
        <div className="my-auto py-6 flex flex-col items-center text-center">
          
          {/* Logo Squircle with SP and Sparkle Badge */}
          <div className="relative mb-5">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white shadow-xs border border-[#E3E5DE] flex items-center justify-center p-3">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[#234B3A] flex items-center justify-center text-white font-extrabold text-2xl tracking-wider shadow-xs select-none">
                SP
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center text-slate-900 shadow-xs">
              <Sparkles className="w-3 h-3 fill-slate-900 text-slate-900" />
            </div>
          </div>

          {/* Typography */}
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#202923] tracking-tight">
            ShopPulse
          </h1>
          
          <p className="text-sm sm:text-base text-[#234B3A] font-bold mt-1">
            {t('landing.mobileRegionalSub')}
          </p>

          <p className="text-xs sm:text-sm text-[#69736C] font-normal mt-3 max-w-xs">
            {t('landing.smartInventorySub')}
          </p>

          {/* 3-Dot Carousel Indicator */}
          <div className="flex items-center justify-center gap-1.5 mt-7">
            <span className="w-2 h-2 rounded-full bg-[#D5E4D7]"></span>
            <span className="w-5 h-2 rounded-full bg-[#234B3A]"></span>
            <span className="w-2 h-2 rounded-full bg-[#D5E4D7]"></span>
          </div>
        </div>

        {/* Mobile Bottom Action Buttons */}
        <div className="w-full max-w-sm mx-auto pb-2">
          <button
            onClick={() => setActivePage(firebaseUser ? 'dashboard' : 'login')}
            className="w-full py-3.5 min-h-[48px] bg-[#234B3A] hover:bg-[#18382B] active:scale-[0.98] text-white font-bold text-base rounded-lg shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{t('landing.getStarted')}</span>
            <ArrowRight className="w-5 h-5" />
          </button>

          <button
            onClick={() => setActivePage('dashboard')}
            className="mt-3 text-xs font-semibold text-[#69736C] hover:text-[#202923] text-center w-full block transition-colors cursor-pointer py-2 min-h-[38px] flex items-center justify-center"
          >
            {t('landing.enterDemoShop')}
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. DESKTOP LANDING VIEW (Shown on md+ screens) */}
      {/* ========================================================= */}
      <div className="hidden md:flex md:flex-col min-h-screen">
        {/* Header / Brand Bar */}
        <nav className="bg-white/95 backdrop-blur-md border-b border-[#E3E5DE] sticky top-0 z-30 shadow-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-lg bg-[#234B3A] flex items-center justify-center text-white shadow-xs shrink-0">
                <Activity className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-xl font-extrabold text-[#202923] tracking-tight">Shop</span>
                  <span className="text-xl font-extrabold text-[#234B3A] tracking-tight">Pulse</span>
                </div>
                <p className="text-[10px] font-medium text-[#69736C]">{t('dashboard.tagline')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setIsLangModalOpen(true)}
                className="px-2.5 py-1.5 rounded-lg bg-[#F7F5EF] hover:bg-[#E5EEE6] text-[#202923] border border-[#E3E5DE] flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-bold"
              >
                <Globe className="w-4 h-4 text-[#234B3A] shrink-0" />
                <span>{currentLanguageMeta.nativeName}</span>
              </button>

              {firebaseUser ? (
                <Button variant="primary" size="sm" onClick={() => setActivePage('dashboard')} className="font-bold">
                  {t('landing.launchDashboard')}
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setActivePage('login')} className="font-semibold">
                    {t('auth.loginHere')}
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setActivePage('signup')} className="font-bold">
                    {t('auth.createAccount')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="flex-1 py-12 sm:py-20 px-4 max-w-5xl mx-auto text-center flex flex-col items-center justify-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E5EEE6] text-[#234B3A] border border-[#52745D]/30 text-xs font-bold mb-6 shadow-xs">
            <Store className="w-4 h-4 text-[#234B3A]" />
            <span>{t('landing.heroBadge')}</span>
          </div>

          <h1 className="text-3xl sm:text-6xl font-extrabold text-[#202923] tracking-tight leading-tight max-w-3xl">
            {t('landing.heroTitle')}
          </h1>

          <p className="mt-5 text-base sm:text-xl text-[#69736C] max-w-2xl font-normal leading-relaxed">
            {t('landing.heroSub')}
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full max-w-sm justify-center">
            <Button 
              variant="primary" 
              size="lg" 
              onClick={() => setActivePage(firebaseUser ? 'dashboard' : 'login')}
              icon={<ArrowRight className="w-5 h-5" />}
              className="font-bold py-3.5"
            >
              {firebaseUser ? t('landing.launchDashboard') : (t('auth.loginBtn') || 'Sign In to Dashboard')}
            </Button>
          </div>

          <p className="mt-3.5 text-xs font-medium text-[#69736C]">
            Mobile-first. Built specifically for everyday shop owners.
          </p>
        </section>
      </div>

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </div>
  );
};
