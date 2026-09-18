/**
 * @file AuthContext.tsx
 * @description React Authentication Context Provider for ShopPulse.
 * Belongs in `src/context/AuthContext.tsx`.
 */

import React, { createContext, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { UserProfile, LoginCredentials, RegisterInput } from '../types/user';
import { 
  onAuthUserChanged, 
  getCurrentUserProfile, 
  loginWithEmail, 
  registerWithEmail, 
  logoutUser 
} from '../services/authService';

export interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<UserProfile | null>;
  register: (input: RegisterInput) => Promise<UserProfile>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthUserChanged(async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const profile = await getCurrentUserProfile(user.uid);
          setUserProfile(profile);
        } catch (err) {
          console.warn('Could not fetch user profile on auth change:', err);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async (credentials: LoginCredentials): Promise<UserProfile | null> => {
    setError(null);
    try {
      const profile = await loginWithEmail(credentials);
      setUserProfile(profile);
      return profile;
    } catch (err: any) {
      setError(err.message || 'Login failed');
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
    await logoutUser();
    setUserProfile(null);
    setFirebaseUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        loading,
        error,
        login: handleLogin,
        register: handleRegister,
        logout: handleLogout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
