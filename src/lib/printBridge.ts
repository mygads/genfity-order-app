// Poller print-bridge slice penuh (FULL, BE 50fd533): antrean cetak terminal.
// Satu siklus = claim → kirim byte ke printer → ack. Tak pernah throw:
// offline/antre-kosong = idle ('empty'), error auth/server = 'error'
// (permukaan auth ditangani layar lain; poller tak boleh mencetak saat ragu).
//
// Aturan server-wins (cermin validatePosVoucherPreview P1-2):
// - Klaim 200 → job milik server; cetak lalu ack sesuai hasil kirim.
// - Tanpa job (204/offline) → idle, TANPA fallback lokal (SQLite tak kenal
//   id job server; antrean lokal tetap milik printqueue.ts).
// - Ack lease basi (409) → catat, jangan retry buta (job kembali ke antrean
//   saat lease kedaluwarsa via klaim berikut).
// - printFn disuntik pemanggil (resolveDrainTarget print.ts) agar modul ini
//   tak mengimpor native/printer dan tetap bisa diuji tanpa runtime RN.

import { ApiPath } from '../config/server';
import { apiFetch, unwrap } from './apiSource';
import { fromBase64 } from './escpos';
import type { EscKitchenTicket, EscReceipt } from './escpos';
import type { PrinterTarget, PrintResult } from '../native/printer';
import type { ServerHistoryEntry, ServerOrderDetail } from './posWire';
import { AppState } from 'react-native';

export interface ServerPrintJob {
  id: number;
  orderId: string | null;
  attempt: number;
  idempotencyKey: string;
  source: string;
  payload: string;
  payloadHash: string;
  leaseToken: string;
  leaseExpiresInSeconds: number;
  /**
   * KONTRAK FINAL AUTO (BE menulis, APP merender): metadata JSON
   * {orderId, paymentId?, templateType:'customer'|'kitchen'}.
   * payload_base64 job AUTO = '' (kosong) — JANGAN dicetak buta
   * (lihat isAutoPrintJob + printAutoServerJob di bawah).
   */
  metadata: AutoJobMetadata | null;
}

/** Metadata kontrak job AUTO terminal_print_jobs. */
export interface AutoJobMetadata {
  orderId?: string;
  paymentId?: string;
  templateType?: string;
}

/** Ambil string metadata toleran snake_case/camelCase ala posWire. */
function metaStr(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v));
  return '';
}

export type ClaimOutcome =
  | { state: 'job'; job: ServerPrintJob }
  | { state: 'empty' }
  | { state: 'error'; status: number };

export type PollOutcome =
  | { state: 'printed'; jobId: number }
  | { state: 'failed'; jobId: number; serverStatus: string }
  | { state: 'empty' }
  | { state: 'error'; status: number };

/** Isi placeholder {id} (+{jobId} opsional) ala pathWithId tanpa impor posWire. */
export function fillPrintPath(tmpl: string, terminalId: string | number, jobId?: string | number): string {
  let out = String(tmpl).replace('{id}', encodeURIComponent(String(terminalId)));
  if (jobId !== undefined) out = out.replace('{jobId}', encodeURIComponent(String(jobId)));
  return out;
}

function asJob(raw: unknown): ServerPrintJob | null {
  const u = unwrap<Record<string, unknown>>(raw);
  const j = (u.data as Record<string, unknown>)?.job as Record<string, unknown> | undefined;
  if (!j || typeof j.id !== 'number' || typeof j.payload !== 'string' || typeof j.leaseToken !== 'string') return null;
  let metadata: AutoJobMetadata | null = null;
  const rm = j.metadata;
  if (rm && typeof rm === 'object') {
    const m = rm as Record<string, unknown>;
    const orderId = metaStr(m.orderId ?? m.order_id);
    const paymentId = metaStr(m.paymentId ?? m.payment_id);
    const templateType = metaStr(m.templateType ?? m.template_type);
    if (orderId || paymentId || templateType) {
      metadata = {
        ...(orderId ? { orderId } : {}),
        ...(paymentId ? { paymentId } : {}),
        ...(templateType ? { templateType } : {}),
      };
    }
  }
  return {
    id: j.id,
    orderId: typeof j.orderId === 'string' ? j.orderId : null,
    attempt: typeof j.attempt === 'number' ? j.attempt : 0,
    idempotencyKey: typeof j.idempotencyKey === 'string' ? j.idempotencyKey : '',
    source: typeof j.source === 'string' ? j.source : '',
    payload: j.payload,
    payloadHash: typeof j.payloadHash === 'string' ? j.payloadHash : '',
    leaseToken: j.leaseToken,
    leaseExpiresInSeconds: typeof j.leaseExpiresInSeconds === 'number' ? j.leaseExpiresInSeconds : 0,
    metadata,
  };
}

export interface FanoutJob {
  destinationId: number;
  destinationName: string;
  kind: string;
  jobId: number;
  duplicate: boolean;
}

export interface FanoutOutcome {
  ok: boolean;
  terminalId?: string;
  jobs: FanoutJob[];
  error?: string;
}

