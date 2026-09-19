import React, { useState } from 'react';
import { 
  Store, 
  ScanLine, 
  Sliders, 
  Info, 
  ChevronRight, 
  LogOut, 
  PhoneCall, 
  IndianRupee,
  Bell,
  Globe,
  Sparkles
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { LanguageSelectorModal } from '../components/LanguageSelectorModal';
import type { PageRoute } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface SettingsProps {
  shopName: string;
  setActivePage: (page: PageRoute) => void;
  onLogout: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  shopName,
  setActivePage,
  onLogout,
}) => {
  const { t, currentLanguageMeta } = useLanguage();
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
      />

      {/* 1. Shop Profile Card */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-emerald-600/20 shrink-0">
          <Store className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
            {t('settings.profileBadge')}
          </span>
          <h2 className="text-xl font-black text-slate-900 truncate mt-1">
            {shopName}
          </h2>
          <p className="text-xs text-slate-500 font-bold truncate">
            {t('settings.partnerId')}
          </p>
        </div>
      </div>

      {/* 2. Language Selection Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          {t('settings.language')}
        </div>

        <button
          onClick={() => setIsLangModalOpen(true)}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <span>{t('settings.language')}</span>
                <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                  {currentLanguageMeta.nativeName}
                </span>
              </p>
              <p className="text-xs text-slate-500 font-medium">
                {t('settings.languageSub')}
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 3. Quick Tools List */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          {t('settings.quickTools')}
        </div>

        <button
          onClick={() => setActivePage('scanner')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('scanner.heading')}</p>
              <p className="text-xs text-slate-500 font-medium">Snap paper bills to auto-fill stock</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>

        <button
          onClick={() => setActivePage('insights')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('insights.title')}</p>
              <p className="text-xs text-slate-500 font-medium">{t('insights.description')}</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 4. Preferences */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          {t('settings.preferences')}
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('settings.currencyFormat')}</p>
              <p className="text-xs text-slate-500 font-medium">{t('settings.indianRupee')}</p>
            </div>
          </div>
          <span className="text-xs font-black bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200">
            {t('settings.active')}
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('settings.lowStockAlerts')}</p>
              <p className="text-xs text-slate-500 font-medium">{t('settings.highlightBelowMin')}</p>
            </div>
          </div>
          <span className="text-xs font-black bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-200">
            {t('settings.enabled')}
          </span>
        </div>
      </div>

      {/* 5. Demo Data & Capstone Evaluation */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          Demo & Evaluation Mode
        </div>

        <div className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">Seed Demo Kirana Catalog</p>
              <p className="text-xs text-slate-500 font-medium">Populate Milk, Bread, Rice, Sugar, Oil & 7-day sales</p>
            </div>
          </div>
          <button
            onClick={async () => {
              setIsSeeding(true);
              try {
                const { seedDemoData } = await import('../scripts/seedDemoData');
                const res = await seedDemoData({ overwrite: false });
                alert(res.message);
              } catch (e: any) {
                alert(e.message || 'Seeding failed');
              } finally {
                setIsSeeding(false);
              }
            }}
            disabled={isSeeding}
            className="text-xs font-bold px-3.5 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded-xl cursor-pointer transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            {isSeeding ? 'Seeding...' : 'Seed Data'}
          </button>
        </div>
      </div>

      {/* 6. Help & About */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs divide-y divide-slate-100 overflow-hidden">
        <div className="p-4 bg-slate-50 text-xs font-black text-slate-600 uppercase tracking-wider">
          {t('settings.helpInfo')}
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('settings.supportLine')}</p>
              <p className="text-xs text-slate-500 font-medium">{t('settings.tollFree')}</p>
            </div>
          </div>
          <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
            24/7 Support
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-slate-900 text-sm sm:text-base">{t('settings.appVersion')}</p>
              <p className="text-xs text-slate-500 font-medium">ShopPulse Mobile Assistant v1.0 (Multi-Language)</p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">
            v1.0.0
          </span>
        </div>
      </div>

      {/* Logout Action */}
      <button
        onClick={onLogout}
        className="w-full py-4 px-6 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-black text-base flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
      >
        <LogOut className="w-5 h-5 text-rose-600" />
        <span>{t('settings.logOut')}</span>
      </button>

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />

    </div>
  );
};
