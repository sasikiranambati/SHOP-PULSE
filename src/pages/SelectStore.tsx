import React, { useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, Store } from 'lucide-react';
import { Button } from '../components/Button';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { BusinessTypeId, PageRoute } from '../types';

interface SelectStoreProps {
  setActivePage: (page: PageRoute) => void;
  selectedBusinessId: BusinessTypeId | null;
  onSelectBusiness: (businessId: BusinessTypeId, defaultStoreName: string) => void;
}

export const SelectStore: React.FC<SelectStoreProps> = ({
  setActivePage,
  selectedBusinessId,
  onSelectBusiness,
}) => {
  const [selectedId, setSelectedId] = useState<BusinessTypeId | null>(selectedBusinessId || null);

  const handleContinue = () => {
    if (!selectedId) return;
    const option = BUSINESS_TYPE_OPTIONS.find(b => b.id === selectedId);
    if (option) {
      onSelectBusiness(selectedId, option.defaultStoreName);
      setActivePage('dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans py-10 px-4">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col justify-between">
        
        {/* Header Header Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-black mb-4 shadow-xs">
            <Activity className="w-4 h-4 text-emerald-700 animate-pulse" />
            <span>ShopPulse Onboarding</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight">
            What type of business do you run?
          </h1>
          
          <p className="mt-3 text-base sm:text-lg text-slate-600 max-w-xl mx-auto font-medium">
            Select your business to personalize your ShopPulse dashboard, inventory, and sales experience.
          </p>
        </div>

        {/* 14 Store Type Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 my-4">
          {BUSINESS_TYPE_OPTIONS.map((item) => {
            const isSelected = selectedId === item.id;
            return (
              <div
                key={item.id}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(item.id);
                  }
                }}
                className={`group bg-white rounded-2xl p-5 border-2 transition-all cursor-pointer select-none flex flex-col justify-between outline-none ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-md ring-2 ring-emerald-500/20'
                    : 'border-slate-200 hover:border-emerald-400 hover:shadow-sm'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-3xl p-2 rounded-xl bg-slate-100 group-hover:bg-white transition-colors">
                      {item.emoji}
                    </span>
                    {isSelected ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <span className="w-5 h-5 rounded-full border-2 border-slate-300 group-hover:border-emerald-400" />
                    )}
                  </div>

                  <h3 className="font-extrabold text-slate-900 text-lg group-hover:text-emerald-700 transition-colors">
                    {item.name}
                  </h3>
                  
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    {item.tagline}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-600">
                  <span>Template</span>
                  <span className={isSelected ? 'text-emerald-700' : 'text-slate-500'}>
                    {item.categoryList[0]} + {item.categoryList.length - 1} more
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Action Bar */}
        <div className="sticky bottom-4 z-20 bg-white/90 backdrop-blur-md rounded-2xl p-4 border border-slate-200 shadow-xl flex items-center justify-between gap-4 mt-8">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600 hidden sm:block" />
            <span className="text-sm font-semibold text-slate-700">
              {selectedId ? (
                <>Selected: <strong className="text-slate-900">{BUSINESS_TYPE_OPTIONS.find(b => b.id === selectedId)?.name}</strong></>
              ) : (
                <span className="text-slate-500">Please tap a store type above to continue</span>
              )}
            </span>
          </div>

          <Button
            variant="primary"
            size="lg"
            disabled={!selectedId}
            onClick={handleContinue}
            icon={<ArrowRight className="w-5 h-5" />}
          >
            Continue to ShopPulse
          </Button>
        </div>

      </div>
    </div>
  );
};
