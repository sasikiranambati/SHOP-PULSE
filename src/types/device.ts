/**
 * @file device.ts
 * @description Connected hardware devices, POS terminals, and mobile scanner interfaces.
 * Belongs in `src/types/device.ts`.
 */

export type DeviceType = 'mobile_app' | 'pos_terminal' | 'barcode_scanner' | 'web_browser';

export type DeviceStatus = 'active' | 'inactive' | 'pending';

/**
 * Linked hardware or mobile device model.
 */
export interface Device {
  id: string;
  shopId: string;
  name: string;
  type: DeviceType;
  ipAddress?: string;
  lastActive: string;
  status: DeviceStatus;
  registeredAt: string;
  appVersion?: string;
}

/**
 * Input for registering a new device.
 */
export interface RegisterDeviceInput {
  name: string;
  type: DeviceType;
  appVersion?: string;
}
