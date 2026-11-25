/**
 * Browser harness for Stage 7.5: the real Dashboard and Insights pages with the signed-in user's role
 * (localStorage shoppulse_role) and the real API client (token in localStorage shoppulse_token).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import { LanguageProvider } from '../../../src/i18n/LanguageContext';
import { AuthContext } from '../../../src/context/authContextDef';
import type { AuthContextType } from '../../../src/context/AuthContext';
import { Dashboard } from '../../../src/pages/Dashboard';
import { Insights } from '../../../src/pages/Insights';
import type { PageRoute } from '../../../src/types';
import type { UserRole } from '../../../src/types/user';

export function InsightsHarness() {
  const role = (localStorage.getItem('shoppulse_role') || 'owner') as UserRole;
  const [page, setPage] = useState<PageRoute>('dashboard');
  const auth = {
    firebaseUser: { uid: 'test_uid' } as any,
    userProfile: { role, uid: 'test_uid', email: 'test@example.com' } as any,
    user: { role, uid: 'test_uid', email: 'test@example.com' } as any,
    loading: false,
    error: null,
  } as unknown as AuthContextType;
  return (
    <AuthContext.Provider value={auth}>
      <LanguageProvider>
        <main className="p-3 sm:p-6 min-h-screen" data-page={page}>
          {page === 'insights' ? <Insights /> : <Dashboard setActivePage={setPage} products={[]} shopName="Test Shop" />}
        </main>
      </LanguageProvider>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<InsightsHarness />);
