import { requireAuthor } from '@/lib/storage/access';
import { readPublication, publishGame } from '@/lib/storage/publication-server';
import { errorResponse, StorageError } from '@/lib/storage/server';
import { saveBody } from '@/lib/storage/save-http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { await requireAuthor(); const game = await readPublication(); return Response.json({ publication: game ? { revision: game.revision, authorRevision: game.authorRevision, fingerprint: game.fingerprint, publishedAt: game.publishedAt, title: game.title } : null }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return errorResponse(cause); }
}
export async function PUT(request: Request) {
  try {
    await requireAuthor(); const input = await saveBody(request, 1024);
    let publication;
    try { publication = await publishGame(input); } catch (cause) { if (cause instanceof StorageError) throw cause; if (cause instanceof Error && !cause.message.includes('D1_')) throw new StorageError(cause.message, 422); throw cause; }
    return Response.json({ publication }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) { return errorResponse(cause, request); }
}
