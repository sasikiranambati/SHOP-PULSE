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
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getDocument, updateDocument } from './firestoreHelpers';
import type { UserProfile, RegisterInput, LoginCredentials } from '../types/user';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const USERS_COLLECTION = 'users';

/**
 * Sign in existing user with email and password.
 */
export async function loginWithEmail({ email, password }: LoginCredentials): Promise<UserProfile | null> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return getCurrentUserProfile(userCredential.user.uid);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Register a new user and create their Firestore profile document.
 */
export async function registerWithEmail(input: RegisterInput): Promise<UserProfile> {
  try {
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

    await setDoc(doc(db, USERS_COLLECTION, uid), profile);
    return profile;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Sign out current authenticated user.
 */
export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Fetch UserProfile document from Firestore by UID.
 */
export async function getCurrentUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    return await getDocument<Omit<UserProfile, 'id'>>(USERS_COLLECTION, uid);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Update UserProfile document fields in Firestore.
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
  try {
    await updateDocument(USERS_COLLECTION, uid, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
