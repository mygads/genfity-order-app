/**
 * Tag terminal efektif satu perangkat (R58): satu sumber kebenaran untuk
 * ketiga lane (realtime, push, print) agar tak drift.
 *
 * Prioritas: tag eksplisit (argumen) → sesi (sudah backfill binding) →
 * binding device (persist lintas logout) → peran device legacy → full_access.
 * Lazy-require ala realtime.ts/push.ts agar tak ada siklus impor (session tak
 * mengimpor modul ini). Tak pernah melempar.
 */

import type { TerminalTag } from './deviceRole';

export function resolveEffectiveTag(explicit?: unknown): TerminalTag {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dr = require('./deviceRole') as typeof import('./deviceRole');
    const p = dr.normalizeTag(explicit);
    if (p) return p;
  } catch {
    /* lanjut lapis berikut */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sess = require('../session') as typeof import('../session');
    // getSessionTag backfill binding + default full_access (tak pernah null).
    const st = sess.getSessionTag?.();
    if (st) return st as TerminalTag;
    const b = (sess.getBinding?.()?.tag ?? '').trim();
    if (b) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dr = require('./deviceRole') as typeof import('./deviceRole');
      const nb = dr.normalizeTag(b);
      if (nb) return nb;
    }
  } catch {
    /* lanjut lapis berikut */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dr = require('./deviceRole') as typeof import('./deviceRole');
    return dr.resolveTerminalTag(dr.getDeviceRole());
  } catch {
    return 'full_access';
  }
}

/** True bila tag hanya boleh menerima konten tanpa harga (view terkunci). */
export function isViewOnlyTag(tag: TerminalTag): boolean {
  return tag === 'view_pelanggan' || tag === 'view_queue';
}
