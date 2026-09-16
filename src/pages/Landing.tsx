import React from 'react';
import { 
  Activity, 
  ShoppingCart, 
  ScanLine, 
  TrendingUp, 
  Zap, 
  ArrowRight, 
  CheckCircle2
} from 'lucide-react';

import { Button } from '../components/Button';
import type { PageRoute } from '../types';

interface LandingProps {
  setActivePage: (page: PageRoute) => void;
}

export const Landing: React.FC<LandingProps> = ({ setActivePage }) => {
  const businessTypes = [
    'Kirana Stores',
    'Bakeries',
    'Pharmacies',
    'Tea Stalls',
    'Supermarkets',
    'General Stores',
  ];

  const features = [
    {
      icon: ShoppingCart,
      title: 'Quick Sales Entry',
      description: 'Record sales in seconds with simple tap selectors designed for busy checkout counters.',
      tag: 'UI Ready',
    },
    {
      icon: ScanLine,
      title: 'Invoice Scanning',
      description: 'Snap photos of supplier paper bills to automatically track stock without manual typing.',
      tag: 'Preview',
    },
    {
      icon: TrendingUp,
      title: 'Demand Forecasting',
      description: 'Know what will sell tomorrow before you run out of stock based on past sales history.',
      tag: 'Future AI',
    },
    {
      icon: Zap,
      title: 'Smart Reordering',
      description: 'Get plain-language recommendations on exact quantities to order from your suppliers.',
      tag: 'Future AI',
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
              <p className="text-[10px] font-semibold text-slate-500">Know what to do next</p>
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
        <h1 className="text-4xl sm:text-6xl font-black text-slate-900 tracking-tight leading-tight max-w-3xl">

          Run your shop <span className="text-emerald-600">smarter.</span>
        </h1>

        <p className="mt-5 text-lg sm:text-xl text-slate-600 max-w-2xl font-medium leading-relaxed">
          ShopPulse helps retailers track sales, manage inventory, and make smarter restocking decisions with less manual work.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full max-w-sm justify-center">
          <Button 
            variant="primary" 
            size="lg" 
            onClick={() => setActivePage('dashboard')}
            icon={<ArrowRight className="w-5 h-5" />}
          >
            Launch Shop Dashboard
          </Button>
        </div>

        <p className="mt-3 text-xs font-semibold text-slate-500">
          No complicated setups. Designed for everyday shop owners.
        </p>
      </section>

      {/* Business Types Pill Section */}
      <section className="bg-white py-6 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4">
            Tailored for your business
          </p>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            {businessTypes.map((type) => (
              <span
                key={type}
                className="px-4 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-sm font-semibold flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {type}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Everything your shop needs in one place
          </h2>
          <p className="mt-2 text-slate-600 font-medium">
            Designed for quick navigation and fast daily usage.
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
