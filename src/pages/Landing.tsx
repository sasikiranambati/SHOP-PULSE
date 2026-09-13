import React from 'react';
import { 
  Activity, 
  ShoppingCart, 
  ScanLine, 
  TrendingUp, 
  Zap, 
  ArrowRight, 
  Store,
  Sparkles
} from 'lucide-react';
import { Button } from '../components/Button';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { PageRoute } from '../types';

interface LandingProps {
  setActivePage: (page: PageRoute) => void;
}

export const Landing: React.FC<LandingProps> = ({ setActivePage }) => {
  const features = [
    {
      icon: ShoppingCart,
      title: 'Quick Sales Entry',
      description: 'Record sales in seconds with simple tap selectors designed for busy retail counters.',
      tag: 'UI Ready',
    },
    {
      icon: ScanLine,
      title: 'Invoice Scanning',
      description: 'Snap photos of supplier paper bills to automatically track stock without manual typing.',
      tag: 'Phase 2 Preview',
    },
    {
      icon: TrendingUp,
      title: 'Demand Forecasting',
      description: 'Know what will sell tomorrow before you run out of stock based on past sales history.',
      tag: 'Phase 3 Preview',
    },
    {
      icon: Zap,
      title: 'Smart Reordering',
      description: 'Get plain-language recommendations on exact quantities to order from your suppliers.',
      tag: 'Phase 3 Preview',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Header / Brand Bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-extrabold text-slate-900">Shop</span>
                <span className="text-xl font-extrabold text-emerald-600">Pulse</span>
              </div>
              <p className="text-[10px] font-semibold text-slate-500">Retail Intelligence Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setActivePage('login')}>
              Log In
            </Button>
            <Button variant="primary" size="sm" onClick={() => setActivePage('signup')}>
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-12 sm:py-20 px-4 max-w-5xl mx-auto text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold mb-6 shadow-xs">
          <Store className="w-4 h-4 text-emerald-700" />
          <span>Select your business & ShopPulse adapts to your store</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black text-slate-900 tracking-tight leading-tight max-w-4xl">
          Run your retail shop <span className="text-emerald-600">smarter.</span>
        </h1>

        <p className="mt-5 text-lg sm:text-xl text-slate-600 max-w-2xl font-medium leading-relaxed">
          ShopPulse helps small and medium product-based retailers track sales, manage stock, and make smarter restocking decisions with minimal manual work.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center">
          <Button 
            variant="primary" 
            size="lg" 
            onClick={() => setActivePage('select-store')}
            icon={<ArrowRight className="w-5 h-5" />}
          >
            Select Business & Launch
          </Button>

          <Button 
            variant="outline" 
            size="lg" 
            onClick={() => setActivePage('dashboard')}
          >
            Demo Dashboard
          </Button>
        </div>

        <p className="mt-3 text-xs font-semibold text-slate-500">
          Designed for everyday shop owners. No complicated setup required.
        </p>
      </section>

      {/* 14 Business Types Section */}
      <section className="bg-white py-12 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Tailored for 14 Product-Based Retail Types</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-6">
            One platform that adapts to your store
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {BUSINESS_TYPE_OPTIONS.map((type) => (
              <button
                key={type.id}
                onClick={() => setActivePage('select-store')}
                className="p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-slate-800 hover:text-emerald-900 transition-all flex flex-col items-center gap-1.5 cursor-pointer text-center group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">{type.emoji}</span>
                <span className="text-xs font-bold leading-tight">{type.name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Everything your retail business needs
          </h2>
          <p className="mt-2 text-slate-600 font-medium">
            Designed for quick navigation and fast daily usage across devices.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <div 
                key={feat.title}
                className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                      {feat.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{feat.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="mt-auto bg-white border-t border-slate-200 py-8 px-4 text-center">
        <p className="text-sm font-semibold text-slate-700">
          ShopPulse &copy; {new Date().getFullYear()} — Retail Intelligence Platform
        </p>
        <p className="text-xs text-slate-500 mt-1">
          "Don't just track your stock. Know what to do next."
        </p>
      </footer>
    </div>
  );
};
