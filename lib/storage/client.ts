import { assetSchema, parseProject, type Asset, type Project } from '../engine/project';
import { z } from 'zod';

export type ProjectDocument = { project: Project; revision: number; updatedAt: string };
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function responseData(response: Response, unavailableMessage = 'Не удалось связаться с хранилищем проекта') {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(data);
    throw new ApiError(failure.success ? failure.data.error : unavailableMessage, response.status);
  }
  return data;
}
function documentFrom(input: unknown): ProjectDocument {
  const result = z.object({ project: z.unknown(), revision: z.number().int().positive(), updatedAt: z.string().datetime() }).strict().safeParse(input);
  if (!result.success) throw new Error('Ответ хранилища повреждён');
  return { ...result.data, project: parseProject(result.data.project) };
}
export async function loadProject(): Promise<ProjectDocument> {
  return documentFrom(await responseData(await fetch('/api/project', { cache: 'no-store' })));
}
export async function saveProject(project: Project, revision: number): Promise<ProjectDocument> {
  return documentFrom(await responseData(await fetch('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: parseProject(project), expectedRevision: revision }) })));
}
export async function uploadAsset(file: File, signal?: AbortSignal): Promise<Asset> {
  const form = new FormData(); form.set('file', file);
  return assetSchema.parse(await responseData(await fetch('/api/assets', { method: 'POST', body: form, signal })));
}
export function assetUrl(id: string, variant?: 'game') { return `/api/assets/${encodeURIComponent(id)}` + (variant ? '?variant=' + variant : ''); }
export async function probeAsset(asset: Asset, signal?: AbortSignal) {
  const response = await fetch(assetUrl(asset.id), { method: 'HEAD', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'Файл отсутствует в хранилище' : response.status === 422 ? 'Файл повреждён' : 'Хранилище недоступно');
  if (response.headers.get('content-type') !== asset.mime || Number(response.headers.get('content-length')) !== asset.bytes) throw new Error('Сведения о файле не совпадают');
}
