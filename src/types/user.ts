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
 * User profile document stored in Firestore.
 */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  shopName: string;
  businessType: BusinessType;
  role: UserRole;
  phoneNumber?: string;
  photoURL?: string;
  createdAt: string;
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
  shopName: string;
  businessType: BusinessType;
}
