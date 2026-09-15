import { useState } from 'react';
import type { PageRoute, Product } from './types';
import { INITIAL_PRODUCTS } from './data/mockData';

// Layouts
import { DashboardLayout } from './layouts/DashboardLayout';

// Pages
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Sales } from './pages/Sales';
import { InvoiceScanner } from './pages/InvoiceScanner';
import { Insights } from './pages/Insights';

export function App() {
  const [activePage, setActivePage] = useState<PageRoute>('landing');
  const [shopName, setShopName] = useState('Gupta Kirana Store');
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);

  const handleAddProduct = (newProd: Omit<Product, 'id'>) => {
    const created: Product = {
      ...newProd,
      id: `p_${Date.now()}`,
    };
    setProducts((prev) => [created, ...prev]);
  };

  const handleLogout = () => {
    setActivePage('landing');
  };

  // Render non-dashboard full-frame pages
  if (activePage === 'landing') {
    return <Landing setActivePage={setActivePage} />;
  }

  if (activePage === 'login') {
    return (
      <Login
        setActivePage={setActivePage}
        onLoginSuccess={(name) => {
          setShopName(name);
        }}
      />
    );
  }

  if (activePage === 'signup') {
    return (
      <Signup
        setActivePage={setActivePage}
        onSignupSuccess={(name) => {
          setShopName(name);
        }}
      />
    );
  }

  // Render app inside DashboardLayout for main app pages
  return (
    <DashboardLayout
      activePage={activePage}
      setActivePage={setActivePage}
      shopName={shopName}
      onLogout={handleLogout}
    >
      {activePage === 'dashboard' && (
        <Dashboard
          setActivePage={setActivePage}
          products={products}
          shopName={shopName}
        />
      )}

      {activePage === 'inventory' && (
        <Inventory
          products={products}
          onAddProduct={handleAddProduct}
        />
      )}

      {activePage === 'sales' && (
        <Sales products={products} />
      )}

      {activePage === 'scanner' && (
        <InvoiceScanner />
      )}

      {activePage === 'insights' && (
        <Insights />
      )}
    </DashboardLayout>
  );
}

export default App;
