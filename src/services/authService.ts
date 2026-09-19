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
  browserLocalPersistence,
  browserSessionPersistence
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
const REMEMBER_ME_KEY = 'shoppulse_remember_me';

/**
 * Check if the user opted in to Remember Me.
 */
export function isRememberMeActive(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Set Firebase auth persistence mode dynamically.
 */
export async function applyAuthPersistence(rememberMe = false): Promise<void> {
  try {
    const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);
  } catch (err) {
    console.warn('Could not set auth persistence:', err);
  }
}

// Initialize Local Session Persistence safely
try {
  const remembered = isRememberMeActive();
  setPersistence(auth, remembered ? browserLocalPersistence : browserSessionPersistence).catch(err => {
    console.warn('Could not set initial auth persistence:', err);
  });
  // If Remember Me was not set to true, clear any lingering stale local session to avoid bypassing login
  if (!remembered) {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    localStorage.removeItem('shoppulse_active_page');
  }
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

export function getLocalSession(): UserProfile | null {
  try {
    // Check sessionStorage first for current tab/window session
    const sessionRaw = sessionStorage.getItem(LOCAL_SESSION_KEY);
    if (sessionRaw) {
      return JSON.parse(sessionRaw);
    }

    // Only inspect localStorage if Remember Me was explicitly chosen
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

export function saveLocalSession(profile: UserProfile | null, rememberMe = false) {
  try {
    if (profile) {
      sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profile));
      if (rememberMe) {
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profile));
        localStorage.setItem(REMEMBER_ME_KEY, 'true');
      } else {
        localStorage.removeItem(LOCAL_SESSION_KEY);
        localStorage.setItem(REMEMBER_ME_KEY, 'false');
      }
    } else {
      sessionStorage.removeItem(LOCAL_SESSION_KEY);
      sessionStorage.removeItem('shoppulse_active_page');
      localStorage.removeItem(LOCAL_SESSION_KEY);
      localStorage.removeItem(REMEMBER_ME_KEY);
      localStorage.removeItem('shoppulse_active_page');
    }
    window.dispatchEvent(new CustomEvent('shoppulse_auth_changed'));
  } catch (err) {
    console.warn('Could not save local session:', err);
  }
}

let testingActiveUid: string | null = null;

/**
 * Override active user ID for automated test suites.
 */
export function setActiveUserIdForTesting(uid: string | null): void {
  testingActiveUid = uid;
}

/**
 * Get active user ID (from Firebase Auth, active local session, or test override).
 */
export function getActiveUserId(): string | null {
  if (testingActiveUid !== null) {
    return testingActiveUid;
  }
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  const session = getLocalSession();
  return session?.uid || null;
}

/**
 * Require active user ID or throw a user-friendly error.
 */
export function requireActiveUserId(): string {
  const uid = getActiveUserId();
  if (!uid) {
    throw new Error('User not authenticated. Please log in to access your shop data.');
  }
  return uid;
}

/**
 * Initialize a new user workspace: creates user document, empty subcollections / local storage entries,
 * and sets default analytics values.
 */
export async function initializeUserWorkspace(uid: string, profile: UserProfile): Promise<void> {
  // 1. Initialize local storage isolation keys for this UID
  try {
    const invKey = `shoppulse_inventory_products_${uid}`;
    const salesKey = `shoppulse_sales_history_${uid}`;
    const alertsKey = `shoppulse_alerts_cache_${uid}`;
    const cacheKey = `shoppulse_dashboard_cache_${uid}`;

    if (!localStorage.getItem(invKey)) {
      localStorage.setItem(invKey, JSON.stringify([]));
    }
    if (!localStorage.getItem(salesKey)) {
      localStorage.setItem(salesKey, JSON.stringify([]));
    }
    if (!localStorage.getItem(alertsKey)) {
      localStorage.setItem(alertsKey, JSON.stringify([]));
    }
    if (!localStorage.getItem(cacheKey)) {
      localStorage.setItem(cacheKey, JSON.stringify({
        todayRevenue: 0,
        totalOrdersToday: 0,
        itemsSoldToday: 0,
        activeAlertsCount: 0,
        recentSales: [],
        timestamp: Date.now()
      }));
    }
  } catch (lsErr) {
    console.warn('Could not initialize local storage workspace:', lsErr);
  }

  // 2. Initialize Firestore workspace documents if Firebase is active
  if (!isDemoApiKey()) {
    try {
      const userDocRef = doc(db, USERS_COLLECTION, uid);
      await setDoc(userDocRef, profile, { merge: true });

      // Profile subcollection (users/{uid}/profile/main)
      const profileSubRef = doc(db, USERS_COLLECTION, uid, 'profile', 'main');
      await setDoc(profileSubRef, profile, { merge: true });

      // Analytics defaults (users/{uid}/analytics/summary)
      const analyticsDocRef = doc(db, USERS_COLLECTION, uid, 'analytics', 'summary');
      await setDoc(analyticsDocRef, {
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        itemsSold: 0,
        topProducts: [],
        lowStockProducts: [],
        dailySales: [],
        weeklySales: [],
        monthlySales: [],
        estimatedProfit: 0,
        generatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (fsErr) {
      console.warn('Could not initialize Firestore user workspace:', fsErr);
    }
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
  initializeUserWorkspace(uid, profile);

  return profile;
}

function signInLocalUser({ email, password }: LoginCredentials, rememberMe = false): UserProfile {
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
  saveLocalSession(profile, rememberMe);

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
export async function signInWithEmail(
  { email, password }: LoginCredentials,
  rememberMe = false
): Promise<UserProfile | null> {
  await applyAuthPersistence(rememberMe);

  if (isDemoApiKey()) {
    return signInLocalUser({ email, password }, rememberMe);
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

    saveLocalSession(resolvedProfile, rememberMe);
    return resolvedProfile;
  } catch (err: any) {
    const errStr = (err?.code || err?.message || '') + '';
    if (errStr.includes('api-key-not-valid') || errStr.includes('invalid-api-key')) {
      return signInLocalUser({ email, password }, rememberMe);
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
    await initializeUserWorkspace(user.uid, newProfile);
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

    await initializeUserWorkspace(uid, profile);
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
