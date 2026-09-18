/**
 * @file authService.ts
 * @description Authentication and User Profile service methods using Firebase Auth & Firestore.
 * Belongs in `src/services/authService.ts`.
 */

import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { UserProfile, RegisterInput, LoginCredentials } from '../types/user';

/**
 * Sign in existing user with email and password.
 */
export async function loginWithEmail({ email, password }: LoginCredentials): Promise<UserProfile | null> {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return getCurrentUserProfile(userCredential.user.uid);
}

/**
 * Register a new user and create their Firestore profile document.
 */
export async function registerWithEmail(input: RegisterInput): Promise<UserProfile> {
  const userCredential = await createUserWithEmailAndPassword(auth, input.email, input.password);
  const uid = userCredential.user.uid;

  const profile: UserProfile = {
    uid,
    email: input.email,
    displayName: input.displayName,
    shopName: input.shopName,
    businessType: input.businessType,
    role: 'owner',
    createdAt: new Date().toISOString()
  };

  await setDoc(doc(db, 'users', uid), profile);
  return profile;
}

/**
 * Sign out current authenticated user.
 */
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Fetch UserProfile document from Firestore by UID.
 */
export async function getCurrentUserProfile(uid: string): Promise<UserProfile | null> {
  const docRef = doc(db, 'users', uid);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data() as UserProfile;
  }
  return null;
}

/**
 * Update UserProfile document fields in Firestore.
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
  const docRef = doc(db, 'users', uid);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
