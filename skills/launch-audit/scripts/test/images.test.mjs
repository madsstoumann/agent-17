import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, fetchImageMeta } from '../lib/images.mjs';

// ---------------------------------------------------------------- test bytes

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const GIF_3x2 = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([3, 0, 2, 0, 0x80, 0, 0])]);

// SOI, APP0 (JFIF), SOF0: precision 8, height 256, width 200, 3 components
const JPEG_200x256 = Buffer.from([
  0xFF, 0xD8,
  0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x00, 0xC8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);
// SOI, DHT (C4, must be skipped), fill bytes, SOF2 (progressive): height 16, width 32
const JPEG_32x16_progressive = Buffer.from([
  0xFF, 0xD8,
  0xFF, 0xC4, 0x00, 0x04, 0x00, 0x00,
  0xFF, 0xFF, 0xC2, 0x00, 0x0B, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00,
]);
const JPEG_no_sof = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xD9]);

function riff(chunkType, payload) {
  const chunk = Buffer.concat([Buffer.from(chunkType), Buffer.alloc(4), payload]);
  chunk.writeUInt32LE(payload.length, 4);
  const out = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), chunk]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}
// VP8X: flags + 3 reserved, then (width-1) and (height-1) as 24-bit LE: 300x150
const WEBP_VP8X_300x150 = riff('VP8X', Buffer.from([0x10, 0, 0, 0, 0x2B, 0x01, 0x00, 0x95, 0x00, 0x00]));
// VP8 (lossy): 3-byte frame tag, start code 9D 01 2A, width 320, height 240 (14 bits each)
const WEBP_VP8_320x240 = riff('VP8 ', Buffer.from([0x10, 0x02, 0x00, 0x9D, 0x01, 0x2A, 0x40, 0x01, 0xF0, 0x00, 0, 0, 0, 0]));
// VP8L: signature 2F, then 14-bit width-1 (15) and height-1 (7): 16x8
const WEBP_VP8L_16x8 = riff('VP8L', Buffer.from([0x2F, 0x0F, 0xC0, 0x01, 0x00, 0, 0, 0]));

