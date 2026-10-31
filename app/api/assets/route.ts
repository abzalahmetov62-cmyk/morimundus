import { bucket, insertAsset, StorageError, errorResponse, rejectCrossSite } from '@/lib/storage/server';
import { detectAsset, MAX_ASSET_BYTES } from '@/lib/storage/asset-format';
import { requireAuthor } from '@/lib/storage/access';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    await requireAuthor();
    rejectCrossSite(request);
    if (Number(request.headers.get('content-length')) > MAX_ASSET_BYTES + 100000) throw new StorageError('Размер ресурса превышает 24 МБ', 413);
    const form = await request.formData(); const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_ASSET_BYTES) throw new StorageError('Выберите изображение или аудио размером до 24 МБ', 422);
    const bytes = new Uint8Array(await file.arrayBuffer()); const format = detectAsset(bytes);
    if (!format) throw new StorageError('Поддерживаются PNG, JPEG, WEBP, GIF, MP3, WAV и OGG', 422);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
    const asset = { id: crypto.randomUUID(), name: file.name.trim().slice(0, 160) || 'Ресурс', ...format, bytes: file.size, sha256 };
    const key = `resources/${asset.id}`;
    await bucket().put(key, bytes, { httpMetadata: { contentType: format.mime } });
    try { await insertAsset(asset, key); } catch (error) { await bucket().delete(key); throw error; }
    return Response.json(asset, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, request); }
}
