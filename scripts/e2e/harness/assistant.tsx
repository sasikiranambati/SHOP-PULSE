/**
 * Browser harness for the business assistant: the real AiChatBox with the signed-in user's role
 * (localStorage shoppulse_role) and the real API client (token in localStorage shoppulse_token).
 */
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import { LanguageProvider } from '../../../src/i18n/LanguageContext';
import { AuthContext } from '../../../src/context/authContextDef';
import type { AuthContextType } from '../../../src/context/AuthContext';
import { AiChatBox } from '../../../src/components/AiChatBox';
import type { UserRole } from '../../../src/types/user';

export function AssistantHarness() {
  const role = (localStorage.getItem('shoppulse_role') || 'owner') as UserRole;
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
        <main className="min-h-screen p-6">
          <h1>Assistant harness ({role})</h1>
        </main>
        <AiChatBox />
      </LanguageProvider>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<AssistantHarness />);
