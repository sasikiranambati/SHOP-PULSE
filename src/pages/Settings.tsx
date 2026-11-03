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
  Globe
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

  return (
    <div className="space-y-5 sm:space-y-6 max-w-2xl mx-auto min-w-0">
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
      />

      {/* 1. Shop Profile Card */}
      <div className="bg-white rounded-xl p-5 border border-[#E3E5DE] shadow-xs flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-[#234B3A] text-white flex items-center justify-center font-bold text-xl shadow-xs shrink-0">
          <Store className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#234B3A] bg-[#E5EEE6] px-2.5 py-0.5 rounded-full border border-[#52745D]/30">
            {t('settings.profileBadge')}
          </span>
          <h2 className="text-xl font-extrabold text-[#202923] truncate mt-1">
            {shopName}
          </h2>
          <p className="text-xs text-[#69736C] font-medium truncate">
            {t('settings.partnerId')}
          </p>
        </div>
      </div>

      {/* 2. Language Selection Card */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs overflow-hidden">
        <div className="p-3.5 bg-[#F7F5EF] text-xs font-semibold text-[#69736C] uppercase tracking-wider border-b border-[#E3E5DE]">
          {t('settings.language')}
        </div>

        <button
          onClick={() => setIsLangModalOpen(true)}
          className="w-full p-4 flex items-center justify-between hover:bg-[#F7F5EF]/60 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base flex items-center gap-2">
                <span>{t('settings.language')}</span>
                <span className="text-xs font-bold text-[#234B3A] bg-[#E5EEE6] px-2 py-0.5 rounded-md border border-[#52745D]/30">
                  {currentLanguageMeta.nativeName}
                </span>
              </p>
              <p className="text-xs text-[#69736C] font-normal">
                {t('settings.languageSub')}
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-[#69736C] group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 3. Quick Tools List */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs divide-y divide-[#E3E5DE] overflow-hidden">
        <div className="p-3.5 bg-[#F7F5EF] text-xs font-semibold text-[#69736C] uppercase tracking-wider border-b border-[#E3E5DE]">
          {t('settings.quickTools')}
        </div>

        <button
          onClick={() => setActivePage('scanner')}
          className="w-full p-4 flex items-center justify-between hover:bg-[#F7F5EF]/60 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('scanner.heading')}</p>
              <p className="text-xs text-[#69736C] font-normal">Snap paper bills to auto-fill stock</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-[#69736C] group-hover:translate-x-0.5 transition-transform" />
        </button>

        <button
          onClick={() => setActivePage('insights')}
          className="w-full p-4 flex items-center justify-between hover:bg-[#F7F5EF]/60 text-left transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#FEF9EB] text-[#A66A16] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('insights.title')}</p>
              <p className="text-xs text-[#69736C] font-normal">{t('insights.description')}</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-[#69736C] group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 4. Preferences */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs divide-y divide-[#E3E5DE] overflow-hidden">
        <div className="p-3.5 bg-[#F7F5EF] text-xs font-semibold text-[#69736C] uppercase tracking-wider border-b border-[#E3E5DE]">
          {t('settings.preferences')}
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('settings.currencyFormat')}</p>
              <p className="text-xs text-[#69736C] font-normal">{t('settings.indianRupee')}</p>
            </div>
          </div>
          <span className="text-xs font-bold bg-[#E5EEE6] text-[#234B3A] px-3 py-1 rounded-full border border-[#52745D]/30">
            {t('settings.active')}
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('settings.lowStockAlerts')}</p>
              <p className="text-xs text-[#69736C] font-normal">{t('settings.highlightBelowMin')}</p>
            </div>
          </div>
          <span className="text-xs font-bold bg-[#E5EEE6] text-[#234B3A] px-3 py-1 rounded-full border border-[#52745D]/30">
            {t('settings.enabled')}
          </span>
        </div>
      </div>

      {/* 5. Help & About */}
      <div className="bg-white rounded-xl border border-[#E3E5DE] shadow-xs divide-y divide-[#E3E5DE] overflow-hidden">
        <div className="p-3.5 bg-[#F7F5EF] text-xs font-semibold text-[#69736C] uppercase tracking-wider border-b border-[#E3E5DE]">
          {t('settings.helpInfo')}
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#E5EEE6] text-[#234B3A] flex items-center justify-center shrink-0">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('settings.supportLine')}</p>
              <p className="text-xs text-[#69736C] font-normal">{t('settings.tollFree')}</p>
            </div>
          </div>
          <span className="text-xs font-bold text-[#234B3A] bg-[#E5EEE6] px-3 py-1 rounded-lg border border-[#52745D]/30">
            24/7 Support
          </span>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#F7F5EF] text-[#202923] flex items-center justify-center shrink-0">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#202923] text-sm sm:text-base">{t('settings.appVersion')}</p>
              <p className="text-xs text-[#69736C] font-normal">ShopPulse Mobile Assistant v1.0 (Multi-Language)</p>
            </div>
          </div>
          <span className="text-xs font-medium text-[#69736C] bg-[#F7F5EF] px-3 py-1 rounded-lg">
            v1.0.0
          </span>
        </div>
      </div>

      {/* Logout Action */}
      <button
        onClick={onLogout}
        className="w-full py-3.5 px-6 rounded-lg bg-[#FDF2F2] hover:bg-[#FCE8E8] border border-[#B93838]/25 text-[#B93838] font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
      >
        <LogOut className="w-5 h-5 text-[#B93838]" />
        <span>{t('settings.logOut')}</span>
      </button>

      <LanguageSelectorModal
        isOpen={isLangModalOpen}
        onClose={() => setIsLangModalOpen(false)}
      />

    </div>
  );
};
