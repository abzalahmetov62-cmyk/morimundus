import { parseProject, type Asset, type Project } from '../engine/project';

const assetKey = (key: string) => key === 'assetId' || key.endsWith('AssetId');
const labels: Record<string, string> = { floorAssetId: 'пол', wallAssetId: 'стены', ceilingAssetId: 'потолок', imageAssetId: 'рисунок', musicAssetId: 'музыка', ambienceAssetId: 'окружение', audioAssetId: 'звук / озвучка', assetId: 'звуковое последствие', frameAssetId: 'рамка шкалы', fillAssetId: 'заполнение шкалы', soundAssetId: 'звук печати' };
export type AssetUse = { label: string; path: string };

export function assetUseIndex(project: Project): Map<string, AssetUse[]> {
  const uses = new Map<string, AssetUse[]>();
  const visit = (value: unknown, path: string, label: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => visit(v, path + '.' + i, label)); return; }
    for (const [key, child] of Object.entries(value)) {
      if (assetKey(key) && typeof child === 'string') { const entries = uses.get(child) ?? []; entries.push({ label: label + ' — ' + (key === 'assetId' && path.endsWith('.spatialAudio') ? 'пространственный звук' : labels[key] ?? 'ресурс'), path: path + '.' + key }); uses.set(child, entries); }
      else visit(child, path + '.' + key, label);
    }
  };
  const groups = { locations: 'Локация', objects: 'Объект', items: 'Предмет', scripts: 'Сцена', rules: 'Реакция', quests: 'Задание' } as const;
  for (const [key, title] of Object.entries(groups)) {
    const values = project[key as keyof typeof groups];
    values.forEach((value, i) => visit(value, key + '.' + i, title + ' «' + value.name + '»'));
  }
  for (const kind of ['stats', 'skills'] as const) project.character[kind].forEach((t, i) => visit(t, 'character.' + kind + '.' + i, (kind === 'stats' ? 'Характеристика' : 'Навык') + ' «' + t.name + '»'));
  project.voices?.forEach((voice, i) => visit(voice, 'voices.' + i, 'Голос «' + voice.name + '»'));
  visit(project.settings, 'settings', 'Настройки игры');
  return uses;
}
export function assetUses(project: Project, assetId: string): AssetUse[] { return assetUseIndex(project).get(assetId) ?? []; }

export function replaceAsset(project: Project, assetId: string, replacement: Asset): Project {
  const original = project.assets.find(a => a.id === assetId);
  if (!original) throw new Error('Заменяемый ресурс уже убран из проекта');
  if (original.kind !== replacement.kind) throw new Error('Изображение можно заменить изображением, звук — звуком');
  if (replacement.id === assetId) return project;
  const map = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(map);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, assetKey(key) && child === assetId ? replacement.id : map(child)]));
  };
  const assets = project.assets.filter(a => a.id !== assetId);
  if (!assets.some(a => a.id === replacement.id)) assets.push({ ...replacement, name: original.name });
  return parseProject({ ...map(project) as Project, assets });
}

export function removeAsset(project: Project, assetId: string): Project {
  const uses = assetUses(project, assetId);
  if (uses.length) throw new Error('Сначала замени или сними назначение: ' + uses.slice(0, 3).map(u => u.label).join('; '));
  return parseProject({ ...project, assets: project.assets.filter(a => a.id !== assetId) });
}
