/**
 * @file deviceService.ts
 * @description Connected device registration and telemetry tracking service.
 * Belongs in `src/services/deviceService.ts`.
 */

import { collection, getDocs, doc, addDoc, updateDoc, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { Device, RegisterDeviceInput, DeviceStatus } from '../types/device';

const DEVICES_COLLECTION = 'devices';

/**
 * Fetch all registered hardware/mobile devices for a shop.
 */
export async function getShopDevices(shopId: string = 'default'): Promise<Device[]> {
  try {
    const colRef = collection(db, DEVICES_COLLECTION);
    const q = query(colRef, where('shopId', '==', shopId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Device, 'id'>)
    }));
  } catch (err) {
    console.warn('Error fetching shop devices:', err);
    return [];
  }
}

/**
 * Register a new device (mobile app, barcode scanner, POS terminal).
 */
export async function registerDevice(shopId: string, input: RegisterDeviceInput): Promise<Device> {
  const now = new Date().toISOString();
  const deviceData: Omit<Device, 'id'> = {
    shopId,
    name: input.name,
    type: input.type,
    status: 'active',
    lastActive: now,
    registeredAt: now,
    appVersion: input.appVersion || '1.0.0'
  };

  const docRef = await addDoc(collection(db, DEVICES_COLLECTION), deviceData);
  return { id: docRef.id, ...deviceData };
}

/**
 * Update the active status of a device.
 */
export async function updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<void> {
  const docRef = doc(db, DEVICES_COLLECTION, deviceId);
  await updateDoc(docRef, {
    status,
    lastActive: new Date().toISOString()
  });
}
