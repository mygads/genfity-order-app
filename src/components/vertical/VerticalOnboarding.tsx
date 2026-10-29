import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TABLET_BP, colors, fonts } from '../../theme';
import AppButton from '../AppButton';
import { VERTICALS, VERTICAL_IDS, type VerticalId } from '../../lib/verticals';
import { useLang } from '../../lib/i18n';

/**
 * VerticalOnboarding — pilih jenis usaha saat pertama kali (7 ikon besar).
 * Aturan emas PRD: onboarding wajib pilih vertikal (tak bisa skip); merchant
 * baru transaksi pertama <5 menit. PIN supervisor untuk ganti di Pengaturan.
 * Grid 2 kolom HP / 3-4 kolom tablet; target sentuh ≥44dp.
 */
export default function VerticalOnboarding({
  visible,
  initial,
  onPick,
}: {
  visible: boolean;
  initial?: VerticalId;
  onPick: (v: VerticalId) => void;
}) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BP;
  const [sel, setSel] = useState<VerticalId | ''>(initial ?? '');
  const { t } = useLang();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => {}}>
      <View style={styles.root}>
        <View style={[styles.card, isTablet && styles.cardTablet]}>
          <Text style={[styles.title, isTablet && styles.titleTablet]}>{t('vertical.pickTitle')}</Text>
          <Text style={styles.sub}>{t('vertical.pickSub')}</Text>
          <View style={styles.grid}>
            {VERTICAL_IDS.map((id) => {
              const v = VERTICALS[id];
              const on = sel === id;
              return (
                <Pressable
                  key={id}
                  style={[styles.tile, isTablet && styles.tileTablet, on && styles.tileOn]}
                  onPress={() => setSel(id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${v.label}: ${v.example}`}>
                  <Text style={styles.icon}>{v.icon}</Text>
                  <Text style={[styles.name, on && styles.nameOn]}>{v.label}</Text>
                  <Text style={styles.ex} numberOfLines={2}>{v.example}</Text>
                </Pressable>
              );
            })}
          </View>
          <AppButton
            title={t('vertical.start')}
            size="lg"
            disabled={!sel}
            onPress={() => { if (sel) onPick(sel); }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(16,24,69,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 520, backgroundColor: colors.white, borderRadius: 16, padding: 18, gap: 10 },
  cardTablet: { maxWidth: 720, padding: 24 },
  title: { fontSize: 20, color: colors.navy, fontFamily: fonts.bold, textAlign: 'center' },
  titleTablet: { fontSize: 24 },
  sub: { fontSize: 13, color: colors.muted, fontFamily: fonts.regular, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginVertical: 6 },
  tile: {
    width: '30%', minWidth: 100, minHeight: 104, borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center',
    justifyContent: 'center', padding: 10, gap: 2,
  },
  tileTablet: { width: '22%', minHeight: 124 },
  tileOn: { borderColor: colors.primary, backgroundColor: colors.paleOrange },
  icon: { fontSize: 30 },
  name: { fontSize: 13, color: colors.text, fontFamily: fonts.semibold, textAlign: 'center' },
  nameOn: { color: colors.primaryDark },
  ex: { fontSize: 11, color: colors.faint, fontFamily: fonts.regular, textAlign: 'center' },
});
