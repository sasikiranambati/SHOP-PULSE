import React, { useState } from 'react';
import { Activity, LogIn, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/Button';
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
      return;
    }

    if (!password) {
      setError('Please enter your password.');
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
      return;
    }

    try {
      setLoading(true);
      const profile = await login({ email: emailToUse, password }, rememberMe);
      onLoginSuccess(profile?.shopName || profile?.ownerName || 'Gupta Kirana Store');
      setActivePage('dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 relative pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      
      {/* Top Back Link */}
      <button 
        onClick={() => setActivePage('landing')}
        className="fixed sm:absolute top-[calc(1rem+env(safe-area-inset-top,0px))] left-4 sm:top-6 sm:left-6 z-10 flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900 bg-white/80 sm:bg-transparent backdrop-blur-xs px-3 py-1.5 rounded-full border border-slate-200/80 sm:border-transparent transition-colors cursor-pointer min-h-[40px]"
      >
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span>{t('common.back')}</span>
      </button>

      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-md">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm mb-3">
            <Activity className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{t('auth.welcomeBack')}</h1>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-1">{t('auth.logInSub')}</p>
        </div>

        {error && (
          <div className="p-3.5 mb-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-semibold space-y-2.5">
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
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-xs transition-colors cursor-pointer"
                >
                  Enter Demo Store ⚡
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              {t('auth.mobileOrEmail')}
            </label>
            <input
              type="text"
              required
              disabled={loading}
              autoComplete="username email"
              inputMode="email"
              placeholder="e.g. 9876543210 or shop@pulse.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base sm:text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              disabled={loading}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base sm:text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex items-center justify-between text-xs sm:text-sm pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <span>{t('auth.rememberMe') || 'Remember me on this device'}</span>
            </label>
          </div>

          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            disabled={loading}
            className="w-full font-black py-3.5"
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
              className="w-full py-2.5 px-3 rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/60 hover:bg-emerald-50 text-emerald-900 transition-all text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⚡ Try 1-Click Demo (Gupta Kirana Store)</span>
            </button>
          </div>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center">
          <p className="text-xs sm:text-sm text-slate-600 font-semibold">
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
    </div>
  );
};
