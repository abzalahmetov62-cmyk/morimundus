import { z } from 'zod';
import { ApiError } from './client';
import { saveDocumentSchema, slotListSchema, slotSummarySchema, type SaveDocument, type SaveSlot, type SlotSummary, type SavedGame } from '../engine/save-game';

async function data(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const error = z.object({ error: z.string() }).safeParse(body); throw new ApiError(error.success ? error.data.error : 'Не удалось связаться с хранилищем прохождения', response.status); }
  return body;
}
export type SaveTransport = {
  list(): Promise<SlotSummary[]>;
  read(slot: SaveSlot): Promise<SaveDocument>;
  write(slot: SaveSlot, input: { save: SavedGame; checksum: string; expectedRevision: number }): Promise<SaveDocument>;
  remove(slot: SaveSlot, expectedRevision: number): Promise<SlotSummary>;
};
export type SaveTransportFactory = (signal: AbortSignal) => SaveTransport;
export function saveTransport(signal?: AbortSignal, base = '/api/saves', accountId?: string): SaveTransport {
  const url = (slot: SaveSlot) => base + '/' + slot;
  const request = async (route: string, options: RequestInit = {}) => {
    try { const headers = new Headers(options.headers); if (accountId) headers.set('x-morimundus-account', accountId); return await data(await fetch(route, { ...options, headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) })); }
    catch (cause) { if (cause instanceof ApiError) throw cause; throw new ApiError('Хранилище не ответило. Прохождение остаётся в открытом окне; повтори запись.', 503); }
  };
  return {
    list: async () => slotListSchema.parse(await request(base, { cache: 'no-store' })).slots,
    read: async slot => saveDocumentSchema.parse(await request(url(slot), { cache: 'no-store' })),
    write: async (slot, input) => saveDocumentSchema.parse(await request(url(slot), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
    remove: async (slot, expectedRevision) => slotSummarySchema.parse(await request(url(slot), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision }) })),
  };
}
