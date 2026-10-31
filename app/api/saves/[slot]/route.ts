import { saveDeleteSchema } from '@/lib/engine/save-game';
import { readSave, writeSave, deleteSave } from '@/lib/storage/saves-server';
import { requireAuthor } from '@/lib/storage/access';
import { saveSlot as slotFrom, saveBody as bodyFrom, saveError } from '@/lib/storage/save-http';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ slot: string }> };
export async function GET(_request: Request, context: Context) {
  try { await requireAuthor(); return Response.json(await readSave(await slotFrom(context)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return saveError(error); }
}
export async function PUT(request: Request, context: Context) {
  try { await requireAuthor(); const slot = await slotFrom(context); return Response.json(await writeSave(slot, await bodyFrom(request)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return saveError(error, request); }
}
export async function DELETE(request: Request, context: Context) {
  try { await requireAuthor(); const slot = await slotFrom(context), body = saveDeleteSchema.parse(await bodyFrom(request)); return Response.json(await deleteSave(slot, body.expectedRevision), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return saveError(error, request); }
}
