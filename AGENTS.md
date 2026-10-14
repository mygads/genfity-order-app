This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

> Proyek ini = clone RN ESB POSLite. Baca `DOKUMENTASI.md` dulu — sumber
> kebenaran status, skor, gap APK 83-vs-29, dan TODO.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json` (saat ini SDK 57).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck (WAJIB lolos sebelum klaim selesai)
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Proyek ini memakai **React Navigation 7 native-stack** (`App.tsx` +
  `src/navigation/types.ts`, 29 route, guard sesi `GuardedStacks`).
  JANGAN pasang expo-router / `src/app/` — bagian template generik di bawah
  tidak berlaku di repo ini.
- Hook verifikasi dev: `EXPO_PUBLIC_NAV_HOOK=1` → `__NAV__.go('RouteName')`
  dipakai driver Playwright di `verify/*.cjs`.
- Docs: https://docs.expo.dev/versions/v57.0.0/

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `npx eas-cli@latest <command>`; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Aturan proyek (wajib, spesifik repo ini)

1. **Tablet = `width >= 768`** (`useWindowDimensions`). Jangan pakai angka lain.
2. **Warna hanya token `colors.*`** dari `src/theme` (`navy #16215E`,
   `orange #F5820D`, …). Hex literal dilarang di file layar.
3. **Rupiah via `rp(n)`** (`Rp 122.500`); tanpa prefix pakai `rpNum(n)`.
4. **Bahasa Indonesia** untuk semua label user-facing (kecuali istilah baku:
   DINE IN, QRIS, EDC, PIN, Online).
5. **Sesi** via `src/session.ts` (`loginDemo`/`logout`/`subscribeSession`).
   Tombol Keluar manapun WAJIB panggil `logout()`.
6. Route baru: daftarkan di `src/navigation/types.ts` + `App.tsx`, pastikan
   ada inbound `navigate` dari UI (orphan yang diketahui: DineIn, Voucher,
   QrScan, EsbOrder, Settings, Edc).
7. Jangan tiru PIN-lokal-only APK (lihat DOKUMENTASI.md §4).

## Definisi selesai (DoD) per tugas

- [ ] `npx tsc --noEmit` lolos.
- [ ] Screenshot Playwright phone (±390) + tablet (±820) di `verify/final/`.
- [ ] Tablet ≥8: konten terpusat (`wideCenter*`) atau 2-panel.
- [ ] Update `DOKUMENTASI.md` §1 (skor) + §6 (status temuan).

## Prioritas backlog

`DOKUMENTASI.md` §7.1: (1) tablet 2-panel login/receipt/success/member/booking,
(2) label Order Fee/Ongkir (`CashierScreen.tsx:253`), (3) orphan routes +
EdcScreen, (4) gap APK (install/klaim → split-bill → recap/expense → printer →
deposit), (5) cetak nyata + logout menyeluruh.
