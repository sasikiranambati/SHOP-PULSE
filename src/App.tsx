import { useState, useEffect, lazy, Suspense } from 'react';
import type { SearchOption } from './utils/searchResults';
import type { PageRoute, Product } from './types';
import { useAuth } from './hooks/useAuth';
import { useInventory } from './hooks/useInventory';
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';

// Layouts
import { DashboardLayout } from './layouts/DashboardLayout';

// Pages: Landing remains eager for instant initial paint
import { Landing } from './pages/Landing';

// Code-split heavy routes to prevent massive initial module cascade
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/Signup').then((m) => ({ default: m.Signup })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const Sales = lazy(() => import('./pages/Sales').then((m) => ({ default: m.Sales })));
const InvoiceScanner = lazy(() => import('./pages/InvoiceScanner').then((m) => ({ default: m.InvoiceScanner })));
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

const PageFallback = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center" role="status" aria-live="polite">
    <div className="w-10 h-10 border-4 border-[#234B3A] border-t-transparent rounded-full animate-spin mb-3" />
    <span className="text-sm font-semibold text-[#69736C]">Loading section...</span>
  </div>
);

export function App() {
  const { firebaseUser, userProfile, loading, logout } = useAuth();
  const {
    products,
    loading: productsLoading,
    loadError: productsLoadError,
    refreshInventory,
    addProduct,
    updateProduct,
    deleteProduct,
    increaseStock,
  } = useInventory();

  const [activePage, setActivePageState] = useState<PageRoute>(() => {
    try {
      // Use sessionStorage for active page so opening a fresh browser session doesn't leak 'dashboard'
      const saved = sessionStorage.getItem('shoppulse_active_page') as PageRoute | null;
      const validPages: PageRoute[] = [
        'landing', 'login', 'signup', 'dashboard', 'sales', 'inventory', 'scanner', 'insights', 'settings'
      ];
      if (saved && validPages.includes(saved)) {
        return saved;
      }
    } catch {
      // Ignore sessionStorage read errors
    }
    return 'landing';
  });

  const setActivePage = (page: PageRoute) => {
    setActivePageState(page);
    try {
      sessionStorage.setItem('shoppulse_active_page', page);
      localStorage.removeItem('shoppulse_active_page');
    } catch {
      // Ignore sessionStorage write errors
    }
  };

  const [shopName, setShopName] = useState('Kiran General Store');

  // Requests from global search. Each carries a new key so the page re-mounts once with it.
  const [inventoryRequest, setInventoryRequest] = useState<{ key: number; query: string; highlightId?: string } | null>(null);
  const [saleRequest, setSaleRequest] = useState<{ key: number; saleId: string } | null>(null);

  const handleOpenSearchResult = (option: SearchOption) => {
    if (option.kind === 'product') {
      setInventoryRequest({ key: Date.now(), query: option.hit.name, highlightId: option.id });
      setActivePage('inventory');
    } else if (option.kind === 'sale') {
      setSaleRequest({ key: Date.now(), saleId: option.id });
      setActivePage('sales');
    }
  };

  const handleShowAllProducts = (query: string) => {
    setInventoryRequest({ key: Date.now(), query });
    setActivePage('inventory');
  };

  // Normal navigation (menus, buttons) drops any pending search request, so returning to a
  // page later does not re-apply an old search filter.
  const navigate = (page: PageRoute) => {
    setInventoryRequest(null);
    setSaleRequest(null);
    setActivePage(page);
  };

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
      // Logged in: only redirect auth forms (login, signup) to dashboard
      if (activePage === 'login' || activePage === 'signup') {
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

  // Errors are re-thrown so callers (product form, invoice scanner) never report a failed save as success.
  const handleAddProduct = async (newProd: Omit<Product, 'id'>) => {
    try {
      await addProduct({
        name: newProd.name,
        category: newProd.category,
        stock: newProd.stock,
        unit: newProd.unit,
        sellingPrice: newProd.sellingPrice ?? newProd.price,
        // Undefined when unknown; the service stores it as "not recorded" rather than ₹0.
        purchasePrice: newProd.purchasePrice,
        mrp: newProd.mrp,
        reorderLevel: newProd.reorderLevel ?? newProd.minStock ?? 10,
        imageUrl: newProd.imageUrl,
        barcode: newProd.barcode,
      });
    } catch (err) {
      console.error('Failed to add product in App:', err);
      throw err;
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
    return <Landing setActivePage={setActivePage} />;
  }

  if (activePage === 'login') {
    return (
      <PublicOnlyRoute setActivePage={setActivePage} targetPage="dashboard">
        <Suspense fallback={<PageFallback />}>
          <Login
            setActivePage={setActivePage}
            onLoginSuccess={(name) => {
              setShopName(name || 'Kiran General Store');
            }}
          />
        </Suspense>
      </PublicOnlyRoute>
    );
  }

  if (activePage === 'signup') {
    return (
      <PublicOnlyRoute setActivePage={setActivePage} targetPage="dashboard">
        <Suspense fallback={<PageFallback />}>
          <Signup
            setActivePage={setActivePage}
            onSignupSuccess={(name) => {
              setShopName(name || 'Kiran General Store');
            }}
          />
        </Suspense>
      </PublicOnlyRoute>
    );
  }

  // Render app inside DashboardLayout for main app pages (Protected)
  return (
    <ProtectedRoute setActivePage={navigate} fallbackPage="login">
      <DashboardLayout
        activePage={activePage}
        setActivePage={navigate}
        shopName={shopName}
        onLogout={handleLogout}
        onOpenSearchResult={handleOpenSearchResult}
        onShowAllProducts={handleShowAllProducts}
      >
        <Suspense fallback={<PageFallback />}>
          {activePage === 'dashboard' && (
            <Dashboard
              setActivePage={navigate}
              products={products}
              shopName={shopName}
            />
          )}

          {activePage === 'inventory' && (
            <Inventory
              key={inventoryRequest?.key ?? 'inventory'}
              searchRequest={inventoryRequest}
              shopName={shopName}
              products={products}
              loading={productsLoading}
              loadError={productsLoadError}
              onRetryLoad={refreshInventory}
              onAddProduct={handleAddProduct}
              onRestock={increaseStock}
              onUpdateProduct={updateProduct}
              onDeleteProduct={deleteProduct}
            />
          )}

          {activePage === 'sales' && (
            <Sales
              key={saleRequest?.key ?? 'sales'}
              products={products}
              shopName={shopName}
              focusSaleId={saleRequest?.saleId ?? null}
            />
          )}

          {activePage === 'scanner' && (
            <InvoiceScanner
              products={products}
              onAddProduct={handleAddProduct}
              onRestock={increaseStock}
              setActivePage={navigate}
            />
          )}

          {activePage === 'insights' && (
            <Insights />
          )}

          {activePage === 'settings' && (
            <Settings
              shopName={shopName}
              setActivePage={navigate}
              onLogout={handleLogout}
            />
          )}
        </Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default App;
