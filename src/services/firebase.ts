/**
 * @file firebase.ts
 * @description Core Firebase Initialization Module for ShopPulse.
 * Configures Firebase Auth, Firestore with Hardened Offline Persistence, and Cloud Storage.
 * Belongs in `src/services/firebase.ts`.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { 
  initializeFirestore, 
  getFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  CACHE_SIZE_UNLIMITED,
  enableNetwork as firestoreEnableNetwork,
  disableNetwork as firestoreDisableNetwork,
  waitForPendingWrites as firestoreWaitForPendingWrites
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import type { FirebaseStorage } from 'firebase/storage';

/**
 * Firebase Configuration object powered strictly by environment variables.
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}) as Record<string, string | undefined>;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDemoKeyForShopPulseDevelopmentOnly",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "shoppulse-dev.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "shoppulse-dev",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "shoppulse-dev.appspot.com",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789012",
  appId: env.VITE_FIREBASE_APP_ID || "1:123456789012:web:abcdef1234567890"
};

/**
 * Singleton instance of FirebaseApp.
 */
export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Firebase Authentication Instance.
 */
export const auth: Auth = getAuth(app);

/**
 * Cloud Firestore Database Instance with Multi-Tab Persistent Local Cache.
 */
let firestoreInstance: Firestore;

try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
      cacheSizeBytes: CACHE_SIZE_UNLIMITED
    })
  });
} catch (err) {
  console.warn('Firestore offline multi-tab persistence initialization failed, falling back to standard Firestore instance:', err);
  firestoreInstance = getFirestore(app);
}

export const db: Firestore = firestoreInstance;

/**
 * Firebase Cloud Storage Instance.
 */
export const storage: FirebaseStorage = getStorage(app);

/**
 * Programmatically disable Firestore network connectivity (useful for offline simulation & testing).
 */
export async function disableFirestoreNetwork(): Promise<void> {
  try {
    await firestoreDisableNetwork(db);
  } catch (err) {
    console.warn('Could not disable Firestore network:', err);
  }
}

/**
 * Programmatically enable Firestore network connectivity and resume syncing.
 */
export async function enableFirestoreNetwork(): Promise<void> {
  try {
    await firestoreEnableNetwork(db);
  } catch (err) {
    console.warn('Could not enable Firestore network:', err);
  }
}

/**
 * Wait until all offline writes in the local cache have been acknowledged by the server.
 */
export async function waitForPendingFirestoreWrites(): Promise<void> {
  try {
    await firestoreWaitForPendingWrites(db);
  } catch (err) {
    console.warn('Error waiting for pending Firestore writes:', err);
  }
}
