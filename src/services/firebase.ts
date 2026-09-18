/**
 * @file firebase.ts
 * @description Firebase application initialization and service instances.
 * Belongs in `src/services/firebase.ts`.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * Firebase configuration object read from environment variables
 * with safe fallback values for development environment.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDemoKeyForShopPulseDevelopmentOnly",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "shoppulse-dev.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "shoppulse-dev",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "shoppulse-dev.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789012",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789012:web:abcdef1234567890"
};

/**
 * Singleton instance of FirebaseApp.
 */
export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Firebase Authentication instance.
 */
export const auth: Auth = getAuth(app);

/**
 * Cloud Firestore Database instance.
 */
export const db: Firestore = getFirestore(app);
