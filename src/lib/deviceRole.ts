/**
 * Tag terminal (SPEC-TERMINAL-SESSION §1 + AUDIT §11.1): 1 perangkat = 1 tag.
 *
 * Kanonis (lowercase, selalu terisi satu dari lima nilai):
 * - kasir / dapur / full_access: drawer penuh (default-allow); tag hanya
 *   memilih notifikasi/event yang diterima, bukan mengunci fitur (Q5 CLOSED).
 * - view_pelanggan: sidebar HANYA halaman customer view (default-deny).
 * - view_queue: sidebar HANYA halaman antrean (default-deny).
 *
 * DeviceRole = gabungan 5 tag kanonis + 3 alias legacy huruf-kapital era
 * 3-peran ('KASIR'|'DAPUR'|'DISPLAY'). Alias legacy dipertahankan HANYA di tipe
 * agar pembanding di layar milik task lain (App.tsx, DrawerMenu,
 * SettingsScreen, KitchenScreen) tetap kompilasi; setiap nilai yang masuk
 * selalu dinormalisasi ke tag kanonis sebelum disimpan
 * (alias 'DISPLAY' → 'view_pelanggan'). Parse ketat untuk nilai asing/server
 * tetap mengembalikan null (fail-closed, tanpa default diam-diam).
 */
import { getItem, setItem } from './storage';

/** Lima tag terminal eksplisit backend (Q1 CLOSED 2026-10-17). */
export type TerminalTag =
  | 'kasir'
  | 'dapur'
  | 'view_pelanggan'
  | 'view_queue'
  | 'full_access';

/** @deprecated Alias legacy era 3-peran — jangan dipakai di kode baru. */
export type LegacyDeviceRole = 'KASIR' | 'DAPUR' | 'DISPLAY';

export type DeviceRole = TerminalTag | LegacyDeviceRole;

const LS_ROLE = 'genfity.device.role';

export const TERMINAL_TAGS: TerminalTag[] = [
  'kasir',
  'dapur',
  'view_pelanggan',
  'view_queue',
  'full_access',
];

/** Tag dengan fitur PENUH (kasir/dapur/full sama; beda notifikasi saja, Q5). */
export const FULL_FEATURE_TAGS: TerminalTag[] = ['kasir', 'dapur', 'full_access'];

/** Tag view terkunci satu halaman (sidebar hanya halamannya). */
export const VIEW_TAGS: TerminalTag[] = ['view_pelanggan', 'view_queue'];

/** Migrasi penyimpanan lama → tag kanonis (bukan validasi server). */
const LEGACY_MAP: Record<string, TerminalTag> = {
  KASIR: 'kasir',
  DAPUR: 'dapur',
  DISPLAY: 'view_pelanggan',
};

/** Default pre-hydrate TERKUNCI (B7 fail-closed, audit 2026-10-17):
 * satu-halaman pelanggan — BUKAN akses penuh. Perangkat tanpa tag
 * tersimpan/server tetap terkunci sampai bind/sync menetapkan tag eksplisit
 * (setDeviceRole); restore() di bawah menaikkan ke tag tersimpan dalam
 * microtask. deviceRoleForTag tak butuh gate tambahan: paramnya bertipe
 * TerminalTag (nilai-terkunci lolos apa adanya) dan nol pemanggil produksi. */
let role: TerminalTag = 'view_pelanggan';
let hydrated = false;

const listeners = new Set<(r: DeviceRole) => void>();

function restore(): void {
  void getItem(LS_ROLE).then((v) => {
    const next = normalizeTag(v);
    if (next) {
      role = next;
      listeners.forEach((cb) => {
        try {
          cb(role);
        } catch {
          /* abaikan */
        }
      });
    }
  });
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  restore();
}

/** Normalisasi nilai lokal/persisted ke tag kanonis (termasuk alias legacy).
 * null bila tak dikenal — pemanggil wajib fail-closed, bukan default diam-diam. */
export function normalizeTag(v: unknown): TerminalTag | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if ((TERMINAL_TAGS as string[]).includes(lower)) return lower as TerminalTag;
  return LEGACY_MAP[s.toUpperCase()] ?? null;
}

/** Tag perangkat aktif (sinkron; TERKUNCI 'view_pelanggan' hingga
 * restore/bind/sync menetapkan tag — B7 fail-closed). */
export function getDeviceRole(): DeviceRole {
  hydrate();
  return role;
}

