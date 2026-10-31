import type { Condition, Project } from './project';
import type { GameState } from './game-state';

type Compare = Extract<Condition, { type: 'compare' }>;
const schedulesByProject = new WeakMap<Project, Map<string, Project['schedules']>>();
function schedulesFor(project: Project, objectId: string) {
  if (!Object.isFrozen(project)) return project.schedules.filter(s => s.objectId === objectId);
  let index = schedulesByProject.get(project);
  if (!index) {
    index = new Map();
    for (const schedule of project.schedules) { const list = index.get(schedule.objectId) ?? []; list.push(schedule); index.set(schedule.objectId, list); }
    schedulesByProject.set(project, index);
  }
  return index.get(objectId) ?? [];
}
export function effectiveTraitValue(project: Project, state: GameState, kind: 'stats' | 'skills', key: string) {
  const base = state.player[kind][key];
  if (base === undefined) return undefined;
  const statuses = state.player.statuses.reduce((sum, id) => sum + (project.character.statuses.find(s => s.id === id)?.modifiers[key] ?? 0), 0);
  return base + statuses + Object.values(state.player.equipment).reduce((sum, id) => sum + (id ? project.items.find(d => d.id === state.items[id]?.definitionId)?.modifiers[key] ?? 0 : 0), 0);
}
export function objectIsPresent(project: Project | undefined, state: GameState, objectId: string): boolean {
  if (!state.objects[objectId]?.present) return false;
  if (!project?.schedules.length) return true;
  const schedules = schedulesFor(project, objectId);
  if (!schedules.length) return true;
  const time = state.clock.worldSeconds % 86400;
  let present = !schedules.some(s => s.present);
  for (const schedule of schedules) {
    const inside = schedule.fromSeconds < schedule.toSeconds ? time >= schedule.fromSeconds && time < schedule.toSeconds : time >= schedule.fromSeconds || time < schedule.toSeconds;
    if (inside && evaluateCondition(schedule.condition, state, project, true)) present = schedule.present;
  }
  return present;
}

export function conditionValue(condition: Compare, state: GameState, project?: Project, basePresence = false): unknown {
  const key = condition.key;
  switch (condition.source) {
    case 'flag': return state.flags[key];
    case 'stat': return project ? effectiveTraitValue(project, state, 'stats', key) : state.player.stats[key];
    case 'skill': return project ? effectiveTraitValue(project, state, 'skills', key) : state.player.skills[key];
    case 'status': return state.player.statuses.includes(key);
    case 'time': return key === 'worldSeconds' ? state.clock.worldSeconds : key === 'playedSeconds' ? state.clock.playedSeconds : key === 'timeOfDaySeconds' ? state.clock.worldSeconds % 86400 : undefined;
    case 'check': return condition.field === 'attempts' ? state.checks[key]?.attempts ?? 0 : state.checks[key]?.succeeded ?? false;
    case 'quest': return condition.field === 'completed' ? state.quests[key]?.completed : state.quests[key]?.stageId;
    case 'object': return !state.objects[key] ? undefined : condition.field ? state.objects[key].state[condition.field] : basePresence ? state.objects[key].present : objectIsPresent(project, state, key);
    case 'inventory': return Object.values(state.items).filter(i => i.definitionId === key && (condition.field === 'equipment' ? i.owner.type === 'equipment' : condition.field === 'inventory' ? i.owner.type === 'inventory' : i.owner.type === 'inventory' || i.owner.type === 'equipment')).length;
  }
}

export function evaluateCondition(condition: Condition | null, state: GameState, project?: Project, basePresence = false): boolean {
  if (!condition) return true;
  if (condition.type === 'literal') return condition.value;
  if (condition.type === 'all') return condition.conditions.every(c => evaluateCondition(c, state, project, basePresence));
  if (condition.type === 'any') return condition.conditions.some(c => evaluateCondition(c, state, project, basePresence));
  if (condition.type === 'not') return !evaluateCondition(condition.condition, state, project, basePresence);
  if (condition.type !== 'compare') return false;
  const actual = conditionValue(condition, state, project, basePresence), expected = condition.value;
  if (actual === undefined || typeof actual !== typeof expected) return false;
  if (condition.operator === 'eq') return actual === expected;
  if (condition.operator === 'neq') return actual !== expected;
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (condition.operator === 'gt') return actual > expected;
  if (condition.operator === 'gte') return actual >= expected;
  if (condition.operator === 'lt') return actual < expected;
  return actual <= expected;
}

