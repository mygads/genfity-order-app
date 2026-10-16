"""Screenshot semua layar via navigasi React Navigation (deep-link tidak ada).
Strategi: buka Expo web, klik 'Masuk Demo', lalu navigasi programatik via
window.__NAV__: tiap layar dibungkus? Tidak - gunakan pendekatan DOM:
klik tombol/menu yang mengarah ke route, atau panggil navigasi lewat React DevTools hook.
Lebih sederhana & robust: tiap screen di-render lewat hash query ?screen=X -
tidak didukung. Maka: gunakan Playwright untuk klik berurutan mengikuti alur
menu Dashboard (semua route ada di MENU + CTA + link), sisanya via tombol di layar.

Peta klik:
- Login: tombol 'Masuk Demo' (text)
- Dashboard: menu grid (Kasir, Riwayat, Booking, Member, Menu Custom, Pratinjau Bill, Laporan, Batal/Void, Pengaturan) + CTA Transaksi Baru + Absensi + Peta Meja + Kelola menu
- Cashier: goCart -> CartDetail; kategori/tab lain
- CartDetail: goPay -> Pay
- Pay: via Qris -> Qris; goSuccess -> Success
- Success: Order Baru -> Cashier
- BillPreview -> Receipt ; History (SavedTransactions+History sama komponen, beda judul) ; Tables -> DineIn? ; Shift/Recap/EndShift/Attendance ; EsbOrder/Kitchen ; QrScan ; Edc ; Voucher ; LoadOrder ; CustomMenu ; Cancel ; Printers ; Settings
Untuk layar tanpa tombol langsung: gunakan menu Dashboard bila ada, atau tombol back + menu lain.
Fallback terakhir: evaluasi JS - cari objek navigation React via __reactFiber dan panggil navigate.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8902"
SHOT = "/opt/data/home/programming/posclone-rn/verify"
PHONE = {"width": 390, "height": 844, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}
TABLET = {"width": 1024, "height": 768, "device_scale_factor": 2, "is_mobile": False, "has_touch": True}

# Urutan kunjungan: (nama_file, cara_mencapai)
# Cara: ("menu", label_menu_dashboard) | ("cta",) | ("link", text) | ("btn", text) | ("back+menu", label) | ("demo",)
PLAN = [
    ("01-Login", [("landing",)]),
    ("02-Dashboard", [("demo",)]),
    ("03-Cashier", [("demo",), ("menu", "Kasir")]),
    ("04-CartDetail", [("demo",), ("menu", "Kasir"), ("cta_cart",)]),
    ("05-Pay", [("demo",), ("menu", "Kasir"), ("cta_cart",), ("cta_pay",)]),
    ("06-Qris", [("demo",), ("menu", "Kasir"), ("cta_cart",), ("cta_pay",), ("btn", "QRIS")]),
    ("07-Success", [("demo",), ("menu", "Kasir"), ("cta_cart",), ("cta_pay",), ("btn_pay_success",)]),
    ("08-BillPreview", [("demo",), ("menu", "Pratinjau Bill")]),
    ("09-Receipt", [("demo",), ("menu", "Pratinjau Bill"), ("btn_receipt",)]),
    ("10-Tables", [("demo",), ("link", "Lihat denah")]),
    ("11-Booking", [("demo",), ("menu", "Booking")]),
    ("12-Member", [("demo",), ("menu", "Member")]),
    ("13-Voucher", [("demo",), ("menu", "Member"), ("btn_voucher",)]),
    ("14-Pay-Edc", [("demo",), ("menu", "Kasir"), ("cta_cart",), ("cta_pay",), ("btn", "Kartu / EDC")]),
    ("15-Attendance", [("demo",), ("link", "Absensi")]),
    ("16-Shift", [("demo",), ("menu", "Laporan"), ("btn_shift",)]),
    ("17-Recap", [("demo",), ("menu", "Laporan")]),
    ("18-EndShift", [("demo",), ("menu", "Laporan"), ("btn_endshift",)]),
    ("19-History", [("demo",), ("menu", "Riwayat")]),
    ("20-EsbOrder", [("demo",), ("btn_esborder",)]),
    ("21-Kitchen", [("demo",), ("btn_kitchen",)]),
    ("22-Printers", [("demo",), ("menu", "Pengaturan"), ("btn_printer",)]),
    ("23-Settings", [("demo",), ("menu", "Pengaturan")]),
    ("24-QrScan", [("demo",), ("btn_qrscan",)]),
    ("25-Cancel", [("demo",), ("menu", "Batal / Void")]),
    ("26-CustomMenu", [("demo",), ("menu", "Menu Custom")]),
    ("27-LoadOrder", [("demo",), ("menu", "Kasir"), ("btn_loadorder",)]),
    ("28-DineIn", [("demo",), ("link", "Lihat denah"), ("btn_dinein",)]),
]

NAV_JS = """() => {
  // cari React Navigation object: telusuri fiber untuk navigation prop
  const root = document.getElementById('root');
  if (!root) return 'no-root';
  const key = Object.keys(root).find(k => k.startsWith('__reactFiber'));
  if (!key) return 'no-fiber';
  let found = null;
  const seen = new Set();
  const queue = [root[key]];
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    const n = queue.shift();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const props = n.memoizedProps;
    if (props && props.navigation && typeof props.navigation.navigate === 'function') {
      found = 'has-navigate-fn';
      try { props.navigation.navigate(NAV_TARGET); return 'navigated:' + NAV_TARGET; }
      catch (e) { return 'nav-error:' + e; }
    }
    if (n.child) queue.push(n.child);
    if (n.sibling) queue.push(n.sibling);
  }
  return found || 'not-found';
}"""
