import React, { useState } from 'react';
import { Activity, UserPlus, ArrowLeft, Globe, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '../components/Button';
import type { PageRoute, BusinessType } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';

interface SignupProps {
  setActivePage: (page: PageRoute) => void;
  onSignupSuccess: (shopName: string) => void;
}

export const Signup: React.FC<SignupProps> = ({ setActivePage, onSignupSuccess }) => {
  const { t, currentLanguageMeta } = useLanguage();
  const { register } = useAuth();
  const [ownerName, setOwnerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('Kirana Store');
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const businessOptions: BusinessType[] = [
    'Kirana Store',
    'Bakery',
    'Pharmacy',
    'Tea Stall',
    'Supermarket',
    'Other',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!ownerName.trim()) {
      setError('Please enter the owner name.');
      return;
    }

    if (!shopName.trim()) {
      setError('Please enter your shop name.');
      return;
    }

    // Email / phone validation
    const trimmedContact = contact.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let emailToUse = trimmedContact;
    let phoneToUse = '';

    if (emailRegex.test(trimmedContact)) {
      emailToUse = trimmedContact.toLowerCase();
    } else if (/^\d{10}$/.test(trimmedContact)) {
      emailToUse = `${trimmedContact}@shoppulse.app`;
      phoneToUse = trimmedContact;
    } else {
      setError('Please enter a valid email address (e.g. shop@pulse.com).');
      return;
    }

    // Password validation (min 6 chars)
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    try {
      setLoading(true);
      const profile = await register({
        email: emailToUse,
        password,
        displayName: ownerName.trim(),
        ownerName: ownerName.trim(),
        shopName: shopName.trim(),
        phone: phoneToUse,
        businessType,
        language: (currentLanguageMeta.code === 'te' ? 'te' : 'en'),
        theme: 'light',
      });

      setSuccessMessage('Account created successfully! Welcome to ShopPulse.');
      onSignupSuccess(profile.shopName || shopName.trim());

      // Redirect smoothly to dashboard
      setTimeout(() => {
        setActivePage('dashboard');
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
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

      <div className="max-w-lg w-full bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-md my-8">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm mb-3">
            <Activity className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{t('auth.createShopAccount')}</h1>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-1">{t('auth.signupSub')}</p>

          {/* Initial Onboarding Language Selector */}
          <button
            type="button"
            onClick={() => setIsLangModalOpen(true)}
            className="mt-3 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Globe className="w-4 h-4 text-emerald-600" />
            <span>🌐 {currentLanguageMeta.nativeName} ({currentLanguageMeta.name})</span>
          </button>
        </div>

        {error && (
          <div className="p-3.5 mb-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-semibold flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 mb-5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                {t('auth.ownerName')}
              </label>
              <input
                type="text"
                required
                disabled={loading}
                placeholder="Ramesh Gupta"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                {t('auth.shopName')}
              </label>
              <input
                type="text"
                required
                disabled={loading}
                placeholder="Gupta Kirana Store"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              {t('auth.businessType')}
            </label>
            <select
              value={businessType}
              disabled={loading}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              {businessOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              {t('auth.phoneOrEmail')}
            </label>
            <input
              type="text"
              required
              disabled={loading}
              placeholder="shop@pulse.com or 9876543210"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              {t('auth.createPassword')}
            </label>
            <input
              type="password"
              required
              disabled={loading}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>

          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            disabled={loading}
            className="w-full mt-2 font-black py-3.5"
            icon={loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserPlus className="w-5 h-5" />}
          >
            {loading ? 'Creating Account...' : t('auth.createShopAccount')}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 text-center">
          <p className="text-xs sm:text-sm text-slate-600 font-semibold">
            {t('auth.alreadyRegistered')}{' '}
            <button
              onClick={() => setActivePage('login')}
              className="text-emerald-700 font-black hover:underline cursor-pointer"
            >
              {t('auth.loginHere')}
            </button>
          </p>
        </div>

      </div>

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />
    </div>
  );
};
