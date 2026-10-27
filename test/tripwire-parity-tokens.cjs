// Tripwire PAR-01 parity tokens (2026-10-27): primer tunggal #FF6B35,
// CTA radius 12, border input #D0D5DD, fokus tunggal, shadow terpusat.
// Statik + node murni (tanpa emulator) agar jalan di CI.
const fs = require('fs');
const path = require('path');

function run() {
  const failures = [];
  let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

  const appRoot = path.resolve(__dirname, '..');
  const feCssPath = path.resolve(appRoot, '..', 'genfity-order-main', 'src', 'app', 'globals.css');
  const themePath = path.join(appRoot, 'src', 'theme', 'index.ts');
  const radiusPath = path.join(appRoot, 'src', 'theme', 'radius.ts');
  const buttonPath = path.join(appRoot, 'src', 'components', 'Button.tsx');
  const inputPath = path.join(appRoot, 'src', 'components', 'Input.tsx');
  const appButtonPath = path.join(appRoot, 'src', 'components', 'AppButton.tsx');

  const css = fs.readFileSync(feCssPath, 'utf8');
  const theme = fs.readFileSync(themePath, 'utf8');
  const radius = fs.readFileSync(radiusPath, 'utf8');
  const button = fs.readFileSync(buttonPath, 'utf8');
  const input = fs.readFileSync(inputPath, 'utf8');
  const appButton = fs.readFileSync(appButtonPath, 'utf8');

  // FE: brand-* disatukan ke primary-* (GENFITY #FF6B35)
  ok(/--color-brand-500:\s*#ff6b35/i.test(css), 'FE brand-500 harus #ff6b35 (kanonis primary)');
  ok(/--color-brand-600:\s*#e55a2b/i.test(css), 'FE brand-600 harus #e55a2b (primary-hover)');
  ok(/--color-primary-500:\s*#ff6b35/i.test(css), 'FE primary-500 harus #ff6b35');
  ok(/--color-gray-300:\s*#d0d5dd/i.test(css), 'FE gray-300 harus #d0d5dd (border input)');
  ok(/--color-border-focus:\s*#ff6b35/i.test(css), 'FE border-focus harus #ff6b35');
  ok(/--shadow-focus-ring:[^;]*255,\s*107,\s*53/i.test(css), 'FE shadow-focus-ring harus orange 255,107,53');
  ok(!/--color-brand-500:\s*#465fff/i.test(css), 'FE brand-500 indigo #465fff harus hilang');
  ok(!/[:\s]#465fff/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'FE literal indigo #465fff harus hilang di luar komentar (flatpickr ikut primer)');

  // POS theme: primer tunggal
  ok(/orange:\s*'#FF6B35'/.test(theme), 'POS colors.orange harus #FF6B35');
  ok(/orangeDark:\s*'#E55A2B'/.test(theme), 'POS colors.orangeDark harus #E55A2B');
  ok(/primary:\s*'#FF6B35'/.test(theme), 'POS colors.primary harus #FF6B35');
  ok(/focus:\s*'#FF6B35'/.test(theme), 'POS colors.focus harus #FF6B35');
  ok(/inputBorder:\s*'#D0D5DD'/.test(theme), 'POS colors.inputBorder harus #D0D5DD');
  ok(!/[:=]\s*'#F5820D'/.test(theme), 'POS literal kode #F5820D harus hilang dari theme (komentar sejarah boleh)');
  ok(/export const shadows/.test(theme) && /floating/.test(theme) && /focusRing/.test(theme), 'POS shadows terpusat harus ada (floating+focusRing)');
  ok(/255,\s*107,\s*53/.test(theme), 'POS shadows harus pakai orange 255,107,53');

  // POS radius: CTA 12 + input 12
  ok(/cta:\s*12/.test(radius), 'POS radius.cta harus 12');
  ok(/input:\s*12/.test(radius), 'POS radius.input harus 12');
  ok(!/cta:\s*28/.test(radius), 'POS radius.cta 28 stadium harus hilang');

  // POS Button: disabled peach paritas FE + pakai token
  ok(/#FFB399/.test(button), 'POS Button PEACH_IDLE harus #FFB399 (FE primary-disabled)');
  ok(!/[:=]\s*'#F6C28B'/.test(button), 'POS Button literal kode #F6C28B harus hilang (komentar sejarah boleh)');
  ok(/colors\.orange/.test(button), 'POS Button primary harus pakai colors.orange');
  ok(/radius\.cta/.test(button), 'POS Button harus pakai radius.cta');

  // POS Input: border paritas FE + pakai token radius
  ok(/#D0D5DD/.test(input), 'POS Input INPUT_BORDER harus #D0D5DD');
  ok(!/[:=]\s*'#BDBDBD'/.test(input), 'POS Input literal kode #BDBDBD harus hilang (komentar sejarah boleh)');
  ok(/radius\.input/.test(input), 'POS Input harus pakai radius.input');

  // POS AppButton: lg radius 12 kedua form-factor
  const lg12 = (appButton.match(/lg:\s*\{[^}]*borderRadius:\s*12/g) || []).length;
  ok(lg12 >= 2, 'POS AppButton lg radius 12 harus ada di phone+tablet (>=2, ketemu ' + lg12 + ')');
  ok(!/lg:\s*\{[^}]*borderRadius:\s*14/.test(appButton), 'POS AppButton lg radius 14 lama harus hilang');

  return { failures, checks };
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  console.log(r.failures.length ? `FAIL ${r.failures.length}/${r.checks}` : `PASS ${r.checks} checks`);
  for (const f of r.failures) console.log(' - ' + f);
  process.exit(r.failures.length ? 1 : 0);
}
