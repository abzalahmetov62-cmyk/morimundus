import { env } from 'cloudflare:workers';
import { assetSchema, parseProject, type Asset, type Project } from '../engine/project';
import { createSampleProject } from '../engine/sample-project';

export class StorageError extends Error { constructor(message: string, readonly status = 503) { super(message); } }
export function db(): D1Database { if (!env.DB) throw new StorageError('Хранилище временно недоступно. Ваши изменения остаются в редакторе.'); return env.DB; }
export function bucket(): R2Bucket { if (!env.BUCKET) throw new StorageError('Хранилище ресурсов временно недоступно.'); return env.BUCKET; }

type Row = { document: string; revision: number; updated_at: string };
export async function readProject() {
  let row = await db().prepare('SELECT document, revision, updated_at FROM projects WHERE id = ?').bind('morimundus').first<Row>();
  if (!row) {
    const project = createSampleProject();
    await db().prepare('INSERT INTO projects (id, document, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(project.id, JSON.stringify(project), new Date().toISOString()).run();
    row = await db().prepare('SELECT document, revision, updated_at FROM projects WHERE id = ?').bind('morimundus').first<Row>();
  }
  if (!row) throw new StorageError('Не удалось открыть проект');
  return { project: parseProject(JSON.parse(row.document)), revision: row.revision, updatedAt: row.updated_at };
}
export async function writeProject(input: unknown, expectedRevision: number) {
  const project = parseProject(input);
  if (project.id !== 'morimundus') throw new StorageError('Этот редактор предназначен для проекта Morimundus', 422);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new StorageError('Неверная версия проекта', 422);
  const records = await db().prepare('SELECT id, name, kind, mime, bytes, sha256 FROM assets').all<Asset>();
  const stored = new Map(records.results.map(a => [a.id, a]));
  for (const a of project.assets) {
    const record = stored.get(a.id);
    if (!record || record.sha256 !== a.sha256 || record.mime !== a.mime || record.bytes !== a.bytes || record.kind !== a.kind) throw new StorageError(`Ресурс «${a.name}» не найден. Импортируйте полную резервную копию.`, 422);
  }
  const updatedAt = new Date().toISOString();
  const result = await db().prepare('UPDATE projects SET document = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(project), updatedAt, project.id, expectedRevision).run();
  if (result.meta.changes !== 1) throw new StorageError('Проект изменился в другой вкладке. Скачайте свою копию перед повторным открытием.', 409);
  return { project, revision: expectedRevision + 1, updatedAt };
}
export async function insertAsset(asset: Asset, key: string) {
  await db().prepare('INSERT INTO assets (id, name, kind, mime, bytes, sha256, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(asset.id, asset.name, asset.kind, asset.mime, asset.bytes, asset.sha256, key).run();
}
export async function readAsset(id: string) {
  const row = await db().prepare('SELECT id, name, kind, mime, bytes, sha256, storage_key FROM assets WHERE id = ?').bind(id).first<Asset & { storage_key: string }>();
  if (!row) throw new StorageError('Ресурс не найден', 404);
  const { storage_key, ...metadata } = row;
  return { asset: assetSchema.parse(metadata), key: storage_key };
}
export async function errorResponse(error: unknown, request?: Request) {
  // Finish small rejected bodies before responding: workerd can otherwise leave
  // a pending read on its proxy stream and break the next request. Never parse
  // rejected input, and bound both discarded bytes and time.
  if (request?.body && !request.bodyUsed && !request.body.locked) {
    let discarded = 0;
    try {
      await request.body.pipeTo(new WritableStream<Uint8Array>({ write(chunk) {
        discarded += chunk.byteLength;
        if (discarded > 64 * 1024) throw new Error('Rejected body discard limit');
      } }), { signal: AbortSignal.any([request.signal, AbortSignal.timeout(3000)]) });
    } catch { /* Preserve the original rejection when input is large or stalled. */ }
  }
  if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
  console.error('Morimundus storage error', error instanceof Error ? error.message : error);
  return Response.json({ error: 'Не удалось выполнить действие. Правки остаются в открытом редакторе. Попробуйте ещё раз.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
}
export function rejectCrossSite(request: Request) { const origin = request.headers.get('origin'); if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin) throw new StorageError('Запрос должен быть выполнен из игры или редактора', 403); }