/**
 * Fan-out cetak (BE kontrak baru): POST
 * /api/v1/terminals/{id}/print-fanout
 * {orderId?,idempotencyKey,source:'MANUAL'|'AUTO',payloadBase64,metadata?} →
 * 201 {data:{terminalId,jobs:[{destinationId,destinationName,kind,jobId,
 * duplicate}]}}. Station kind dapur otomatis dikecualikan BE untuk MANUAL.
 * Tak pernah melempar: offline/BE-error = {ok:false} (pemanggil fallback ke
 * antrean lokal printqueue).
 */
export async function postPrintFanout(
  terminalIdBe: string | number,
  input: {
    idempotencyKey: string;
    source: 'MANUAL' | 'AUTO';
    payloadBase64: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<FanoutOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { ok: false, jobs: [], error: 'terminalId required' };
  if (!input.idempotencyKey.trim() || !input.payloadBase64.trim()) {
    return { ok: false, jobs: [], error: 'idempotencyKey + payloadBase64 required' };
  }
  let r;
  try {
    r = await apiFetch(fillPrintPath(ApiPath.terminalPrintFanout, terminalIdBe), {
      method: 'POST',
      body: {
        ...(input.orderId ? { orderId: input.orderId } : {}),
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        payloadBase64: input.payloadBase64,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  } catch {
    return { ok: false, jobs: [], error: 'offline' };
  }
  if (!r.ok) return { ok: false, jobs: [], error: 'fanout failed' };
  const u = unwrap<Record<string, unknown>>(r.data);
  const d = (u.data ?? {}) as Record<string, unknown>;
  const jobs = Array.isArray(d.jobs) ? d.jobs : [];
  return {
    ok: true,
    terminalId: typeof d.terminalId === 'string' ? d.terminalId : undefined,
    jobs: jobs
      .map((j) => {
        if (!j || typeof j !== 'object') return null;
        const o = j as Record<string, unknown>;
        const jobId = Number(o.jobId ?? o.id);
        const destId = Number(o.destinationId);
        if (!Number.isFinite(jobId) || !Number.isFinite(destId)) return null;
        return {
          destinationId: Math.round(destId),
          destinationName: typeof o.destinationName === 'string' ? o.destinationName : '',
          kind: typeof o.kind === 'string' ? o.kind : '',
          jobId: Math.round(jobId),
          duplicate: o.duplicate === true,
        } satisfies FanoutJob;
      })
      .filter((j): j is FanoutJob => j !== null),
  };
}

/**
 * Tugas G: fan-out OTOMATIS struk pasca-bayar (source AUTO).
 * Dipanggil fire-and-forget dari ReceiptScreen.doPrint saat autoPrint
 * pasca-Success (bukan cetak manual — manual tak membuat server jobs).
 * - idempotencyKey = client_id rantai bayar (stabil per sale; BE dedup
 *   per station `{base}:station-{destinationId}`, replay ganda aman).
 * - orderId = id order server numerik bila tertaut (BE menolak non-numerik;
 *   tanpa tautan = dihilangkan, bukan 'TRX-…' display).
 * - terminalIdBe diresolve dari klaim device (branchId+terminalCode →
 *   daftar terminal cabang); tanpa klaim/BE-id = {ok:false} jujur.
 * - Gagal/offline = fallback antrean lokal persisten (kind 'receipt',
 *   target null → drain kind-aware; tak pernah melempar). Anti-ganda:
 *   pemanggil meneruskan `alreadyQueued` dari outcome lokal (jalur lokal
 *   print.ts SUDAH mengantre per-station saat kirim gagal) — fallback di
 *   sini hanya jalan bila lokal BELUM mengantre.
 */
export async function fanoutReceiptAuto(input: {
  orderNo: string;
  clientId: string;
  payloadBase64: string;
  /** true = jalur lokal SUDAH mengantre byte ini (outcome `queued`) —
   * fallback lokal dilewati agar drain tak mencetak ganda. */
  alreadyQueued?: boolean;
}): Promise<FanoutOutcome> {
  const fail = (error: string): FanoutOutcome => ({ ok: false, jobs: [], error });
  const payloadBase64 = String(input?.payloadBase64 ?? '').trim();
  const clientId = String(input?.clientId ?? '').trim().slice(0, 120);
  const orderNo = String(input?.orderNo ?? '').trim();
  if (!payloadBase64 || !clientId) return fail('payload + clientId required');
  try {
    // Lazy-require: terminalApi mengimpor session (lazy) — impor statis di
    // sini berisiko siklus modul saat app boot (pola sama session.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTerminal } = require('../config/server') as typeof import('../config/server');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchBranchTerminals } = require('./terminalApi') as typeof import('./terminalApi');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getServerOrderIdForSale } = require('./posWire') as typeof import('./posWire');
    // PB server-wins: tanpa fallback antrean lokal (SQLite tak kenal id job server).
    const g = getTerminal();
    const termCode = String(g?.terminalCode ?? '').trim().toUpperCase();
    const branchId = String(g?.branchId ?? '').trim();
    if (!termCode || !branchId) return fail('terminal-unclaimed');
    const list = await fetchBranchTerminals(branchId);
    if (!list.ok) return fail(`fleet-${list.status}`);
    const hit = list.data.terminals.find(
      (x) => String(x.terminalCode ?? '').trim().toUpperCase() === termCode,
    );
    const beId = String(hit?.terminalId ?? '').trim();
    if (!beId) return fail('no-terminal-id');
    let orderId: string | undefined;
    try {
      const sid = await getServerOrderIdForSale(orderNo);
      if (typeof sid === 'number' && Number.isFinite(sid) && sid > 0) orderId = String(Math.round(sid));
    } catch {
      /* tanpa tautan server = orderId dihilangkan */
    }
    const r = await postPrintFanout(beId, {
      ...(orderId ? { orderId } : {}),
      idempotencyKey: clientId,
      source: 'AUTO',
      payloadBase64,
      metadata: { salesNum: orderNo, origin: 'payment-auto' },
    });
    // PB server-wins: gagal = outcome jujur, tanpa antrean lokal (fail-closed, tak melempar).
    return r;
  } catch {
    return fail('offline');
  }
}

/** Klaim satu job FIFO untuk terminal ini. */
export function isAutoPrintJob(job: ServerPrintJob): boolean {
  if (!job) return false;
  // KONTRAK FINAL: source='AUTO' (payload_base64='' + metadata.orderId).
  // Bentuk lama/toleran: payload kosong + metadata.orderId ikut AUTO agar
  // byte kosong tak pernah keluar kertas.
  if (String(job.source ?? '').trim().toUpperCase() === 'AUTO') return true;
  return !String(job.payload ?? '').trim() && !!String(job.metadata?.orderId ?? '').trim();
}

export type AutoPrintOutcome =
  // `printed` = kertas keluar ATAU byte aman di antrean lokal persisten
  // (via='queue'; drain kind-aware mengurasnya — tak hangus, retry bounded).
  | { state: 'printed'; via: 'stations' | 'queue'; detail: string }
  | { state: 'failed'; errorCode: string; lastError: string }
  // `unavailable` = order/template tak tersedia (offline): pemanggil ack
  // FAILED ORDER_UNAVAILABLE agar BE me-retry via backoff — tanpa spam.
  | { state: 'unavailable'; reason: 'offline' | 'not-found' };

/**
 * Cari order server untuk job AUTO via API yang sudah ada
 * (pullServerHistory — satu-satunya snapshot ber-items; active tak membawa
 * items sehingga tak bisa dirender). Cocok id ATAU nomor display.
 */
async function findAutoOrder(
  orderId: string,
): Promise<{ entry: ServerHistoryEntry } | { offline: true } | { missing: true }> {
  const want = String(orderId ?? '').trim();
  if (!want) return { missing: true };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pullServerHistory } = require('./posWire') as typeof import('./posWire');
    const r = await pullServerHistory(100);
    if (!r.ok) return { offline: true };
    const hit = (r.data ?? []).find(
      (e) => String(e.id ?? '').trim() === want || String(e.orderNumber ?? '').trim() === want,
    );
    return hit ? { entry: hit } : { missing: true };
  } catch {
    return { offline: true };
  }
}

/**
 * Tiket dapur dari DETAIL penuh BE (sumber utama AUTO kitchen): items +
 * addons (dilipat ke baris note `+ addon`) + notes + meja/mode/waktu.
 * templateType kitchen HANYA ke station dapur (printKitchenTicket) — tak
 * pernah ke station kasir (tiket dapur tanpa harga).
 */
async function printDetailKitchenTicket(
  printLib: typeof import('./print'),
  detail: ServerOrderDetail,
  orderId: string,
): Promise<AutoPrintOutcome> {
  const ticket: EscKitchenTicket = {
    station: 'dapur',
    no: String(detail.orderNumber || detail.id || orderId),
    ...(detail.tableNumber ? { table: detail.tableNumber } : {}),
    ...(detail.orderType ? { mode: detail.orderType } : {}),
    ...((detail.paidAt || detail.createdAt) ? { time: detail.paidAt || detail.createdAt } : {}),
    items: detail.items.map((it) => {
      const addonPart = it.addons.length > 0 ? `+ ${it.addons.map((a) => a.name).join(', + ')}` : '';
      const noteParts = [String(it.note ?? '').trim(), addonPart].filter((s) => s);
      return {
        name: String(it.name || '-'),
        qty: Math.max(1, Math.round(it.qty) || 1),
        ...(noteParts.length > 0 ? { note: noteParts.join(' | ') } : {}),
      };
    }),
  };
  const res = await printLib.printKitchenTicket('dapur', ticket);
  if (res.ok) return { state: 'printed', via: 'stations', detail: res.printer };
  if (res.queued) return { state: 'printed', via: 'queue', detail: res.queuedId ?? '' };
  return { state: 'failed', errorCode: 'PRINT_FAILED', lastError: String(res.detail ?? res.reason ?? 'kitchen send failed') };
}

/**
 * Struk pelanggan dari DETAIL penuh BE (sumber utama AUTO customer): cermin
 * ReceiptScreen.doPrint — subtotal, discount, service (+serviceLabel sadar
 * server via totals.ts), tip, tax info-only, packaging, voucherCode,
 * delivery (ongkir), total, method, paid/change (tunai + toggle template),
 * cashier (paidBy BE) + meja/pelanggan, datetime, thanks/footer/branding
 * template. templateType customer HANYA ke stations non-dapur (broadcast
 * printReceiptData di print.ts).
 */
async function printDetailReceipt(
  printLib: typeof import('./print'),
  detail: ServerOrderDetail,
  orderId: string,
): Promise<AutoPrintOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tplLib = require('./receiptTemplate') as typeof import('./receiptTemplate');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCachedCurrency } = require('./currency') as typeof import('./currency');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tOf, getLang } = require('./i18n') as typeof import('./i18n');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getTerminal } = require('../config/server') as typeof import('../config/server');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const totalsLib = require('./totals') as typeof import('./totals');
  const tplOn = await tplLib.hasReceiptTemplate();
  const tpl = await tplLib.getReceiptTemplateToggles();
  const tp = tplOn ? tpl : null;
  const lang = getLang();
  const tplLang = (tpl.receiptLanguage ?? lang) as 'id' | 'en';
  let svcCfg = totalsLib.SERVICE_LEGACY;
  try {
    svcCfg = await totalsLib.getServiceConfig();
  } catch {
    /* label service legacy */
  }
  const svcLabel = totalsLib.serviceLabel((k: string) => tOf(k, lang), svcCfg);
  let shopName = 'Genfity';
  try {
    shopName = String(getTerminal()?.branchName ?? '').trim() || 'Genfity';
  } catch {
    /* default */
  }
  const no = String(detail.orderNumber || detail.id || orderId);
  const orderType = String(detail.orderType ?? '');
  const cashierLineTpl = [
    tp && tp.showCashierName ? detail.cashierName : '',
    tp && !tp.showTableNumber ? '' : detail.tableNumber,
    tp && !(tp.showCustomerName || tp.showCustomerPhone) ? '' : detail.customerName,
  ].map((s) => String(s ?? '').trim()).filter((s) => s).join(' · ');
  const cashierLineLegacy = [detail.cashierName, detail.tableNumber, detail.customerName]
    .map((s) => String(s ?? '').trim()).filter((s) => s).join(' · ');
  const method = String(detail.paymentMethod ?? '');
  const isCash = /cash|tunai/i.test(method);
  const receipt: EscReceipt = {
    shop: (!tp || tp.showMerchantName) ? shopName.toUpperCase() : '',
    trx: tplOn
      ? [tpl.showOrderNumber ? `No: ${no}` : '', tpl.showOrderType ? orderType : '']
        .map((s) => s.trim()).filter((s) => s).join(' - ')
      : `No: ${no}${orderType ? ` - ${orderType}` : ''}`,
    ...((tplOn ? cashierLineTpl : cashierLineLegacy) ? { cashier: tplOn ? cashierLineTpl : cashierLineLegacy } : {}),
    ...(((!tp || tp.showDateTime) && (detail.paidAt || detail.createdAt))
      ? { datetime: String(detail.paidAt || detail.createdAt) } : {}),
    currency: getCachedCurrency().code,
    items: detail.items.map((it) => ({
      name: String(it.name || '-'),
      qty: Math.max(1, Math.round(it.qty) || 1),
      price: Math.max(0, Math.round(it.price) || 0),
      ...(tp?.showItemNotes && it.note ? { note: String(it.note) } : {}),
      ...(tp?.showAddons
        ? { addons: it.addons.map((a) => ({ name: a.name, price: tp?.showAddonPrices ? Math.max(0, Math.round(a.price) || 0) : 0 })) }
        : {}),
    })),
    subtotal: Math.max(0, Math.round(detail.subtotal) || 0),
    ...((tp && !tp.showSubtotal) ? { hideSubtotal: true } : {}),
    ...((detail.discount > 0 && (!tp || tp.showDiscount))
      ? { discount: Math.max(0, Math.round(detail.discount)) } : {}),
    ...((detail.service > 0 && (!tp || tp.showServiceCharge))
      ? { service: Math.max(0, Math.round(detail.service)), ...(svcLabel ? { serviceLabel: svcLabel } : {}) }
      : {}),
    ...((detail.tip > 0) ? { tip: Math.max(0, Math.round(detail.tip)) } : {}),
    ...((detail.tax > 0 && (!tp || tp.showTax))
      ? { tax: Math.max(0, Math.round(detail.tax)) } : {}),
    ...((detail.packaging > 0 && (!tp || tp.showPackagingFee))
      ? { packaging: Math.max(0, Math.round(detail.packaging)) } : {}),
    ...(detail.voucherCode ? { voucherCode: detail.voucherCode } : {}),
    ...((detail.delivery > 0 && (!tp || tp.showDeliveryFee))
      ? { ongkir: Math.max(0, Math.round(detail.delivery)) } : {}),
    total: Math.max(0, Math.round(detail.total) || 0),
    ...((tp && !tp.showTotal) ? { hideTotal: true } : {}),
    ...(((!tp || tp.showPaymentMethod) && method) ? { method } : {}),
    ...((isCash && detail.amountPaid > 0 && (!tp || tp.showAmountPaid))
      ? { paid: Math.max(0, Math.round(detail.amountPaid)) } : {}),
    ...((isCash && detail.changeAmount > 0 && (!tp || tp.showChange))
      ? { change: Math.max(0, Math.round(detail.changeAmount)) } : {}),
    ...(tplOn
      ? {
        thanks: tpl.showThankYouMessage
          ? (tpl.customThankYouMessage || (tplLang === 'en' ? 'Thank you for your order!' : 'Terima kasih atas pesanan Anda!'))
          : '',
      }
      : { thanks: tOf('rc_thanks', lang) }),
    ...(tplOn && tpl.showCustomFooterText && tpl.customFooterText ? { footer: tpl.customFooterText } : {}),
    ...(tplOn && tpl.showGenfityBranding
      ? { branding: tplLang === 'en' ? 'Powered by Genfity' : 'Diberdayakan oleh Genfity' }
      : {}),
  };
  const res = await printLib.printReceiptData(receipt);
  if (res.ok) return { state: 'printed', via: 'stations', detail: res.printer };
  if (res.queued) return { state: 'printed', via: 'queue', detail: res.queuedId ?? '' };
  return { state: 'failed', errorCode: 'PRINT_FAILED', lastError: String(res.detail ?? res.reason ?? 'receipt send failed') };
}

