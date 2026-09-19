/**
 * @file networkService.ts
 * @description Real-time network detection service for ShopPulse.
 * Monitors browser online/offline status, tracks last online timestamps,
 * supports active reachability probes, and enables manual simulation for offline testing.
 * Belongs in `src/services/networkService.ts`.
 */

type NetworkStatusListener = (isOnline: boolean) => void;

class NetworkService {
  private online: boolean = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  private lastOnlineTimestamp: number = Date.now();
  private listeners: Set<NetworkStatusListener> = new Set();
  private simulatedState: boolean | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnlineEvent.bind(this));
      window.addEventListener('offline', this.handleOfflineEvent.bind(this));
    }
  }

  /**
   * Returns current network connectivity status.
   */
  public isOnline(): boolean {
    if (this.simulatedState !== null) {
      return this.simulatedState;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return this.online;
  }

  /**
   * Returns Unix timestamp of when the device was last confirmed online.
   */
  public lastOnlineTime(): number {
    return this.lastOnlineTimestamp;
  }

  /**
   * Subscribe to network transition events. Returns an unsubscribe cleanup function.
   */
  public subscribeNetworkStatus(callback: NetworkStatusListener): () => void {
    this.listeners.add(callback);
    callback(this.isOnline());
    return () => this.listeners.delete(callback);
  }

  /**
   * Active probe to verify if the internet route is actually functional.
   */
  public async checkConnectivity(): Promise<boolean> {
    if (this.simulatedState !== null) {
      return this.simulatedState;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState(false);
      return false;
    }

    try {
      // Lightweight fetch probe with cache-busting timestamp
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // Probe a reliable HTTPS endpoint or current origin
      const probeUrl = typeof window !== 'undefined' ? `${window.location.origin}/favicon.ico?t=${Date.now()}` : 'https://www.google.com/favicon.ico';
      const response = await fetch(probeUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const isReachable = Boolean(response);
      this.updateState(isReachable);
      return isReachable;
    } catch {
      // If probe fails but navigator is online, check again or keep current
      return this.online;
    }
  }

  /**
   * Manually simulate offline or online mode for testing and demonstrations.
   */
  public setSimulatedState(online: boolean | null): void {
    this.simulatedState = online;
    const effectiveOnline = this.isOnline();
    if (effectiveOnline) {
      this.lastOnlineTimestamp = Date.now();
    }
    this.notifyListeners(effectiveOnline);
  }

  private handleOnlineEvent(): void {
    if (this.simulatedState !== null) return;
    this.updateState(true);
  }

  private handleOfflineEvent(): void {
    if (this.simulatedState !== null) return;
    this.updateState(false);
  }

  private updateState(isOnline: boolean): void {
    if (this.online !== isOnline) {
      this.online = isOnline;
      if (isOnline) {
        this.lastOnlineTimestamp = Date.now();
      }
      this.notifyListeners(isOnline);
    }
  }

  private notifyListeners(isOnline: boolean): void {
    this.listeners.forEach(listener => {
      try {
        listener(isOnline);
      } catch (err) {
        console.error('Error in network status listener:', err);
      }
    });
  }
}

export const networkService = new NetworkService();

if (typeof window !== 'undefined') {
  (window as any).__shoppulse_network = networkService;
}

