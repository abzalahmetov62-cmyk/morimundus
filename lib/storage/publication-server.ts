import { parseProject } from '../engine/project';
import { projectFingerprint } from '../engine/save-game';
import { publicationInfoSchema, publicationWriteSchema, type PublishedGame } from '../engine/publication';
import { db, readProject, StorageError } from './server';

type Row = { revision: number; author_revision: number; document: string; fingerprint: string; published_at: string };
export async function readPublication(): Promise<PublishedGame | null> {
  const row = await db().prepare('SELECT revision, author_revision, document, fingerprint, published_at FROM published_games WHERE project_id = ?').bind('morimundus').first<Row>();
  if (!row) return null;
  const project = parseProject(JSON.parse(row.document));
  if (await projectFingerprint(project) !== row.fingerprint) throw new StorageError('Опубликованная редакция повреждена. Автор может опубликовать сохранённый проект повторно.', 503);
  return { ...publicationInfoSchema.parse({ revision: row.revision, authorRevision: row.author_revision, fingerprint: row.fingerprint, publishedAt: row.published_at, title: project.meta.title }), project };
}
export async function requirePublication() {
  const game = await readPublication();
  if (!game) throw new StorageError('Автор ещё не опубликовал игру.', 404);
  return game;
}
export async function publishGame(input: unknown) {
  const body = publicationWriteSchema.parse(input), author = await readProject();
  if (author.revision !== body.expectedAuthorRevision) throw new StorageError('Авторский проект изменился. Открой актуальную версию перед публикацией.', 409);
  const fingerprint = await projectFingerprint(author.project), publishedAt = new Date().toISOString();
  const result = await db().prepare(`INSERT INTO published_games (project_id, revision, author_revision, document, fingerprint, published_at)
    SELECT ?, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM published_games WHERE project_id = ? AND revision = ?))
    ON CONFLICT(project_id) DO UPDATE SET revision = published_games.revision + 1, author_revision = excluded.author_revision,
      document = excluded.document, fingerprint = excluded.fingerprint, published_at = excluded.published_at
      WHERE published_games.revision = ?`).bind(author.project.id, author.revision, JSON.stringify(author.project), fingerprint, publishedAt,
      author.project.id, author.revision, body.expectedPublicationRevision, author.project.id, body.expectedPublicationRevision, body.expectedPublicationRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Проект или опубликованная редакция изменились в другой вкладке. Обнови сведения перед повтором.', 409);
  return publicationInfoSchema.parse({ revision: body.expectedPublicationRevision + 1, authorRevision: author.revision, publishedAt, fingerprint, title: author.project.meta.title });
}
