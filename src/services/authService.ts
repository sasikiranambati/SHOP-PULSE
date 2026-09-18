/**
 * @file authService.ts
 * @description Production-grade Authentication and User Profile service methods using Firebase Auth & Firestore.
 * Belongs in `src/services/authService.ts`.
 */

import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getDocument, updateDocument } from './firestoreHelpers';
import type { UserProfile, RegisterInput, LoginCredentials } from '../types/user';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const USERS_COLLECTION = 'users';

// Initialize Local Session Persistence
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('Could not set auth persistence:', err);
});

/**
 * Fetch current authenticated user profile from Firestore.
 */
export async function getCurrentUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    return await getDocument<Omit<UserProfile, 'id'>>(USERS_COLLECTION, uid);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Sign in existing user with email and password.
 */
export async function signInWithEmail({ email, password }: LoginCredentials): Promise<UserProfile | null> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const now = new Date().toISOString();

    // Update lastLogin timestamp in Firestore
    await updateDocument(USERS_COLLECTION, uid, { lastLogin: now });

    return await getCurrentUserProfile(uid);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Sign in or sign up with Google Auth provider.
 * Automatically creates a Firestore shop profile if one does not exist.
 */
export async function signInWithGoogle(): Promise<UserProfile> {
  try {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    const user = userCredential.user;
    const now = new Date().toISOString();

    const existingProfile = await getCurrentUserProfile(user.uid);

    if (existingProfile) {
      // Update last login without overwriting shop details
      await updateDocument(USERS_COLLECTION, user.uid, { lastLogin: now });
      return { ...existingProfile, lastLogin: now };
    }

    // Create new automatic profile for Google user
    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'Shop Owner',
      ownerName: user.displayName || 'Shop Owner',
      shopName: `${user.displayName || 'My'} Shop`,
      businessType: 'General Store',
      role: 'owner',
      phone: user.phoneNumber || '',
      photoURL: user.photoURL || undefined,
      theme: 'light',
      language: 'en',
      createdAt: now,
      lastLogin: now
    };

    await setDoc(doc(db, USERS_COLLECTION, user.uid), newProfile);
    return newProfile;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Register a new user with Email and Password.
 * Automatically creates Firestore document `users/{uid}`.
 */
export async function registerWithEmail(input: RegisterInput): Promise<UserProfile> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    const uid = userCredential.user.uid;
    const now = new Date().toISOString();

    const profile: UserProfile = {
      uid,
      email: input.email,
      displayName: input.displayName,
      ownerName: input.ownerName || input.displayName,
      shopName: input.shopName,
      phone: input.phone || '',
      businessType: input.businessType || 'General Store',
      role: 'owner',
      theme: input.theme || 'light',
      language: input.language || 'en',
      createdAt: now,
      lastLogin: now
    };

    await setDoc(doc(db, USERS_COLLECTION, uid), profile);
    return profile;
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Send password reset email to user.
 */
export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Sign out current user safely.
 */
export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth);
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
 * Get current authenticated Firebase User.
 */
export function getCurrentUser(): FirebaseUser | null {
  return auth.currentUser;
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
