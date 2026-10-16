#!/usr/bin/env node
/**
 * PNG → bitmap monokrom 1-bit untuk logo header struk ESC/POS.
 * Murni Node (node:zlib + node:fs), tanpa dependensi.
 *
 * Pakai: node scripts/png2mono.cjs logo.png [lebarMaxDot=384] [ambang=128] [keluar.json]
 *   logo.png      : PNG non-interlaced (bit 1/2/4/8; gray/RGB/palette/RGBA)
 *   lebarMaxDot   : 384 untuk 58mm, 576 untuk 80mm (gambar diperkecil proporsional)
 *   ambang        : 0-255, piksel lebih gelap dari ini = titik hitam
 *   keluar.json   : bila diisi tulis ke file, bila tidak cetak ke stdout
 *
 * Hasil JSON { widthPx, heightPx, base64 } — cocok untuk EscReceipt.logo
 * (src/lib/escpos.ts). Tips: siapkan logo ~300px, latar putih, kontras tegas.
 */
const fs = require('fs');
const zlib = require('zlib');

function fail(msg) {
  console.error(`png2mono: ${msg}`);
  process.exit(1);
}

function readChunks(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) fail('bukan file PNG');
  let pos = 8;
  const chunks = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    chunks.push({ type, data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Kembalikan matriks RGB per piksel (rows × width × [r,g,b]). */
function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) fail('IHDR hilang');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (interlace !== 0) fail('PNG interlaced tak didukung — simpan ulang tanpa interlace');
  if (![1, 2, 4, 8].includes(bitDepth)) fail(`bit depth ${bitDepth} tak didukung`);
  if (![0, 2, 3, 4, 6].includes(colorType)) fail(`color type ${colorType} tak didukung`);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) fail('dimensi tak wajar');

  const plte = chunks.find((c) => c.type === 'PLTE');
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  let raw;
  try {
    raw = zlib.inflateSync(idat);
  } catch {
    fail('IDAT rusak (inflate gagal)');
  }

  const channels = colorType === 0 || colorType === 3 || colorType === 4 ? 1 : 3;
  const hasAlpha = colorType === 4 || colorType === 6;
  const spp = channels + (hasAlpha ? 1 : 0);
  // Untuk bitDepth < 8 hanya gray/palette 1 kanal yang valid.
  const bpp = bitDepth >= 8 ? spp : 1;
  const stride = Math.ceil((width * spp * bitDepth) / 8);
  if (raw.length < (stride + 1) * height) fail('data IDAT kurang dari dimensi');

  // Unfilter per baris scanline.
  const px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const cur = Buffer.alloc(stride);
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(a, b, c)) & 255;
      else if (f !== 0) fail(`filter ${f} tak dikenal`);
      cur[i] = v;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }

  // Petakan ke RGB per piksel.
  const rgb = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      let r = 255;
      let g = 255;
      let b = 255;
      let a = 255;
      if (bitDepth < 8) {
        const bitPos = x * bitDepth;
        const byte = px[y * stride + (bitPos >> 3)];
        const shift = 8 - bitDepth - (bitPos & 7);
        const idx = (byte >> shift) & ((1 << bitDepth) - 1);
        const v = Math.round((idx * 255) / ((1 << bitDepth) - 1));
        if (colorType === 3 && plte) {
          r = plte.data[idx * 3] ?? 0;
          g = plte.data[idx * 3 + 1] ?? 0;
          b = plte.data[idx * 3 + 2] ?? 0;
        } else {
          r = g = b = v;
        }
      } else if (colorType === 0) {
        r = g = b = px[y * stride + x];
      } else if (colorType === 2) {
        r = px[y * stride + x * 3];
        g = px[y * stride + x * 3 + 1];
        b = px[y * stride + x * 3 + 2];
      } else if (colorType === 3) {
        const idx = px[y * stride + x];
        if (!plte || idx * 3 + 2 >= plte.data.length) fail('indeks palette di luar PLTE');
        r = plte.data[idx * 3];
        g = plte.data[idx * 3 + 1];
        b = plte.data[idx * 3 + 2];
      } else if (colorType === 4) {
        r = g = b = px[y * stride + x * 2];
        a = px[y * stride + x * 2 + 1];
      } else {
        r = px[y * stride + x * 4];
        g = px[y * stride + x * 4 + 1];
        b = px[y * stride + x * 4 + 2];
        a = px[y * stride + x * 4 + 3];
      }
      // Alpha di-blend ke putih (kertas struk putih).
      const al = a / 255;
      row.push([r * al + 255 * (1 - al), g * al + 255 * (1 - al), b * al + 255 * (1 - al)]);
    }
    rgb.push(row);
  }
  return { rgb, width, height };
}

function main() {
  const [pngPath, maxWArg, thrArg, outPath] = process.argv.slice(2);
  if (!pngPath) {
    console.error('Pakai: node scripts/png2mono.cjs logo.png [lebarMaxDot=384] [ambang=128] [keluar.json]');
    process.exit(1);
  }
  if (!fs.existsSync(pngPath)) fail(`file tak ada: ${pngPath}`);
  const maxW = Math.min(576, Math.max(8, Number(maxWArg ?? 384) || 384));
  const thr = Math.min(255, Math.max(1, Number(thrArg ?? 128) || 128));

  const { rgb, width, height } = decodePng(fs.readFileSync(pngPath));
  // Perkecil proporsional bila melebihi lebar dot / tinggi aman memori printer.
  let scale = Math.min(1, maxW / width, 320 / height);
  if (scale <= 0) scale = 1;
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const rowBytes = Math.ceil(w / 8);
  const mono = Buffer.alloc(rowBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb[Math.min(height - 1, Math.floor(y / scale))][Math.min(width - 1, Math.floor(x / scale))];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < thr) mono[(y * rowBytes + (x >> 3))] |= 0x80 >> (x & 7);
    }
  }
  const json = JSON.stringify({ widthPx: w, heightPx: h, base64: mono.toString('base64') });
  if (outPath) fs.writeFileSync(outPath, json);
  else console.log(json);
}

main();
