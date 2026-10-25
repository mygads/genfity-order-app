/**
 * Sinkronisasi konfigurasi POS merchant → seed lokal APP (audit-5d80).
 * Dipanggil fire-and-forget pasca-login (cermin syncCurrencyFromProfile):
 * best-effort, fail-silent — login tak diblokir bila gagal.
 *
 * KEBIJAKAN SYNC TRISISI (audit #4 — satu paragraf acuan):
 * - merchant-truth = server-wins-on-sync: lookup member, threshold stok,
 *   tax, fee/service, packaging, receipt prefs. Nilai server menimpa lokal
 *   tiap sync sukses (pengecualian TERDOKUMENTASI: threshold stok seed-hanya-
 *   bila-default, lihat bawah — terminal tak bisa baca endpoint owner-gated
 *   /menu/stock/settings, jadi kasir yang sudah mengkustom tak ditimpa).
 * - fisik-perangkat = local-wins SELALU: port/MAC printer, paper-size/autocut
 *   per-station, mapping station, preferensi acquirer EDC/QRIS. Server tak
 *   tahu alamat printer per-terminal (cermin master.ts:113-123).
 * - UX-perangkat = seed-once: timer meja, sound, sync opts, float shift.
 *   Ditulis hanya bila belum ada cfg lokal (kasir yang sudah mengatur tak
 *   ditimpa).
 *
 * Aturan server-wins yang disepakati:
 * - Stok (`genfity.stock.opts.lowLimit`): S-F5 = adopsi threshold merchant
 *   TANPA SYARAT tiap sync sukses + catat thresholdSyncedAt (menggantikan
 *   aturan seed-once audit-5d80: server kini punya padanan via pos-config).
 *   Kustom kasir di layar Stok tetap bisa, tapi sync login berikutnya
 *   menimpa dengan nilai server (sengaja, bukan bug).
 * - allowSellEmpty/trackStock: adopsi HANYA bila kunci eksplisit hadir di
 *   posBehavior server (presence-check, bukan nilai): BE lama yang tak
 *   mengirim kunci = lokal dipertahankan (tolerate absent). Kunci hadir
 *   (termasuk false eksplisit) = server-wins + catat stockFlagsSyncedAt.
 *   (M9-3 local-only dicabut S-F5: BE kini punya padanan allowSellEmpty/
 *   trackStock di pos_behavior_settings JSONB.)
 * - Timer (`genfity.tabletimer.config`): seed HANYA bila belum ada cfg lokal
 *   (kasir yang sudah mengatur tak ditimpa).
 */
import { getJSON, setJSON } from './storage';
import { fetchTerminalPosConfig } from './terminalApi';
import { parsePaymentMethods, PAYMENT_METHODS_DEFAULT, type PaymentMethods } from './paymentMethods';

const STOCK_OPTS_KEY = 'genfity.stock.opts';
const TIMER_CFG_KEY = 'genfity.tabletimer.config';
/** Ronde-3 Q5: cache flag gate lookup member. Absen = enabled (boleh lookup). */
const MEMBER_LOOKUP_KEY = 'genfity.member.lookup';

/** S-F3: cache jadwal ongkir server (null per field = tak dikonfigurasi). */
const FEE_SCHEDULE_KEY = 'genfity.pos.deliveryFee';
/** S-F4: cache langkah pembulatan server (absen = default currency). */
const ROUND_STEP_KEY = 'genfity.pos.roundingStep';
/** S-F6: cache gerbang workforce (absen = keduanya OFF). */
const WORKFORCE_KEY = 'genfity.pos.workforce';
/** S-F12/F13: cache destinasi cetak server ([] = BE lama/lokal-only). */
const PRINT_DEST_KEY = 'genfity.pos.printDestinations';
/** S-F1: cache filter tab bayar ({tunai,nontunai,online,member,lainnya}; absen = semua tampil). */
const PAY_TABS_KEY = 'genfity.pos.paymentTabs';
/** S-F2: cache gate promo (posDiscounts* = POS; customer* = info-only). */
const PROMO_GATE_KEY = 'genfity.pos.promo';
/** S-F8: cache auto-print (absen = OFF). */
const AUTO_PRINT_KEY = 'genfity.pos.autoPrint';
/** SESI-FINAL-APP: cache flag wajib-foto-bukti-bayar (absen = OFF). */
const REQUIRE_PROOF_KEY = 'genfity.pos.requireProof';
/** R4-4: cache snapshot metode bayar server (absen = semua tampil). */
const PAYMENT_METHODS_KEY = 'genfity.pos.paymentMethods';

