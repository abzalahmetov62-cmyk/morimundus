import { requirePlayer } from '@/lib/storage/access';
import { listPlayerSaves } from '@/lib/storage/player-saves-server';
import { errorResponse } from '@/lib/storage/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const user = await requirePlayer(request); return Response.json(await listPlayerSaves(user.userId), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return errorResponse(cause); }
}
