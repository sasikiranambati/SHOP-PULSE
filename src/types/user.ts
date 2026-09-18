/**
 * @file user.ts
 * @description User and authentication data models for ShopPulse.
 * Belongs in `src/types/user.ts`.
 */

export type UserRole = 'owner' | 'manager' | 'staff';

export type BusinessType = 
  | 'Kirana Store' 
  | 'Bakery' 
  | 'Pharmacy' 
  | 'Tea Stall' 
  | 'Supermarket' 
  | 'General Store'
  | 'Other';

export type UserTheme = 'light' | 'dark';
export type UserLanguage = 'en' | 'te';

/**
 * Authenticated user token payload representation.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  emailVerified: boolean;
}

/**
 * User profile document stored in Firestore (`users/{uid}`).
 */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  ownerName?: string;
  shopName: string;
  phone?: string;
  phoneNumber?: string;
  businessType?: BusinessType;
  role?: UserRole;
  photoURL?: string;
  theme: UserTheme;
  language: UserLanguage;
  createdAt: string;
  lastLogin: string;
  updatedAt?: string;
}

/**
 * Login credentials input.
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * User registration form input.
 */
export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  ownerName?: string;
  shopName: string;
  phone?: string;
  businessType?: BusinessType;
  language?: UserLanguage;
  theme?: UserTheme;
}
