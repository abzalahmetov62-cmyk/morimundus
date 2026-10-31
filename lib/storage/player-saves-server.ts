import { checksum, emptySlot, MAX_SAVE_BYTES, restoreSavedGame, savedGameSchema, saveDocumentSchema, saveWriteSchema, SAVE_SLOTS, summarizeSave, type SaveSlot, type SlotSummary } from '../engine/save-game';
import { db, StorageError } from './server';
import { requirePublication } from './publication-server';

type Row = { slot: SaveSlot; revision: number; document: string | null; checksum: string | null; updated_at: string };
async function documentFrom(row: Row) {
  if (!row.document) throw new StorageError('Этот слот пуст', 410);
  try {
    const save = savedGameSchema.parse(JSON.parse(row.document));
    if (await checksum(save) !== row.checksum) throw new Error('Контрольная сумма не совпадает');
    return saveDocumentSchema.parse({ slot: row.slot, revision: row.revision, updatedAt: row.updated_at, save, checksum: row.checksum });
  } catch { throw new StorageError('Сохранение повреждено. Другие слоты и текущее прохождение сохранены.', 422); }
}
export async function listPlayerSaves(userId: string): Promise<{ slots: SlotSummary[] }> {
  const game = await requirePublication();
  const rows = (await db().prepare('SELECT slot, revision, document, checksum, updated_at FROM player_saves WHERE project_id = ? AND user_id = ?').bind(game.project.id, userId).all<Row>()).results;
  const slots = await Promise.all(SAVE_SLOTS.map(async slot => {
    const row = rows.find(r => r.slot === slot);
    if (!row?.document) return emptySlot(slot, row?.revision, row?.updated_at);
    try {
      const document = await documentFrom(row);
      if (document.save.projectFingerprint === game.fingerprint) await restoreSavedGame(document.save, document.checksum, game.project, game.revision, game.fingerprint);
      return summarizeSave(document, game.project);
    } catch { return { ...emptySlot(slot, row.revision, row.updated_at), occupied: true, health: 'damaged' as const }; }
  }));
  return { slots };
}
export async function readPlayerSave(userId: string, slot: SaveSlot) {
  const game = await requirePublication();
  const row = await db().prepare('SELECT slot, revision, document, checksum, updated_at FROM player_saves WHERE project_id = ? AND user_id = ? AND slot = ?').bind(game.project.id, userId, slot).first<Row>();
  if (!row) throw new StorageError('Этот слот пуст', 410);
  const document = await documentFrom(row);
  if (document.save.projectFingerprint === game.fingerprint) await restoreSavedGame(document.save, document.checksum, game.project, game.revision, game.fingerprint);
  return document;
}
export async function writePlayerSave(userId: string, slot: SaveSlot, input: unknown) {
  const body = saveWriteSchema.parse(input), game = await requirePublication();
  if (body.save.state.projectRevision !== game.revision) throw new StorageError('Опубликована новая редакция игры. Обнови игру перед записью; прежний слот сохранён.', 409);
  await restoreSavedGame(body.save, body.checksum, game.project, game.revision, game.fingerprint);
  const document = JSON.stringify(body.save);
  if (new TextEncoder().encode(document).length > MAX_SAVE_BYTES) throw new StorageError('Сохранение слишком большое. Рабочий слот не изменён.', 413);
  const updatedAt = new Date().toISOString();
  const result = await db().prepare(`INSERT INTO player_saves (project_id, user_id, slot, revision, document, checksum, updated_at)
    SELECT ?, ?, ?, 1, ?, ?, ? WHERE EXISTS (SELECT 1 FROM published_games WHERE project_id = ? AND revision = ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM player_saves WHERE project_id = ? AND user_id = ? AND slot = ? AND revision = ?))
    ON CONFLICT(project_id, user_id, slot) DO UPDATE SET revision = player_saves.revision + 1, document = excluded.document, checksum = excluded.checksum, updated_at = excluded.updated_at
      WHERE player_saves.revision = ?`).bind(game.project.id, userId, slot, document, body.checksum, updatedAt,
      game.project.id, game.revision, body.expectedRevision, game.project.id, userId, slot, body.expectedRevision, body.expectedRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Слот или редакция игры изменились. Обнови список перед повтором; рабочий слот сохранён.', 409);
  return saveDocumentSchema.parse({ slot, revision: body.expectedRevision + 1, updatedAt, save: body.save, checksum: body.checksum });
}
export async function deletePlayerSave(userId: string, slot: SaveSlot, expectedRevision: number) {
  const game = await requirePublication(), updatedAt = new Date().toISOString();
  const result = await db().prepare('UPDATE player_saves SET document = NULL, checksum = NULL, revision = revision + 1, updated_at = ? WHERE project_id = ? AND user_id = ? AND slot = ? AND revision = ? AND document IS NOT NULL').bind(updatedAt, game.project.id, userId, slot, expectedRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Слот изменился. Обнови список перед удалением.', 409);
  return emptySlot(slot, expectedRevision + 1, updatedAt);
}
