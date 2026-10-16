import { useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { getWsConnected, subscribeWsStatus } from '../lib/realtime';

const POLL_MS = 15000;

export interface Connectivity {
  /** Jaringan device up (berdasar expo-network). */
  online: boolean;
  /** Minimal satu channel WS realtime sedang OPEN. */
  wsConnected: boolean;
}

/**
 * Status konektivitas REAL: gabungan state jaringan device
 * (expo-network, dicek saat mount + polling 15 dtk) dengan
 * status socket realtime (langganan subscribeWsStatus).
 */
export function useConnectivity(): Connectivity {
  const [online, setOnline] = useState(true);
  const [wsConnected, setWsConnected] = useState<boolean>(() => getWsConnected());

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const st = await Network.getNetworkStateAsync();
        if (alive) setOnline((st.isConnected ?? true) && (st.isInternetReachable ?? true));
      } catch {
        /* pertahankan status terakhir */
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    const unsub = subscribeWsStatus((c) => {
      if (alive) setWsConnected(c);
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, []);

  return { online, wsConnected };
}

export default useConnectivity;
