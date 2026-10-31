import type { Project } from '../engine/project';
import type { GameState } from '../engine/game-state';
import { TestSession } from '../engine/session';
import { assertArrival } from '../engine/spatial';
import { explainCondition, objectIsPresent, type ConditionTrace } from '../engine/conditions';
import { currentNode } from '../engine/scenarios';

export type TestPose = { position: [number, number, number]; yaw: number; pitch: number };
export function authorTestSnapshot(project: Project, revision: number, locationId: string, pose?: TestPose, scriptId?: string): GameState {
  const session = new TestSession(project, revision, locationId, { startScriptId: scriptId ?? null });
  const location = session.project.locations.find(l => l.id === locationId)!;
  if (pose) {
    const [x, , z] = pose.position;
    const room = location.rooms.find(r => x > r.origin[0] && x < r.origin[0] + r.width && z > r.origin[2] && z < r.origin[2] + r.depth);
    if (!room) throw new Error('Точка обзора находится за пределами комнаты. Приблизь обзор внутрь локации.');
    const position: [number, number, number] = [x, room.origin[1] + 1.65, z];
    assertArrival(location, session.visibleObjects(), position); session.setPose(position, pose.yaw, pose.pitch);
  } else assertArrival(location, session.visibleObjects(), session.pose().position);
  session.start();
  const destination = session.project.locations.find(l => l.id === session.locationId())!;
  assertArrival(destination, session.visibleObjects(), session.pose().position);
  return session.snapshot();
}

export function objectDiagnostics(project: Project, state: GameState, objectId: string): ConditionTrace[] {
  const object = project.objects.find(o => o.id === objectId);
  if (!object) return [];
  const wrap = (label: string, condition: Parameters<typeof explainCondition>[0], base = false): ConditionTrace => { const trace = explainCondition(condition, project, state, base); return { label, allowed: trace.allowed, detail: '', children: [trace] }; };
  const result: ConditionTrace[] = [
    { label: 'Присутствие в мире', allowed: !!state.objects[objectId]?.present, detail: state.objects[objectId]?.present ? 'Объект не убран последствием' : 'Объект убран последствием', children: [] },
    { label: 'Итог расписания', allowed: objectIsPresent(project, state, objectId), detail: 'При текущем времени мира', children: [] },
    wrap('Условие видимости', object.visibleWhen), wrap('Условие взаимодействия', object.interaction.condition),
  ];
  const owner = state.items['instance-' + object.id]?.owner;
  if (owner) result.push({ label: 'Исходный экземпляр предмета', allowed: owner.type === 'world' && !owner.dropped && owner.locationId === object.locationId, detail: owner.type === 'world' ? owner.dropped ? 'Выброшен отдельно от исходного объекта' : 'Находится в мире' : owner.type === 'equipment' ? 'Надет на героя' : owner.type === 'container' ? 'Находится в контейнере' : 'Находится в инвентаре', children: [] });
  project.schedules.filter(s => s.objectId === objectId).forEach((schedule, index) => result.push(wrap('Условие расписания ' + (index + 1), schedule.condition, true)));
  const triggers: Record<string, string> = { interact: 'действие', enter: 'вход', checkSuccess: 'успех проверки', checkFailure: 'провал проверки', useItem: 'применение вещи', timer: 'таймер' };
  for (const rule of project.rules.filter(r => r.targetObjectId === objectId || !r.targetObjectId)) {
    const trace = wrap('Условие реакции «' + rule.name + '» — ' + (triggers[rule.trigger] ?? 'событие'), rule.condition);
    if (rule.once && state.appliedRules.includes(rule.id)) { trace.allowed = false; trace.detail = 'Одноразовая реакция уже выполнена'; }
    result.push(trace);
  }
  for (const recipe of project.recipes.filter(r => r.containerObjectId === objectId)) result.push(wrap('Условие рецепта «' + recipe.name + '»', recipe.condition));
  for (const choice of currentNode(project, state)?.choices ?? []) result.push(wrap('Условие ответа «' + choice.label + '»', choice.condition));
  return result;
}
