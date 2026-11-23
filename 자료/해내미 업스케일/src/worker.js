/* 해내미 업스케일 — 작업용 워커 (크기 조정 · 파일 만들기)
   메인 화면이 멈추지 않도록 무거운 계산은 여기서 처리합니다. */
'use strict';

/* ---------------- 공통 ---------------- */
function post(id, type, payload, transfer) { self.postMessage(Object.assign({ id, type }, payload || {}), transfer || []); }
async function deflate(u8) {
  const cs = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
class ByteWriter {
  constructor(cap) { this.buf = new Uint8Array(cap || 1 << 20); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let c = this.buf.length * 2; while (c < this.len + n) c *= 2;
    const nb = new Uint8Array(c); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  byte(v) { if (this.len >= this.buf.length) this.ensure(1); this.buf[this.len++] = v; }
  word(v) { this.byte((v >> 8) & 255); this.byte(v & 255); }
  bytes(a) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; }
  ascii(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i) & 255); }
  result() { return this.buf.slice(0, this.len); }
}

/* ---------------- 크기 조정 (Lanczos3) ---------------- */
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px);
}
function contrib(sn, dn) {
  const scale = dn / sn;
  const fs = scale < 1 ? scale : 1;
  const support = 3 / fs;
  const n = Math.ceil(support) * 2 + 2;
  const idx = new Int32Array(dn * n), wt = new Float32Array(dn * n), cnt = new Int32Array(dn);
  for (let i = 0; i < dn; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const left = Math.ceil(center - support), right = Math.floor(center + support);
    let sum = 0, k = 0;
    for (let j = left; j <= right && k < n; j++) {
      const w = lanczos((j - center) * fs);
      if (w === 0) continue;
      idx[i * n + k] = j < 0 ? 0 : (j >= sn ? sn - 1 : j);
      wt[i * n + k] = w; sum += w; k++;
    }
    for (let t = 0; t < k; t++) wt[i * n + t] /= sum;
    cnt[i] = k;
  }
  return { idx, wt, cnt, n };
}
function resize(id, src, sw, sh, ch, dw, dh, premul) {
  if (premul && ch === 4) {
    const s2 = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      s2[i] = (src[i] * a + 127) / 255; s2[i + 1] = (src[i + 1] * a + 127) / 255; s2[i + 2] = (src[i + 2] * a + 127) / 255; s2[i + 3] = a;
    }
    src = s2;
  }
  // 가로
  const H = contrib(sw, dw);
  const tmp = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++) {
    const so = y * sw * ch, to = y * dw * ch;
    for (let x = 0; x < dw; x++) {
      const b = x * H.n, k = H.cnt[x];
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let t = 0; t < k; t++) s += src[so + H.idx[b + t] * ch + c] * H.wt[b + t];
        tmp[to + x * ch + c] = s;
      }
    }
    if ((y & 127) === 0) post(id, 'progress', { p: 0.5 * y / sh });
  }
  // 세로
  const V = contrib(sh, dh);
  const out = new Uint8Array(dw * dh * ch);
  const row = dw * ch;
  for (let y = 0; y < dh; y++) {
    const b = y * V.n, k = V.cnt[y], oo = y * row;
    for (let i = 0; i < row; i++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += tmp[V.idx[b + t] * row + i] * V.wt[b + t];
      out[oo + i] = s < 0 ? 0 : (s > 255 ? 255 : s + 0.5);
    }
    if ((y & 127) === 0) post(id, 'progress', { p: 0.5 + 0.5 * y / dh });
  }
  if (premul && ch === 4) {
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (a === 0) { out[i] = out[i + 1] = out[i + 2] = 0; continue; }
      if (a === 255) continue;
      const r = out[i] * 255 / a, g = out[i + 1] * 255 / a, bb = out[i + 2] * 255 / a;
      out[i] = r > 255 ? 255 : r + 0.5; out[i + 1] = g > 255 ? 255 : g + 0.5; out[i + 2] = bb > 255 ? 255 : bb + 0.5;
    }
  }
  return out;
}

