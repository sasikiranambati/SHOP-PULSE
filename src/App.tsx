import { useState, useEffect } from 'react';
import type { PageRoute, Product } from './types';
import { useAuth } from './hooks/useAuth';
import { useInventory } from './hooks/useInventory';
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';

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
import { Settings } from './pages/Settings';

export function App() {
  const { firebaseUser, userProfile, loading, logout } = useAuth();
  const { products, addProduct, updateProduct, deleteProduct, increaseStock } = useInventory();

  const [activePage, setActivePageState] = useState<PageRoute>(() => {
    try {
      const saved = localStorage.getItem('shoppulse_active_page') as PageRoute | null;
      const validPages: PageRoute[] = [
        'landing', 'login', 'signup', 'dashboard', 'sales', 'inventory', 'scanner', 'insights', 'settings'
      ];
      if (saved && validPages.includes(saved)) {
        return saved;
      }
    } catch {
      // Ignore localStorage read errors
    }
    return 'landing';
  });

  const setActivePage = (page: PageRoute) => {
    setActivePageState(page);
    try {
      localStorage.setItem('shoppulse_active_page', page);
    } catch {
      // Ignore localStorage write errors
    }
  };

  const [shopName, setShopName] = useState('Kiran General Store');

  // Sync shop name from authenticated user profile
  useEffect(() => {
    if (userProfile?.shopName) {
      setShopName(userProfile.shopName);
    }
  }, [userProfile]);

  // Handle persistent session transitions & route guarding
  useEffect(() => {
    if (loading) return;

    if (firebaseUser) {
      // Logged in: skip landing, login, or signup and go straight to dashboard
      if (activePage === 'landing' || activePage === 'login' || activePage === 'signup') {
        setActivePage('dashboard');
      }
    } else {
      // Not logged in: protect internal dashboard pages
      const protectedPages: PageRoute[] = ['dashboard', 'inventory', 'sales', 'scanner', 'insights', 'settings'];
      if (protectedPages.includes(activePage)) {
        setActivePage('login');
      }
    }
  }, [firebaseUser, loading, activePage]);

  const handleAddProduct = async (newProd: Omit<Product, 'id'>) => {
    try {
      await addProduct({
        name: newProd.name,
        category: newProd.category,
        stock: newProd.stock,
        unit: newProd.unit,
        sellingPrice: newProd.sellingPrice ?? newProd.price,
        purchasePrice: newProd.purchasePrice ?? 0,
        reorderLevel: newProd.reorderLevel ?? newProd.minStock ?? 10,
        imageUrl: newProd.imageUrl,
        barcode: newProd.barcode,
      });
    } catch (err) {
      console.error('Failed to add product in App:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.warn('Error during logout:', err);
    }
    setActivePage('login');
  };

  // Loading screen while checking session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-600">Verifying session...</p>
        </div>
      </div>
    );
  }

  // Render non-dashboard full-frame pages
  if (activePage === 'landing') {
    if (firebaseUser) {
      return (
        <PublicOnlyRoute setActivePage={setActivePage} targetPage="dashboard">
          <Landing setActivePage={setActivePage} />
        </PublicOnlyRoute>
      );
    }
    return <Landing setActivePage={setActivePage} />;
  }

  if (activePage === 'login') {
    return (
      <PublicOnlyRoute setActivePage={setActivePage} targetPage="dashboard">
        <Login
          setActivePage={setActivePage}
          onLoginSuccess={(name) => {
            setShopName(name || 'Kiran General Store');
          }}
        />
      </PublicOnlyRoute>
    );
  }

  if (activePage === 'signup') {
    return (
      <PublicOnlyRoute setActivePage={setActivePage} targetPage="dashboard">
        <Signup
          setActivePage={setActivePage}
          onSignupSuccess={(name) => {
            setShopName(name || 'Kiran General Store');
          }}
        />
      </PublicOnlyRoute>
    );
  }

  // Render app inside DashboardLayout for main app pages (Protected)
  return (
    <ProtectedRoute setActivePage={setActivePage} fallbackPage="login">
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
            onRestock={increaseStock}
            onUpdateProduct={updateProduct}
            onDeleteProduct={deleteProduct}
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

        {activePage === 'settings' && (
          <Settings
            shopName={shopName}
            setActivePage={setActivePage}
            onLogout={handleLogout}
          />
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default App;
