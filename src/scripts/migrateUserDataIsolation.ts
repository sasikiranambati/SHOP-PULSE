/**
 * @file migrateUserDataIsolation.ts
 * @description Safe data migration utility to copy legacy global collections into the
 * isolated user schema: `users/{uid}/...` without deleting any original source records.
 * Belongs in `src/scripts/migrateUserDataIsolation.ts`.
 */

import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getActiveUserId } from '../services/authService';

export interface MigrationSummary {
  userId: string;
  productsMigrated: number;
  salesMigrated: number;
  alertsMigrated: number;
  errors: string[];
  durationMs: number;
}

/**
 * Migrates legacy root-level Firestore collections (products, sales, alerts)
 * into a specific user's isolated subcollections:
 * - `products` -> `users/{uid}/inventory`
 * - `sales` -> `users/{uid}/sales`
 * - `alerts` / `inventory_alerts` -> `users/{uid}/alerts`
 *
 * NOTE: This is a NON-DESTRUCTIVE operation. Original root collections are never deleted.
 */
export async function migrateLegacyDataToUser(targetUid?: string): Promise<MigrationSummary> {
  const uid = targetUid || getActiveUserId();
  const startTime = Date.now();

  if (!uid) {
    throw new Error('Migration failed: No target user UID provided and no user currently logged in.');
  }

  const summary: MigrationSummary = {
    userId: uid,
    productsMigrated: 0,
    salesMigrated: 0,
    alertsMigrated: 0,
    errors: [],
    durationMs: 0
  };

  console.log(`[ShopPulse Migration] Starting user data isolation migration for UID: ${uid}...`);

  // 1. Migrate Products -> users/{uid}/inventory
  try {
    const productsSnap = await getDocs(collection(db, 'products'));
    for (const prodDoc of productsSnap.docs) {
      try {
        const destRef = doc(db, 'users', uid, 'inventory', prodDoc.id);
        await setDoc(destRef, {
          ...prodDoc.data(),
          migratedFromLegacy: true,
          migratedAt: new Date().toISOString()
        }, { merge: true });
        summary.productsMigrated++;
      } catch (err: any) {
        summary.errors.push(`Product ${prodDoc.id}: ${err.message}`);
      }
    }
    console.log(`[ShopPulse Migration] Successfully copied ${summary.productsMigrated} products.`);
  } catch (err: any) {
    console.warn('[ShopPulse Migration] Notice: Could not read legacy products (may already be empty or blocked):', err.message);
  }

  // 2. Migrate Sales -> users/{uid}/sales
  try {
    const salesSnap = await getDocs(collection(db, 'sales'));
    for (const saleDoc of salesSnap.docs) {
      try {
        const destRef = doc(db, 'users', uid, 'sales', saleDoc.id);
        await setDoc(destRef, {
          ...saleDoc.data(),
          migratedFromLegacy: true,
          migratedAt: new Date().toISOString()
        }, { merge: true });
        summary.salesMigrated++;
      } catch (err: any) {
        summary.errors.push(`Sale ${saleDoc.id}: ${err.message}`);
      }
    }
    console.log(`[ShopPulse Migration] Successfully copied ${summary.salesMigrated} sales.`);
  } catch (err: any) {
    console.warn('[ShopPulse Migration] Notice: Could not read legacy sales (may already be empty or blocked):', err.message);
  }

  // 3. Migrate Alerts -> users/{uid}/alerts
  try {
    const alertsSnap = await getDocs(collection(db, 'alerts'));
    for (const alertDoc of alertsSnap.docs) {
      try {
        const destRef = doc(db, 'users', uid, 'alerts', alertDoc.id);
        await setDoc(destRef, {
          ...alertDoc.data(),
          migratedFromLegacy: true,
          migratedAt: new Date().toISOString()
        }, { merge: true });
        summary.alertsMigrated++;
      } catch (err: any) {
        summary.errors.push(`Alert ${alertDoc.id}: ${err.message}`);
      }
    }
    console.log(`[ShopPulse Migration] Successfully copied ${summary.alertsMigrated} alerts.`);
  } catch (err: any) {
    console.warn('[ShopPulse Migration] Notice: Could not read legacy alerts (may already be empty or blocked):', err.message);
  }

  summary.durationMs = Date.now() - startTime;
  console.log(`[ShopPulse Migration] Completed in ${summary.durationMs}ms. Summary:`, summary);

  return summary;
}

// Expose migration helper on window in browser for dev/ops access
if (typeof window !== 'undefined') {
  (window as any).__shoppulse_migrate = migrateLegacyDataToUser;
}
