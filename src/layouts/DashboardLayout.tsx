import React from 'react';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { BottomNav } from '../components/BottomNav';
import { Plus } from 'lucide-react';
import type { PageRoute } from '../types';

interface DashboardLayoutProps {
  children: React.ReactNode;
  activePage: PageRoute;
  setActivePage: (page: PageRoute) => void;
  shopName: string;
  onLogout: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  activePage,
  setActivePage,
  shopName,
  onLogout,
}) => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans relative">
      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        shopName={shopName}
        isLoggedIn={true}
        onLogout={onLogout}
      />
      
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 pb-24 md:pb-12 overflow-x-hidden max-w-full">
          {children}
        </main>
      </div>

      {/* Floating Action Button (FAB) for Mobile Quick Sale */}
      {activePage !== 'sales' && (
        <button
          onClick={() => setActivePage('sales')}
          className="md:hidden fixed bottom-20 right-4 z-40 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-4 py-3 rounded-full shadow-lg shadow-emerald-600/30 flex items-center gap-2 active:scale-95 transition-transform cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm">Sale</span>
        </button>
      )}

      <BottomNav activePage={activePage} setActivePage={setActivePage} />
    </div>
  );
};
