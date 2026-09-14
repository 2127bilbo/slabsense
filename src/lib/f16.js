/**
 * IEEE 754 binary16 codec (little-endian), shared by node scripts and the browser.
 * No Float16Array dependency. Handles subnormals, ±0, ±Inf, NaN; rounds to nearest even.
 * Used for the card identification embedding shards (scripts/card-db, src/lib/card-db-client.js).
 */
export function encodeF16(f32) {
  const src = f32 instanceof Float32Array ? f32 : Float32Array.from(f32);
  const out = new Uint8Array(src.length * 2);
  const dv = new DataView(out.buffer);
  const tmp = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < src.length; i++) {
    tmp.setFloat32(0, src[i]);
    const x = tmp.getUint32(0);
    const sign = (x >>> 16) & 0x8000;
    let exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    let h;
    if (exp === 0xff) {
      h = sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
    } else {
      exp = exp - 127 + 15;
      if (exp >= 0x1f) {
        h = sign | 0x7c00; // overflow → Inf
      } else if (exp <= 0) {
        // subnormal or zero
        if (exp < -10) {
          h = sign;
        } else {
          mant = (mant | 0x800000) >>> (1 - exp);
          const low = mant & 0x1fff;
          let r = mant >>> 13;
          if (low > 0x1000 || (low === 0x1000 && (r & 1))) r++;
          h = sign | r;
        }
      } else {
        let r = mant >>> 13;
        const rem = mant & 0x1fff;
        if (rem > 0x1000 || (rem === 0x1000 && (r & 1))) {
          r++;
          if (r === 0x400) { r = 0; exp++; }
        }
        h = exp >= 0x1f ? sign | 0x7c00 : sign | (exp << 10) | r;
      }
    }
    dv.setUint16(i * 2, h, true);
  }
  return out;
}

export function decodeF16(bytes, byteOffset = 0, length) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
  const base = bytes instanceof ArrayBuffer ? byteOffset : bytes.byteOffset + byteOffset;
  const n = length ?? Math.floor((buffer.byteLength - base) / 2);
  const dv = new DataView(buffer, base, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = dv.getUint16(i * 2, true);
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >>> 10) & 0x1f;
    const m = h & 0x3ff;
    if (e === 0) out[i] = s * m * 2 ** -24;
    else if (e === 0x1f) out[i] = m ? NaN : s * Infinity;
    else out[i] = s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}
