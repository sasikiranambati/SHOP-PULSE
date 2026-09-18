/**
 * @file firestoreHelpers.ts
 * @description Generic, reusable Firestore CRUD helper functions for ShopPulse backend services.
 * Belongs in `src/services/firestoreHelpers.ts`.
 */

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  QueryConstraint 
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Add a new document to a specified Firestore collection.
 */
export async function addDocument<T extends object>(
  collectionName: string, 
  data: T
): Promise<T & { id: string }> {
  const colRef = collection(db, collectionName);
  const docRef = await addDoc(colRef, data);
  return { id: docRef.id, ...data };
}

/**
 * Update an existing document by ID in a Firestore collection.
 */
export async function updateDocument<T extends object>(
  collectionName: string, 
  id: string, 
  updates: Partial<T>
): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await updateDoc(docRef, updates as any);
}

/**
 * Delete a document by ID from a Firestore collection.
 */
export async function deleteDocument(
  collectionName: string, 
  id: string
): Promise<void> {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
}

/**
 * Fetch a single document by ID from a Firestore collection.
 */
export async function getDocument<T extends object>(
  collectionName: string, 
  id: string
): Promise<(T & { id: string }) | null> {
  const docRef = doc(db, collectionName, id);
  const snapshot = await getDoc(docRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...(snapshot.data() as T) };
  }
  return null;
}

/**
 * Query and fetch all matching documents from a Firestore collection.
 */
export async function getCollection<T extends object>(
  collectionName: string, 
  constraints: QueryConstraint[] = []
): Promise<Array<T & { id: string }>> {
  const colRef = collection(db, collectionName);
  const q = constraints.length > 0 ? query(colRef, ...constraints) : colRef;
  const snapshot = await getDocs(q);

  return snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as T)
  }));
}
