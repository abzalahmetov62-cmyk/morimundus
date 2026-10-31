import { slotSchema, MAX_SAVE_BYTES } from '../engine/save-game';
import { StorageError, errorResponse, rejectCrossSite } from './server';

export async function saveSlot(context: { params: Promise<{ slot: string }> }) {
  const result = slotSchema.safeParse((await context.params).slot);
  if (!result.success) throw new StorageError('Неизвестный слот', 400);
  return result.data;
}
export async function saveBody(request: Request, limit = MAX_SAVE_BYTES + 1024) {
  rejectCrossSite(request);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new StorageError('Неверный формат запроса', 415);
  const reader = request.body?.getReader(), decoder = new TextDecoder();
  let bytes = 0, oversized = Number(request.headers.get('content-length')) > limit;
  const parts: string[] = [];
  if (reader) {
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > limit) { oversized = true; parts.length = 0; } if (bytes > limit * 4) { await reader.cancel(); break; } if (!oversized) parts.push(decoder.decode(chunk.value, { stream: true })); } }
    finally { reader.releaseLock(); }
  }
  if (oversized) throw new StorageError('Запрос слишком большой', 413);
  try { return JSON.parse(parts.join('') + decoder.decode()); } catch { throw new StorageError('Запрос повреждён: неверный JSON', 422); }
}
export function saveError(cause: unknown, request?: Request) { return errorResponse(cause instanceof StorageError ? cause : cause instanceof Error && !cause.message.includes('D1_') ? new StorageError(cause.message, 422) : cause, request); }
