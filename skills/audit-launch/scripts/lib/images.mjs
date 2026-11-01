/**
 * Image byte sniffing, and a fetch wrapper that reports what an image URL really
 * serves (status, type, dimensions) without decoding the picture.
 *
 * Zero dependencies. Node >= 22. imageSize is pure; fetchImageMeta never throws.
 */

/** Content types the sniffer can verify: a claimed one of these must sniff, or it is not an image. */
const SNIFFED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/x-icon', 'image/vnd.microsoft.icon', 'image/avif',
]);

const dims = (type, width = null, height = null) => ({ type, width, height });

function toBuffer(input) {
  if (input == null) return null;
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return null;
}

// ---------------------------------------------------------------- binary formats

/** PNG: 8-byte signature, then the IHDR chunk with width and height as big-endian u32. */
function png(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return dims('png');
  return dims('png', buf.readUInt32BE(16), buf.readUInt32BE(20));
}

/** SOF0-SOF15 minus the DHT (C4), JPG (C8) and DAC (CC) markers that share the range. */
const isSof = (m) => m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;

/** JPEG: walk the marker segments to the first SOFn; its payload is precision(1) height(2) width(2). */
function jpeg(buf) {
  let pos = 2;
  while (pos + 3 < buf.length) {
    if (buf[pos] !== 0xFF) { pos++; continue; } // resync on stray bytes
    const marker = buf[pos + 1];
    if (marker === 0xFF) { pos++; continue; } // fill byte
    pos += 2;
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue; // standalone markers
    if (marker === 0xD9 || marker === 0xDA) break; // end of image / start of scan: no frame header seen
    if (pos + 1 >= buf.length) break;
    if (isSof(marker)) {
      if (pos + 7 > buf.length) break;
      return dims('jpeg', buf.readUInt16BE(pos + 5), buf.readUInt16BE(pos + 3));
    }
    pos += buf.readUInt16BE(pos);
  }
  return dims('jpeg');
}

/** GIF: logical screen width and height as little-endian u16 right after the 6-byte header. */
function gif(buf) {
  if (buf.length < 10) return dims('gif');
  return dims('gif', buf.readUInt16LE(6), buf.readUInt16LE(8));
}

/** WebP: RIFF container; the first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended). */
function webp(buf) {
  if (buf.length < 16) return dims('webp');
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    if (buf.length < 30) return dims('webp');
    return dims('webp', 1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
  }
  if (chunk === 'VP8 ') {
    // 3-byte frame tag, start code 9D 01 2A, then 14-bit width and height
    if (buf.length < 30 || buf[23] !== 0x9D || buf[24] !== 0x01 || buf[25] !== 0x2A) return dims('webp');
    return dims('webp', buf.readUInt16LE(26) & 0x3FFF, buf.readUInt16LE(28) & 0x3FFF);
  }
  if (chunk === 'VP8L') {
    // signature 2F, then 14 bits (width - 1) and 14 bits (height - 1)
    if (buf.length < 25 || buf[20] !== 0x2F) return dims('webp');
    const bits = buf.readUInt32LE(21);
    return dims('webp', (bits & 0x3FFF) + 1, ((bits >>> 14) & 0x3FFF) + 1);
  }
  return dims('webp');
}

/** ICO: reserved(2) type(2)=1 count(2), then 16-byte directory entries; a 0 dimension means 256. */
function ico(buf) {
  if (buf.length < 22 || buf.readUInt16LE(4) === 0) return dims('ico');
  return dims('ico', buf[6] || 256, buf[7] || 256);
}

/** AVIF: an ISOBMFF ftyp box with an avif/avis brand; dimensions only from an ispe box, when one is in the bytes read. */
function avif(buf) {
  const ftypEnd = Math.min(buf.length, Math.max(16, buf.readUInt32BE(0)));
  const brands = buf.toString('latin1', 8, ftypEnd);
  if (!/avi[fs]/.test(brands)) return null;
  const i = buf.indexOf('ispe', 12, 'latin1');
  if (i < 0 || i + 16 > buf.length) return dims('avif');
  return dims('avif', buf.readUInt32BE(i + 8), buf.readUInt32BE(i + 12));
}

// ---------------------------------------------------------------- SVG (text)

/** A CSS length that is a plain number or px; anything else (%, em, ...) is null. */
function pxLength(s) {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px)?\s*$/i.exec(s || '');
  return m ? Number(m[1]) : null;
}

function svg(buf) {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 8192)).replace(/^﻿/, '');
  // prolog, doctype and comments may precede the root; the first real element must be <svg
  if (!/^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>))*\s*<svg[\s>/]/i.test(head)) return null;
  const tag = (/<svg\b([^>]*)>/i.exec(head) || [])[1] || '';
  const attrs = {};
  for (const m of tag.matchAll(/(?:^|\s)(width|height|viewBox)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) attrs[m[1].toLowerCase()] = m[2] ?? m[3];
  let width = pxLength(attrs.width);
  let height = pxLength(attrs.height);
  const vb = (attrs.viewbox || '').trim().split(/[\s,]+/).map(Number);
  const vbOk = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  if (vbOk) {
    if (width == null && height == null) { width = vb[2]; height = vb[3]; }
    else if (width == null) width = height * (vb[2] / vb[3]);
    else if (height == null) height = width * (vb[3] / vb[2]);
  }
  return dims('svg', width, height);
}

// ---------------------------------------------------------------- exports

/**
 * imageSize(bytes) -> { type: 'png'|'jpeg'|'gif'|'webp'|'svg'|'ico'|'avif', width: number|null, height: number|null } | null
 *
 * Reads only the header; a recognised format whose header is truncated still returns
 * its type with null dimensions. Unknown bytes, empty input and non-binary input -> null.
 */
export function imageSize(bytes) {
  const buf = toBuffer(bytes);
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return png(buf);
  if (buf[0] === 0xFF && buf[1] === 0xD8) return jpeg(buf);
  if (buf.toString('latin1', 0, 3) === 'GIF') return gif(buf);
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return webp(buf);
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.length >= 6) return ico(buf);
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return avif(buf);
  return svg(buf);
}

/**
 * fetchImageMeta(http, url, { maxBytes = 5 MiB })
 *   -> { url, status, contentType, bytes, size: {…}|null, isImage: boolean, error? }
 *
 * Reads the body as bytes and sniffs it. `isImage` follows the bytes: true when they
 * sniff as an image, or when the response is OK with an `image/*` type the sniffer does
 * not know (bmp, tiff, jxl …) and is taken on trust. A claimed `image/png` that is not a
 * PNG is not an image. `error` is set only for a network failure (status 0).
 */
export async function fetchImageMeta(http, url, { maxBytes = 5 * 1024 * 1024 } = {}) {
  let res;
  try {
    res = await http.get(url, { as: 'buffer', maxBytes });
  } catch (e) {
    return { url, status: 0, contentType: '', bytes: 0, size: null, isImage: false, error: e?.message || String(e) };
  }
  const contentType = String(res.contentType || '');
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const size = res.body ? imageSize(res.body) : null;
  const trusted = Boolean(res.ok) && mime.startsWith('image/') && !SNIFFED_MIMES.has(mime);
  const out = { url, status: res.status ?? 0, contentType, bytes: res.bytes || 0, size, isImage: size !== null || trusted };
  if (res.error) out.error = res.error;
  return out;
}