/* ---------------- JPEG (RGB / CMYK) ---------------- */
const ZigZag = [0,1,5,6,14,15,27,28,2,4,7,13,16,26,29,42,3,8,12,17,25,30,41,43,9,11,18,24,31,40,44,53,10,19,23,32,39,45,52,54,20,22,33,38,46,51,55,60,21,34,37,47,50,56,59,61,35,36,48,49,57,58,62,63];
const DC_L_N = [0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], DC_L_V = [0,1,2,3,4,5,6,7,8,9,10,11];
const AC_L_N = [0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
const AC_L_V = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
const DC_C_N = [0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0], DC_C_V = [0,1,2,3,4,5,6,7,8,9,10,11];
const AC_C_N = [0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77];
const AC_C_V = [0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
const YQT = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const UVQT = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];

function huffTable(nrcodes, values) {
  const code = new Int32Array(256), len = new Int32Array(256);
  let cv = 0, p = 0;
  for (let k = 1; k <= 16; k++) { for (let j = 1; j <= nrcodes[k]; j++) { code[values[p]] = cv; len[values[p]] = k; p++; cv++; } cv *= 2; }
  return { code, len };
}
const HT = { ydc: huffTable(DC_L_N, DC_L_V), yac: huffTable(AC_L_N, AC_L_V), cdc: huffTable(DC_C_N, DC_C_V), cac: huffTable(AC_C_N, AC_C_V) };

function quantTables(quality) {
  quality = Math.max(1, Math.min(100, quality | 0));
  const sf = quality < 50 ? Math.floor(5000 / quality) : Math.floor(200 - quality * 2);
  const qy = new Uint8Array(64), qc = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    qy[ZigZag[i]] = Math.min(255, Math.max(1, Math.floor((YQT[i] * sf + 50) / 100)));
    qc[ZigZag[i]] = Math.min(255, Math.max(1, Math.floor((UVQT[i] * sf + 50) / 100)));
  }
  const fy = new Float64Array(64), fc = new Float64Array(64);
  let k = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    fy[k] = 1 / (qy[ZigZag[k]] * AASF[r] * AASF[c] * 8);
    fc[k] = 1 / (qc[ZigZag[k]] * AASF[r] * AASF[c] * 8);
    k++;
  }
  return { qy, qc, fy, fc };
}