/**
 * Render + cetak job AUTO (KONTRAK FINAL): ambil DETAIL PENUH order via
 * fetchMerchantOrderDetail (posWire → MerchantOrderDetailGet) — 1:1 website:
 * orderItems (+addons, notes), subtotal, discount, tax, service,
 * packaging, delivery, tip, total, paid, change, payment method, cashier —
 * lalu rakit ESC/POS memakai cache template BE (receiptTemplate.ts; tanpa
 * template = perilaku legacy byte-identik) + currency cabang → cetak ke
 * stations non-dapur (templateType customer, broadcast per cols/cut) atau
 * station dapur (templateType kitchen). Snapshot pullServerHistory HANYA
 * fallback bila detail gagal (blocked non-numerik / 404 / parse) — baris
 * yang tak dibawa riwayat (service/packaging/delivery/tip/paid/change)
 * dihilangkan jujur di jalur fallback. Gagal kirim/printer absen = byte
 * MASUK antrean offline printqueue via print.ts (kind receipt/kitchen;
 * drain kind-aware, retry bounded) — bukan hangus, bukan spam retry.
 * Tak pernah melempar; ack tetap milik pemanggil.
 */
export async function printAutoServerJob(job: ServerPrintJob): Promise<AutoPrintOutcome> {
  const orderId = String(job.metadata?.orderId ?? job.orderId ?? '').trim();
  if (!orderId) {
    return { state: 'failed', errorCode: 'AUTO_NO_ORDER', lastError: 'Job AUTO tanpa orderId di metadata' };
  }
  const tplType = String(job.metadata?.templateType ?? '').trim().toLowerCase();
  const isKitchen = tplType === 'kitchen' || tplType === 'dapur' || tplType === 'tiket_dapur';
  // Lazy-require ala fanoutReceiptAuto: print.ts menarik native/printer —
  // impor statis berisiko siklus modul saat app boot.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const printLib = require('./print') as typeof import('./print');
  // SUMBER UTAMA: detail penuh BE (MerchantOrderDetailGet). Offline di sini
  // = unavailable jujur (order tak tersedia); blocked/error = fallback
  // riwayat di bawah (no display non-numerik, 404, respons buruk).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchMerchantOrderDetail } = require('./posWire') as typeof import('./posWire');
    const r = await fetchMerchantOrderDetail(orderId);
    if (r.ok) {
      try {
        if (isKitchen) return await printDetailKitchenTicket(printLib, r.data, orderId);
        return await printDetailReceipt(printLib, r.data, orderId);
      } catch {
        return { state: 'failed', errorCode: 'AUTO_RENDER_FAILED', lastError: 'render exception' };
      }
    }
    if (r.reason === 'offline') return { state: 'unavailable', reason: 'offline' };
  } catch {
    /* jatuh ke fallback riwayat */
  }
  const found = await findAutoOrder(orderId);
  if ('offline' in found) return { state: 'unavailable', reason: 'offline' };
  if ('missing' in found) return { state: 'unavailable', reason: 'not-found' };
  const entry = found.entry;
  try {
    if (isKitchen) {
      const ticket: EscKitchenTicket = {
        station: 'dapur',
        no: String(entry.orderNumber || entry.id || orderId),
        ...(entry.tableNumber ? { table: entry.tableNumber } : {}),
        ...(entry.orderType ? { mode: entry.orderType } : {}),
        ...((entry.paidAt || entry.createdAt) ? { time: entry.paidAt || entry.createdAt } : {}),
        items: (entry.items ?? []).map((it) => ({
          name: String(it.name ?? '-'),
          qty: Math.max(1, Math.round(Number(it.qty) || 1)),
          ...(it.note ? { note: String(it.note) } : {}),
        })),
      };
      const res = await printLib.printKitchenTicket('dapur', ticket);
      if (res.ok) return { state: 'printed', via: 'stations', detail: res.printer };
      if (res.queued) return { state: 'printed', via: 'queue', detail: res.queuedId ?? '' };
      return { state: 'failed', errorCode: 'PRINT_FAILED', lastError: String(res.detail ?? res.reason ?? 'kitchen send failed') };
    }
    // Struk pelanggan: gerbang template cermin ReceiptScreen.doPrint
    // (tplOn + tp; tanpa TemplateJSON = legacy). Riwayat server tak membawa
    // service/packaging/tip/feeESB/paid/change — baris itu dihilangkan jujur
    // (bukan dikarang), method + tendered tak ditampilkan tanpa data.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tplLib = require('./receiptTemplate') as typeof import('./receiptTemplate');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCachedCurrency } = require('./currency') as typeof import('./currency');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tOf, getLang } = require('./i18n') as typeof import('./i18n');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTerminal } = require('../config/server') as typeof import('../config/server');
    const tplOn = await tplLib.hasReceiptTemplate();
    const tpl = await tplLib.getReceiptTemplateToggles();
    const tp = tplOn ? tpl : null;
    const lang = getLang();
    const tplLang = (tpl.receiptLanguage ?? lang) as 'id' | 'en';
    let shopName = 'Genfity';
    try {
      shopName = String(getTerminal()?.branchName ?? '').trim() || 'Genfity';
    } catch {
      /* default */
    }
    const no = String(entry.orderNumber || entry.id || orderId);
    const orderType = String(entry.orderType ?? '');
    const custParts = [
      ...(tp && !tp.showTableNumber ? [] : [entry.tableNumber]),
      ...(tp && !tp.showCustomerName ? [] : [entry.customerName]),
    ].map((s) => String(s ?? '').trim()).filter((s) => s);
    const receipt: EscReceipt = {
      shop: (!tp || tp.showMerchantName) ? shopName.toUpperCase() : '',
      trx: tplOn
        ? [tpl.showOrderNumber ? `No: ${no}` : '', tpl.showOrderType ? orderType : '']
          .map((s) => s.trim()).filter((s) => s).join(' - ')
        : `No: ${no}${orderType ? ` - ${orderType}` : ''}`,
      ...(custParts.length > 0 ? { cashier: custParts.join(' · ') } : {}),
      ...(((!tp || tp.showDateTime) && (entry.paidAt || entry.createdAt))
        ? { datetime: String(entry.paidAt || entry.createdAt) } : {}),
      currency: getCachedCurrency().code,
      items: (entry.items ?? []).map((it) => ({
        name: String(it.name ?? '-'),
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        price: Math.max(0, Math.round(Number(it.price) || 0)),
        ...(tp?.showItemNotes && it.note ? { note: String(it.note) } : {}),
      })),
      subtotal: Math.max(0, Math.round(Number(entry.subtotal) || 0)),
      ...((tp && !tp.showSubtotal) ? { hideSubtotal: true } : {}),
      ...((Number(entry.discount) > 0 && (!tp || tp.showDiscount))
        ? { discount: Math.max(0, Math.round(Number(entry.discount))) } : {}),
      ...((Number(entry.tax) > 0 && (!tp || tp.showTax))
        ? { tax: Math.max(0, Math.round(Number(entry.tax))) } : {}),
      total: Math.max(0, Math.round(Number(entry.total) || 0)),
      ...((tp && !tp.showTotal) ? { hideTotal: true } : {}),
      ...(((!tp || tp.showPaymentMethod) && entry.paymentMethod) ? { method: String(entry.paymentMethod) } : {}),
      ...(tplOn
        ? {
          thanks: tpl.showThankYouMessage
            ? (tpl.customThankYouMessage || (tplLang === 'en' ? 'Thank you for your order!' : 'Terima kasih atas pesanan Anda!'))
            : '',
        }
        : { thanks: tOf('rc_thanks', lang) }),
      ...(tplOn && tpl.showCustomFooterText && tpl.customFooterText ? { footer: tpl.customFooterText } : {}),
      ...(tplOn && tpl.showGenfityBranding
        ? { branding: tplLang === 'en' ? 'Powered by Genfity' : 'Diberdayakan oleh Genfity' }
        : {}),
    };
    const res = await printLib.printReceiptData(receipt);
    if (res.ok) return { state: 'printed', via: 'stations', detail: res.printer };
    if (res.queued) return { state: 'printed', via: 'queue', detail: res.queuedId ?? '' };
    return { state: 'failed', errorCode: 'PRINT_FAILED', lastError: String(res.detail ?? res.reason ?? 'receipt send failed') };
  } catch {
    return { state: 'failed', errorCode: 'AUTO_RENDER_FAILED', lastError: 'render exception' };
  }
}

