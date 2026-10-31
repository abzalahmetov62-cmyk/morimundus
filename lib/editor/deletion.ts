import { parseProject, type Project } from '../engine/project';

export function checkedDeletion(candidate: Project, label: string, original?: Project) {
  try { return parseProject(candidate); }
  catch (cause) {
    const groups = { locations: 'Локация', objects: 'Объект', scripts: 'Сцена', rules: 'Реакция', items: 'Предмет', checks: 'Проверка', quests: 'Задание', recipes: 'Рецепт', schedules: 'Расписание', timers: 'Таймер' } as const;
    const references: string[] = [];
    if (original) {
      const removed = new Map(Object.keys(groups).map(key => { const group = key as keyof typeof groups; return [key, new Set(original[group].filter(value => !candidate[group].some(current => current.id === value.id)).map(value => value.id))]; }));
      const fields: Record<string, string> = { scriptId: 'scripts', startScriptId: 'scripts', objectId: 'objects', targetObjectId: 'objects', containerObjectId: 'objects', locationId: 'locations', startLocationId: 'locations', timerId: 'timers', ruleId: 'rules', checkId: 'checks', itemDefinitionId: 'items', resultItemId: 'items' };
      const sources: Record<string, string> = { object: 'objects', check: 'checks', quest: 'quests', inventory: 'items' };
      const refers = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(refers);
        const record = value as Record<string, unknown>;
        if (record.type === 'compare' && typeof record.source === 'string' && typeof record.key === 'string' && removed.get(sources[record.source])?.has(record.key)) return true;
        return Object.entries(record).some(([key, child]) => typeof child === 'string' && removed.get(fields[key])?.has(child) || refers(child));
      };
      for (const [key, title] of Object.entries(groups)) candidate[key as keyof typeof groups].forEach((value, index) => { if (refers(value)) references.push(title + ' «' + ('name' in value ? value.name : index + 1) + '»'); });
    }
    const message = (cause instanceof Error ? cause.message : 'Связанные данные требуют исправления').replace(/\b(locations|objects|scripts|rules|items|checks|quests|recipes|schedules|timers)\.(\d+)/g, (_, key: keyof typeof groups, index: string) => groups[key] + ' «' + (('name' in (candidate[key][Number(index)] ?? {}) ? (candidate[key][Number(index)] as { name: string }).name : undefined) ?? Number(index) + 1) + '»');
    throw new Error('Нельзя удалить ' + label + '. Проверь зависимости: ' + (references.length ? [...new Set(references)].slice(0, 5).join(', ') + '. ' : '') + message);
  }
}
