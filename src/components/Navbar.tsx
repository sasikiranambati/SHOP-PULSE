import React from 'react';
import { Activity, Bell, User, LogOut, Store } from 'lucide-react';
import type { PageRoute } from '../types';

interface NavbarProps {
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName?: string;
  isLoggedIn?: boolean;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  setActivePage,
  shopName = 'Kiran General Store',
  isLoggedIn = true,
  onLogout,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Mobile Compact Header / Brand Logo */}
        <div 
          onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Shop</span>
              <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">Pulse</span>
            </div>
            <p className="text-[10px] font-semibold text-slate-500 leading-none truncate max-w-[140px] sm:max-w-none">
              {shopName}
            </p>
          </div>
        </div>

        {/* Action Controls & Store Info */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isLoggedIn ? (
            <>
              {/* Desktop Store Tag */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                <Store className="w-4 h-4 text-emerald-600" />
                <span>{shopName}</span>
              </div>

              {/* Notification Icon */}
              <button
                onClick={() => setActivePage('dashboard')}
                title="Notifications"
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer relative"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white"></span>
              </button>

              {/* Mobile Profile & Logout */}
              <button
                onClick={() => setActivePage('settings')}
                title="Shop Profile & Settings"
                className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition-colors cursor-pointer font-bold text-xs"
              >
                <User className="w-4 h-4" />
              </button>

              <button
                onClick={onLogout}
                title="Logout"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivePage('login')}
                className="px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 rounded-xl transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => setActivePage('signup')}
                className="px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs"
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
