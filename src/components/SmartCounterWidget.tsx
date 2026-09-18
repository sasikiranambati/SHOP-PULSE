import React, { useState } from 'react';
import { Cpu, Zap, CheckCircle2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export const SmartCounterWidget: React.FC = () => {
  const { t } = useLanguage();
  const [lastEventTime, setLastEventTime] = useState('2 mins ago');
  const [eventCount, setEventCount] = useState(42);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSimulateSensor = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setEventCount((prev) => prev + 1);
      setLastEventTime('Just now');
      setIsSimulating(false);
    }, 600);
  };

  return (
    <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-700 relative overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-700/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 flex items-center justify-center shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-white">{t('smartCounter.title')}</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                {t('smartCounter.connected')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">{t('smartCounter.subtext')}</p>
          </div>
        </div>

        <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-500/30">
          {t('smartCounter.demoBadge')}
        </span>
      </div>

      {/* Sensor Event Summary */}
      <div className="mt-3.5 grid grid-cols-2 gap-3">
        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{t('smartCounter.lastDetection')}</span>
          <p className="text-xs sm:text-sm font-extrabold text-emerald-300 mt-0.5 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{t('smartCounter.saleRecorded', { time: lastEventTime })}</span>
          </p>
        </div>

        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{t('smartCounter.todayPasses')}</span>
          <p className="text-xs sm:text-sm font-extrabold text-white mt-0.5">
            {t('smartCounter.scansCount', { count: eventCount })}
          </p>
        </div>
      </div>

      {/* Interactive Hardware Action Button */}
      <div className="mt-3.5 flex items-center justify-between gap-2 pt-2 border-t border-slate-700/60">
        <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
          {t('smartCounter.simulateLabel')}
        </span>
        <button
          onClick={handleSimulateSensor}
          disabled={isSimulating}
          className="w-full sm:w-auto px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isSimulating ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-amber-300" />
          )}
          <span>{isSimulating ? t('smartCounter.detecting') : t('smartCounter.testSignal')}</span>
        </button>
      </div>
    </div>
  );
};