/** Klaim satu job FIFO untuk terminal ini. */export async function claimTerminalPrintJob(terminalIdBe: string | number): Promise<ClaimOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { state: 'error', status: 400 };
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintClaim, terminalIdBe), { method: 'POST', body: {} });
  if (!r.ok) {
    // 204 (json kosong) + offline + dummy → fromDummy; 401/403/5xx → error.
    if (r.fromDummy) return { state: 'empty' };
    return { state: 'error', status: r.status };
  }
  const job = asJob(r.data);
  return job ? { state: 'job', job } : { state: 'empty' };
}

export interface EnqueueOutcome {
  ok: boolean;
  jobId?: number;
  status?: string;
  duplicate?: boolean;
  error?: string;
}

/** Enqueue byte ESC-POS (sudah base64) ke terminal — jalur kasir yang jujur. */
export async function enqueueTerminalPrintJob(
  terminalIdBe: string | number,
  input: { idempotencyKey: string; payloadBase64: string; source?: string; maxAttempts?: number },
): Promise<EnqueueOutcome> {
  if (!String(terminalIdBe ?? '').trim()) return { ok: false, error: 'terminalId required' };
  if (!input.idempotencyKey.trim() || !input.payloadBase64.trim()) {
    return { ok: false, error: 'idempotencyKey + payloadBase64 required' };
  }
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintEnqueue, terminalIdBe), {
    method: 'POST',
    body: { idempotencyKey: input.idempotencyKey, source: input.source ?? 'MANUAL', payloadBase64: input.payloadBase64, maxAttempts: input.maxAttempts },
  });
  if (!r.ok) return { ok: false, error: 'enqueue failed' };
  const u = unwrap<Record<string, unknown>>(r.data);
  const d = u.data as Record<string, unknown>;
  const id = typeof d?.id === 'number' ? d.id : Number(d?.id);
  if (!Number.isFinite(id)) return { ok: false, error: 'bad response' };
  return { ok: true, jobId: id, status: typeof d?.status === 'string' ? d.status : undefined, duplicate: (r.data as { duplicate?: boolean })?.duplicate };
}

