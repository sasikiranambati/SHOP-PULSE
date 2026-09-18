/**
 * @file useTheme.ts
 * @description Custom React hook to access and toggle light/dark UI themes.
 * Belongs in `src/hooks/useTheme.ts`.
 */

import { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';
import type { ThemeContextType } from '../context/ThemeContext';

/**
 * Access ThemeContext state.
 * @throws {Error} if used outside of a <ThemeProvider>.
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return context;
}
