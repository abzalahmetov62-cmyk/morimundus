import { z } from 'zod';
import { parseProject, type Project } from '../engine/project';
import { assetUrl, uploadAsset } from './client';
import { detectAsset, MAX_ASSET_BYTES } from './asset-format';

export type Backup = { format: 'morimundus-backup'; version: 1; project: Project; resources: { id: string; base64: string }[] };
const schema = z.object({ format: z.literal('morimundus-backup'), version: z.literal(1), project: z.unknown(), resources: z.array(z.object({ id: z.string(), base64: z.string().max(MAX_ASSET_BYTES * 1.4) }).strict()).max(500) }).strict();
async function hash(bytes: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map(x => x.toString(16).padStart(2, '0')).join(''); }
function encode(bytes: Uint8Array) { let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); }
function decode(s: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('Повреждены ресурсы резервной копии');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
export async function createBackup(project: Project): Promise<Backup> {
  const validated = parseProject(project);
  const resources: Backup['resources'] = [];
  for (const a of validated.assets) {
    const response = await fetch(assetUrl(a.id)); if (!response.ok) throw new Error(`Не удалось скачать ресурс «${a.name}»`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== a.bytes || await hash(bytes) !== a.sha256) throw new Error(`Ресурс «${a.name}» повреждён`);
    resources.push({ id: a.id, base64: encode(bytes) });
  }
  return { format: 'morimundus-backup', version: 1, project: validated, resources };
}
export async function parseBackup(file: File): Promise<Backup> {
  let data: unknown; try { data = JSON.parse(await file.text()); } catch { throw new Error('Выберите файл резервной копии Morimundus'); }
  const parsed = schema.safeParse(data); if (!parsed.success) throw new Error('Неизвестный или повреждённый формат резервной копии');
  const project = parseProject(parsed.data.project);
  if (project.id !== 'morimundus') throw new Error('Резервная копия относится к другому проекту');
  const resources = parsed.data.resources;
  if (new Set(resources.map(r => r.id)).size !== resources.length || resources.length !== project.assets.length) throw new Error('Список ресурсов резервной копии неполный');
  for (const a of project.assets) {
    const r = resources.find(r => r.id === a.id); if (!r) throw new Error(`Не хватает ресурса «${a.name}»`);
    const bytes = decode(r.base64); const format = detectAsset(bytes);
    if (bytes.length !== a.bytes || await hash(bytes) !== a.sha256 || format?.mime !== a.mime || format?.kind !== a.kind) throw new Error(`Ресурс «${a.name}» повреждён`);
  }
  return { format: 'morimundus-backup', version: 1, project, resources };
}
export async function restoreBackup(backup: Backup): Promise<Project> {
  const project = structuredClone(backup.project); const mappings = new Map<string, string>();
  for (let i = 0; i < project.assets.length; i++) {
    const a = project.assets[i]; const response = await fetch(assetUrl(a.id));
    if (response.ok && await hash(new Uint8Array(await response.arrayBuffer())) === a.sha256) continue;
    if (!response.ok && response.status !== 404) throw new Error('Не удалось проверить сохранённые ресурсы. Попробуйте ещё раз.');
    const r = backup.resources.find(r => r.id === a.id)!;
    const uploaded = await uploadAsset(new File([decode(r.base64) as BlobPart], a.name, { type: a.mime }));
    mappings.set(a.id, uploaded.id); project.assets[i] = { ...uploaded, name: a.name };
  }
  const remap = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    for (const [key, val] of Object.entries(v)) {
      if ((key.endsWith('AssetId') || key === 'assetId') && typeof val === 'string' && mappings.has(val)) (v as Record<string, unknown>)[key] = mappings.get(val)!;
      else remap(val);
    }
  };
  remap(project); return parseProject(project);
}
export function backupBlob(backup: Backup): Blob {
  const parts: BlobPart[] = ['{"format":"morimundus-backup","version":1,"project":', JSON.stringify(backup.project), ',"resources":['];
  for (const [index, resource] of backup.resources.entries()) {
    if (index) parts.push(',');
    parts.push(new Blob([JSON.stringify(resource)]));
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}
export function downloadBackup(backup: Backup) {
  const url = URL.createObjectURL(backupBlob(backup));
  const link = document.createElement('a'); link.href = url; link.download = `Morimundus-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
