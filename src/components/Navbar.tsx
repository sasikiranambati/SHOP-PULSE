import React from 'react';
import { Activity, LogOut, User } from 'lucide-react';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { PageRoute, StoreProfile } from '../types';

interface NavbarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  profile: StoreProfile;
  isLoggedIn?: boolean;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  profile,
  isLoggedIn = true,
  onLogout,
}) => {
  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === profile.businessTypeId) || BUSINESS_TYPE_OPTIONS[0];

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo & Tagline */}
        <div 
          onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-extrabold text-slate-900 tracking-tight">Shop</span>
              <span className="text-xl font-extrabold text-emerald-600 tracking-tight">Pulse</span>
            </div>
            <p className="hidden sm:block text-[10px] font-semibold text-slate-500 leading-none">
              Retail Intelligence Platform
            </p>
          </div>
        </div>

        {/* Action Controls & Store Badge */}
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <>
              {/* Store Badge */}
              <button 
                onClick={() => setActivePage('profile')}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold transition-colors cursor-pointer"
                title="View & Edit Store Profile"
              >
                <span className="text-base">{activeOption.emoji}</span>
                <span>{profile.shopName}</span>
                <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">
                  {activeOption.name}
                </span>
              </button>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setActivePage('profile')}
                  className={`p-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
                    activePage === 'profile'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title="Profile Settings"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden md:inline">Profile</span>
                </button>

                <button 
                  onClick={() => setActivePage('landing')}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors hidden md:inline-block"
                >
                  Landing
                </button>

                <button
                  onClick={onLogout}
                  title="Logout"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivePage('login')}
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => setActivePage('signup')}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
              >
                Create Account
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
