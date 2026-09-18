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
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const profile = await login({ email: emailToUse, password });
      onLoginSuccess(profile?.shopName || profile?.ownerName || 'Gupta Kirana Store');
      setActivePage('dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 relative">
      
      {/* Top Back Link */}
      <button 
        onClick={() => setActivePage('landing')}
        className="absolute top-6 left-6 flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
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
          <div className="p-3.5 mb-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-semibold flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
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
              placeholder="e.g. 9876543210 or shop@pulse.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm sm:text-base font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
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
