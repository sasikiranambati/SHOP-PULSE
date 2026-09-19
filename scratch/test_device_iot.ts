/**
 * @file test_device_iot.ts
 * @description Comprehensive validation script for ShopPulse Phase 7 IoT Features:
 * - Device Service CRUD & Heartbeats
 * - Hardware Button Events (NEW_SALE, ADD_STOCK, LOW_STOCK_BUTTON, CANCEL)
 * - Smart Scale (Live Weight, Tare, Stability Detection, Inventory Auto-calc)
 * - Device Simulator (Weight Settling, Buttons, Battery)
 * - Device Health Monitoring (Offline, Low Battery, Signal, Alert Deduplication)
 * - Firmware & OTA Placeholders
 * - Bluetooth Graceful Fallback
 */

// Node.js environment polyfills for browser storage & event dispatch
if (typeof window === 'undefined') {
  const store = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
  (global as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };
  (global as any).CustomEvent = class {
    constructor(public type: string, public detail?: any) {}
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 Starting ShopPulse Phase 7 IoT System Validation Tests');
  console.log('================================================================\n');

  // Dynamic imports after polyfills
  const { 
    pairDevice, 
    connectDevice, 
    disconnectDevice, 
    getDevices, 
    getDeviceStatus, 
    updateHeartbeat, 
    enableSimulatorMode, 
    recordDeviceEvent,
    getDeviceEvents 
  } = await import('../src/services/deviceService');

  const { scaleService } = await import('../src/services/scaleService');
  const { deviceSimulator } = await import('../src/services/deviceSimulator');
  const { deviceHealthMonitor } = await import('../src/services/deviceHealthMonitor');
  const { firmwareService } = await import('../src/services/firmwareService');
  const { bluetoothService } = await import('../src/services/bluetoothService');
  const { getAlerts } = await import('../src/services/alertService');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, msg: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      throw new Error(`Assertion Failed: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1: Device Management (pair, connect, disconnect, heartbeat, simulator)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 1] Device Service Lifecycle');

  const pairedDevice = await pairDevice({
    deviceName: 'ESP32 Test Counter',
    deviceType: 'SMART_COUNTER',
    connectionType: 'Bluetooth',
    firmwareVersion: '1.2.0',
    batteryLevel: 90,
    signalStrength: -60,
    simulatorMode: true
  });
  assert(pairedDevice.id.startsWith('esp32_'), 'pairDevice generated valid device ID');
  assert(pairedDevice.isConnected === true, 'pairedDevice is marked connected');

  const allDevices = await getDevices();
  assert(allDevices.some(d => d.id === pairedDevice.id), 'getDevices includes newly paired device');

  await disconnectDevice(pairedDevice.id);
  let status = await getDeviceStatus(pairedDevice.id);
  assert(status?.isConnected === false, 'disconnectDevice successfully marked device offline');

  await connectDevice(pairedDevice.id);
  status = await getDeviceStatus(pairedDevice.id);
  assert(status?.isConnected === true, 'connectDevice restored online state');

  await updateHeartbeat(pairedDevice.id, { batteryLevel: 75, signalStrength: -68 });
  status = await getDeviceStatus(pairedDevice.id);
  assert(status?.batteryLevel === 75 && status?.signalStrength === -68, 'updateHeartbeat updated telemetry');

  await enableSimulatorMode(pairedDevice.id, true);
  status = await getDeviceStatus(pairedDevice.id);
  assert(status?.simulatorMode === true, 'enableSimulatorMode toggled simulator state');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 2: Hardware Button Events (NEW_SALE, ADD_STOCK, LOW_STOCK_BUTTON, CANCEL)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 2] Smart Counter Hardware Events');

  const saleEvent = await recordDeviceEvent(pairedDevice.id, {
    eventType: 'NEW_SALE',
    payload: { customer: 'Walk-in Kirana shopper', quickCart: true }
  });
  assert(saleEvent.eventType === 'NEW_SALE', 'NEW_SALE event recorded');
  assert(Boolean(saleEvent.timestamp), 'NEW_SALE event timestamped');

  const stockEvent = await recordDeviceEvent(pairedDevice.id, {
    eventType: 'ADD_STOCK',
    payload: { productName: 'Aashirvaad Atta (5kg)', quantity: 10 }
  });
  assert(stockEvent.eventType === 'ADD_STOCK', 'ADD_STOCK event recorded');

  const lowStockEvent = await recordDeviceEvent(pairedDevice.id, {
    eventType: 'LOW_STOCK_BUTTON',
    payload: { productName: 'Tata Tea Gold (500g)' }
  });
  assert(lowStockEvent.eventType === 'LOW_STOCK_BUTTON', 'LOW_STOCK_BUTTON event recorded');

  const cancelEvent = await recordDeviceEvent(pairedDevice.id, {
    eventType: 'CANCEL',
    payload: { reason: 'Operator pressed cancel button' }
  });
  assert(cancelEvent.eventType === 'CANCEL', 'CANCEL event recorded');

  const recentEvents = await getDeviceEvents(pairedDevice.id, 10);
  assert(recentEvents.length >= 4, 'getDeviceEvents returns recorded hardware event logs');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 3: Smart Scale (Live Weight, Tare, Stability Detection, Auto-calculation)
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 3] Smart Weighing Scale Service');

  scaleService.clearTare();
  let r1 = scaleService.processRawWeight(2.000);
  assert(r1.weight === 2.000, 'processRawWeight updates gross weight to 2.000 kg');
  assert(r1.netWeight === 2.000, 'Initial net weight equals gross weight');

  // Test Tare
  scaleService.tare(0.200); // 200g container tare
  let r2 = scaleService.getLatestReading();
  assert(r2.tare === 0.200, 'tare correctly set to 0.200 kg');
  assert(r2.netWeight === 1.800, 'netWeight correctly calculated as gross - tare (1.800 kg)');

  // Clear Tare
  scaleService.clearTare();
  let r3 = scaleService.processRawWeight(2.000);
  assert(r3.netWeight === 2.000, 'clearTare reset tare back to zero');

  // Test automatic inventory quantity & pricing calculation
  const mockRiceProduct: any = {
    id: 'p_rice_01',
    name: 'Basmati Rice (Loose)',
    unit: 'kg',
    price: 60.00
  };

  const calculated = scaleService.calculateProductQuantity(mockRiceProduct, r3);
  assert(calculated.productName === 'Basmati Rice (Loose)', 'calculateProductQuantity structured product match');
  assert(calculated.quantity === 2.000, 'Quantity accurately corresponds to 2.000 kg');
  assert(calculated.totalPrice === 120.00, 'Total price accurately calculated (2.000 kg * ₹60 = ₹120.00)');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 4: Device Simulator
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 4] High-Fidelity Device Simulator');

  const simSale = await deviceSimulator.triggerNewSale('Demonstration Sale');
  assert(simSale.eventType === 'NEW_SALE', 'Simulator triggerNewSale works');

  const simLowStock = await deviceSimulator.triggerLowStock('Fortune Mustard Oil');
  assert(simLowStock.eventType === 'LOW_STOCK_BUTTON', 'Simulator triggerLowStock works');

  // Test weight settling simulation
  await deviceSimulator.simulateWeight(3.50, 'Sugar (Loose)');
  const scalePostSim = scaleService.getLatestReading();
  assert(scalePostSim.weight === 3.50, 'simulateWeight settled on target weight 3.50 kg');
  assert(scalePostSim.isStable === true, 'simulateWeight marked reading as stable');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 5: Health Monitoring & Alert Deduplication
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 5] Automated Health Monitoring & Alerts');

  // 1. Inspect offline device
  const offlineDev = await pairDevice({
    id: 'esp32_offline_test',
    deviceName: 'ESP32 Offline Sensor',
    deviceType: 'SMART_COUNTER',
    connectionType: 'Bluetooth',
    simulatorMode: true
  });
  await disconnectDevice(offlineDev.id);
  const reloadedOffline = await getDeviceStatus(offlineDev.id);

  if (reloadedOffline) {
    await deviceHealthMonitor.inspectDevice(reloadedOffline);
  }

  const alerts = await getAlerts();
  const offlineAlert = alerts.find(a => a.deviceId === 'esp32_offline_test' && a.type === 'DEVICE_OFFLINE');
  assert(Boolean(offlineAlert), 'Offline device automatically triggered DEVICE_OFFLINE alert');

  // Verify deduplication: inspect again immediately
  const alertCountBefore = alerts.filter(a => a.deviceId === 'esp32_offline_test' && a.type === 'DEVICE_OFFLINE').length;
  if (reloadedOffline) {
    await deviceHealthMonitor.inspectDevice(reloadedOffline);
  }
  const alertsAfter = await getAlerts();
  const alertCountAfter = alertsAfter.filter(a => a.deviceId === 'esp32_offline_test' && a.type === 'DEVICE_OFFLINE').length;
  assert(alertCountBefore === alertCountAfter, 'Duplicate alert prevented by deduplication logic');

  // 2. Inspect low battery device
  const lowBatteryDev = await pairDevice({
    id: 'esp32_low_bat_test',
    deviceName: 'ESP32 Low Battery Scale',
    deviceType: 'SMART_SCALE',
    connectionType: 'Wi-Fi',
    batteryLevel: 12, // < 20%
    simulatorMode: true
  });
  await deviceHealthMonitor.inspectDevice(lowBatteryDev);
  const lowBatAlerts = await getAlerts({ type: 'DEVICE_BATTERY_LOW' });
  assert(lowBatAlerts.some(a => a.deviceId === 'esp32_low_bat_test'), 'Low battery triggered DEVICE_BATTERY_LOW alert');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 6: Future Firmware & OTA Service
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 6] Future Firmware Support & OTA Checks');

  const firmwareCheck = await firmwareService.checkForUpdate({
    id: 'esp32_counter_01',
    deviceName: 'ESP32 Smart Counter',
    deviceType: 'SMART_COUNTER',
    firmwareVersion: '1.2.0', // Registry has 1.3.0
    connectionType: 'Bluetooth',
    isConnected: true,
    signalStrength: -60,
    lastSeen: new Date().toISOString(),
    simulatorMode: true
  });

  assert(firmwareCheck.isUpdateAvailable === true, 'Firmware check detects v1.3.0 update available for v1.2.0');
  assert(Boolean(firmwareCheck.downloadUrl), 'Firmware manifest provides download URL');

  const otaSchedule = await firmwareService.scheduleOTAUpdate('esp32_counter_01', '1.3.0');
  assert(otaSchedule.status === 'AVAILABLE', 'scheduleOTAUpdate returned structured status');

  console.log('');

  // ---------------------------------------------------------------------------
  // Test 7: Bluetooth Graceful Fallback
  // ---------------------------------------------------------------------------
  console.log('👉 [Test 7] Bluetooth Layer Fallback');

  const isBtSupported = bluetoothService.isBluetoothSupported();
  assert(typeof isBtSupported === 'boolean', 'isBluetoothSupported returns valid boolean without throwing');

  // Scanning without Web Bluetooth should gracefully fall back to simulator
  const pairResult = await bluetoothService.scanAndPair();
  assert(pairResult.fallbackToSimulator === true, 'Web Bluetooth gracefully falls back to simulator mode in unsupported environments');

  console.log('');
  console.log('================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('Validation test failed with error:', err);
  process.exit(1);
});
