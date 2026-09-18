/**
 * @file useAuth.ts
 * @description Custom React hook to access authentication state and methods.
 * Belongs in `src/hooks/useAuth.ts`.
 */

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import type { AuthContextType } from '../context/AuthContext';

/**
 * Access AuthContext state.
 * @throws {Error} if used outside of <AuthProvider>.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}