/** A-P1-7: flag perilaku POS (BE merchant_pos_menu.go:85-89 — posPayImmediately,
 * requireTableNumberForDineIn, posCustomItems, posEditOrder). Konsumsi toleran:
 * endpoint merchant-auth /menu hanya bisa dibaca JWT merchant, terminal APP tak
 * bisa fetch langsung — cache ditulis DI SINI saat BE kelak mengekspos flag via
 * terminal pos-config (kunci flat ATAU nested posBehavior). Absen = default
 * legacy (perilaku hari ini), sehingga NOL-regresi sampai BE menambahkannya.
 * customItems/editOrder default TRUE (fitur sudah hidup); payImmediately/
 * requireTable default FALSE (alur lama: review keranjang, meja opsional). */
const POS_FLAGS_KEY = 'genfity.pos.flags';
export interface PosFlags {
  payImmediately: boolean;
  requireTable: boolean;
  customItems: boolean;
  editOrder: boolean;
}
const POS_FLAGS_DEFAULT: PosFlags = {
  payImmediately: false,
  requireTable: false,
  customItems: true,
  editOrder: true,
};
const asBool = (v: unknown, fb: boolean): boolean => {
  if (v === undefined || v === null) return fb;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  return fb;
};
/** Baca satu flag dari beberapa alias (flat + nested posBehavior + snake_case)
 * karena bentuk pasti payload terminal BE belum final saat APP ditulis. */
function pickFlag(src: Record<string, unknown>, aliases: string[], fb: boolean): boolean {
  for (const k of aliases) {
    if (src[k] !== undefined && src[k] !== null) return asBool(src[k], fb);
  }
  const nested = src.posBehavior ?? src.pos_behavior ?? src.settings;
  if (nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>;
    for (const k of aliases) {
      if (n[k] !== undefined && n[k] !== null) return asBool(n[k], fb);
    }
  }
  return fb;
}
function parsePosFlags(raw: unknown): PosFlags {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    payImmediately: pickFlag(src, ['posPayImmediately', 'pos_pay_immediately', 'payImmediately', 'pay_immediately'], POS_FLAGS_DEFAULT.payImmediately),
    requireTable: pickFlag(src, ['requireTableNumberForDineIn', 'require_table_number_for_dine_in', 'requireTable', 'require_table'], POS_FLAGS_DEFAULT.requireTable),
    customItems: pickFlag(src, ['posCustomItems', 'pos_custom_items', 'customItems', 'custom_items'], POS_FLAGS_DEFAULT.customItems),
    editOrder: pickFlag(src, ['posEditOrder', 'pos_edit_order', 'editOrder', 'edit_order'], POS_FLAGS_DEFAULT.editOrder),
  };
}

