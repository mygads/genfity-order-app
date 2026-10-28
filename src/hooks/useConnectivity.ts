import { useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { getWsConnected, subscribeWsStatus } from '../lib/realtime';
import { subscribeSseStatus } from '../lib/sse';

const POLL_MS = 15000;

export interface Connectivity {
  /** Jaringan device up (berdasar expo-network); null = belum diketahui (awal). */
  online: boolean | null;
  /** Minimal satu channel WS realtime sedang OPEN. */
  wsConnected: boolean;
  /** Minimal satu feed SSE sedang online (primer display; best-effort kasir). */
  sseLive: boolean;
  /**
   * BE terjangkau via HTTP GET {base}/health (null = tak diukur, mis. Local
   * Mode tanpa base URL). Sinyal stabil untuk badge: WS warisan ESB
   * (/wss-self-order) 404 di BE Go by-design, jadi badge tak boleh gate
   * penuh pada WS saja (W-FULL §14).
   */
  beReachable: boolean | null;
}

/** Cek HTTP ringan ke BE /health dengan timeout 5 dtk; null bila tak ada base. */
async function probeBeHealth(): Promise<boolean | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const srv = require('../config/server') as typeof import('../config/server');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('../lib/apiSource') as typeof import('../lib/apiSource');
    let base = '';
    try {
      if (api.getApiMode() !== 'real') return null;
      base = srv.getBaseUrl().replace(/\/+$/, '');
    } catch {
      return null;
    }
    if (!base) return null;
    const url = `${base}/health`;
    const ctl = new AbortController();
    const t = setTimeout(() => { try { ctl.abort(); } catch { /* abaikan */ } }, 5000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/**
 * Status konektivitas REAL: gabungan state jaringan device
 * (expo-network, dicek saat mount + polling 15 dtk) dengan
 * status socket realtime (langganan subscribeWsStatus), status agregat SSE,
 * dan probe HTTP BE /health (sinyal stabil badge hijau).
 */
export function useConnectivity(): Connectivity {
  const [online, setOnline] = useState<boolean | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(() => getWsConnected());
  const [sseLive, setSseLive] = useState<boolean>(false);
  const [beReachable, setBeReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const st = await Network.getNetworkStateAsync();
        if (alive) setOnline((st.isConnected ?? true) && (st.isInternetReachable ?? true));
      } catch {
        /* pertahankan status terakhir */
      }
      try {
        const r = await probeBeHealth();
        if (alive && r !== null) setBeReachable(r);
        else if (alive && r === null) setBeReachable(null);
      } catch {
        /* pertahankan status terakhir */
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    const unsub = subscribeWsStatus((c) => {
      if (alive) setWsConnected(c);
    });
    let unsubSse: (() => void) | null = null;
    try {
      unsubSse = subscribeSseStatus((live) => {
        if (alive) setSseLive(live);
      });
    } catch {
      /* SSE belum siap — tetap false */
    }
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
      try { unsubSse?.(); } catch { /* abaikan */ }
    };
  }, []);

  return { online, wsConnected, sseLive, beReachable };
}

export default useConnectivity;
