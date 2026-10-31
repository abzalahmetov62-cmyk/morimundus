import { checksum, emptySlot, projectFingerprint, restoreSavedGame, savedGameSchema, saveDocumentSchema, saveWriteSchema, SAVE_SLOTS, summarizeSave, type SaveSlot, type SlotSummary } from '../engine/save-game';
import { db, readProject, StorageError } from './server';

type Row = { slot: SaveSlot; revision: number; document: string | null; checksum: string | null; updated_at: string };
function saveId(projectId: string, slot: SaveSlot) { return projectId + ':' + slot; }
async function documentFrom(row: Row) {
  if (!row.document) throw new StorageError('Этот слот пуст', 410);
  try {
    const save = savedGameSchema.parse(JSON.parse(row.document));
    if (await checksum(save) !== row.checksum) throw new Error('Контрольная сумма не совпадает');
    return saveDocumentSchema.parse({ slot: row.slot, revision: row.revision, updatedAt: row.updated_at, save, checksum: row.checksum });
  } catch { throw new StorageError('Сохранение повреждено. Другие слоты и текущее прохождение сохранены.', 422); }
}
export async function listSaves(): Promise<{ slots: SlotSummary[] }> {
  const author = await readProject(), fingerprint = await projectFingerprint(author.project);
  const rows = (await db().prepare('SELECT slot, revision, document, checksum, updated_at FROM game_saves WHERE project_id = ?').bind(author.project.id).all<Row>()).results;
  const slots = await Promise.all(SAVE_SLOTS.map(async slot => {
    const row = rows.find(r => r.slot === slot);
    if (!row?.document) return emptySlot(slot, row?.revision, row?.updated_at);
    try {
      const document = await documentFrom(row);
      if (document.save.projectFingerprint === fingerprint) await restoreSavedGame(document.save, document.checksum, author.project, author.revision, fingerprint);
      return summarizeSave(document, author.project);
    } catch { return { ...emptySlot(slot, row.revision, row.updated_at), occupied: true, health: 'damaged' as const }; }
  }));
  return { slots };
}
export async function readSave(slot: SaveSlot) {
  const author = await readProject();
  const row = await db().prepare('SELECT slot, revision, document, checksum, updated_at FROM game_saves WHERE id = ?').bind(saveId(author.project.id, slot)).first<Row>();
  if (!row) throw new StorageError('Этот слот пуст', 410);
  const document = await documentFrom(row), fingerprint = await projectFingerprint(author.project);
  if (document.save.projectFingerprint === fingerprint) await restoreSavedGame(document.save, document.checksum, author.project, author.revision, fingerprint);
  return document;
}
export async function writeSave(slot: SaveSlot, input: unknown) {
  const body = saveWriteSchema.parse(input), author = await readProject();
  if (body.save.state.projectRevision !== author.revision) throw new StorageError('Авторский проект изменился. Откройте сохранённый проект перед записью прохождения.', 409);
  const fingerprint = await projectFingerprint(author.project);
  await restoreSavedGame(body.save, body.checksum, author.project, author.revision, fingerprint);
  const document = JSON.stringify(body.save);
  if (new TextEncoder().encode(document).length > 1024 * 1024) throw new StorageError('Сохранение слишком большое. Рабочий слот не изменён.', 413);
  const updatedAt = new Date().toISOString(), id = saveId(author.project.id, slot);
  const result = await db().prepare(`INSERT INTO game_saves (id, project_id, slot, revision, document, checksum, updated_at)
    SELECT ?, ?, ?, 1, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM game_saves WHERE id = ? AND revision = ?))
    ON CONFLICT(id) DO UPDATE SET revision = game_saves.revision + 1, document = excluded.document, checksum = excluded.checksum, updated_at = excluded.updated_at
      WHERE game_saves.revision = ?`).bind(id, author.project.id, slot, document, body.checksum, updatedAt, author.project.id, author.revision, body.expectedRevision, id, body.expectedRevision, body.expectedRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Слот или проект изменился в другой вкладке. Обновите список сохранений; рабочий слот не перезаписан.', 409);
  return saveDocumentSchema.parse({ slot, revision: body.expectedRevision + 1, updatedAt, save: body.save, checksum: body.checksum });
}
export async function deleteSave(slot: SaveSlot, expectedRevision: number) {
  const author = await readProject(), updatedAt = new Date().toISOString();
  const result = await db().prepare('UPDATE game_saves SET document = NULL, checksum = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND document IS NOT NULL').bind(updatedAt, saveId(author.project.id, slot), expectedRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Слот изменился в другой вкладке. Обновите список перед удалением.', 409);
  return emptySlot(slot, expectedRevision + 1, updatedAt);
}