/** Ack hasil cetak; printed=false wajib sertakan errorCode agar BE catat. */
export async function ackTerminalPrintJob(
  terminalIdBe: string | number,
  jobId: number,
  leaseToken: string,
  printed: boolean,
  errorCode?: string,
  lastError?: string,
): Promise<{ ok: boolean; status?: string }> {
  const r = await apiFetch(fillPrintPath(ApiPath.terminalPrintAck, terminalIdBe, jobId), {
    method: 'POST',
    body: printed
      ? { leaseToken, status: 'PRINTED' }
      : { leaseToken, status: 'FAILED', errorCode: errorCode ?? 'PRINT_FAILED', lastError: lastError ?? 'Printer reported failure' },
  });
  if (!r.ok) return { ok: false };
  const u = unwrap<Record<string, unknown>>(r.data);
  const j = (u.data as Record<string, unknown>)?.job as Record<string, unknown> | undefined;
  const s = j?.status;
  return { ok: true, status: typeof s === 'string' ? s : undefined };
}

/**
 * Satu siklus poller: claim → kirim byte → ack.
 * - printed → ack PRINTED → {printed}.
 * - kirim gagal/exception → ack FAILED (printer siap retry via BE backoff).
 * - decode base64 rusak → ack FAILED INVALID_PAYLOAD (racun antrean jangan
 *   muter selamanya; BE habiskan attempt lalu FAILED final).
 * - KONTRAK FINAL AUTO: source=AUTO (atau payload kosong + metadata.orderId)
 *   → JANGAN cetak byte kosong; render ESC/POS dari order server + template
 *   BE via printAutoServerJob (customer → stations non-dapur, kitchen →
 *   station dapur). Order tak tersedia (offline) → ack FAILED
 *   ORDER_UNAVAILABLE (BE backoff retry; tanpa spam, tanpa hangus).
 */
