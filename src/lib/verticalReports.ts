/**
 * Laporan vertikal offline-first (Fase 3, PRD §11).
 * Hitung dari baris lokal tr_saleshead/menu — tanpa BE baru, jadi kasir
 * tetap dapat insight saat offline; angka server (laporan web) tetap kanonik.
 */
export type SaleHeadLite = {
  salesNum: string;
  salesMode?: string;
  grandTotal?: number;
  salesDate?: string;
  tableNo?: string;
  customerName?: string;
  ongkir?: number;
};

export type SaleItemLite = { name: string; qty: number; price: number; note?: string };

export type VerticalInsight = { title: string; lines: string[] };

function hourOf(s?: string): string {
  const m = /T(\d{2}):/.exec(String(s ?? ''));
  return m ? `${m[1]}:00` : '-';
}

/** Provider Indonesia dari prefix HP (peta ringkas, best-effort). */
export function providerOf(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (/^081[12789]/.test(d) || /^085[2378]/.test(d) || /^089[5-9]/.test(d)) return 'Telkomsel';
  if (/^081[478]/.test(d) || /^085[67189]/.test(d) || /^088[12]/.test(d)) return 'Indosat';
  if (/^081[2359]/.test(d) || /^085[69]/.test(d) || /^087[78]/.test(d)) return 'XL/Axis';
  if (/^082[12]/.test(d) || /^085[12]/.test(d)) return '3 (Tri)';
  if (/^083[18]/.test(d)) return 'Smartfren';
  return 'Lainnya';
}

export function insightFor(
  verticalId: string,
  heads: SaleHeadLite[],
  items: SaleItemLite[],
): VerticalInsight {
  const v = String(verticalId ?? '').toUpperCase();
  const total = heads.reduce((s, h) => s + Math.max(0, Math.round(Number(h.grandTotal) || 0)), 0);
  const n = heads.length;
  if (v === 'PULSA_DIGITAL') {
    const byProv = new Map<string, { n: number; amt: number }>();
    for (const it of items) {
      const m = /Pulsa\s+(\d+)\s*→\s*(\d+)/.exec(it.name);
      if (!m) continue;
      const prov = providerOf(m[2]);
      const cur = byProv.get(prov) ?? { n: 0, amt: 0 };
      cur.n += it.qty;
      cur.amt += it.qty * it.price;
      byProv.set(prov, cur);
    }
    const top = [...byProv.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 3);
    return {
      title: `Hari ini: ${n} transaksi · ${total}`,
      lines: [...(top.length ? top.map(([k, x]) => `${k}: ${x.n}x · ${x.amt}`) : ['Belum ada penjualan pulsa.']), 'Margin/provider: lihat deposit + laporan web.'],
    };
  }
  if (v === 'FASHION') {
    const byVar = new Map<string, number>();
    for (const it of items) {
      const m = /\(([^)]+)\)\s*$/.exec(it.name);
      const key = m ? m[1].trim() : 'Tanpa varian';
      byVar.set(key, (byVar.get(key) ?? 0) + it.qty);
    }
    const top = [...byVar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    return {
      title: `Hari ini: ${n} struk · ${total}`,
      lines: top.length ? top.map(([k, q]) => `${k}: ${q} pcs`) : ['Belum ada penjualan.'],
    };
  }
  if (v === 'SERVICE') {
    const byTech = new Map<string, { jobs: number; amt: number }>();
    for (const it of items) {
      const m = /Teknisi:\s*([^\n,;]+)/i.exec(it.note ?? '');
      const key = m ? m[1].trim() : 'Tanpa teknisi';
      const cur = byTech.get(key) ?? { jobs: 0, amt: 0 };
      cur.jobs += it.qty;
      cur.amt += it.qty * it.price;
      byTech.set(key, cur);
    }
    return {
      title: `Hari ini: ${n} layanan · ${total}`,
      lines: [...(byTech.size ? [...byTech.entries()].map(([k, x]) => `${k}: ${x.jobs} job · ${x.amt}`) : ['Belum ada layanan.']), 'Komisi = job × tarif (master jasa web).'],
    };
  }
  // Resto/coffee/warung/grocery: mode + jam ramai + ongkir agregator.
  const ongkirTotal = heads.reduce((sum, h) => sum + Math.max(0, Math.round(Number(h.ongkir) || 0)), 0);
  const byMode = new Map<string, number>();
  const byHour = new Map<string, number>();
  for (const h of heads) {
    const mode = String(h.salesMode ?? '-').toUpperCase();
    byMode.set(mode, (byMode.get(mode) ?? 0) + 1);
    const hh = hourOf(h.salesDate);
    byHour.set(hh, (byHour.get(hh) ?? 0) + 1);
  }
  const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
  const net = Math.max(0, total - ongkirTotal);
  return {
    title: `Hari ini: ${n} struk · ${total}`,
    lines: [
      [...byMode.entries()].map(([k, c]) => `${k}: ${c}`).join(' · ') || 'Belum ada penjualan.',
      peak && peak[0] !== '-' ? `Jam ramai: ${peak[0]} (${peak[1]} struk)` : '',
      // Fee agregator dipisah dari omzet bersih (anti selisih kas QSR).
      ongkirTotal > 0 ? `Ongkir agregator: ${ongkirTotal} · Bersih: ${net}` : '',
      // Margin jujur: HPP hanya di server (laporan web kanonik); kasir offline tampil omzet.
      'Margin/food-cost: lihat laporan web (HPP server).',
    ].filter(Boolean),
  };
}
