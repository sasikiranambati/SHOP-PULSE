import React, { useState } from 'react';
import { LogIn, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';
import { ShelforaLogo } from '../components/branding/ShelforaLogo';
import { readSessionExpiredNotice } from '../utils/posDraftStorage';

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
  const [sessionExpiredNotice] = useState(() => readSessionExpiredNotice());

  const resolvePostLoginPage = (): PageRoute => {
    const notice = readSessionExpiredNotice();
    const target = notice?.returnPage;
    if (target && ['dashboard', 'inventory', 'sales', 'insights', 'scanner', 'settings'].includes(target)) {
      return target;
    }
    return 'dashboard';
  };

  const handleDemoLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const profile = await loginDemo(rememberMe);
      onLoginSuccess(profile?.shopName || 'Gupta Kirana Store');
      setActivePage(resolvePostLoginPage());
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
      emailToUse = `${trimmed}@shelfora.com`;
    } else {
      setError(t('auth.invalidEmail') || 'Please enter a valid email address.');
      document.getElementById('login-identifier')?.focus();
      return;
    }

    try {
      setLoading(true);
      const profile = await login({ email: emailToUse, password }, rememberMe);
      onLoginSuccess(profile?.shopName || profile?.ownerName || 'Gupta Kirana Store');
      setActivePage(resolvePostLoginPage());
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
      document.getElementById('login-identifier')?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F2] flex flex-col justify-center items-center p-4 relative pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">

      {/* Top Back Link */}
      <button
        onClick={() => setActivePage('landing')}
        className="fixed sm:absolute top-[calc(1rem+env(safe-area-inset-top,0px))] left-4 sm:top-6 sm:left-6 z-10 flex items-center gap-2 text-sm font-semibold text-[#5E6C64] hover:text-[#153D32] bg-white/90 sm:bg-transparent backdrop-blur-xs px-3 py-1.5 rounded-xl border border-[#DDE9DF] sm:border-transparent transition-colors cursor-pointer min-h-[40px]"
      >
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span>{t('common.back')}</span>
      </button>

      <div className="max-w-md w-full bg-white rounded-2xl border border-[#DDE9DF] p-6 sm:p-8 shadow-card">

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-3">
            <ShelforaLogo variant="full" size="lg" showTagline={false} />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#153D32] tracking-tight">{t('auth.welcomeBack')}</h1>
          <p className="text-xs sm:text-sm text-[#5E6C64] font-normal mt-1">{t('auth.logInSub')}</p>
        </div>

        {sessionExpiredNotice && !error && (
          <div id="session-expired-notice" role="status" className="p-3.5 mb-5 rounded-xl bg-[#FEF9EB] border border-[#D6AE62]/50 text-[#8A6118] text-xs sm:text-sm font-medium flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#A07828] mt-0.5" />
            <span>
              Your session expired. Sign in again to continue.
              {sessionExpiredNotice.hadActiveDraft ? ' Your active bill draft has been saved and will be restored.' : ''}
            </span>
          </div>
        )}

        {error && (
          <div id="login-error-alert" role="alert" className="p-3.5 mb-5 rounded-xl bg-[#FDF1EF] border border-[#EF806D]/30 text-[#EF806D] text-xs sm:text-sm font-medium space-y-2.5">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#EF806D] mt-0.5" />
              <span>{error}</span>
            </div>
            {(error.includes('502') || error.includes('Backend') || error.includes('backend') || error.includes('connect')) && (
              <div className="pt-2 border-t border-[#EF806D]/20 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-[#EF806D] font-medium">Want to explore right now?</p>
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  className="px-3 py-1.5 rounded-xl bg-[#153D32] hover:bg-[#0F2D25] text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  Enter Demo Store ⚡
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-identifier" className="block text-xs font-bold text-[#153D32] uppercase tracking-wider mb-1.5">
              <span>{t('auth.mobileOrEmail')}</span>
              <span className="text-[#EF806D] font-bold ml-1" aria-hidden="true">*</span>
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
              placeholder="e.g. 9876543210 or store@shelfora.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/20 focus:border-[#153D32] text-base sm:text-sm font-medium text-[#252D29] disabled:bg-[#FAF8F2]/60 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-[#153D32] uppercase tracking-wider mb-1.5">
              <span>{t('auth.password')}</span>
              <span className="text-[#EF806D] font-bold ml-1" aria-hidden="true">*</span>
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
              className="w-full px-4 py-2.5 rounded-xl border border-[#DDE9DF] focus:outline-none focus:ring-2 focus:ring-[#153D32]/20 focus:border-[#153D32] text-base sm:text-sm font-medium text-[#252D29] disabled:bg-[#FAF8F2]/60 disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex items-center justify-between text-xs sm:text-sm pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-[#252D29] select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-[#DDE9DF] text-[#153D32] focus:ring-[#153D32] cursor-pointer"
              />
              <span>{t('auth.rememberMe') || 'Remember me on this device'}</span>
            </label>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            className="w-full font-bold py-3 bg-[#153D32] hover:bg-[#0F2D25] text-white rounded-xl shadow-card"
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
              className="w-full py-2.5 px-3 rounded-xl border border-dashed border-[#23866A]/40 hover:border-[#23866A]/70 bg-[#E7F3EE]/60 hover:bg-[#E7F3EE] text-[#153D32] transition-all text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⚡ Try 1-Click Demo (Gupta Kirana Store)</span>
            </button>
          </div>
        </form>

        <div className="mt-8 pt-6 border-t border-[#DDE9DF] text-center">
          <p className="text-xs sm:text-sm text-[#5E6C64] font-normal">
            {t('auth.noAccount')}{' '}
            <button
              onClick={() => setActivePage('signup')}
              className="text-[#23866A] font-bold hover:underline cursor-pointer"
            >
              {t('auth.createAccount')}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
};

export default Login;