export async function pollServerPrintJobs(
  terminalIdBe: string | number,
  target: PrinterTarget,
  printFn: (target: PrinterTarget, bytes: Uint8Array) => Promise<PrintResult>,
): Promise<PollOutcome> {
  const claimed = await claimTerminalPrintJob(terminalIdBe);
  if (claimed.state !== 'job') return claimed;
  const { job } = claimed;
  if (isAutoPrintJob(job)) {
    const auto = await printAutoServerJob(job);
    if (auto.state === 'printed') {
      await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, true);
      return { state: 'printed', jobId: job.id };
    }
    const code = auto.state === 'unavailable'
      ? 'ORDER_UNAVAILABLE'
      : auto.errorCode;
    const err = auto.state === 'unavailable'
      ? `order ${String(job.metadata?.orderId ?? job.orderId ?? '')} ${auto.reason}`
      : auto.lastError;
    const ack = await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, false, code, err);
    return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(job.payload);
  } catch {
    const ack = await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, false, 'INVALID_PAYLOAD', 'Payload is not valid base64');
    return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
  }
  // KONTRAK FINAL AUTO (lubang cetak-buta): fromBase64('') = byte kosong TANPA
  // throw — tanpa penjaga ini payload kosong lolos ke printFn lalu bisa di-ack
  // PRINTED palsu. Byte kosong TAK PERNAH dicetak; ack FAILED INVALID_PAYLOAD
  // agar BE habiskan attempt lalu FAILED final (racun tak muter selamanya).
  if (bytes.length === 0) {
    const ack = await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, false, 'INVALID_PAYLOAD', 'Payload kosong — tak dicetak buta (bukan job AUTO sah)');
    return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
  }
  let sent: PrintResult;
  try {
    sent = await printFn(target, bytes);
  } catch {
    sent = { ok: false, reason: 'send-failed', detail: 'printFn threw' };
  }
  if (sent.ok) {
    await ackTerminalPrintJob(terminalIdBe, job.id, job.leaseToken, true);
    return { state: 'printed', jobId: job.id };
  }
  const ack = await ackTerminalPrintJob(
    terminalIdBe,
    job.id,
    job.leaseToken,
    false,
    sent.reason === 'need-dev-client' ? 'NO_PRINTER_MODULE' : 'PRINT_FAILED',
    sent.detail ?? sent.reason,
  );
  return { state: 'failed', jobId: job.id, serverStatus: ack.status ?? 'QUEUED' };
}

