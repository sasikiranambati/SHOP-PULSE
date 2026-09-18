import React, { useState } from 'react';
import { Activity, UserPlus, ArrowLeft } from 'lucide-react';
import { Button } from '../components/Button';
import type { PageRoute, BusinessType } from '../types';

interface SignupProps {
  setActivePage: (page: PageRoute) => void;
  onSignupSuccess: (shopName: string) => void;
}

export const Signup: React.FC<SignupProps> = ({ setActivePage, onSignupSuccess }) => {
  const [ownerName, setOwnerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('Kirana Store');

  const businessOptions: BusinessType[] = [
    'Kirana Store',
    'Bakery',
    'Pharmacy',
    'Tea Stall',
    'Supermarket',
    'Other',
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSignupSuccess(shopName || 'My Retail Shop');
    setActivePage('dashboard');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 relative">
      
      {/* Top Back Link */}
      <button 
        onClick={() => setActivePage('landing')}
        className="absolute top-6 left-6 flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Home</span>
      </button>

      <div className="max-w-lg w-full bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-md my-8">
        
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm mb-3">
            <Activity className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Create Shop Account</h1>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-1">Start managing your store with ShopPulse</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                Owner Name *
              </label>
              <input
                type="text"
                required
                placeholder="Ramesh Gupta"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
                Shop Name *
              </label>
              <input
                type="text"
                required
                placeholder="Gupta Kirana Store"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              Business Type *
            </label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium bg-white"
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
              Phone Number or Email *
            </label>
            <input
              type="text"
              required
              placeholder="9876543210"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1">
              Create Password *
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>

          <Button 
            type="submit" 
            variant="primary" 
            size="lg" 
            className="w-full mt-2 font-black py-3.5"
            icon={<UserPlus className="w-5 h-5" />}
          >
            Create Shop Account
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 text-center">
          <p className="text-xs sm:text-sm text-slate-600 font-semibold">
            Already registered?{' '}
            <button
              onClick={() => setActivePage('login')}
              className="text-emerald-700 font-black hover:underline cursor-pointer"
            >
              Log in here
            </button>
          </p>
        </div>

      </div>
    </div>
  );
};
