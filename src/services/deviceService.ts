/**
 * @file deviceService.ts
 * @description Connected device registration and telemetry tracking service using shared helpers.
 * Belongs in `src/services/deviceService.ts`.
 */

import { where } from 'firebase/firestore';
import { 
  getCollection, 
  addDocument, 
  updateDocument 
} from './firestoreHelpers';
import type { Device, RegisterDeviceInput, DeviceStatus } from '../types/device';
import { getFirebaseErrorMessage } from '../utils/firebaseErrorMapper';

const DEVICES_COLLECTION = 'devices';

/**
 * Fetch all registered hardware/mobile devices for a shop.
 */
export async function getShopDevices(shopId: string = 'default'): Promise<Device[]> {
  try {
    return await getCollection<Omit<Device, 'id'>>(DEVICES_COLLECTION, [
      where('shopId', '==', shopId)
    ]);
  } catch (err) {
    console.warn('Error fetching shop devices:', getFirebaseErrorMessage(err));
    return [];
  }
}

/**
 * Register a new device (mobile app, barcode scanner, POS terminal).
 */
export async function registerDevice(shopId: string, input: RegisterDeviceInput): Promise<Device> {
  try {
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

    return await addDocument<Omit<Device, 'id'>>(DEVICES_COLLECTION, deviceData);
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}

/**
 * Update the active status of a device.
 */
export async function updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<void> {
  try {
    await updateDocument(DEVICES_COLLECTION, deviceId, {
      status,
      lastActive: new Date().toISOString()
    });
  } catch (err) {
    throw new Error(getFirebaseErrorMessage(err));
  }
}
