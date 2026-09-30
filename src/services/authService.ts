/**
 * @file authService.ts
 * @description Production-grade Authentication and User Profile service integrated with ShopPulse FastAPI backend.
 * Belongs in `src/services/authService.ts`.
 */

import type { UserProfile, RegisterInput, LoginCredentials, BusinessType } from '../types/user';
import { authApi } from '../api/auth';
import { shopsApi } from '../api/shops';
import { getAccessToken } from '../api/client';

const LOCAL_SESSION_KEY = 'shoppulse_local_session';
const REMEMBER_ME_KEY = 'shoppulse_remember_me';

export function isRememberMeActive(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function applyAuthPersistence(rememberMe = false): Promise<void> {
  try {
    localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');
  } catch {
    // Ignore error
  }
}

export function getLocalSession(): UserProfile | null {
  try {
    const sessionRaw = sessionStorage.getItem(LOCAL_SESSION_KEY);
    if (sessionRaw) {
      return JSON.parse(sessionRaw);
    }
    if (isRememberMeActive()) {
      const localRaw = localStorage.getItem(LOCAL_SESSION_KEY);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        sessionStorage.setItem(LOCAL_SESSION_KEY, localRaw);
        return parsed;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocalSession(profile: UserProfile | null, rememberMe = false, emitEvent = true): void {
  try {
    if (profile) {
      sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profile));
      if (rememberMe || isRememberMeActive()) {
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profile));
        localStorage.setItem(REMEMBER_ME_KEY, 'true');
      } else {
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    } else {
      sessionStorage.removeItem(LOCAL_SESSION_KEY);
      sessionStorage.removeItem('shoppulse_active_page');
      localStorage.removeItem(LOCAL_SESSION_KEY);
      localStorage.removeItem(REMEMBER_ME_KEY);
      localStorage.removeItem('shoppulse_active_page');
    }
    if (emitEvent) {
      window.dispatchEvent(new CustomEvent('shoppulse_auth_changed'));
    }
  } catch (err) {
    console.warn('Could not save local session:', err);
  }
}

let testingActiveUid: string | null = null;

export function setActiveUserIdForTesting(uid: string | null): void {
  testingActiveUid = uid;
}

export function getActiveUserId(): string | null {
  if (testingActiveUid !== null) {
    return testingActiveUid;
  }
  const session = getLocalSession();
  return session?.uid || null;
}

export function requireActiveUserId(): string {
  const uid = getActiveUserId();
  if (!uid) {
    throw new Error('User is not authenticated. Please log in.');
  }
  return uid;
}

function mapFrontendToBackendBusinessType(type?: string): string {
  if (!type) return 'Grocery/Kirana';
  const lower = type.toLowerCase();
  if (lower.includes('bakery')) return 'Bakery';
  if (lower.includes('pharm') || lower.includes('med')) return 'Medical/Pharmacy';
  if (lower.includes('tea') || lower.includes('coffee')) return 'Tea/Coffee Shop';
  if (lower.includes('sweet')) return 'Sweet Shop';
  if (lower.includes('fruit') || lower.includes('veg')) return 'Fruit & Vegetable Store';
  if (lower.includes('mobile') || lower.includes('electronic')) return 'Mobile & Electronics Accessories';
  if (lower.includes('stationery') || lower.includes('book')) return 'Stationery & Book Store';
  if (lower.includes('hardware')) return 'Hardware Store';
  if (lower.includes('electrical')) return 'Electrical Store';
  if (lower.includes('cosmetic')) return 'Cosmetics & Personal Care';
  if (lower.includes('household')) return 'Household & General Store';
  if (lower.includes('plant') || lower.includes('garden')) return 'Plant & Gardening Store';
  if (lower.includes('kirana') || lower.includes('grocery') || lower.includes('supermarket')) return 'Grocery/Kirana';
  return 'Other Retail Store';
}

function mapBackendToFrontendBusinessType(type?: string): BusinessType {
  if (!type) return 'Kirana Store';
  const lower = type.toLowerCase();
  if (lower.includes('bakery')) return 'Bakery';
  if (lower.includes('pharm') || lower.includes('med')) return 'Pharmacy';
  if (lower.includes('tea') || lower.includes('coffee')) return 'Tea Stall';
  if (lower.includes('supermarket')) return 'Supermarket';
  if (lower.includes('general')) return 'General Store';
  if (lower.includes('kirana') || lower.includes('grocery')) return 'Kirana Store';
  return 'Other';
}

/**
 * Register a new user and shop profile against the backend.
 */
export async function registerWithEmail(input: RegisterInput): Promise<UserProfile> {
  const email = input.email.trim().toLowerCase();
  
  // 1. Register with backend
  await authApi.register(email, input.password);

  // 2. Login to acquire JWT access token
  await authApi.login(email, input.password);

  // 3. Get created user profile
  const user = await authApi.getProfile();

  // 4. Create user shop profile
  const mappedType = mapFrontendToBackendBusinessType(input.businessType);
  const shopName = input.shopName?.trim() || 'My Shop';
  const ownerName = input.ownerName?.trim() || input.displayName?.trim() || 'Shop Owner';

  let shop;
  try {
    shop = await shopsApi.createShop({
      shop_name: shopName,
      owner_name: ownerName,
      business_type: mappedType,
      location: input.phone || undefined,
    });
  } catch (err: any) {
    console.warn('Shop creation error (may already exist):', err);
    try {
      shop = await shopsApi.getMyShop();
    } catch {
      shop = null;
    }
  }

  const now = new Date().toISOString();
  const profile: UserProfile = {
    uid: user.id,
    email: user.email,
    displayName: ownerName,
    ownerName: ownerName,
    shopName: shop?.shop_name || shopName,
    businessType: mapBackendToFrontendBusinessType(shop?.business_type || mappedType),
    phone: input.phone || '',
    role: 'owner',
    theme: input.theme || 'light',
    language: input.language || 'en',
    createdAt: user.created_at || now,
    lastLogin: now,
  };

  saveLocalSession(profile, false);
  return profile;
}

/**
 * Sign in existing user with email and password using backend JWT.
 */
export async function signInWithEmail(
  { email, password }: LoginCredentials,
  rememberMe = false
): Promise<UserProfile | null> {
  await applyAuthPersistence(rememberMe);

  const normalizedEmail = email.trim().toLowerCase();
  // 1. Login to acquire JWT
  await authApi.login(normalizedEmail, password);

  // 2. Get user profile
  const user = await authApi.getProfile();

  // 3. Get user's shop profile
  let shop;
  try {
    shop = await shopsApi.getMyShop();
  } catch (shopErr) {
    try {
      shop = await shopsApi.createShop({
        shop_name: 'My Shop',
        owner_name: 'Shop Owner',
        business_type: 'Grocery/Kirana',
      });
    } catch {
      shop = null;
    }
  }

  const now = new Date().toISOString();
  const profile: UserProfile = {
    uid: user.id,
    email: user.email,
    displayName: shop?.owner_name || 'Shop Owner',
    ownerName: shop?.owner_name || 'Shop Owner',
    shopName: shop?.shop_name || 'My Shop',
    businessType: mapBackendToFrontendBusinessType(shop?.business_type),
    phone: shop?.location || '',
    role: 'owner',
    theme: (localStorage.getItem('shoppulse_theme') as any) || 'light',
    language: (localStorage.getItem('shoppulse_language') as any) || 'en',
    createdAt: user.created_at || now,
    lastLogin: now,
  };

  saveLocalSession(profile, rememberMe);
  return profile;
}

/**
 * Fetch current user profile.
 */
export async function getCurrentUserProfile(_uid?: string): Promise<UserProfile | null> {
  const token = getAccessToken();
  if (!token) {
    return getLocalSession();
  }

  try {
    const user = await authApi.getProfile();
    let shop;
    try {
      shop = await shopsApi.getMyShop();
    } catch {
      shop = null;
    }

    const cached = getLocalSession();
    const profile: UserProfile = {
      uid: user.id,
      email: user.email,
      displayName: shop?.owner_name || cached?.displayName || 'Shop Owner',
      ownerName: shop?.owner_name || cached?.ownerName || 'Shop Owner',
      shopName: shop?.shop_name || cached?.shopName || 'My Shop',
      businessType: mapBackendToFrontendBusinessType(shop?.business_type || cached?.businessType),
      phone: shop?.location || cached?.phone || '',
      role: 'owner',
      theme: cached?.theme || (localStorage.getItem('shoppulse_theme') as any) || 'light',
      language: cached?.language || (localStorage.getItem('shoppulse_language') as any) || 'en',
      createdAt: user.created_at || cached?.createdAt || new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    saveLocalSession(profile, isRememberMeActive(), false);
    return profile;
  } catch (err) {
    return getLocalSession();
  }
}

/**
 * Log out user and clear all auth state.
 */
export async function signOutUser(): Promise<void> {
  authApi.logout();
  saveLocalSession(null);
}

/**
 * Subscribe to auth state changes.
 */
export function onAuthUserChanged(callback: (user: any) => void): () => void {
  const token = getAccessToken();
  if (token) {
    getCurrentUserProfile()
      .then((profile) => {
        if (profile) {
          callback({ uid: profile.uid, email: profile.email, displayName: profile.displayName });
        } else {
          callback(null);
        }
      })
      .catch(() => callback(null));
  } else {
    const local = getLocalSession();
    if (local) {
      callback({ uid: local.uid, email: local.email, displayName: local.displayName });
    } else {
      callback(null);
    }
  }

  const handleAuthChange = () => {
    const current = getLocalSession();
    if (current && getAccessToken()) {
      callback({ uid: current.uid, email: current.email, displayName: current.displayName });
    } else {
      callback(null);
    }
  };

  const handleExpired = () => {
    signOutUser();
    callback(null);
  };

  window.addEventListener('shoppulse_auth_changed', handleAuthChange);
  window.addEventListener('shoppulse_auth_expired', handleExpired);

  return () => {
    window.removeEventListener('shoppulse_auth_changed', handleAuthChange);
    window.removeEventListener('shoppulse_auth_expired', handleExpired);
  };
}

/**
 * Update user / shop profile in the backend.
 */
export async function updateUserProfile(_uid: string, updates: Partial<UserProfile>): Promise<void> {
  try {
    const shop = await shopsApi.getMyShop();
    if (shop) {
      await shopsApi.updateShop(shop.id, {
        shop_name: updates.shopName,
        owner_name: updates.ownerName || updates.displayName,
        business_type: updates.businessType ? mapFrontendToBackendBusinessType(updates.businessType) : undefined,
      });
    }
  } catch (err) {
    console.warn('Could not update backend shop profile:', err);
  }

  const current = getLocalSession();
  if (current) {
    const updated = { ...current, ...updates };
    saveLocalSession(updated, isRememberMeActive());
  }
}

/**
 * Initialize workspace helper for backward compatibility.
 */
export function initializeUserWorkspace(_uid: string, _profile?: any): void {
  // Backend automatically initializes tables and user scope
}

/**
 * Password reset placeholder.
 */
export async function resetPassword(email: string): Promise<void> {
  console.info('Password reset requested for:', email);
}

/**
 * Google Sign In placeholder for backend integration.
 */
export async function signInWithGoogle(): Promise<UserProfile> {
  throw new Error('Google Sign-In is not configured for the local backend. Please use email and password.');
}
