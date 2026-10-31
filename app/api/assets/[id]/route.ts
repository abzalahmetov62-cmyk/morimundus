import { bucket, readAsset, StorageError, errorResponse } from '@/lib/storage/server';
import { idSchema } from '@/lib/engine/project';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { authorAccess } from '@/lib/storage/access';
import { optimizationCandidate, optimizedImageKey } from '@/lib/storage/image-optimization';
import { readPublication } from '@/lib/storage/publication-server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function respond(request: Request, context: Context, head: boolean) {
  try {
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) throw new StorageError('Ресурс не найден', 404);
    const author = await authorAccess(await getChatGPTUser());
    if (!author && !(await readPublication())?.project.assets.some(asset => asset.id === id)) throw new StorageError('Ресурс не найден', 404);
    const { asset, key } = await readAsset(id);
    const variant = new URL(request.url).searchParams.get('variant') === 'game' && optimizationCandidate(asset);
    let pendingVariant = variant;
    if (variant) {
      try {
        const optimizedKey = optimizedImageKey(asset.sha256), file = head ? null : await bucket().get(optimizedKey), stored = head ? await bucket().head(optimizedKey) : file;
        if (stored && stored.size > 0 && stored.size < asset.bytes && stored.httpMetadata?.contentType === 'image/webp') {
          return new Response(file?.body ?? null, { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(stored.size), 'X-Content-Type-Options': 'nosniff', 'X-Morimundus-Image': 'optimized', 'Cache-Control': author ? 'private, no-store' : 'private, max-age=3600' } });
        }
        if (!stored && await bucket().head(optimizedImageKey(asset.sha256, true))) pendingVariant = false;
      } catch { console.warn('Optimized image unavailable; using original', id); }
    }
    const file = head ? null : await bucket().get(key); const stored = head ? await bucket().head(key) : file;
    if (!stored) throw new StorageError('Ресурс недоступен', 404);
    if (stored.size !== asset.bytes) throw new StorageError('Ресурс повреждён: размер не совпадает', 422);
    return new Response(file?.body ?? null, { headers: { 'Content-Type': asset.mime, 'Content-Length': String(asset.bytes), 'X-Content-Type-Options': 'nosniff', 'X-Morimundus-Image': 'original', 'Cache-Control': head || author || pendingVariant ? 'private, no-store' : 'private, max-age=3600' } });
  } catch (error) { return errorResponse(error); }
}
export function GET(_request: Request, context: Context) { return respond(_request, context, false); }
export function HEAD(_request: Request, context: Context) { return respond(_request, context, true); }
