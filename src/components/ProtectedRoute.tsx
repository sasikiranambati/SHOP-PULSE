/**
 * @file ProtectedRoute.tsx
 * @description Route guard component to protect private application pages.
 * Belongs in `src/components/ProtectedRoute.tsx`.
 */

import React from 'react';
import { useAuth } from '../hooks/useAuth';
import type { PageRoute } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  setActivePage?: (page: PageRoute) => void;
  fallbackPage?: PageRoute;
}

/**
 * Guard component that verifies user authentication status.
 * If user is unauthenticated, redirects to login/landing page.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  setActivePage,
  fallbackPage = 'login'
}) => {
  const { firebaseUser, loading } = useAuth();

  React.useEffect(() => {
    if (!loading && !firebaseUser && setActivePage) {
      setActivePage(fallbackPage);
    }
  }, [loading, firebaseUser, setActivePage, fallbackPage]);

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

  if (!firebaseUser) {
    return null;
  }

  return <>{children}</>;
};

/**
 * Public-only guard component that redirects logged-in users away from auth pages.
 */
export const PublicOnlyRoute: React.FC<{
  children: React.ReactNode;
  setActivePage?: (page: PageRoute) => void;
  targetPage?: PageRoute;
}> = ({ children, setActivePage, targetPage = 'dashboard' }) => {
  const { firebaseUser, loading } = useAuth();

  React.useEffect(() => {
    if (!loading && firebaseUser && setActivePage) {
      setActivePage(targetPage);
    }
  }, [loading, firebaseUser, setActivePage, targetPage]);

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

  if (firebaseUser) {
    return null;
  }

  return <>{children}</>;
};
