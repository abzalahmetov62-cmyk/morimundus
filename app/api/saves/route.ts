import { listSaves } from '@/lib/storage/saves-server';
import { errorResponse } from '@/lib/storage/server';
import { requireAuthor } from '@/lib/storage/access';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { await requireAuthor(); return Response.json(await listSaves(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
