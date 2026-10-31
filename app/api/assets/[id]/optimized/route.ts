import { bucket, readAsset, StorageError, errorResponse, rejectCrossSite } from '@/lib/storage/server';
import { requireAuthor } from '@/lib/storage/access';
import { idSchema } from '@/lib/engine/project';
import { GAME_IMAGE_EDGE, optimizationCandidate, optimizedImageKey, webpInfo, worthwhileImage } from '@/lib/storage/image-optimization';

export const dynamic = 'force-dynamic';
async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new StorageError('Размер запроса превышен', 413);
  if (!request.body) throw new StorageError('Изображение отсутствует', 422);
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new StorageError('Размер запроса превышен', 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuthor(); rejectCrossSite(request);
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) throw new StorageError('Ресурс не найден', 404);
    const { asset } = await readAsset(id);
    if (!optimizationCandidate(asset)) throw new StorageError('Этот ресурс не требует сжатия', 422);
    const store = bucket(), key = optimizedImageKey(asset.sha256);
    if (request.headers.get('content-type') === 'application/json') {
      const body = new TextDecoder().decode(await readBody(request, 128));
      if (body !== '{"skip":true}') throw new StorageError('Неверный запрос', 422);
      await store.put(optimizedImageKey(asset.sha256, true), '', { httpMetadata: { contentType: 'text/plain' } });
    } else {
      if (request.headers.get('content-type') !== 'image/webp') throw new StorageError('Ожидается изображение WebP', 422);
      const bytes = await readBody(request, Math.floor(asset.bytes * .9));
      const info = webpInfo(bytes);
      if (!info || info.animated || info.width > GAME_IMAGE_EDGE || info.height > GAME_IMAGE_EDGE || !worthwhileImage(asset.bytes, bytes.length)) throw new StorageError('Неверная облегчённая копия', 422);
      await store.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
    }
    return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, request); }
}
