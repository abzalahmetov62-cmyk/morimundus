import { saveDeleteSchema } from '@/lib/engine/save-game';
import { requirePlayer } from '@/lib/storage/access';
import { readPlayerSave, writePlayerSave, deletePlayerSave } from '@/lib/storage/player-saves-server';
import { saveSlot, saveBody, saveError } from '@/lib/storage/save-http';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ slot: string }> };
export async function GET(request: Request, context: Context) {
  try { const user = await requirePlayer(request); return Response.json(await readPlayerSave(user.userId, await saveSlot(context)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return saveError(cause); }
}
export async function PUT(request: Request, context: Context) {
  try { const user = await requirePlayer(request), slot = await saveSlot(context); return Response.json(await writePlayerSave(user.userId, slot, await saveBody(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return saveError(cause, request); }
}
export async function DELETE(request: Request, context: Context) {
  try { const user = await requirePlayer(request), slot = await saveSlot(context), body = saveDeleteSchema.parse(await saveBody(request)); return Response.json(await deletePlayerSave(user.userId, slot, body.expectedRevision), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (cause) { return saveError(cause, request); }
}