export async function syncPosConfigFromServer(terminalId: string): Promise<boolean> {
  const id = (terminalId ?? '').trim();
  if (!id) return false;
  let r;
  try {
    r = await fetchTerminalPosConfig(id);
  } catch {
    return false;
  }
  if (!r || !r.ok || r.fromDummy) return false;

  try {
    const local = await getJSON<Record<string, unknown>>(STOCK_OPTS_KEY, {});
    // S-F5: threshold server-wins TANPA SYARAT + timestamp (menggantikan
    // seed-once: nilai server selalu menang tiap sync sukses).
    const at = new Date().toISOString();
    const merged: Record<string, unknown> = {
      ...local,
      lowLimit: String(r.data.defaultLowStockThreshold),
      thresholdSyncedAt: at,
    };
    // S-F5: allowSellEmpty/trackStock HANYA bila kunci eksplisit hadir di
    // posBehavior (BE lama tanpa kunci = lokal dipertahankan).
    const pb = (r.data.posBehavior ?? {}) as Record<string, unknown>;
    const flagPatch: Record<string, unknown> = {};
    if ('allowSellEmpty' in pb) flagPatch.allowSellEmpty = asBool(pb.allowSellEmpty, false);
    if ('trackStock' in pb) flagPatch.trackStock = asBool(pb.trackStock, true);
    if (Object.keys(flagPatch).length > 0) {
      Object.assign(merged, flagPatch, { stockFlagsSyncedAt: at });
    }
    await setJSON(STOCK_OPTS_KEY, merged);
  } catch {
    /* best-effort: cache stok tetap dipakai */
  }

  try {
    const existing = await getJSON<Record<string, unknown> | null>(TIMER_CFG_KEY, null);
    if (existing === null || existing === undefined) {
      await setJSON(TIMER_CFG_KEY, {
        enabled: true,
        limit: String(r.data.timerDefaultLimitMin),
        warnBefore: String(r.data.timerWarnBeforeMin),
        startMode: 'duduk',
        autoExtend: false,
      });
    }
  } catch {
    /* best-effort: default TableTimerScreen tetap dipakai */
  }

  // Q5: cache flag gate lookup member (server-wins tiap sync sukses; gagal
  // sync = cache lama dipakai, belum pernah sync = enabled).
  try {
    await setJSON(MEMBER_LOOKUP_KEY, { enabled: r.data.memberLookupEnabled !== false });
  } catch {
    /* abaikan */
  }

  // A-P1-7: cache 4 flag perilaku POS (toleran: kunci flat/nested apa pun yang
  // kelak dikirim BE; tak ada = cache lama/default legacy dipertahankan).
  try {
    await setJSON(POS_FLAGS_KEY, parsePosFlags(r.data));
  } catch {
    /* abaikan */
  }

  // S-F group: cache kontrak pos-config baru (server-wins tiap sync sukses;
  // gagal sync = cache lama dipakai; belum pernah sync = default legacy).
  // Tiap tulis best-effort terpisah agar satu gagal tak menggugurkan lainnya.
  const pbRaw = (r.data.posBehavior ?? {}) as Record<string, unknown>;
  try {
    await setJSON(FEE_SCHEDULE_KEY, {
      base: r.data.deliveryFee.base,
      perKm: r.data.deliveryFee.perKm,
      min: r.data.deliveryFee.min,
      max: r.data.deliveryFee.max,
    });
  } catch { /* abaikan */ }
  try {
    await setJSON(ROUND_STEP_KEY, { step: r.data.roundingStep });
  } catch { /* abaikan */ }
  try {
    await setJSON(WORKFORCE_KEY, {
      requirePinForPos: r.data.workforce.requirePinForPos === true,
      requireCashRegisterForPos: r.data.workforce.requireCashRegisterForPos === true,
    });
  } catch { /* abaikan */ }
  try {
    await setJSON(PRINT_DEST_KEY, { destinations: r.data.printDestinations ?? [] });
  } catch { /* abaikan */ }
  try {
    // S-F1: filter tab bayar (map metode→bool; kunci tak dikenal diabaikan
    // saat konsumsi; absen = semua tampil).
    // S-F1b: gabung gate eksplisit per-tab dari blok paymentSettings server
    // (BE turunkan dari merchant_payment_settings). Hanya 'tunai' punya knob
    // tak-ambigu (payAtCashierEnabled): 'nontunai' mencakup EDC yang tak punya
    // flag server sehingga TAK di-gate; online/member/lainnya tak punya knob.
    // Blok absen / tanpa kunci eksplisit = tampil (perilaku lama, nol-regresi).
    const tabs = parsePayTabs(pbRaw);
    const pm = ((r.data as unknown as Record<string, unknown>).paymentSettings ?? {}) as Record<string, unknown>;
    if (pm && typeof pm === 'object') {
      const cash = pm.payAtCashierEnabled ?? pm.pay_at_cashier_enabled;
      if (cash !== undefined && cash !== null) tabs.tunai = asBool(cash, true);
    }
    await setJSON(PAY_TABS_KEY, tabs);
  } catch { /* abaikan */ }
  try {
    // S-F2: gate promo (posDiscounts* gerbang UI POS; customer* info-only).
    await setJSON(PROMO_GATE_KEY, parsePromoGate(pbRaw));
  } catch { /* abaikan */ }
  try {
    // S-F8: auto-print (varian deprecated ikut dibaca; absen = OFF).
    const auto = pbRaw.autoPrint ?? pbRaw.autoPrintOnPaymentConfirm ?? pbRaw.autoPrintOnOrderCreated;
    await setJSON(AUTO_PRINT_KEY, { enabled: asBool(auto, false) });
  } catch { /* abaikan */ }
  try {
    // SESI-FINAL-APP: merchant mewajibkan foto bukti bayar (absen = OFF).
    // parseRequirePaymentProof inline-toleran DI SINI (tanpa impor terminalApi:
    // terminalApi tak mengimpor posConfigSync; impor balik aman, tapi bentuk
    // nested dibaca langsung agar nol-risiko siklus).
    await setJSON(REQUIRE_PROOF_KEY, { required: parseRequireProof(r.data) });
  } catch { /* abaikan */ }
  try {
    // R4-4: snapshot metode bayar — server-wins tiap sync sukses (tulis TANPA
    // SYARAT, bukan seed-once: nilai server selalu menimpa cache). BE lama
    // tanpa kunci → parse = semua-true = tampil semua (NOL-regresi).
    await setJSON(PAYMENT_METHODS_KEY, parsePaymentMethods(r.data));
  } catch { /* abaikan */ }
  return true;
}