const ICO_256 = Buffer.from([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);
const ICO_16 = Buffer.from([0, 0, 1, 0, 2, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);

const AVIF_HEADER = Buffer.concat([Buffer.from([0, 0, 0, 0x1C]), Buffer.from('ftypavif'), Buffer.from([0, 0, 0, 0]), Buffer.from('avifmif1miaf')]);
const ISPE_640x480 = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ispe'), Buffer.from([0, 0, 0, 0, 0, 0, 2, 0x80, 0, 0, 1, 0xE0])]);

// ---------------------------------------------------------------- imageSize

test('imageSize: PNG IHDR', () => {
  assert.deepEqual(imageSize(PNG_1x1), { type: 'png', width: 1, height: 1 });
  assert.deepEqual(imageSize(PNG_1x1.subarray(0, 8)), { type: 'png', width: null, height: null }, 'signature only: type but no size');
});

test('imageSize: GIF logical screen', () => {
  assert.deepEqual(imageSize(GIF_3x2), { type: 'gif', width: 3, height: 2 });
});

test('imageSize: JPEG walks markers to the first SOFn', () => {
  assert.deepEqual(imageSize(JPEG_200x256), { type: 'jpeg', width: 200, height: 256 });
  assert.deepEqual(imageSize(JPEG_32x16_progressive), { type: 'jpeg', width: 32, height: 16 }, 'skips DHT and fill bytes, accepts SOF2');
  assert.deepEqual(imageSize(JPEG_no_sof), { type: 'jpeg', width: null, height: null });
});

test('imageSize: WebP VP8X, VP8 and VP8L', () => {
  assert.deepEqual(imageSize(WEBP_VP8X_300x150), { type: 'webp', width: 300, height: 150 });
  assert.deepEqual(imageSize(WEBP_VP8_320x240), { type: 'webp', width: 320, height: 240 });
  assert.deepEqual(imageSize(WEBP_VP8L_16x8), { type: 'webp', width: 16, height: 8 });
});

test('imageSize: SVG from width/height, viewBox, or nothing', () => {
  assert.deepEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect/></svg>')), { type: 'svg', width: 120, height: 60 });
  assert.deepEqual(imageSize(Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"/>')), { type: 'svg', width: 24, height: 24 });
  assert.deepEqual(imageSize(Buffer.from('﻿<svg width="100%" height="10em" viewBox="0, 0, 300.5, 150"></svg>')), { type: 'svg', width: 300.5, height: 150 }, 'relative units fall back to viewBox');
  assert.deepEqual(imageSize(Buffer.from('<svg width="12.5px" height="8px"></svg>')), { type: 'svg', width: 12.5, height: 8 });
  assert.deepEqual(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), { type: 'svg', width: null, height: null });
  assert.equal(imageSize(Buffer.from('<!doctype html><html><body>svg</body></html>')), null, 'HTML is not an SVG');
});

test('imageSize: ICO first directory entry, 0 means 256', () => {
  assert.deepEqual(imageSize(ICO_256), { type: 'ico', width: 256, height: 256 });
  assert.deepEqual(imageSize(ICO_16), { type: 'ico', width: 16, height: 16 });
});

test('imageSize: AVIF by brand, dimensions only from an ispe box', () => {
  assert.deepEqual(imageSize(AVIF_HEADER), { type: 'avif', width: null, height: null });
  assert.deepEqual(imageSize(Buffer.concat([AVIF_HEADER, ISPE_640x480])), { type: 'avif', width: 640, height: 480 });
});

test('imageSize: unknown bytes, empty and odd inputs are null', () => {
  assert.equal(imageSize(Buffer.from('hello world')), null);
  assert.equal(imageSize(Buffer.alloc(0)), null);
  assert.equal(imageSize(null), null);
  assert.equal(imageSize(undefined), null);
  assert.deepEqual(imageSize(new Uint8Array(PNG_1x1)), { type: 'png', width: 1, height: 1 }, 'accepts a Uint8Array');
});

// ---------------------------------------------------------------- fetchImageMeta

function fakeHttp(response) {
  const calls = [];
  return {
    calls,
    get: async (url, opts) => { calls.push({ url, opts }); return { url, finalUrl: url, ok: true, headers: {}, setCookie: [], truncated: false, ms: 1, redirected: false, ...response }; },
  };
}

test('fetchImageMeta reads bytes, sniffs the size and passes the buffer options through', async () => {
  const http = fakeHttp({ status: 200, contentType: 'image/png', body: PNG_1x1, bytes: PNG_1x1.length });
  const r = await fetchImageMeta(http, 'https://example.com/a.png');
  assert.deepEqual(r, { url: 'https://example.com/a.png', status: 200, contentType: 'image/png', bytes: PNG_1x1.length, size: { type: 'png', width: 1, height: 1 }, isImage: true });
  assert.equal(http.calls[0].opts.as, 'buffer');
  assert.equal(http.calls[0].opts.maxBytes, 5 * 1024 * 1024);
  const r2 = await fetchImageMeta(http, 'https://example.com/a.png', { maxBytes: 1024 });
  assert.equal(http.calls[1].opts.maxBytes, 1024);
  assert.equal(r2.isImage, true);
});

test('fetchImageMeta: a network failure is a result, not a throw', async () => {
  const http = fakeHttp({ status: 0, ok: false, contentType: '', body: null, bytes: 0, error: 'ENOTFOUND: getaddrinfo' });
  const r = await fetchImageMeta(http, 'https://nope.invalid/x.png');
  assert.equal(r.status, 0);
  assert.equal(r.isImage, false);
  assert.equal(r.size, null);
  assert.match(r.error, /ENOTFOUND/);
});

test('fetchImageMeta: isImage follows the bytes; a lying content type does not count, an unsniffable image type is trusted', async () => {
  const html = Buffer.from('<!doctype html><html><body>404</body></html>');
  const notFound = await fetchImageMeta(fakeHttp({ status: 404, ok: false, contentType: 'text/html', body: html, bytes: html.length }), 'https://example.com/missing.png');
  assert.equal(notFound.isImage, false);
  assert.equal(notFound.size, null);
  assert.equal(notFound.status, 404);
  assert.equal('error' in notFound, false, 'an HTTP error is an ordinary response');

  const lying = await fetchImageMeta(fakeHttp({ status: 200, contentType: 'image/png', body: html, bytes: html.length }), 'https://example.com/fake.png');
  assert.equal(lying.isImage, false, 'image/png that is not a PNG');

  const bmp = Buffer.from('BM\x00\x00');
  const trusted = await fetchImageMeta(fakeHttp({ status: 200, contentType: 'image/bmp; charset=binary', body: bmp, bytes: bmp.length }), 'https://example.com/x.bmp');
  assert.equal(trusted.isImage, true, 'a format the sniffer does not know is taken on trust');
  assert.equal(trusted.size, null);

  const svgBody = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"/>');
  const svg = await fetchImageMeta(fakeHttp({ status: 200, contentType: 'image/svg+xml', body: svgBody, bytes: svgBody.length }), 'https://example.com/logo.svg');
  assert.deepEqual(svg.size, { type: 'svg', width: 10, height: 5 });
  assert.equal(svg.isImage, true);
});
