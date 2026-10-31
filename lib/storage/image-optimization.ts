import type { Asset } from '../engine/project';

export const IMAGE_VARIANT_PREFIX = 'optimized/image-v1/';
export const GAME_IMAGE_EDGE = 1024;
export const MIN_OPTIMIZATION_BYTES = 128 * 1024;
export function optimizationCandidate(asset: Pick<Asset, 'kind' | 'mime' | 'bytes'>) {
  return asset.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime) && asset.bytes >= MIN_OPTIMIZATION_BYTES;
}
export function optimizedImageKey(sha: string, skipped = false) {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Неверная контрольная сумма изображения');
  return IMAGE_VARIANT_PREFIX + sha + (skipped ? '.skip' : '.webp');
}
export function imageSize(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Неверные размеры изображения');
  const scale = Math.min(1, GAME_IMAGE_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function worthwhileImage(originalBytes: number, optimizedBytes: number) {
  return optimizedBytes > 0 && optimizedBytes <= originalBytes * .9 && originalBytes - optimizedBytes >= 16 * 1024;
}
const text = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
export function webpInfo(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 20 || text(bytes, 0, 4) !== 'RIFF' || text(bytes, 8, 4) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  let dimensions: { width: number; height: number } | null = null, animated = false, pixels = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return null;
    const kind = text(bytes, offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8, end = data + length;
    if (end + (length % 2) > bytes.length) return null;
    if (kind === 'VP8X' && length >= 10) {
      animated ||= !!(bytes[data] & 2);
      dimensions = { width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16) };
    } else if (kind === 'VP8 ' && length >= 10 && text(bytes, data + 3, 3) === '\x9d\x01\x2a') {
      pixels = true; dimensions ??= { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
    } else if (kind === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
      pixels = true; const bits = view.getUint32(data + 1, true); dimensions ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (kind === 'ANIM' || kind === 'ANMF') animated = true;
    offset = end + (length % 2);
  }
  return dimensions && dimensions.width > 0 && dimensions.height > 0 && (pixels || animated) ? { ...dimensions, animated } : null;
}
export function animatedImage(bytes: Uint8Array, mime: string) {
  if (mime === 'image/gif') return true;
  if (mime === 'image/webp') return webpInfo(bytes)?.animated ?? true;
  if (mime !== 'image/png') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), kind = text(bytes, offset + 4, 4);
    if (kind === 'acTL') return true;
    if (kind === 'IDAT' || kind === 'IEND') return false;
    if (length > bytes.length - offset - 12) return true;
    offset += 12 + length;
  }
  return false;
}
