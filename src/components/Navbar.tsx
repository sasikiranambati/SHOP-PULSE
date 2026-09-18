import React, { useState } from 'react';
import { Activity, Bell, User, LogOut, Store, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = [
    { id: 1, title: 'Low Stock Alert', text: '3 items (Bread, Milk, Eggs) are low.', time: '10m ago', urgent: true },
    { id: 2, title: 'Smart Counter Event', text: '42 sale events logged automatically.', time: '1h ago', urgent: false },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Brand Logo & Shop Name */}
        <div 
          onClick={() => setActivePage(isLoggedIn ? 'dashboard' : 'landing')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors shrink-0">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Shop</span>
              <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">Pulse</span>
            </div>
            <p className="text-[10px] font-bold text-slate-500 leading-none truncate max-w-[130px] sm:max-w-none">
              {shopName}
            </p>
          </div>
        </div>

        {/* Action Controls & Store Info */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isLoggedIn ? (
            <>
              {/* Desktop Store Tag */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black">
                <Store className="w-4 h-4 text-emerald-600" />
                <span>{shopName}</span>
              </div>

              {/* Notification Popover Icon */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  title="Notifications"
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer relative"
                >
                  <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse"></span>
                </button>

                {/* Notifications Dropdown Panel */}
                {showNotifications && (
                  <div className="absolute right-0 top-12 w-80 bg-white rounded-2xl border border-slate-200 shadow-xl p-3.5 z-50 animate-fade-in">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                      <span className="text-xs font-black text-slate-900 uppercase">Shop Notifications</span>
                      <button 
                        onClick={() => setShowNotifications(false)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            setShowNotifications(false);
                            setActivePage(n.urgent ? 'inventory' : 'dashboard');
                          }}
                          className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                            n.urgent ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between font-extrabold mb-0.5">
                            <span className="flex items-center gap-1">
                              {n.urgent ? <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                              {n.title}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">{n.time}</span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-medium">{n.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile & Settings Action */}
              <button
                onClick={() => setActivePage('settings')}
                title="Shop Profile & Settings"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center transition-colors cursor-pointer font-bold"
              >
                <User className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Logout Button */}
              <button
                onClick={onLogout}
                title="Logout"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActivePage('login')}
                className="px-3 py-1.5 text-xs sm:text-sm font-bold text-slate-700 hover:text-slate-900 rounded-xl transition-colors cursor-pointer"
              >
                Log In
              </button>
              <button
                onClick={() => setActivePage('signup')}
                className="px-3.5 py-2 text-xs sm:text-sm font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-xs cursor-pointer"
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