// ---------------------------------------------------------------------------
// Auto-poll job terminal (tugas B): interval 20 detik, SATU loop global
// (idempoten — start ganda = no-op, anti double dengan poller bridge lain).
// Tiap tick: AppState active + sesi login + terminal ter-bind (branchId +
// terminalCode klaim) + mode online + id BE terminal via daftar cabang →
// SATU siklus pollServerPrintJobs (claim → cetak/ack). Job AUTO tak butuh
// printer siap (printAutoServerJob mengantre persisten bila printer absen);
// job MANUAL non-AUTO memakai station struk default (drain-target receipt).
// Guard anti-overlap: tick yang masih jalan menahan tick berikut (jaringan
// lambat tak menumpuk klaim). Berhenti via stop (unbind/logout/cleanup efek
// App) + AppState listener dilepas. Tak pernah melempar; diam saat
// prasyarat tak terpenuhi (tanpa spam status).
// Tombol tarik manual (PrintersScreen.pullServerJobs) tetap ada dan tak
// berubah — loop ini hanya otomatisasi siklus yang sama.
// ---------------------------------------------------------------------------
export const TERMINAL_AUTO_PRINT_POLL_MS = 20000;

let terminalAutoPollTimer: ReturnType<typeof setInterval> | null = null;
let terminalAutoPollBusy = false;
let terminalAutoPollAppSub: { remove: () => void } | null = null;
/**
 * printFn disuntik pemanggil (App menyuntik printBytes native/printer) —
 * modul ini TETAP tanpa impor nilai native/printer (tripwire PB-4; poll
 * semua runtime, diuji tanpa RN). Tanpa suntikan = tick diam (tak klaim).
 */
