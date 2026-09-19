/**
 * @file useNetworkStatus.ts
 * @description React hook for subscribing to real-time network connectivity changes.
 * Belongs in `src/hooks/useNetworkStatus.ts`.
 */

import { useState, useEffect } from 'react';
import { networkService } from '../services/networkService';

export interface NetworkStatusResult {
  isOnline: boolean;
  lastOnlineTime: number;
  toggleSimulation: (simulateOffline?: boolean) => void;
}

export function useNetworkStatus(): NetworkStatusResult {
  const [isOnline, setIsOnline] = useState<boolean>(networkService.isOnline());
  const [lastOnlineTime, setLastOnlineTime] = useState<number>(networkService.lastOnlineTime());

  useEffect(() => {
    const unsubscribe = networkService.subscribeNetworkStatus((online) => {
      setIsOnline(online);
      setLastOnlineTime(networkService.lastOnlineTime());
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const toggleSimulation = (simulateOffline?: boolean) => {
    if (simulateOffline === undefined) {
      networkService.setSimulatedState(!networkService.isOnline() ? null : false);
    } else {
      networkService.setSimulatedState(simulateOffline ? false : null);
    }
  };

  return {
    isOnline,
    lastOnlineTime,
    toggleSimulation
  };
}
