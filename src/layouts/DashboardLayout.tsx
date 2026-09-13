import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { BottomNav } from '../components/BottomNav';
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
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        shopName={shopName}
        isLoggedIn={true}
        onLogout={onLogout}
      />
      
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 md:pb-12 overflow-x-hidden">
          {children}
        </main>
      </div>

      <BottomNav activePage={activePage} setActivePage={setActivePage} />
    </div>
  );
};
