import React, { useState } from 'react';
import { 
  ArrowRight, 
  Globe, 
  Layers, 
  Mic, 
  BarChart3, 
  ChevronRight,
  ShieldCheck,
  Menu,
  X
} from 'lucide-react';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';
import { ShelforaLogo } from '../components/branding/ShelforaLogo';

export interface LandingProps {
  setActivePage: (page: PageRoute) => void;
}

export const Landing: React.FC<LandingProps> = ({ setActivePage }) => {
  const { currentLanguageMeta } = useLanguage();
  const { firebaseUser } = useAuth();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleFeatureClick = (targetPage: PageRoute) => {
    if (firebaseUser) {
      setActivePage(targetPage);
    } else {
      setActivePage('login');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F2] text-[#252D29] font-sans flex flex-col selection:bg-[#E8F3ED] selection:text-[#123D32]">
      
      {/* ========================================================= */}
      {/* 1. CLEAN HORIZONTAL NAVIGATION BAR                        */}
      {/* ========================================================= */}
      <header className="bg-white border-b border-[#E5EAE5] sticky top-0 z-40 transition-shadow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          
          {/* Left: Shelfora Logo & Tagline */}
          <div className="flex items-center gap-3">
            <ShelforaLogo variant="horizontal" size="md" showTagline={true} />
          </div>

          {/* Right: Language selector + Login / Signup (Desktop) */}
          <div className="hidden md:flex items-center gap-3">
            {/* Language Selector */}
            <button
              type="button"
              onClick={() => setIsLangModalOpen(true)}
              className="px-3.5 py-2 rounded-full bg-[#FAF8F2] hover:bg-[#E8F3ED] text-[#123D32] border border-[#DDE9DF] flex items-center gap-2 text-xs font-semibold transition-colors cursor-pointer"
              title="Change Language"
              aria-label="Change Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#16866A] shrink-0" />
              <span>{currentLanguageMeta.nativeName}</span>
            </button>

            {firebaseUser ? (
              <button
                type="button"
                onClick={() => setActivePage('dashboard')}
                className="px-5 py-2.5 rounded-full bg-[#123D32] hover:bg-[#0A241D] text-white text-sm font-semibold transition-all shadow-xs hover:shadow-sm cursor-pointer"
              >
                Go to Dashboard
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setActivePage('login')}
                  className="px-5 py-2.5 rounded-full text-sm font-semibold text-[#123D32] hover:text-[#0A241D] hover:bg-[#FAF8F2] border border-transparent hover:border-[#DDE9DF] transition-all cursor-pointer"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => setActivePage('signup')}
                  className="px-5 py-2.5 rounded-full bg-[#123D32] hover:bg-[#0A241D] text-white text-sm font-semibold transition-all shadow-xs hover:shadow-sm cursor-pointer"
                >
                  Create Account
                </button>
              </>
            )}
          </div>

          {/* Mobile Right Controls: Language Button & Hamburger */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setIsLangModalOpen(true)}
              className="p-2 rounded-full bg-[#FAF8F2] border border-[#DDE9DF] text-[#123D32] flex items-center justify-center cursor-pointer min-h-[40px] min-w-[40px]"
              aria-label="Change Language"
            >
              <Globe className="w-4 h-4 text-[#16866A]" />
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-full bg-[#FAF8F2] border border-[#DDE9DF] text-[#123D32] flex items-center justify-center cursor-pointer min-h-[40px] min-w-[40px]"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-[#123D32]" /> : <Menu className="w-5 h-5 text-[#123D32]" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#E5EAE5] bg-white px-4 pt-3 pb-5 space-y-3 animate-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between py-1 text-xs text-[#5E6C64] font-medium border-b border-[#E5EAE5] pb-2">
              <span>Smarter Grocery Management</span>
              <span className="flex items-center gap-1 text-[#16866A]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Made for Bharat</span>
              </span>
            </div>

            <div className="pt-1 flex flex-col gap-2.5">
              {firebaseUser ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setActivePage('dashboard');
                  }}
                  className="w-full py-3 rounded-xl bg-[#123D32] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                >
                  <span>Open Dashboard</span>
                  <ArrowRight className="w-4 h-4 text-[#E8F3ED]" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setActivePage('signup');
                    }}
                    className="w-full py-3 rounded-xl bg-[#123D32] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                  >
                    <span>Create Free Account</span>
                    <ArrowRight className="w-4 h-4 text-[#E8F3ED]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setActivePage('login');
                    }}
                    className="w-full py-3 rounded-xl bg-[#FAF8F2] hover:bg-[#F3EFE3] text-[#123D32] font-semibold text-sm border border-[#DDE9DF] flex items-center justify-center cursor-pointer min-h-[44px]"
                  >
                    <span>Log In to Existing Store</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ========================================================= */}
      {/* 2. HERO SECTION (Centered, Spacious, Deep Forest Green)   */}
      {/* ========================================================= */}
      <main className="flex-1">
        <section className="pt-20 pb-16 md:pt-28 md:pb-24 px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center justify-center">
          
          {/* Small Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#E8F3ED] text-[#123D32] border border-[#16866A]/25 text-xs font-semibold tracking-wide mb-8 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16866A]" />
            <span>Smarter Grocery Management</span>
          </div>

          {/* Main Heading */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-[#123D32] tracking-tight leading-[1.12] max-w-4xl mx-auto">
            Manage Your Store.<br className="hidden sm:inline" />
            <span className="block mt-1 sm:mt-2">Know What to Do Next.</span>
          </h1>

          {/* Supporting Description */}
          <p className="mt-6 md:mt-8 text-base sm:text-lg md:text-xl text-[#5E6C64] max-w-2xl mx-auto leading-relaxed font-normal">
            Shelfora helps grocery retailers manage inventory, process supplier invoices, track sales and make smarter business decisions.
          </p>

          {/* Primary & Secondary Call to Actions */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-md mx-auto">
            <button
              type="button"
              onClick={() => setActivePage(firebaseUser ? 'dashboard' : 'signup')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-full bg-[#123D32] hover:bg-[#0A241D] text-white font-semibold text-base transition-all shadow-sm hover:shadow-md cursor-pointer min-h-[48px]"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4 text-[#E8F3ED]" />
            </button>

            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('features');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-white hover:bg-[#FAF8F2] text-[#123D32] border border-[#DDE9DF] font-semibold text-base transition-all cursor-pointer min-h-[48px]"
            >
              <span>Explore Features</span>
            </button>
          </div>

          {/* Trust Metric Strip */}
          <div className="mt-12 inline-flex items-center gap-6 text-xs text-[#5E6C64]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16866A]" />
              Zero Hardware Required
            </span>
            <span className="hidden sm:inline-block text-[#DDE9DF]">·</span>
            <span className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16866A]" />
              Works Offline & Cloud-Synced
            </span>
            <span className="hidden sm:inline-block text-[#DDE9DF]">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16866A]" />
              English Voice-to-Bill
            </span>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 3. FEATURE CARDS SECTION (3 Balanced Cards)               */}
        {/* ========================================================= */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 md:pb-32">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#16866A] mb-2">
              Capabilities Built for Indian Kiranas
            </h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-[#123D32] tracking-tight">
              Everything Your Store Needs in One Place
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            
            {/* CARD 1 – Invoice Intelligence */}
            <div 
              onClick={() => handleFeatureClick('scanner')}
              className="group bg-white border border-[#E5EAE5] rounded-2xl p-7 flex flex-col justify-between hover:border-[#16866A]/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer shadow-xs hover:shadow-sm"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-[#E8F3ED] flex items-center justify-center text-[#16866A] mb-5 group-hover:bg-[#123D32] group-hover:text-white transition-colors">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-[#123D32] tracking-tight mb-2.5">
                  Invoice Intelligence
                </h3>
                <p className="text-sm text-[#5E6C64] leading-relaxed">
                  Convert supplier invoices into structured grocery inventory data with intelligent extraction and validation.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-[#F3EFE3] flex items-center justify-between text-xs font-semibold text-[#16866A] group-hover:text-[#123D32]">
                <span>Process wholesale bills</span>
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>

            {/* CARD 2 – Voice-to-Bill */}
            <div 
              onClick={() => handleFeatureClick('sales')}
              className="group bg-white border border-[#E5EAE5] rounded-2xl p-7 flex flex-col justify-between hover:border-[#16866A]/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer shadow-xs hover:shadow-sm"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-[#E8F3ED] flex items-center justify-center text-[#16866A] mb-5 group-hover:bg-[#123D32] group-hover:text-white transition-colors">
                  <Mic className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-[#123D32] tracking-tight mb-2.5">
                  Voice-to-Bill
                </h3>
                <p className="text-sm text-[#5E6C64] leading-relaxed">
                  Create bills quickly using natural English voice input with smart quantity and unit matching.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-[#F3EFE3] flex items-center justify-between text-xs font-semibold text-[#16866A] group-hover:text-[#123D32]">
                <span>Speak to generate bill</span>
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>

            {/* CARD 3 – Retail Analytics */}
            <div 
              onClick={() => handleFeatureClick('insights')}
              className="group bg-white border border-[#E5EAE5] rounded-2xl p-7 flex flex-col justify-between hover:border-[#16866A]/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer shadow-xs hover:shadow-sm"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-[#E8F3ED] flex items-center justify-center text-[#16866A] mb-5 group-hover:bg-[#123D32] group-hover:text-white transition-colors">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-[#123D32] tracking-tight mb-2.5">
                  Retail Analytics
                </h3>
                <p className="text-sm text-[#5E6C64] leading-relaxed">
                  Understand stock levels, sales performance, profit margins and restocking requirements.
                </p>
              </div>

              <div className="mt-8 pt-4 border-t border-[#F3EFE3] flex items-center justify-between text-xs font-semibold text-[#16866A] group-hover:text-[#123D32]">
                <span>View store insights</span>
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>

          </div>
        </section>
      </main>

      {/* ========================================================= */}
      {/* 4. CLEAN MINIMAL FOOTER                                   */}
      {/* ========================================================= */}
      <footer className="bg-white border-t border-[#E5EAE5] py-8 text-xs text-[#5E6C64]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShelforaLogo variant="compact" size="sm" />
            <span className="font-bold text-[#123D32]">Shelfora</span>
            <span className="text-[#DDE9DF]">·</span>
            <span>Smarter Grocery Management.</span>
          </div>

          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActivePage('login')}
              className="hover:text-[#123D32] transition-colors cursor-pointer"
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => setActivePage('signup')}
              className="hover:text-[#123D32] transition-colors cursor-pointer"
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => setActivePage('dashboard')}
              className="hover:text-[#123D32] transition-colors cursor-pointer"
            >
              Store Dashboard
            </button>
            <span className="text-[#DDE9DF]">·</span>
            <span className="font-medium text-[#123D32]">Help: 1800-SHELFORA</span>
          </div>
        </div>
      </footer>

      {/* Global Language Selector Modal */}
      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </div>
  );
};

export default Landing;
