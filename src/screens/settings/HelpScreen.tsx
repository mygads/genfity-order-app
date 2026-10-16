import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts, wideCenter } from '../../theme';

type Nav = { navigate: (screen: string, params?: Record<string, unknown>) => void; goBack: () => void };
type Props = { navigation?: Nav };

const FAQS: { q: string; a: string }[] = [
  { q: 'Bagaimana cara klaim terminal baru?', a: 'Buka Pengaturan → Terminal, isi kode terminal dari server, lalu pilih cabang. Atau pindai QR klaim lewat menu Scan QR → tab Klaim.' },
  { q: 'Printer Bluetooth tidak ketemu?', a: 'Pastikan printer menyala dan belum terhubung ke perangkat lain. Buka Printer → Pindai Perangkat BT, lalu Pairing. Kirim cetak nyata membutuhkan dev-client (Expo Go tidak bisa).' },
  { q: 'Printer LAN tidak mencetak?', a: 'Pastikan tablet dan printer satu jaringan Wi-Fi. Cek IP:port di Printer → LAN (umumnya port 9100), lalu Uji Koneksi LAN.' },
  { q: 'Apa arti peringatan sync > 3 hari?', a: 'Data offline menumpuk. Buka Sinkronisasi → Push Sekarang saat online. Lewat 7 hari kasir diblokir (E00044) sampai sync berhasil.' },
  { q: 'Tiket tidak sampai ke dapur?', a: 'Aktifkan Cetak Otomatis Dapur di Pengaturan, pastikan routing grup menu di Cetakan Menu menunjuk station Dapur/Checker yang terhubung.' },
  { q: 'Bagaimana atur batas waktu meja?', a: 'Buka Timer Meja: isi batas menit, peringatan sebelum habis, kapan timer mulai, lalu pantau timer berjalan per meja.' },
  { q: 'Menu habis tapi masih bisa dipesan?', a: 'Matikan "Tetap jual saat stok habis" di Pengaturan Stok, atau tandai Habis di Manajemen Menu agar tombol menu terkunci.' },
  { q: 'Layar pelanggan menampilkan apa?', a: 'Tampilan Pelanggan menunjukkan antrean Disiapkan vs Siap Diambil, item berjalan + total + QRIS saat transaksi, dan layar sukses setelah bayar.' },
];

export default function HelpScreen(_props: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [open, setOpen] = useState<number | null>(0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, isTablet && wideCenter]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bantuan</Text>
        <Text style={styles.headerSub}>FAQ & panduan singkat operasional</Text>
      </View>
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <View key={f.q} style={styles.card}>
            <Pressable onPress={() => setOpen(isOpen ? null : i)} style={styles.qRow}>
              <Text style={styles.q}>{f.q}</Text>
              <Text style={styles.chev}>{isOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {isOpen ? <Text style={styles.a}>{f.a}</Text> : null}
          </View>
        );
      })}
      <View style={styles.card}>
        <Text style={styles.q}>Butuh bantuan lebih lanjut?</Text>
        <Text style={styles.a}>Hubungi admin cabang atau tim support Genfity (jam operasional 08.00–21.00 WIB).</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32 },
  header: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.white },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.navyTint, marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  qRow: { flexDirection: 'row', alignItems: 'center' },
  q: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.navy, paddingRight: 8 },
  chev: { fontFamily: fonts.bold, fontSize: 16, color: colors.faint },
  a: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 8 },
});
