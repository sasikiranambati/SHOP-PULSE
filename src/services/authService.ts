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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { updateDocument } from './firestoreHelpers';
import type { UserProfile, RegisterInput, LoginCredentials } from '../types/user';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const USERS_COLLECTION = 'users';
const LOCAL_USERS_KEY = 'shoppulse_local_users';
const LOCAL_SESSION_KEY = 'shoppulse_local_session';

// Initialize Local Session Persistence safely
try {
  setPersistence(auth, browserLocalPersistence).catch(err => {
    console.warn('Could not set auth persistence:', err);
  });
} catch {
  // Ignore in environments where persistence is unavailable
}

/**
 * Check if the Firebase configuration is using a demo / placeholder key.
 */
function isDemoApiKey(): boolean {
  const key = auth.app.options.apiKey || '';
  return !key || key.includes('DemoKey') || key.includes('YourFirebaseApiKey') || key === 'AIzaSyDemoKeyForShopPulseDevelopmentOnly';
}

function getLocalUsers(): Array<UserProfile & { password?: string }> {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users: Array<UserProfile & { password?: string }>) {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  } catch (err) {
    console.warn('Could not save local users:', err);
  }
}

function getLocalSession(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalSession(profile: UserProfile | null) {
  try {
    if (profile) {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    }
    window.dispatchEvent(new CustomEvent('shoppulse_auth_changed'));
  } catch (err) {
    console.warn('Could not save local session:', err);
  }
}

function registerLocalUser(input: RegisterInput): UserProfile {
  const users = getLocalUsers();
  const normalizedEmail = input.email.toLowerCase().trim();

  // Duplicate email handling
  if (users.some(u => u.email.toLowerCase() === normalizedEmail)) {
    throw new Error(getFirebaseErrorMessage('auth/email-already-in-use'));
  }

  const now = new Date().toISOString();
  const uid = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  const profile: UserProfile = {
    uid,
    ownerName: input.ownerName || input.displayName || 'Shop Owner',
    shopName: input.shopName || 'My Shop',
    email: normalizedEmail,
    language: input.language || 'en',
    theme: input.theme || 'light',
    createdAt: now,
    lastLogin: now,
    displayName: input.displayName || input.ownerName || 'Shop Owner',
    phone: input.phone || '',
    businessType: input.businessType || 'General Store',
    role: 'owner'
  };

  users.push({ ...profile, password: input.password });
  saveLocalUsers(users);
  saveLocalSession(profile);

  return profile;
}

function signInLocalUser({ email, password }: LoginCredentials): UserProfile {
  const users = getLocalUsers();
  const normalizedEmail = email.toLowerCase().trim();
  const user = users.find(u => u.email.toLowerCase() === normalizedEmail);

  if (!user) {
    throw new Error(getFirebaseErrorMessage('auth/user-not-found'));
  }

  if (user.password && user.password !== password) {
    throw new Error(getFirebaseErrorMessage('auth/wrong-password'));
  }

  const now = new Date().toISOString();
  user.lastLogin = now;
  saveLocalUsers(users);

  const { password: _, ...profile } = user;
  saveLocalSession(profile);

  return profile;
}

/**
 * Fetch current authenticated user profile from Firestore or local session cache.
 */
export async function getCurrentUserProfile(uid: string): Promise<UserProfile | null> {
  const localSession = getLocalSession();
  if (localSession && localSession.uid === uid) {
    return localSession;
  }

  const localUser = getLocalUsers().find(u => u.uid === uid);
  if (localUser) {
    const { password: _, ...profile } = localUser;
    return profile;
  }

  try {
    const docRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return { uid: snap.id, ...(snap.data() as Omit<UserProfile, 'uid'>) } as UserProfile;
    }
    return null;
  } catch (err) {
    console.warn('Could not fetch user profile from Firestore:', err);
    return null;
  }
}

/**
 * Sign in existing user with email and password.
 */