function encodeJPEG(id, { data, w, h, ch, quality, dpi, icc }) {
  // ch: 3 = RGB(YCbCr로 저장), 4 = CMYK(Adobe 방식, 반전 저장)
  const Q = quantTables(quality);
  const out = new ByteWriter(Math.max(1 << 16, (w * h * ch) >> 2));
  let bytenew = 0, bytepos = 7;
  const writeBits = (value, length) => {
    let posval = length - 1;
    while (posval >= 0) {
      if (value & (1 << posval)) bytenew |= (1 << bytepos);
      posval--; bytepos--;
      if (bytepos < 0) {
        if (bytenew === 0xff) { out.byte(0xff); out.byte(0); } else out.byte(bytenew);
        bytepos = 7; bytenew = 0;
      }
    }
  };
  // 헤더
  out.word(0xffd8);
  const d = Math.max(1, Math.min(65535, Math.round(dpi || 72)));
  if (ch === 3) { // JFIF
    out.word(0xffe0); out.word(16); out.ascii('JFIF'); out.byte(0); out.byte(1); out.byte(2); out.byte(1); out.word(d); out.word(d); out.byte(0); out.byte(0);
  }
  // Photoshop 해상도 정보 (APP13)
  {
    const irb = new ByteWriter(64);
    irb.ascii('Photoshop 3.0'); irb.byte(0); irb.ascii('8BIM'); irb.word(0x03ed); irb.byte(0); irb.byte(0);
    irb.word(0); irb.word(16);
    irb.word(d); irb.word(0); irb.word(1); irb.word(1); irb.word(d); irb.word(0); irb.word(1); irb.word(1);
    const b = irb.result(); out.word(0xffed); out.word(b.length + 2); out.bytes(b);
  }
  // ICC 프로파일 (APP2, 나눠서 저장)
  if (icc && icc.length) {
    const CH = 65519, cnt = Math.ceil(icc.length / CH);
    for (let i = 0; i < cnt; i++) {
      const part = icc.subarray(i * CH, Math.min(icc.length, (i + 1) * CH));
      out.word(0xffe2); out.word(part.length + 16); out.ascii('ICC_PROFILE'); out.byte(0); out.byte(i + 1); out.byte(cnt); out.bytes(part);
    }
  }
  if (ch === 4) { // Adobe APP14 : transform 0 (CMYK 그대로)
    out.word(0xffee); out.word(14); out.ascii('Adobe'); out.word(100); out.word(0); out.word(0); out.byte(0);
  }
  // DQT
  out.word(0xffdb); out.word(132);
  out.byte(0); for (let i = 0; i < 64; i++) out.byte(Q.qy[i]);
  out.byte(1); for (let i = 0; i < 64; i++) out.byte(Q.qc[i]);
  // SOF0
  out.word(0xffc0); out.word(8 + 3 * ch); out.byte(8); out.word(h); out.word(w); out.byte(ch);
  for (let c = 0; c < ch; c++) { out.byte(c + 1); out.byte(0x11); out.byte(ch === 3 && c > 0 ? 1 : 0); }
  // DHT
  out.word(0xffc4); out.word(0x01a2);
  out.byte(0x00); for (let i = 1; i <= 16; i++) out.byte(DC_L_N[i]); for (const v of DC_L_V) out.byte(v);
  out.byte(0x10); for (let i = 1; i <= 16; i++) out.byte(AC_L_N[i]); for (const v of AC_L_V) out.byte(v);
  out.byte(0x01); for (let i = 1; i <= 16; i++) out.byte(DC_C_N[i]); for (const v of DC_C_V) out.byte(v);
  out.byte(0x11); for (let i = 1; i <= 16; i++) out.byte(AC_C_N[i]); for (const v of AC_C_V) out.byte(v);
  // SOS
  out.word(0xffda); out.word(6 + 2 * ch); out.byte(ch);
  for (let c = 0; c < ch; c++) { out.byte(c + 1); out.byte(ch === 3 && c > 0 ? 0x11 : 0x00); }
  out.byte(0); out.byte(0x3f); out.byte(0);

  // 블록 부호화
  const blk = new Float64Array(64), DU = new Int32Array(64), q = new Int32Array(64);
  const comps = [];
  for (let c = 0; c < ch; c++) comps.push(new Float64Array(64));
  const dcPrev = new Int32Array(ch);
  const category = (v) => { v = v < 0 ? -v : v; let c = 0; while (v) { c++; v >>= 1; } return c; };
  const fdctQuant = (data, fdtbl) => {
    for (let i = 0, o = 0; i < 8; i++, o += 8) {
      const d0 = data[o], d1 = data[o + 1], d2 = data[o + 2], d3 = data[o + 3], d4 = data[o + 4], d5 = data[o + 5], d6 = data[o + 6], d7 = data[o + 7];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[o] = t10 + t11; data[o + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781; data[o + 2] = t13 + z1; data[o + 6] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[o + 5] = z13 + z2; data[o + 3] = z13 - z2; data[o + 1] = z11 + z4; data[o + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) {
      const d0 = data[i], d1 = data[i + 8], d2 = data[i + 16], d3 = data[i + 24], d4 = data[i + 32], d5 = data[i + 40], d6 = data[i + 48], d7 = data[i + 56];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[i] = t10 + t11; data[i + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781; data[i + 16] = t13 + z1; data[i + 48] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[i + 40] = z13 + z2; data[i + 24] = z13 - z2; data[i + 8] = z11 + z4; data[i + 56] = z11 - z4;
    }
    for (let i = 0; i < 64; i++) { const v = data[i] * fdtbl[i]; q[i] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0; }
  };
  const processDU = (cdu, fdtbl, dcIdx, dc, ac) => {
    fdctQuant(cdu, fdtbl);
    for (let j = 0; j < 64; j++) DU[ZigZag[j]] = q[j];
    const diff = DU[0] - dcPrev[dcIdx]; dcPrev[dcIdx] = DU[0];
    if (diff === 0) writeBits(dc.code[0], dc.len[0]);
    else { const c = category(diff); writeBits(dc.code[c], dc.len[c]); writeBits(diff < 0 ? diff + (1 << c) - 1 : diff, c); }
    let end0 = 63; while (end0 > 0 && DU[end0] === 0) end0--;
    if (end0 === 0) { writeBits(ac.code[0], ac.len[0]); return; }
    let i = 1;
    while (i <= end0) {
      const start = i;
      while (DU[i] === 0 && i <= end0) i++;
      let nz = i - start;
      if (nz >= 16) { const l = nz >> 4; for (let m = 0; m < l; m++) writeBits(ac.code[0xf0], ac.len[0xf0]); nz &= 15; }
      const v = DU[i], c = category(v);
      writeBits(ac.code[(nz << 4) + c], ac.len[(nz << 4) + c]);
      writeBits(v < 0 ? v + (1 << c) - 1 : v, c);
      i++;
    }
    if (end0 !== 63) writeBits(ac.code[0], ac.len[0]);
  };
  const stride = w * ch;
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let pos = 0; pos < 64; pos++) {
        const yy = Math.min(h - 1, by + (pos >> 3)), xx = Math.min(w - 1, bx + (pos & 7));
        const p = yy * stride + xx * ch;
        if (ch === 3) {
          const r = data[p], g = data[p + 1], b = data[p + 2];
          comps[0][pos] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          comps[1][pos] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          comps[2][pos] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        } else {
          // Adobe CMYK JPEG 관례: 잉크량을 반전(255-값)해서 저장
          comps[0][pos] = 127 - data[p]; comps[1][pos] = 127 - data[p + 1]; comps[2][pos] = 127 - data[p + 2]; comps[3][pos] = 127 - data[p + 3];
        }
      }
      for (let c = 0; c < ch; c++) {
        blk.set(comps[c]);
        const chroma = ch === 3 && c > 0;
        processDU(blk, chroma ? Q.fc : Q.fy, c, chroma ? HT.cdc : HT.ydc, chroma ? HT.cac : HT.yac);
      }
    }
    if ((by & 63) === 0) post(id, 'progress', { p: by / h });
  }
  if (bytepos >= 0) writeBits((1 << (bytepos + 1)) - 1, bytepos + 1);
  out.word(0xffd9);
  return out.result();
}

