import { requirePublication } from '@/lib/storage/publication-server';
import { errorResponse } from '@/lib/storage/server';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json(await requirePublication(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return errorResponse(cause); }
}
