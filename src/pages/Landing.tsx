import React, { useState } from 'react';
import { 
  Activity, 
  ShoppingCart, 
  ScanLine, 
  TrendingUp, 
  ArrowRight, 
  CheckCircle2,
  Store,
  Cpu,
  Globe
} from 'lucide-react';
import { Button } from '../components/Button';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';

interface LandingProps {
  setActivePage: (page: PageRoute) => void;
}

export const Landing: React.FC<LandingProps> = ({ setActivePage }) => {
  const { t, currentLanguageMeta } = useLanguage();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  const businessTypes = [
    'Kirana Stores',
    'Bakeries',
    'Pharmacies',
    'Tea Stalls',
    'Supermarkets',
    'General Stores',
  ];

  const features = [
    {
      icon: ShoppingCart,
      title: t('landing.feature1Title'),
      description: t('landing.feature1Desc'),
      tag: 'Ready Now',
    },
    {
      icon: Cpu,
      title: t('landing.feature2Title'),
      description: t('landing.feature2Desc'),
      tag: 'IoT Ready',
    },
    {
      icon: ScanLine,
      title: t('landing.feature3Title'),
      description: t('landing.feature3Desc'),
      tag: 'Phase 1',
    },
    {
      icon: TrendingUp,
      title: t('landing.feature4Title'),
      description: t('landing.feature4Desc'),
      tag: 'AI Intelligence',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Header / Brand Bar */}
      <nav className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-baseline gap-0.5">
                <span className="text-xl font-black text-slate-900 tracking-tight">Shop</span>
                <span className="text-xl font-black text-emerald-600 tracking-tight">Pulse</span>
              </div>
              <p className="text-[10px] font-bold text-slate-500">{t('dashboard.tagline')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setIsLangModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-black"
            >
              <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{currentLanguageMeta.nativeName}</span>
            </button>

            <Button variant="outline" size="sm" onClick={() => setActivePage('login')} className="font-bold">
              {t('auth.loginHere')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setActivePage('signup')} className="font-black">
              {t('auth.createAccount')}
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-12 sm:py-20 px-4 max-w-5xl mx-auto text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-black mb-6 shadow-2xs">
          <Store className="w-4 h-4 text-emerald-700" />
          <span>{t('landing.heroBadge')}</span>
        </div>

        <h1 className="text-3xl sm:text-6xl font-black text-slate-900 tracking-tight leading-tight max-w-3xl">
          {t('landing.heroTitle')}
        </h1>

        <p className="mt-5 text-base sm:text-xl text-slate-600 max-w-2xl font-semibold leading-relaxed">
          {t('landing.heroSub')}
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full max-w-sm justify-center">
          <Button 
            variant="primary" 
            size="lg" 
            onClick={() => setActivePage('dashboard')}
            icon={<ArrowRight className="w-5 h-5" />}
            className="font-black py-4"
          >
            {t('landing.launchDashboard')}
          </Button>
        </div>

        <p className="mt-3.5 text-xs font-bold text-slate-500">
          ⚡ Mobile-first. Built specifically for everyday shop owners.
        </p>
      </section>

      {/* Business Types Pill Section */}
      <section className="bg-white py-6 border-y border-slate-200/90">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500 mb-4">
            {t('landing.tailoredFor')}
          </p>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            {businessTypes.map((type) => (
              <span
                key={type}
                className="px-4 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-xs sm:text-sm font-extrabold flex items-center gap-1.5 shadow-2xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {type}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-14 sm:py-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Everything your shop needs to stay ahead
          </h2>
          <p className="mt-2 text-slate-600 font-semibold text-sm sm:text-base">
            Designed for quick navigation and fast daily usage at the billing counter.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <div 
                key={feat.title}
                className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-700 flex items-center justify-center shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      {feat.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900">{feat.title}</h3>
                  <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed font-semibold">
                    {feat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto bg-white border-t border-slate-200 py-8 px-4 text-center">
        <p className="text-sm font-extrabold text-slate-800">
          ShopPulse &copy; {new Date().getFullYear()} — Retail Intelligence Platform
        </p>
        <p className="text-xs text-slate-500 font-semibold mt-1">
          "{t('dashboard.tagline')}"
        </p>
      </footer>

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </div>
  );
};