/**
 * Validasi string asing (mis. tag dari backend) menjadi TerminalTag.
 * Case-insensitive, unknown → null, tanpa silent default. 'DISPLAY' legacy
 * BUKAN tag kanonis sehingga mengembalikan null (migrasi penyimpanan lama
 * lewat normalizeTag, bukan lewat parse).
 */
export function parseDeviceRole(v: unknown): TerminalTag | null {
  const s = String(v ?? '').trim().toLowerCase();
  return (TERMINAL_TAGS as string[]).includes(s) ? (s as TerminalTag) : null;
}

/** Alias parseDeviceRole (nama paket app-model). */
export function parseTerminalTag(v: unknown): TerminalTag | null {
  return parseDeviceRole(v);
}

/**
 * Legacy untagged / tak dikenal => 'full_access' (usulan audit:
 * terminal lama tanpa tag berjalan penuh, bukan dibuang diam-diam).
 * Helper eksplisit-default — parse* ketat tetap mengembalikan null.
 */
export function resolveTerminalTag(v: unknown): TerminalTag {
  return parseTerminalTag(v) ?? 'full_access';
}

/**
 * Tag => peran nav: kasir/dapur/full_access = fitur penuh,
 * view_pelanggan/view_queue = satu halaman terkunci.
 * Dikembalikan sebagai tag kanonis.
 */
export function deviceRoleForTag(tag: TerminalTag): TerminalTag {
  return (VIEW_TAGS as TerminalTag[]).includes(tag) ? 'view_pelanggan' : 'full_access';
}

/** Terapkan tag terminal ke kunci nav (server menang); kembalikan tag kanonis. */
export function setDeviceRoleForTag(tag: TerminalTag): TerminalTag {
  setDeviceRole(tag);
  return normalizeTag(tag) ?? 'full_access';
}

/** Simpan tag perangkat (tak pernah melempar; alias legacy dinormalisasi). */
export function setDeviceRole(next: DeviceRole): void {
  hydrate();
  const tag = normalizeTag(next);
  if (!tag) {
    console.warn('[deviceRole] setDeviceRole: nilai tak dikenal, diabaikan.');
    return;
  }
  role = tag;
  void setItem(LS_ROLE, tag);
  listeners.forEach((cb) => {
    try {
      cb(role);
    } catch {
      /* abaikan */
    }
  });
}

/** Langganan perubahan tag (untuk kunci navigasi reaktif). Langsung
 * dipanggil sekali dengan nilai saat ini agar tak kehilangan restore yang
 * selesai sebelum subscribe (AsyncStorage web resolve dalam microtask). */
export function subscribeDeviceRole(cb: (r: DeviceRole) => void): () => void {
  listeners.add(cb);
  hydrate();
  try {
    cb(role);
  } catch {
    /* abaikan */
  }
  return () => {
    listeners.delete(cb);
  };
}

/** Rute beranda per tag (SPEC §10). 'CustomerDisplay' adalah nama layar
 * eksisting (belum diganti 'CustomerView'); 'QueueView' mendarat di task Fase 2. */
export function homeRouteFor(roleName: DeviceRole): string {
  const tag = normalizeTag(roleName);
  if (tag === 'dapur') return 'Kitchen';
  if (tag === 'view_pelanggan') return 'CustomerDisplay';
  if (tag === 'view_queue') return 'QueueView';
  return 'Dashboard';
}

/** Allowlist rute per tag (SPEC §10): kasir/dapur/full_access = null
 * (default-allow, drawer penuh — nav-lock DAPUR/DISPLAY lama dicabut);
 * dua tag view = default-deny single-page. Tanpa Settings/role-switch/
 * cashier-entry di profil view; keluar hanya via aksi owner terautentikasi
 * (task Fase 2). Tag tak dikenal → himpunan kosong (fail-closed). */
export function allowedRoutesFor(roleName: DeviceRole): Set<string> | null {
  const tag = normalizeTag(roleName);
  if (!tag) return new Set<string>();
  if (tag === 'view_pelanggan') {
    // APP-FIXUP(E6): 'CustomerView' tak pernah terdaftar di Stack — kembalikan
    // hanya 'CustomerDisplay' yang terdaftar (App.tsx).
    return new Set(['CustomerDisplay']);
  }
  if (tag === 'view_queue') {
    return new Set(['QueueView']);
  }
  return null;
}
