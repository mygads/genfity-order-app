/**
 * E2E-02 adapter ESB↔BE (pure mapping, tanpa side-effect).
 * POS bicara ESB-style (main/*, pos/*, esb_api/*, erp/*) secara default (SERVER REA),
 * BE bicara /api/v1 + /api/merchant + /api/public. Modul ini peta jujur:
 * mana SUDAH selaras (print), mana BUTUH backend/bridge (master), mana local-only.
 * Tripwire-safe: tanpa import runtime (type-only bila perlu), tanpa fetch di sini.
 */

export type BeRoute = string;

export const PRINT_ALIGNED: Record<string, BeRoute> = {
  'pos/install': 'api/v1/branches/{id}/terminals (create) + terminal-claim/pair',
  'main/validate-terminal': 'api/v1/terminals/{id}/readiness + pos-config',
  'terminalPrintEnqueue': 'api/v1/terminals/{id}/print-jobs',
  'terminalPrintClaim': 'api/v1/terminals/{id}/print-jobs/claim',
  'terminalPrintAck': 'api/v1/terminals/{id}/print-jobs/{jobId}/ack',
  'terminalPrintFanout': 'api/v1/terminals/{id}/print-fanout',
};

export const MASTER_NEEDS_BRIDGE: Record<string, BeRoute> = {
  'main/get-menu': 'api/public/menu/{merchantCode} (public) ATAU api/merchant/menu (authed)',
  'main/get-branch-menu': 'api/v1/terminals/{id}/branch-menu (cek) / merchant pos-menu',
  'main/get-table': 'api/v1/terminals/{id}/tables',
  'main/get-promotion': 'api/merchant/orders/pos/* (validate-voucher-preview)',
  'main/get-member': 'api/merchant/* member (cek) / erp/member (legacy)',
  'main/get-voucher': 'api/v1/terminals/{id}/vouchers/burn|release + pos voucher-templates',
  'main/get-user': 'api/v1/terminals/{id}/access',
  'v1/pull/expense-chart-of-accounts': 'merchant CoA (cek) — pullExpenseCoa FAKTA APK',
  'esb_api/pull/pull-station-data': 'BE station? (cek) — fallback konstanta POS',
  'main/get-sales': 'api/merchant/orders/* + pos-wire riwayat (fallback jujur)',
};

export const LOCAL_ONLY: string[] = [
  'SQLite ms_* (menu, table, outbox) — Local Mode by-design',
  'backupCodec — PARKED needs-dep (tanpa clipboard/share)',
  'takeover SSE realtime — butuh dua user/devices live (log E2E terpisah)',
];

export function bePath(template: BeRoute, params: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(`{${k}}`, String(v)).replace('{id}', String(v));
  }
  return out;
}
