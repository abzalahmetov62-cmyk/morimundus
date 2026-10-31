import { z } from 'zod';
import type { Project } from '../engine/project';
import { checksum, emptySlot, MAX_SAVE_BYTES, projectFingerprint, restoreSavedGame, savedGameSchema, saveDocumentSchema, saveWriteSchema, SAVE_SLOTS, summarizeSave, type SaveSlot } from '../engine/save-game';
import { ApiError } from './client';
import type { SaveTransport } from './saves-client';

type GuestStorage = Pick<Storage, 'getItem' | 'setItem'>;
type GuestOptions = { storage?: () => GuestStorage; lock?: <T>(key: string, action: () => Promise<T>, signal: AbortSignal) => Promise<T> };
const rowSchema = z.object({ formatVersion: z.literal(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), updatedAt: z.string().datetime(), save: savedGameSchema.nullable(), checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict().refine(row => (row.save === null) === (row.checksum === null));
type Row = z.infer<typeof rowSchema>;

export function guestSaveTransport(project: Project, revision: number, lifetime?: AbortSignal, options: GuestOptions = {}): SaveTransport {
  const prefix = 'morimundus:guest:v1:' + project.id + ':';
  const fingerprint = projectFingerprint(project);
  const storage = () => options.storage ? options.storage() : window.localStorage;
  const keyFor = (slot: SaveSlot) => prefix + slot;
  function record(slot: SaveSlot) {
    let raw: string | null;
    try { raw = storage().getItem(keyFor(slot)); } catch { throw new ApiError('Браузер не разрешил открыть гостевые сохранения. Текущее прохождение остаётся в окне.', 503); }
    if (raw === null) return { row: null, damaged: false, revision: 0, updatedAt: null };
    let value: unknown;
    try { if (raw.length > MAX_SAVE_BYTES + 4096) throw new Error(); value = JSON.parse(raw); } catch { return { row: null, damaged: true, revision: 0, updatedAt: null }; }
    const parsed = rowSchema.safeParse(value);
    if (parsed.success) return { row: parsed.data, damaged: false, revision: parsed.data.revision, updatedAt: parsed.data.updatedAt };
    const metadata = z.object({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), updatedAt: z.string().datetime() }).safeParse(value);
    return { row: null, damaged: true, revision: metadata.success ? metadata.data.revision : 0, updatedAt: metadata.success ? metadata.data.updatedAt : null };
  }
  async function document(slot: SaveSlot, row: Row) {
    if (!row.save) throw new ApiError('Этот слот пуст', 410);
    if (await checksum(row.save) !== row.checksum) throw new ApiError('Гостевое сохранение повреждено. Другие слоты сохранены.', 422);
    if (row.save.projectFingerprint === await fingerprint) await restoreSavedGame(row.save, row.checksum!, project, revision, await fingerprint);
    return saveDocumentSchema.parse({ slot, revision: row.revision, updatedAt: row.updatedAt, save: row.save, checksum: row.checksum });
  }
  async function locked<T>(slot: SaveSlot, action: (signal: AbortSignal) => Promise<T>) {
    const signal = lifetime ? AbortSignal.any([lifetime, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    try {
      signal.throwIfAborted();
      const run = async () => { signal.throwIfAborted(); return action(signal); };
      if (options.lock) return await options.lock(keyFor(slot), run, signal);
      if (!navigator.locks) throw new ApiError('Этот браузер не поддерживает безопасную запись гостевых слотов. Войди через ChatGPT для серверного сохранения.', 503);
      return await navigator.locks.request(keyFor(slot), { signal }, run);
    } catch (cause) { if (cause instanceof ApiError) throw cause; throw new ApiError('Не удалось записать гостевое сохранение. Текущее прохождение остаётся в окне; повтори запись.', 503); }
  }
  function put(slot: SaveSlot, row: Row) {
    rowSchema.parse(row);
    try { storage().setItem(keyFor(slot), JSON.stringify(row)); }
    catch { throw new ApiError('Гостевое сохранение не записано: хранилище браузера недоступно или заполнено. Прежний слот сохранён.', 503); }
  }
  return {
    async list() {
      lifetime?.throwIfAborted();
      return Promise.all(SAVE_SLOTS.map(async slot => {
        const stored = record(slot);
        if (!stored.damaged && !stored.row?.save) return emptySlot(slot, stored.revision, stored.updatedAt);
        try { if (!stored.row || stored.damaged) throw new Error(); return summarizeSave(await document(slot, stored.row), project); }
        catch { return { ...emptySlot(slot, stored.revision, stored.updatedAt), occupied: true, health: 'damaged' as const }; }
      }));
    },
    async read(slot) { lifetime?.throwIfAborted(); const stored = record(slot); if (stored.damaged) throw new ApiError('Гостевое сохранение повреждено. Другие слоты сохранены.', 422); if (!stored.row) throw new ApiError('Этот слот пуст', 410); return document(slot, stored.row); },
    async write(slot, input) {
      const body = saveWriteSchema.parse(input);
      if (body.save.state.projectRevision !== revision) throw new ApiError('Игра открыта в другой редакции. Обнови страницу перед записью.', 409);
      if (new TextEncoder().encode(JSON.stringify(body.save)).length > MAX_SAVE_BYTES) throw new ApiError('Сохранение превышает 1 МБ. Прежний слот сохранён.', 413);
      await restoreSavedGame(body.save, body.checksum, project, revision, await fingerprint);
      return locked(slot, async signal => {
        const stored = record(slot);
        if (stored.damaged) throw new ApiError('Повреждённый гостевой слот не перезаписан. Удали его явно через список сохранений.', 422);
        if (stored.revision !== body.expectedRevision) throw new ApiError('Гостевой слот изменился в другой вкладке. Обнови список перед записью.', 409);
        signal.throwIfAborted();
        const row: Row = { formatVersion: 1, revision: stored.revision + 1, updatedAt: new Date().toISOString(), save: body.save, checksum: body.checksum };
        const result = saveDocumentSchema.parse({ slot, revision: row.revision, updatedAt: row.updatedAt, save: row.save, checksum: row.checksum });
        put(slot, row); return result;
      });
    },
    async remove(slot, expectedRevision) {
      return locked(slot, async signal => {
        const stored = record(slot);
        if (stored.revision !== expectedRevision || !stored.damaged && !stored.row?.save) throw new ApiError('Гостевой слот изменился в другой вкладке. Обнови список перед удалением.', 409);
        signal.throwIfAborted();
        const row: Row = { formatVersion: 1, revision: stored.revision + 1, updatedAt: new Date().toISOString(), save: null, checksum: null };
        put(slot, row); return emptySlot(slot, row.revision, row.updatedAt);
      });
    },
  };
}
