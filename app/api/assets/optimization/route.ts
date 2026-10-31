import { bucket, errorResponse } from '@/lib/storage/server';
import { requireAuthor } from '@/lib/storage/access';
import { IMAGE_VARIANT_PREFIX } from '@/lib/storage/image-optimization';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await requireAuthor();
    const completed = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await bucket().list({ prefix: IMAGE_VARIANT_PREFIX, cursor, limit: 1000 });
      for (const object of page.objects) {
        const match = object.key.slice(IMAGE_VARIANT_PREFIX.length).match(/^([a-f0-9]{64})\.(webp|skip)$/);
        if (match) completed.add(match[1]);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return Response.json({ completed: [...completed] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
