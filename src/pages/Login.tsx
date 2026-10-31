import React, { useState } from 'react';
import { Activity, LogIn, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';

interface LoginProps {
  setActivePage: (page: PageRoute) => void;
  onLoginSuccess: (name: string) => void;
}

export const Login: React.FC<LoginProps> = ({ setActivePage, onLoginSuccess }) => {
  const { t } = useLanguage();
  const { login, loginDemo } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemoLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const profile = await loginDemo(rememberMe);
      onLoginSuccess(profile?.shopName || 'Gupta Kirana Store');
      setActivePage('dashboard');
    } catch (err: any) {
      setError(err?.message || 'Failed to enter demo mode.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = identifier.trim();
    if (!trimmed) {
      setError(t('auth.invalidEmail') || 'Please enter your email or mobile number.');
      document.getElementById('login-identifier')?.focus();
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      document.getElementById('login-password')?.focus();
      return;
    }

    // Email / phone validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let emailToUse = trimmed;
    if (emailRegex.test(trimmed)) {
      emailToUse = trimmed.toLowerCase();
    } else if (/^\d{10}$/.test(trimmed)) {
      emailToUse = `${trimmed}@shoppulse.app`;
    } else {
      setError(t('auth.invalidEmail') || 'Please enter a valid email address.');
      document.getElementById('login-identifier')?.focus();
      return;
    }

    try {
      setLoading(true);
      const profile = await login({ email: emailToUse, password }, rememberMe);
      onLoginSuccess(profile?.shopName || profile?.ownerName || 'Gupta Kirana Store');
      setActivePage('dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
      document.getElementById('login-identifier')?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col justify-center items-center p-4 relative pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      
      {/* Top Back Link */}
      <button 
        onClick={() => setActivePage('landing')}
        className="fixed sm:absolute top-[calc(1rem+env(safe-area-inset-top,0px))] left-4 sm:top-6 sm:left-6 z-10 flex items-center gap-2 text-sm font-semibold text-[#69736C] hover:text-[#202923] bg-white/90 sm:bg-transparent backdrop-blur-xs px-3 py-1.5 rounded-lg border border-[#E3E5DE] sm:border-transparent transition-colors cursor-pointer min-h-[40px]"
      >
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span>{t('common.back')}</span>
      </button>

      <div className="max-w-md w-full bg-white rounded-xl border border-[#E3E5DE] p-6 sm:p-8 shadow-xs">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#234B3A] flex items-center justify-center text-white shadow-xs mb-3">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#202923] tracking-tight">{t('auth.welcomeBack')}</h1>
          <p className="text-xs sm:text-sm text-[#69736C] font-normal mt-1">{t('auth.logInSub')}</p>
        </div>

        {error && (
          <div id="login-error-alert" role="alert" className="p-3.5 mb-5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-medium space-y-2.5">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
            {(error.includes('502') || error.includes('Backend') || error.includes('backend') || error.includes('connect')) && (
              <div className="pt-2 border-t border-rose-200/70 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-rose-700 font-medium">Want to explore right now?</p>
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  className="px-3 py-1.5 rounded-lg bg-[#234B3A] hover:bg-[#18382B] text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  Enter Demo Store ⚡
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label htmlFor="login-identifier" className="block text-xs font-semibold text-[#202923] uppercase tracking-wider mb-1.5">
              <span>{t('auth.mobileOrEmail')}</span>
              <span className="text-rose-500 font-bold ml-1" aria-hidden="true">*</span>
            </label>
            <input
              id="login-identifier"
              type="text"
              required
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error-alert' : undefined}
              disabled={loading}
              autoComplete="username email"
              inputMode="email"
              placeholder="e.g. 9876543210 or shop@pulse.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-2 focus:ring-[#234B3A]/20 focus:border-[#234B3A] text-base sm:text-sm font-medium text-[#202923] disabled:bg-[#F7F5EF]/60 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-[#202923] uppercase tracking-wider mb-1.5">
              <span>{t('auth.password')}</span>
              <span className="text-rose-500 font-bold ml-1" aria-hidden="true">*</span>
            </label>
            <PasswordInput
              id="login-password"
              required
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error-alert' : undefined}
              disabled={loading}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#E3E5DE] focus:outline-none focus:ring-2 focus:ring-[#234B3A]/20 focus:border-[#234B3A] text-base sm:text-sm font-medium text-[#202923] disabled:bg-[#F7F5EF]/60 disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex items-center justify-between text-xs sm:text-sm pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-[#202923] select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-[#E3E5DE] text-[#234B3A] focus:ring-[#234B3A] cursor-pointer"
              />
              <span>{t('auth.rememberMe') || 'Remember me on this device'}</span>
            </label>
          </div>

          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            disabled={loading}
            className="w-full font-bold py-3"
            icon={loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
          >
            {loading ? (t('common.loading') || 'Logging in...') : t('auth.loginBtn')}
          </Button>

          {/* 1-Click Demo Login Shortcut */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={loading}
              className="w-full py-2.5 px-3 rounded-lg border border-dashed border-[#52745D]/40 hover:border-[#52745D]/70 bg-[#E5EEE6]/60 hover:bg-[#E5EEE6] text-[#234B3A] transition-all text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⚡ Try 1-Click Demo (Gupta Kirana Store)</span>
            </button>
          </div>
        </form>

        <div className="mt-8 pt-6 border-t border-[#E3E5DE] text-center">
          <p className="text-xs sm:text-sm text-[#69736C] font-normal">
            {t('auth.noAccount')}{' '}
            <button
              onClick={() => setActivePage('signup')}
              className="text-[#234B3A] font-bold hover:underline cursor-pointer"
            >
              {t('auth.createAccount')}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
};