const comparisons = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
const valueLabel = (v: unknown) => v === true ? 'да' : v === false ? 'нет' : v === null ? 'пусто' : String(v);
export function describeCondition(condition: Condition | null, project: Project): string {
  if (!condition) return 'Без условия';
  if (condition.type === 'literal') return condition.value ? 'Всегда доступно' : 'Недоступно';
  if (condition.type === 'all' || condition.type === 'any') return '(' + condition.conditions.map(c => describeCondition(c, project)).join(condition.type === 'all' ? ' И ' : ' ИЛИ ') + ')';
  if (condition.type === 'not') return 'НЕ ' + describeCondition(condition.condition, project);
  if (condition.type !== 'compare') return '';
  const key = condition.key;
  let label: string;
  switch (condition.source) {
    case 'flag': label = 'Флаг «' + key + '»'; break;
    case 'stat': label = project.character.stats.find(s => s.id === key)?.name ?? key; break;
    case 'skill': label = project.character.skills.find(s => s.id === key)?.name ?? key; break;
    case 'status': label = 'Статус «' + (project.character.statuses.find(s => s.id === key)?.name ?? key) + '»'; break;
    case 'inventory': label = 'Количество «' + (project.items.find(s => s.id === key)?.name ?? key) + '»' + (condition.field === 'equipment' ? ' в экипировке' : condition.field === 'inventory' ? ' в ячейках' : ' у героя'); break;
    case 'time': label = condition.key === 'worldSeconds' ? 'Время мира, с' : condition.key === 'timeOfDaySeconds' ? 'Время суток, с' : 'Время игры, с'; break;
    case 'check': label = 'Проверка «' + (project.checks.find(c => c.id === key)?.name ?? key) + '»: ' + (condition.field === 'attempts' ? 'попытки' : 'успех'); break;
    case 'quest': label = 'Задание «' + (project.quests.find(s => s.id === key)?.name ?? key) + '»'; break;
    case 'object': label = '«' + (project.objects.find(s => s.id === key)?.name ?? key) + '»: ' + (condition.field ?? 'присутствует'); break;
  }
  return label + ' ' + comparisons[condition.operator] + ' ' + valueLabel(condition.value);
}

export function conditionResult(condition: Condition | null, project: Project, state: GameState): { allowed: boolean; reason: string } {
  const allowed = evaluateCondition(condition, state, project);
  if (allowed) return { allowed, reason: '' };
  if (condition?.type === 'all') return conditionResult(condition.conditions.find(c => !evaluateCondition(c, state, project))!, project, state);
  return { allowed, reason: 'Не выполнено условие: ' + describeCondition(condition, project) };
}

export type ConditionTrace = { label: string; allowed: boolean; detail: string; children: ConditionTrace[] };
export function explainCondition(condition: Condition | null, project: Project, state: GameState, basePresence = false): ConditionTrace {
  const children = !condition ? [] : condition.type === 'all' || condition.type === 'any' ? condition.conditions.map(c => explainCondition(c, project, state, basePresence)) : condition.type === 'not' ? [explainCondition(condition.condition, project, state, basePresence)] : [];
  const actual = condition?.type === 'compare' ? conditionValue(condition, state, project, basePresence) : undefined;
  return { label: !condition ? 'Без условия' : condition.type === 'all' ? 'Все условия (И)' : condition.type === 'any' ? 'Любое условие (ИЛИ)' : condition.type === 'not' ? 'Обратное условие (НЕ)' : describeCondition(condition, project), allowed: evaluateCondition(condition, state, project, basePresence), detail: condition?.type === 'compare' ? 'Сейчас: ' + (actual === undefined ? 'значение отсутствует' : valueLabel(actual)) + '. Ожидается: ' + valueLabel(condition.value) : '', children };
}