export type TerminalAutoPollPrintFn = (
  target: PrinterTarget,
  bytes: Uint8Array,
) => Promise<PrintResult>;

let terminalAutoPollPrintFn: TerminalAutoPollPrintFn | null = null;

async function terminalAutoPollTick(): Promise<void> {
  if (terminalAutoPollBusy) return;
  terminalAutoPollBusy = true;
  try {
    try {
      if (AppState.currentState !== 'active') return;
    } catch {
      /* best-effort: lanjut */
    }
    // Lazy-require ala fanoutReceiptAuto (anti siklus saat boot).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSession } = require('../session') as typeof import('../session');
    let me: unknown = null;
    try {
      me = getSession();
    } catch {
      me = null;
    }
    if (!me) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTerminal } = require('../config/server') as typeof import('../config/server');
    let termCode = '';
    let branchId = '';
    try {
      const g = getTerminal();
      termCode = String(g?.terminalCode ?? '').trim().toUpperCase();
      branchId = String(g?.branchId ?? '').trim();
    } catch {
      /* unbound */
    }
    if (!termCode || !branchId) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isOnlineMode } = require('./posWire') as typeof import('./posWire');
    let online = false;
    try {
      online = isOnlineMode();
    } catch {
      online = false;
    }
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchBranchTerminals } = require('./terminalApi') as typeof import('./terminalApi');
    const list = await fetchBranchTerminals(branchId);
    if (!list.ok) return;
    const hit = list.data.terminals.find(
      (x) => String(x.terminalCode ?? '').trim().toUpperCase() === termCode,
    );
    const beId = String(hit?.terminalId ?? '').trim();
    if (!beId) return;
    // Target untuk job non-AUTO (raw payload): station struk default
    // (cermin resolveDrainTarget receipt). Job AUTO mengabaikan target +
    // printFn ini (render internal via print.ts + antre persisten).
    let target: PrinterTarget = { transport: 'loopback' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const printLib = require('./print') as typeof import('./print');
      const d = await printLib.resolveDrainTarget({ name: '', kind: 'receipt' });
      if (d && d.target) target = d.target;
    } catch {
      /* fallback loopback */
    }
    const fn = terminalAutoPollPrintFn;
    if (!fn) return;
    await pollServerPrintJobs(beId, target, fn);
  } catch {
    /* tak pernah melempar */
  } finally {
    terminalAutoPollBusy = false;
  }
}

/** Nyalakan loop auto-poll (idempoten). printFn disuntik pemanggil (App
 * menyuntik printBytes) agar modul tetap bebas impor native. Tick pertama
 * langsung jalan agar job tak menunggu satu interval penuh. */
export function startTerminalAutoPrintPoll(printFn?: TerminalAutoPollPrintFn): void {
  if (printFn) terminalAutoPollPrintFn = printFn;
  if (terminalAutoPollTimer) return;
  void terminalAutoPollTick();
  terminalAutoPollTimer = setInterval(() => {
    void terminalAutoPollTick();
  }, TERMINAL_AUTO_PRINT_POLL_MS);
  try {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void terminalAutoPollTick();
    });
    terminalAutoPollAppSub = sub;
  } catch {
    terminalAutoPollAppSub = null;
  }
}

/** Matikan loop auto-poll (unbind/logout/cleanup). Idempoten. */
export function stopTerminalAutoPrintPoll(): void {
  if (terminalAutoPollTimer) {
    clearInterval(terminalAutoPollTimer);
    terminalAutoPollTimer = null;
  }
  try {
    terminalAutoPollAppSub?.remove();
  } catch {
    /* abaikan */
  }
  terminalAutoPollAppSub = null;
  terminalAutoPollBusy = false;
}

/** true bila loop auto-poll sedang hidup (diagnostik/tests). */
export function isTerminalAutoPrintPolling(): boolean {
  return terminalAutoPollTimer !== null;
}