/* ---------------- PNG ---------------- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf, start, end) { let c = -1; for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
async function encodePNG(id, { data, w, h, ch, dpi }) {
  const bpl = w * ch;
  const raw = new Uint8Array(h * (bpl + 1));
  for (let y = 0; y < h; y++) {
    const ro = y * (bpl + 1), so = y * bpl;
    raw[ro] = 4; // Paeth
    for (let i = 0; i < bpl; i++) {
      const a = i >= ch ? data[so + i - ch] : 0;
      const b = y > 0 ? data[so - bpl + i] : 0;
      const c = (i >= ch && y > 0) ? data[so - bpl + i - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      raw[ro + 1 + i] = (data[so + i] - pr) & 255;
    }
    if ((y & 255) === 0) post(id, 'progress', { p: 0.4 * y / h });
  }
  const z = await deflate(raw);
  post(id, 'progress', { p: 0.95 });
  const out = new ByteWriter(z.length + 200);
  out.bytes([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, body) => {
    const L = body.length; out.word(L >>> 16); out.word(L & 65535);
    const s = out.len; out.ascii(type); out.bytes(body);
    const c = crc32(out.buf, s, out.len); out.word(c >>> 16); out.word(c & 65535);
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('sRGB', new Uint8Array([0]));
  const ppm = Math.round((dpi || 72) / 0.0254);
  const phys = new Uint8Array(9); const pv = new DataView(phys.buffer); pv.setUint32(0, ppm); pv.setUint32(4, ppm); phys[8] = 1;
  chunk('pHYs', phys);
  chunk('IDAT', z);
  chunk('IEND', new Uint8Array(0));
  return out.result();
}

/* ---------------- TIFF (RGB / RGBA / CMYK, ZIP 압축) ---------------- */
async function encodeTIFF(id, { data, w, h, ch, mode, dpi, icc }) {
  const bpl = w * ch;
  const rps = Math.max(1, Math.min(h, Math.floor((256 * 1024) / bpl)));
  const nStrips = Math.ceil(h / rps);
  const strips = new Array(nStrips);
  const BATCH = 8;
  for (let s0 = 0; s0 < nStrips; s0 += BATCH) {
    const jobs = [];
    for (let s = s0; s < Math.min(nStrips, s0 + BATCH); s++) {
      const y0 = s * rps, y1 = Math.min(h, y0 + rps);
      const part = data.slice(y0 * bpl, y1 * bpl);
      // 가로 차분(Predictor 2)
      for (let y = 0; y < y1 - y0; y++) {
        const o = y * bpl;
        for (let i = bpl - 1; i >= ch; i--) part[o + i] = (part[o + i] - part[o + i - ch]) & 255;
      }
      jobs.push(deflate(part).then(z => { strips[s] = z; }));
    }
    await Promise.all(jobs);
    post(id, 'progress', { p: 0.95 * Math.min(nStrips, s0 + BATCH) / nStrips });
  }
  const tags = [];
  const T = (tag, type, values) => tags.push({ tag, type, values });
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2, UNDEF = 7;
  T(256, LONG, [w]); T(257, LONG, [h]);
  T(258, SHORT, new Array(ch).fill(8));
  T(259, SHORT, [8]);
  T(262, SHORT, [mode === 'cmyk' ? 5 : 2]);
  T(273, LONG, new Array(nStrips).fill(0));
  T(277, SHORT, [ch]); T(278, LONG, [rps]);
  T(279, LONG, strips.map(s => s.length));
  const r = Math.round(dpi || 72);
  T(282, RATIONAL, [[r, 1]]); T(283, RATIONAL, [[r, 1]]);
  T(284, SHORT, [1]); T(296, SHORT, [2]);
  T(305, ASCII, 'Haenaemi Upscale');
  T(317, SHORT, [2]);
  if (mode === 'cmyk') T(332, SHORT, [1]);
  if (mode !== 'cmyk' && ch === 4) T(338, SHORT, [2]);
  if (icc && icc.length) T(34675, UNDEF, icc);
  tags.sort((a, b) => a.tag - b.tag);
  const size = (t) => {
    if (t.type === ASCII) return t.values.length + 1;
    if (t.type === UNDEF) return t.values.length;
    const n = t.values.length; return t.type === SHORT ? n * 2 : t.type === LONG ? n * 4 : n * 8;
  };
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize;
  const extraOff = new Map();
  for (const t of tags) { const s = size(t); if (s > 4) { extraOff.set(t, extra); extra += s + (s & 1); } }
  let dataOff = extra;
  const stripOffsets = [];
  for (const s of strips) { stripOffsets.push(dataOff); dataOff += s.length; }
  tags.find(t => t.tag === 273).values = stripOffsets;
  const head = new Uint8Array(extra); const dv = new DataView(head.buffer);
  head[0] = 0x49; head[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  let p = 8; dv.setUint16(p, tags.length, true); p += 2;
  const writeVals = (t, at) => {
    if (t.type === ASCII) { for (let i = 0; i < t.values.length; i++) head[at + i] = t.values.charCodeAt(i); head[at + t.values.length] = 0; return; }
    if (t.type === UNDEF) { head.set(t.values, at); return; }
    t.values.forEach((v, i) => {
      if (t.type === SHORT) dv.setUint16(at + i * 2, v, true);
      else if (t.type === LONG) dv.setUint32(at + i * 4, v, true);
      else { dv.setUint32(at + i * 8, v[0], true); dv.setUint32(at + i * 8 + 4, v[1], true); }
    });
  };
  for (const t of tags) {
    dv.setUint16(p, t.tag, true); dv.setUint16(p + 2, t.type, true);
    const cnt = t.type === ASCII ? t.values.length + 1 : t.values.length;
    dv.setUint32(p + 4, cnt, true);
    if (extraOff.has(t)) { dv.setUint32(p + 8, extraOff.get(t), true); writeVals(t, extraOff.get(t)); }
    else writeVals(t, p + 8);
    p += 12;
  }
  dv.setUint32(p, 0, true);
  const out = new Uint8Array(dataOff);
  out.set(head, 0);
  strips.forEach((s, i) => out.set(s, stripOffsets[i]));
  return out;
}

/* ---------------- PDF (이미지 한 장, 실제 인쇄 크기) ---------------- */
async function encodePDF(id, { data, w, h, ch, mode, dpi, icc, profileName, alpha }) {
  const enc = new TextEncoder();
  const parts = []; let off = 0; const offs = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); off += b.length; };
  const obj = (n, dict, stream) => {
    offs[n] = off; push(`${n} 0 obj\n${dict}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  const N = mode === 'cmyk' ? 4 : 3;
  post(id, 'progress', { p: 0.1 });
  const imgZ = await deflate(data);
  post(id, 'progress', { p: 0.7 });
  const iccZ = icc && icc.length ? await deflate(icc) : null;
  const alphaZ = alpha ? await deflate(alpha) : null;
  const wpt = (w / (dpi || 72) * 72), hpt = (h / (dpi || 72) * 72);
  const fx = (v) => v.toFixed(3).replace(/\.?0+$/, '');
  const pdfStr = (s) => '(' + s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '') + ')';
  push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 54, 10, 37, 226, 227, 207, 211, 10]));
  const cs = iccZ ? '[/ICCBased 6 0 R]' : (N === 4 ? '/DeviceCMYK' : '/DeviceRGB');
  let catalog = '<< /Type /Catalog /Pages 2 0 R';
  if (iccZ && N === 4) catalog += ` /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${pdfStr(profileName || 'CMYK')} /Info ${pdfStr(profileName || 'CMYK')} /DestOutputProfile 6 0 R >>]`;
  catalog += ' >>';
  obj(1, catalog);
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fx(wpt)} ${fx(hpt)}] /TrimBox [0 0 ${fx(wpt)} ${fx(hpt)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  const content = enc.encode(`q ${fx(wpt)} 0 0 ${fx(hpt)} 0 0 cm /Im0 Do Q`);
  obj(4, `<< /Length ${content.length} >>`, content);
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /FlateDecode /Length ${imgZ.length}${alphaZ ? ' /SMask 7 0 R' : ''} >>`, imgZ);
  if (iccZ) obj(6, `<< /N ${N} /Alternate ${N === 4 ? '/DeviceCMYK' : '/DeviceRGB'} /Filter /FlateDecode /Length ${iccZ.length} >>`, iccZ);
  else obj(6, '<< >>');
  if (alphaZ) obj(7, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alphaZ.length} >>`, alphaZ);
  else obj(7, '<< >>');
  const d = new Date(); const p2 = (v) => String(v).padStart(2, '0');
  obj(8, `<< /Producer (Haenaemi Upscale) /CreationDate (D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}) >>`);
  const xref = off;
  let x = `xref\n0 9\n0000000000 65535 f \n`;
  for (let i = 1; i <= 8; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<< /Size 9 /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(x);
  const out = new Uint8Array(off); let o = 0;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/* ---------------- 메시지 처리 ---------------- */
self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    let res;
    if (op === 'resize') res = resize(id, args.data, args.sw, args.sh, args.ch, args.dw, args.dh, args.premul);
    else if (op === 'jpeg') res = encodeJPEG(id, args);
    else if (op === 'png') res = await encodePNG(id, args);
    else if (op === 'tiff') res = await encodeTIFF(id, args);
    else if (op === 'pdf') res = await encodePDF(id, args);
    else throw new Error('알 수 없는 작업: ' + op);
    post(id, 'done', { res }, [res.buffer]);
  } catch (err) {
    post(id, 'error', { message: String(err && err.message || err) });
  }
};
