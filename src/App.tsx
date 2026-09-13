import { useState } from 'react';
import type { PageRoute, StoreProfile, BusinessTypeId, Product } from './types';
import { getMockDataForBusiness } from './data/mockData';

// Layouts
import { DashboardLayout } from './layouts/DashboardLayout';

// Pages
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { SelectStore } from './pages/SelectStore';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Sales } from './pages/Sales';
import { InvoiceScanner } from './pages/InvoiceScanner';
import { Insights } from './pages/Insights';
import { Profile } from './pages/Profile';

export function App() {
  const [activePage, setActivePage] = useState<PageRoute>('landing');
  
  // Store profile state
  const [profile, setProfile] = useState<StoreProfile>({
    shopName: 'Gupta Kirana Store',
    ownerName: 'Ramesh Gupta',
    businessTypeId: 'grocery',
    location: 'Mumbai, MH',
    contact: '+91 98765 43210',
  });

  // Dynamic mock data based on active business type
  const activeMockData = getMockDataForBusiness(profile.businessTypeId);
  const [customProducts, setCustomProducts] = useState<Product[] | null>(null);

  const currentProducts = customProducts || activeMockData.products;

  const handleSelectBusiness = (businessId: BusinessTypeId, defaultStoreName: string) => {
    setProfile((prev) => ({
      ...prev,
      businessTypeId: businessId,
      shopName: prev.shopName === 'Gupta Kirana Store' || prev.shopName === 'My Retail Store'
        ? defaultStoreName 
        : prev.shopName,
    }));
    setCustomProducts(null); // Reset custom items to load new template
  };

  const handleUpdateProfile = (updated: Partial<StoreProfile>) => {
    if (updated.businessTypeId && updated.businessTypeId !== profile.businessTypeId) {
      setCustomProducts(null); // Reset products if store type changes
    }
    setProfile((prev) => ({ ...prev, ...updated }));
  };

  const handleAddProduct = (newProd: Omit<Product, 'id'>) => {
    const created: Product = {
      ...newProd,
      id: `p_${Date.now()}`,
    };
    setCustomProducts([created, ...currentProducts]);
  };

  const handleLogout = () => {
    setActivePage('landing');
  };

  // Full frame pages outside DashboardLayout
  if (activePage === 'landing') {
    return <Landing setActivePage={setActivePage} />;
  }

  if (activePage === 'login') {
    return (
      <Login
        setActivePage={setActivePage}
        onLoginSuccess={(name) => {
          setProfile((prev) => ({ ...prev, shopName: name }));
        }}
      />
    );
  }

  if (activePage === 'signup') {
    return (
      <Signup
        setActivePage={setActivePage}
        onSignupDetails={(ownerName, shopName, contact) => {
          setProfile((prev) => ({
            ...prev,
            ownerName,
            shopName,
            contact,
          }));
        }}
      />
    );
  }

  if (activePage === 'select-store') {
    return (
      <SelectStore
        setActivePage={setActivePage}
        selectedBusinessId={profile.businessTypeId}
        onSelectBusiness={handleSelectBusiness}
      />
    );
  }

  // Dashboard pages wrapped in DashboardLayout
  return (
    <DashboardLayout
      activePage={activePage}
      setActivePage={setActivePage}
      profile={profile}
      onLogout={handleLogout}
    >
      {activePage === 'dashboard' && (
        <Dashboard
          setActivePage={setActivePage}
          profile={profile}
          products={currentProducts}
          recommendations={activeMockData.recommendations}
          recentSales={activeMockData.recentSales}
        />
      )}

      {activePage === 'inventory' && (
        <Inventory
          products={currentProducts}
          onAddProduct={handleAddProduct}
          profile={profile}
        />
      )}

      {activePage === 'sales' && (
        <Sales
          products={currentProducts}
          profile={profile}
        />
      )}

      {activePage === 'scanner' && (
        <InvoiceScanner profile={profile} />
      )}

      {activePage === 'insights' && (
        <Insights
          profile={profile}
          topSelling={activeMockData.topSelling}
        />
      )}

      {activePage === 'profile' && (
        <Profile
          profile={profile}
          onUpdateProfile={handleUpdateProfile}
          setActivePage={setActivePage}
        />
      )}
    </DashboardLayout>
  );
}

export default App;
