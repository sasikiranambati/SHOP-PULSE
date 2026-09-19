/**
 * @file AuthContext.tsx
 * @description React Authentication & User Profile Context Provider for ShopPulse.
 * Belongs in `src/context/AuthContext.tsx`.
 */

import React, { createContext, useEffect, useState, useCallback } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { UserProfile, LoginCredentials, RegisterInput, UserLanguage, UserTheme } from '../types/user';
import { 
  onAuthUserChanged, 
  getCurrentUserProfile, 
  signInWithEmail, 
  signInWithGoogle as googleSignIn,
  registerWithEmail, 
  signOutUser,
  resetPassword as sendPasswordReset,
  updateUserProfile as updateProfileDoc
} from '../services/authService';

export interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials, rememberMe?: boolean) => Promise<UserProfile | null>;
  loginWithGoogle: () => Promise<UserProfile>;
  register: (input: RegisterInput) => Promise<UserProfile>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  setLanguage: (lang: UserLanguage) => Promise<void>;
  setTheme: (theme: UserTheme) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (uid: string) => {
    try {
      const profile = await getCurrentUserProfile(uid);
      if (profile) {
        setUserProfile(profile);
        if (profile.theme) {
          localStorage.setItem('shoppulse_theme', profile.theme);
          if (profile.theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
        if (profile.language) {
          localStorage.setItem('shoppulse_language', profile.language);
        }
      } else {
        // Fallback user profile in case Firestore document has not propagated yet
        setUserProfile((prev) => prev || {
          uid,
          email: '',
          displayName: 'Shop Owner',
          ownerName: 'Shop Owner',
          shopName: 'My Shop',
          businessType: 'General Store',
          role: 'owner',
          theme: 'light',
          language: 'en',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn('Could not load user profile document:', err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthUserChanged(async (user) => {
      setFirebaseUser(user);
      if (user) {
        await fetchProfile(user.uid);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfile]);

  const handleLogin = async (credentials: LoginCredentials, rememberMe = false): Promise<UserProfile | null> => {
    setError(null);
    try {
      const profile = await signInWithEmail(credentials, rememberMe);
      setUserProfile(profile);
      return profile;
    } catch (err: any) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  const handleGoogleLogin = async (): Promise<UserProfile> => {
    setError(null);
    try {
      const profile = await googleSignIn();
      setUserProfile(profile);
      return profile;
    } catch (err: any) {
      setError(err.message || 'Google Login failed');
      throw err;
    }
  };

  const handleRegister = async (input: RegisterInput): Promise<UserProfile> => {
    setError(null);
    try {
      const profile = await registerWithEmail(input);
      setUserProfile(profile);
      return profile;
    } catch (err: any) {
      setError(err.message || 'Registration failed');
      throw err;
    }
  };

  const handleLogout = async (): Promise<void> => {
    setError(null);
    try {
      await signOutUser();
    } finally {
      setUserProfile(null);
      setFirebaseUser(null);
      sessionStorage.removeItem('shoppulse_active_page');
      localStorage.removeItem('shoppulse_active_page');
    }
  };

  const handleResetPassword = async (email: string): Promise<void> => {
    setError(null);
    try {
      await sendPasswordReset(email);
    } catch (err: any) {
      setError(err.message || 'Password reset request failed');
      throw err;
    }
  };

  const handleRefreshProfile = async (): Promise<void> => {
    if (firebaseUser) {
      await fetchProfile(firebaseUser.uid);
    }
  };

  const handleUpdateProfile = async (updates: Partial<UserProfile>): Promise<void> => {
    if (!firebaseUser) throw new Error('User is not logged in.');
    await updateProfileDoc(firebaseUser.uid, updates);
    setUserProfile(prev => prev ? { ...prev, ...updates } : null);
  };

  const handleSetLanguage = async (language: UserLanguage): Promise<void> => {
    localStorage.setItem('shoppulse_language', language);
    if (firebaseUser && userProfile) {
      await handleUpdateProfile({ language });
    }
  };

  const handleSetTheme = async (theme: UserTheme): Promise<void> => {
    localStorage.setItem('shoppulse_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (firebaseUser && userProfile) {
      await handleUpdateProfile({ theme });
    }
  };

  const user: UserProfile | null = userProfile || (firebaseUser ? {
    uid: firebaseUser.uid,
    email: firebaseUser.email || '',
    displayName: firebaseUser.displayName || 'Shop Owner',
    shopName: 'My Store',
    role: 'owner' as const,
    theme: 'light' as const,
    language: 'en' as const,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } : null);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        user,
        loading,
        error,
        login: handleLogin,
        loginWithGoogle: handleGoogleLogin,
        register: handleRegister,
        logout: handleLogout,
        resetPassword: handleResetPassword,
        refreshProfile: handleRefreshProfile,
        updateProfile: handleUpdateProfile,
        setLanguage: handleSetLanguage,
        setTheme: handleSetTheme
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