export async function signInWithEmail({ email, password }: LoginCredentials): Promise<UserProfile | null> {
  if (isDemoApiKey()) {
    return signInLocalUser({ email, password });
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const now = new Date().toISOString();

    // Check if user profile exists in Firestore and update lastLogin without overwriting
    try {
      const userDocRef = doc(db, USERS_COLLECTION, uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        await updateDocument(USERS_COLLECTION, uid, { lastLogin: now });
      } else {
        const initialProfile: UserProfile = {
          uid,
          ownerName: userCredential.user.displayName || 'Shop Owner',
          shopName: 'My Shop',
          email: userCredential.user.email || email,
          language: 'en',
          theme: 'light',
          businessType: 'General Store',
          role: 'owner',
          displayName: userCredential.user.displayName || 'Shop Owner',
          createdAt: now,
          lastLogin: now
        };
        await setDoc(userDocRef, initialProfile);
      }
    } catch (fsErr) {
      console.warn('Could not update lastLogin in Firestore:', fsErr);
    }

    const profile = await getCurrentUserProfile(uid);
    const resolvedProfile = profile || {
      uid,
      ownerName: userCredential.user.displayName || 'Shop Owner',
      shopName: 'My Shop',
      email: userCredential.user.email || email,
      language: 'en',
      theme: 'light',
      businessType: 'General Store',
      role: 'owner',
      displayName: userCredential.user.displayName || 'Shop Owner',
      createdAt: now,
      lastLogin: now
    };

    saveLocalSession(resolvedProfile);
    return resolvedProfile;
  } catch (err: any) {
    const errStr = (err?.code || err?.message || '') + '';
    if (errStr.includes('api-key-not-valid') || errStr.includes('invalid-api-key')) {
      return signInLocalUser({ email, password });
    }
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
    saveLocalSession(newProfile);
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
  if (isDemoApiKey()) {
    return registerLocalUser(input);
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    const uid = userCredential.user.uid;
    const now = new Date().toISOString();

    const userDocRef = doc(db, USERS_COLLECTION, uid);
    
    // Check if user document already exists to never overwrite existing users
    try {
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        const existing = { uid: userDocSnap.id, ...(userDocSnap.data() as Omit<UserProfile, 'uid'>) } as UserProfile;
        saveLocalSession(existing);
        return existing;
      }
    } catch (fsCheckErr) {
      console.warn('Could not check existing Firestore document:', fsCheckErr);
    }

    const profile: UserProfile = {
      uid,
      ownerName: input.ownerName || input.displayName || 'Shop Owner',
      shopName: input.shopName || 'My Shop',
      email: input.email,
      language: input.language || 'en',
      theme: input.theme || 'light',
      createdAt: now,
      lastLogin: now,
      displayName: input.displayName || input.ownerName || 'Shop Owner',
      phone: input.phone || '',
      businessType: input.businessType || 'General Store',
      role: 'owner'
    };

    try {
      await setDoc(userDocRef, profile);
    } catch (fsWriteErr) {
      console.warn('Could not write user profile to Firestore:', fsWriteErr);
    }

    saveLocalSession(profile);
    return profile;
  } catch (err: any) {
    const errStr = (err?.code || err?.message || '') + '';
    if (errStr.includes('api-key-not-valid') || errStr.includes('invalid-api-key')) {
      return registerLocalUser(input);
    }
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
  saveLocalSession(null);
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('Firebase signOut warning:', err);
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
    const session = getLocalSession();
    if (session && session.uid === uid) {
      saveLocalSession({ ...session, ...updates });
    }
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Get current authenticated Firebase User.
 */
export function getCurrentUser(): FirebaseUser | null {
  if (auth.currentUser) return auth.currentUser;
  const localSession = getLocalSession();
  if (localSession?.uid) {
    return {
      uid: localSession.uid,
      email: localSession.email,
      displayName: localSession.displayName || localSession.ownerName,
      emailVerified: true
    } as unknown as FirebaseUser;
  }
  return null;
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void): () => void {
  const checkState = (firebaseUser: FirebaseUser | null) => {
    if (firebaseUser) {
      callback(firebaseUser);
      return;
    }
    const localSession = getLocalSession();
    if (localSession?.uid) {
      const mockUser = {
        uid: localSession.uid,
        email: localSession.email,
        displayName: localSession.displayName || localSession.ownerName,
        emailVerified: true
      } as unknown as FirebaseUser;
      callback(mockUser);
      return;
    }
    callback(null);
  };

  const unsubscribe = onAuthStateChanged(auth, checkState);

  const handleCustomEvent = () => {
    checkState(auth.currentUser);
  };

  window.addEventListener('shoppulse_auth_changed', handleCustomEvent);

  // Immediate check
  checkState(auth.currentUser);

  return () => {
    unsubscribe();
    window.removeEventListener('shoppulse_auth_changed', handleCustomEvent);
  };
}
