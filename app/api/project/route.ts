import { readProject, writeProject, StorageError, errorResponse, rejectCrossSite } from '@/lib/storage/server';
import { requireAuthor } from '@/lib/storage/access';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { await requireAuthor(); return Response.json(await readProject(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    await requireAuthor();
    rejectCrossSite(request);
    if (Number(request.headers.get('content-length')) > 4 * 1024 * 1024) throw new StorageError('Файл проекта слишком большой', 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4 * 1024 * 1024) throw new StorageError('Файл проекта слишком большой', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new StorageError('Файл проекта повреждён', 422); }
    let result;
    try { result = await writeProject(body.project, body.expectedRevision); }
    catch (error) { if (error instanceof StorageError) throw error; if (error instanceof Error && !error.message.includes('D1_')) throw new StorageError(error.message, 422); throw error; }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, request); }
}
