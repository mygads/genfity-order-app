import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/**
 * Grafik mini dashboard (bar + donat) dari View murni - tanpa dependensi
 * chart/SVG native sehingga tetap jalan offline di APK, Expo Go, dan web.
 * Data selalu agregasi live SQLite yang dioper pemanggil (jangan dummy).
 */

/** Palet irisan donat: 6 warna tema, dipakai berurutan. */
export const SLICE_COLORS = [
  colors.navy,
  colors.green,
  colors.orange,
  colors.blue,
  colors.amber,
  colors.red,
];

export interface WeekPoint {
  d: string;
  label: string;
  t: number;
  c: number;
  today: boolean;
}

/** Bar chart omzet 7 hari: tinggi bar proporsional thd nilai maksimum. */
export function WeekBars({
  data,
  emptyText,
  fmtCompact,
}: {
  data: WeekPoint[];
  emptyText: string;
  fmtCompact: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((x) => x.t));
  if (data.length === 0 || data.every((x) => x.t <= 0)) {
    return <Text style={cstyles.empty}>{emptyText}</Text>;
  }
  return (
    <View style={cstyles.bars}>
      {data.map((x) => (
        <View key={x.d} style={cstyles.col}>
          <Text style={[cstyles.barVal, x.today && cstyles.barValToday]} numberOfLines={1}>
            {fmtCompact(x.t)}
          </Text>
          <View style={cstyles.track}>
            <View
              style={[
                cstyles.bar,
                x.today && cstyles.barToday,
                { height: `${Math.max(4, Math.round((x.t / max) * 100))}%` },
              ]}
            />
          </View>
          <Text style={[cstyles.barDay, x.today && cstyles.barDayToday]}>{x.label}</Text>
        </View>
      ))}
    </View>
  );
}

export interface PaySlice {
  m: string;
  n: number;
  t: number;
}

/** Donat komposisi: tiap irisan = lapisan lingkaran penuh yang diputar ke
 *  sudut awal; sweep<=180 cukup setengah-lingkaran, sweep>180 memakai
 *  lingkaran penuh + tutup setengah warna permukaan kartu. Eksak untuk
 *  berapa pun jumlah metode pembayaran. */
export function PayDonut({
  data,
  surface,
  emptyText,
  centerValue,
  centerSub,
  fmtAmt,
}: {
  data: PaySlice[];
  surface: string;
  emptyText: string;
  centerValue: string;
  centerSub: string;
  fmtAmt: (n: number) => string;
}) {
  const total = data.reduce((s, x) => s + x.t, 0);
  if (data.length === 0 || total <= 0) {
    return <Text style={cstyles.empty}>{emptyText}</Text>;
  }
  const D = 148;
  const R = D / 2;
  let acc = 0;
  const slices = data.map((x, i) => {
    const start = (acc / total) * 360;
    acc += x.t;
    return { ...x, start, sweep: (x.t / total) * 360, color: SLICE_COLORS[i % SLICE_COLORS.length] };
  });
  return (
    <View style={cstyles.donutRow}>
      <View style={[cstyles.donut, { width: D, height: D, borderRadius: R }]}>
        {slices.map((sl, i) => (
          <View key={i} style={[cstyles.slice, { width: D, height: D }, { transform: [{ rotate: `${sl.start}deg` }] }]}>
            {sl.sweep <= 180 ? (
              <View
                style={[
                  cstyles.halfR,
                  { width: R, height: D, borderTopRightRadius: R, borderBottomRightRadius: R, backgroundColor: sl.color },
                ]}
              />
            ) : sl.sweep >= 359.99 ? (
              // Satu-satunya irisan = lingkaran penuh (tanpa tutup; rotasi 360
              // identik 0 dan justru menutup setengah lingkaran).
              <View style={[cstyles.full, { width: D, height: D, borderRadius: R, backgroundColor: sl.color }]} />
            ) : (
              <>
                <View style={[cstyles.full, { width: D, height: D, borderRadius: R, backgroundColor: sl.color }]} />
                <View
                  style={[
                    cstyles.halfR,
                    {
                      width: R,
                      height: D,
                      borderTopRightRadius: R,
                      borderBottomRightRadius: R,
                      backgroundColor: surface,
                      transform: [{ rotate: `${sl.sweep}deg` }],
                    },
                  ]}
                />
              </>
            )}
          </View>
        ))}
        <View
          style={[
            cstyles.hole,
            { width: D - 62, height: D - 62, borderRadius: (D - 62) / 2, backgroundColor: surface },
          ]}>
          <Text style={cstyles.holeValue} numberOfLines={1}>
            {centerValue}
          </Text>
          <Text style={cstyles.holeSub} numberOfLines={1}>
            {centerSub}
          </Text>
        </View>
      </View>
      <View style={cstyles.legend}>
        {slices.map((sl, i) => (
          <View key={i} style={cstyles.legRow}>
            <View style={[cstyles.dot, { backgroundColor: sl.color }]} />
            <Text style={cstyles.legName} numberOfLines={1}>
              {sl.m}
            </Text>
            <Text style={cstyles.legVal} numberOfLines={1}>
              {Math.round((sl.t / total) * 100)}% · {fmtAmt(sl.t)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cstyles = StyleSheet.create({
  empty: { fontFamily: fonts.regular, fontSize: 12, color: colors.faint, paddingVertical: 18, textAlign: 'center' },
  bars: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8 },
  col: { flex: 1, alignItems: 'center' },
  barVal: { fontFamily: fonts.semibold, fontSize: 9, color: colors.muted, marginBottom: 4, height: 13 },
  barValToday: { color: colors.orangeDark, fontFamily: fonts.bold },
  track: { height: 104, width: '100%', alignItems: 'center', justifyContent: 'flex-end', backgroundColor: colors.bg, borderRadius: 8 },
  bar: { width: 20, borderRadius: 6, backgroundColor: colors.navy, minHeight: 4 },
  barToday: { backgroundColor: colors.orange, width: 24 },
  barDay: { fontFamily: fonts.medium, fontSize: 10, color: colors.faint, marginTop: 4 },
  barDayToday: { color: colors.text, fontFamily: fonts.bold },
  donutRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 },
  donut: { alignItems: 'center', justifyContent: 'center' },
  slice: { position: 'absolute', left: 0, top: 0 },
  halfR: { position: 'absolute', right: 0, top: 0 },
  full: { position: 'absolute', left: 0, top: 0 },
  hole: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  holeValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.navy, textAlign: 'center' },
  holeSub: { fontFamily: fonts.regular, fontSize: 10, color: colors.muted, marginTop: 2, textAlign: 'center' },
  legend: { flex: 1, gap: 6 },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legName: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  legVal: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
});