/** Q5: gate UI lookup/search member. Absen/error = enabled (kontrak). */
export async function getMemberLookupEnabled(): Promise<boolean> {
  try {
    const cur = await getJSON<{ enabled?: unknown } | null>(MEMBER_LOOKUP_KEY, null);
    if (!cur || cur.enabled === undefined || cur.enabled === null) return true;
    if (typeof cur.enabled === 'boolean') return cur.enabled;
    return String(cur.enabled).trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}

/** A-P1-7: baca 4 flag perilaku POS dari cache. Absen/error = default legacy
 * (payImmediately/requireTable OFF, customItems/editOrder ON). */
export async function getPosFlags(): Promise<PosFlags> {
  try {
    const cur = await getJSON<Partial<PosFlags> | null>(POS_FLAGS_KEY, null);
    if (!cur || typeof cur !== 'object') return { ...POS_FLAGS_DEFAULT };
    return {
      payImmediately: asBool(cur.payImmediately, POS_FLAGS_DEFAULT.payImmediately),
      requireTable: asBool(cur.requireTable, POS_FLAGS_DEFAULT.requireTable),
      customItems: asBool(cur.customItems, POS_FLAGS_DEFAULT.customItems),
      editOrder: asBool(cur.editOrder, POS_FLAGS_DEFAULT.editOrder),
    };
  } catch {
    return { ...POS_FLAGS_DEFAULT };
  }
}

/** A-P1-7: kasir → Pay langsung tanpa review keranjang (default OFF). */
export async function getPosPayImmediately(): Promise<boolean> {
  return (await getPosFlags()).payImmediately;
}

/** A-P1-7: DINE IN wajib nomor meja sebelum simpan/bayar (default OFF). */
export async function getRequireTableNumberForDineIn(): Promise<boolean> {
  return (await getPosFlags()).requireTable;
}

/** A-P1-7: tombol + penerimaan item kustom diizinkan (default ON = hidup). */
export async function getPosCustomItemsEnabled(): Promise<boolean> {
  return (await getPosFlags()).customItems;
}

/** A-P1-7: penerimaan loadItems (buka order tersimpan untuk diedit) (default ON). */
export async function getPosEditOrderEnabled(): Promise<boolean> {
  return (await getPosFlags()).editOrder;
}

// ---------------------------------------------------------------------------
// S-F group: parser + getter kontrak pos-config baru. Semua toleran:
// absen/error = default legacy (perilaku hari ini), nol-regresi.
// ---------------------------------------------------------------------------

/** S-F3: jadwal ongkir server (null per field = tak dikonfigurasi). */
export interface DeliveryFeeSchedule {
  base: number | null;
  perKm: number | null;
  min: number | null;
  max: number | null;
}

const cleanFee = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** S-F3: baca jadwal ongkir dari cache (null = BE lama / belum dikonfigurasi). */
export async function getDeliveryFeeSchedule(): Promise<DeliveryFeeSchedule> {
  try {
    const cur = await getJSON<Partial<DeliveryFeeSchedule> | null>(FEE_SCHEDULE_KEY, null);
    if (!cur || typeof cur !== 'object') return { base: null, perKm: null, min: null, max: null };
    return { base: cleanFee(cur.base), perKm: cleanFee(cur.perKm), min: cleanFee(cur.min), max: cleanFee(cur.max) };
  } catch {
    return { base: null, perKm: null, min: null, max: null };
  }
}

/** S-F4: langkah pembulatan server (null = BE lama; pemanggil pakai default currency). */
export async function getServerRoundStep(): Promise<number | null> {
  try {
    const cur = await getJSON<{ step?: unknown } | null>(ROUND_STEP_KEY, null);
    const s = cur?.step;
    if (s === undefined || s === null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** S-F6: gerbang workforce (absen/error = keduanya OFF = perilaku lama).
 * Peta 3 sistem PIN (jangan dicampur):
 * (1) PIN binding terminal — klaim/pair perangkat (TerminalBind/Claim);
 * (2) PIN staff/workforce pasca-login — buka shift (ShiftScreen +
 *     verifyAttendancePin, lib/pin.ts);
 * (3) PIN supervisor/manager per-aksi — otorisasi manajer (ManagerPinPrompt
 *     + authorizeSupervisor + posPinGate).
 * requirePinForPos = kebijakan server: jalur (2) wajib sebelum kasir jalan. */
export interface WorkforceGates {
  requirePinForPos: boolean;
  requireCashRegisterForPos: boolean;
}

export async function getWorkforceGates(): Promise<WorkforceGates> {
  try {
    const cur = await getJSON<Partial<WorkforceGates> | null>(WORKFORCE_KEY, null);
    if (!cur || typeof cur !== 'object') return { requirePinForPos: false, requireCashRegisterForPos: false };
    return {
      requirePinForPos: cur.requirePinForPos === true,
      requireCashRegisterForPos: cur.requireCashRegisterForPos === true,
    };
  } catch {
    return { requirePinForPos: false, requireCashRegisterForPos: false };
  }
}

/** S-F12/F13: destinasi cetak server ([] = BE lama / lokal-only). */
export interface PrintDestination {
  id: number;
  name: string;
  role: string;
  copies: number;
  templateType: string;
  selected: boolean;
  receiptTemplateId: number | null;
}

export async function getPrintDestinations(): Promise<PrintDestination[]> {
  try {
    const cur = await getJSON<{ destinations?: unknown } | null>(PRINT_DEST_KEY, null);
    const arr = cur?.destinations;
    if (!Array.isArray(arr)) return [];
    const out: PrintDestination[] = [];
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = Number(o.id);
      if (!Number.isFinite(id)) continue;
      const copies = Number(o.copies);
      const rid = o.receiptTemplateId;
      out.push({
        id: Math.round(id),
        name: String(o.name ?? '').trim(),
        role: String(o.role ?? '').trim().toLowerCase(),
        copies: Number.isFinite(copies) && copies > 0 ? Math.round(copies) : 1,
        templateType: String(o.templateType ?? o.template_type ?? '').trim(),
        selected: o.selected === true,
        receiptTemplateId: rid === undefined || rid === null || rid === '' || !Number.isFinite(Number(rid)) ? null : Math.round(Number(rid)),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** S-F1: tab bayar yang tampil (kunci = id tab PayScreen; absen = semua tampil). */
export type PayTabId = 'tunai' | 'nontunai' | 'online' | 'member' | 'lainnya';

const PAY_TAB_IDS: PayTabId[] = ['tunai', 'nontunai', 'online', 'member', 'lainnya'];

/** S-F1: kupas map tab dari posBehavior (flat `paymentTabs` ATAU `payTabs` ATAU
 * kunci per-tab `show TunaiTab`/`paymentTab_<id>`; tak dikenal = tampil). */
function parsePayTabs(pb: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const src = (pb.paymentTabs ?? pb.payTabs ?? pb.enabledPaymentTabs ?? null) as Record<string, unknown> | null;
  if (src && typeof src === 'object') {
    for (const id of PAY_TAB_IDS) {
      if (src[id] !== undefined && src[id] !== null) out[id] = asBool(src[id], true);
    }
  }
  for (const id of PAY_TAB_IDS) {
    if (out[id] !== undefined) continue;
    const per = pb[`show${id.charAt(0).toUpperCase()}${id.slice(1)}Tab`] ?? pb[`paymentTab_${id}`] ?? pb[`payTab_${id}`];
    if (per !== undefined && per !== null) out[id] = asBool(per, true);
  }
  return out;
}

/** S-F1: tab boleh tampil? (absen di cache = tampil = perilaku lama). */
export async function isPayTabEnabled(id: PayTabId): Promise<boolean> {
  try {
    const cur = await getJSON<Record<string, unknown> | null>(PAY_TABS_KEY, null);
    if (!cur || typeof cur !== 'object') return true;
    const v = cur[id];
    if (v === undefined || v === null) return true;
    return asBool(v, true);
  } catch {
    return true;
  }
}

/** S-F2: gate promo (pos* = gerbang UI POS; customer* = info-only). */
export interface PromoGate {
  posDiscountsEnabled: boolean;
  customerVouchersEnabled: boolean;
}

function parsePromoGate(pb: Record<string, unknown>): PromoGate {
  // Bentuk bersarang `orderVouchers{posDiscountsEnabled,customerEnabled}` (BE
  // merchant_order_vouchers.go) + flat tolerant.
  const nested = (pb.orderVouchers ?? pb.promo ?? pb.vouchers ?? null) as Record<string, unknown> | null;
  const pos = nested && typeof nested === 'object' && (nested.posDiscountsEnabled ?? nested.posEnabled ?? null) !== undefined
    ? (nested.posDiscountsEnabled ?? nested.posEnabled)
    : (pb.posDiscountsEnabled ?? pb.posDiscounts ?? pb.discountsEnabled);
  const cust = nested && typeof nested === 'object' && (nested.customerVouchersEnabled ?? nested.customerEnabled ?? null) !== undefined
    ? (nested.customerVouchersEnabled ?? nested.customerEnabled)
    : (pb.customerVouchersEnabled ?? pb.customerVouchers ?? null);
  return {
    posDiscountsEnabled: asBool(pos ?? null, true),
    customerVouchersEnabled: asBool(cust ?? null, false),
  };
}

/** S-F2: diskon/promo POS diizinkan? (absen = true = perilaku lama). */
export async function getPosPromoGate(): Promise<PromoGate> {
  try {
    const cur = await getJSON<Partial<PromoGate> | null>(PROMO_GATE_KEY, null);
    if (!cur || typeof cur !== 'object') return { posDiscountsEnabled: true, customerVouchersEnabled: false };
    return {
      posDiscountsEnabled: asBool(cur.posDiscountsEnabled, true),
      customerVouchersEnabled: asBool(cur.customerVouchersEnabled, false),
    };
  } catch {
    return { posDiscountsEnabled: true, customerVouchersEnabled: false };
  }
}

/** S-F8: auto-print aktif? (absen/error = OFF = perilaku lama). */
export async function getAutoPrintEnabled(): Promise<boolean> {
  try {
    const cur = await getJSON<{ enabled?: unknown } | null>(AUTO_PRINT_KEY, null);
    if (!cur || cur.enabled === undefined || cur.enabled === null) return false;
    return asBool(cur.enabled, false);
  } catch {
    return false;
  }
}

/** SESI-FINAL-APP: merchant mewajibkan foto bukti bayar di PayScreen.
 * Parser toleran lokal (tanpa impor terminalApi — nol-risiko siklus):
 * top-level ATAU nested posBehaviorSettings/posBehavior/pb/paymentSettings/
 * payment_settings — varian snake_case ikut dibaca. Absen/error = false. */
function parseRequireProof(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  const nested: Array<Record<string, unknown>> = [];
  for (const k of ['posBehaviorSettings', 'posBehavior', 'pb', 'pos_behavior', 'paymentSettings', 'payment_settings', 'payment', 'settings']) {
    const v = o[k];
    if (v && typeof v === 'object') nested.push(v as Record<string, unknown>);
  }
  const cands: unknown[] = [o.requirePaymentProof, o.require_payment_proof, o.proofRequired, o.proof_required];
  for (const n of nested) cands.push(n.requirePaymentProof, n.require_payment_proof, n.proofRequired, n.proof_required);
  for (const c of cands) {
    if (c === undefined || c === null) continue;
    if (typeof c === 'boolean') return c;
    if (typeof c === 'number') return c !== 0;
    const s = String(c).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'ya' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'tidak' || s === 'no') return false;
  }
  return false;
}

/** SESI-FINAL-APP: wajibkah foto bukti bayar? (absen/error = false). */
export async function getRequirePaymentProof(): Promise<boolean> {
  try {
    const cur = await getJSON<{ required?: unknown } | null>(REQUIRE_PROOF_KEY, null);
    if (!cur || cur.required === undefined || cur.required === null) return false;
    if (typeof cur.required === 'boolean') return cur.required;
    return String(cur.required).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/** R4-4: snapshot metode bayar merchant (server-wins tiap sync; absen/error =
 *  semua-true = tampil semua = perilaku lama). Cache korup/parsial
 *  dinormalisasi via parse (bukan dibuang) agar satu kunci asing tak
 *  mengunci kasir. */
export async function getPaymentMethods(): Promise<PaymentMethods> {
  try {
    const cur = await getJSON<Partial<PaymentMethods> | null>(PAYMENT_METHODS_KEY, null);
    if (!cur || typeof cur !== 'object') return { ...PAYMENT_METHODS_DEFAULT };
    return parsePaymentMethods(cur);
  } catch {
    return { ...PAYMENT_METHODS_DEFAULT };
  }
}
