export const MAX_ASSET_BYTES = 24 * 1024 * 1024;
export function detectAsset(bytes: Uint8Array): { kind: 'image' | 'audio'; mime: string } | null {
  const s = (start: number, count: number) => String.fromCharCode(...bytes.slice(start, start + count));
  if (bytes.length < 8) return null;
  if (bytes[0] === 137 && s(1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return { kind: 'image', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { kind: 'image', mime: 'image/jpeg' };
  if (s(0, 6) === 'GIF87a' || s(0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (s(0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (s(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  return null;
}
