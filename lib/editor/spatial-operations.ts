import { parseProject, type Condition, type Location, type Project, type WorldObject } from '../engine/project';
import { scenarioDependencies } from './scenario-dependencies';
import { checkedDeletion } from './deletion';
import { assertArrival, canStandAt, collisionWorld, type Point2 } from '../engine/spatial';

export type Room = Location['rooms'][number];
export type ObjectClipboard = { project: Project; ids: string[] };
export const snap = (n: number, step = .25) => Math.round(n / step) * step;
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const requireLocation = (p: Project, locationId: string) => { const l = p.locations.find(l => l.id === locationId); if (!l) throw new Error('Локация не найдена'); return l; };

export function rectangle(a: Point2, b: Point2) {
  return { x: snap(Math.min(a.x, b.x)), z: snap(Math.min(a.z, b.z)), width: snap(Math.abs(b.x - a.x)), depth: snap(Math.abs(b.z - a.z)) };
}

export function createLocation(project: Project, name: string, width = 6, depth = 5, height = 2.8) {
  if (width < .5 || depth < .5 || height < 1.9) throw new Error('Комната должна быть не меньше 0,5 × 0,5 м, потолок — не ниже 1,9 м');
  const location: Location = { id: id('location'), name, notes: '', rooms: [{ id: id('room'), origin: [0, 0, 0], width, depth, height, floorAssetId: null, wallAssetId: null, ceilingAssetId: null }], spawn: { position: [width / 2, 1.65, depth / 2], yaw: 0, pitch: 0 }, audio: { musicAssetId: null, ambienceAssetId: null, volume: .7 } };
  return { project: parseProject({ ...project, locations: [...project.locations, location] }), id: location.id };
}

export function addRoom(project: Project, locationId: string, a: Point2, b: Point2) {
  const location = requireLocation(project, locationId), bounds = rectangle(a, b);
  if (bounds.width < .5 || bounds.depth < .5) throw new Error('Нарисуйте прямоугольник не меньше 0,5 × 0,5 м');
  const template = location.rooms[0];
  const room: Room = { ...template, id: id('room'), origin: [bounds.x, template.origin[1], bounds.z], width: bounds.width, depth: bounds.depth };
  return { project: parseProject({ ...project, locations: project.locations.map(l => l.id === locationId ? { ...l, rooms: [...l.rooms, room] } : l) }), id: room.id };
}

export function addObject(project: Project, locationId: string, kind: WorldObject['kind'], point?: Point2) {
  const location = requireLocation(project, locationId);
  const position: [number, number, number] = [point?.x ?? location.spawn.position[0], location.rooms[0].origin[1], point?.z ?? location.spawn.position[2]];
  const name = { prop: 'Новый объект', item: 'Новый предмет', npc: 'Новый персонаж', container: 'Новый контейнер', exit: 'Дверь' }[kind];
  const definitionId = kind === 'item' ? id('item') : null;
  const object: WorldObject = { id: id('object'), locationId, name, kind, notes: '', tags: [], transform: { position, rotation: [0, 0, 0], scale: kind === 'exit' ? [1, 2, 1] : kind === 'npc' ? [.7, 1.7, 1] : [.5, .5, 1] }, imageAssetId: null, billboard: 'vertical', collision: { solid: false, radius: .25 }, initialState: {}, visibleWhen: null, interaction: { scriptId: null, itemDefinitionId: definitionId, canTake: kind === 'item', reach: 2, audioAssetId: null, showsTime: false, condition: null, unavailableReason: '', itemUseReason: 'Эта вещь здесь не подходит.' }, container: kind === 'container' ? { capacity: 8, acceptedTags: [] } : null, transition: null };
  const items = definitionId ? [...project.items, { id: definitionId, name, description: '', tags: [], imageAssetId: null, equipmentSlot: null, capacityBonus: 0, modifiers: {} }] : project.items;
  return { project: parseProject({ ...project, objects: [...project.objects, object], items }), id: object.id };
}

export function setObjectImage(project: Project, objectId: string, imageAssetId: string | null) {
  if (!project.objects.some(o => o.id === objectId)) throw new Error('Объект не найден');
  return parseProject({ ...project, objects: project.objects.map(o => o.id === objectId ? { ...o, imageAssetId } : o) });
}

export function setObjectKind(project: Project, objectId: string, kind: WorldObject['kind']) {
  const object = project.objects.find(o => o.id === objectId);
  if (!object) throw new Error('Объект не найден');
  const definitionId = kind === 'item' ? object.interaction.itemDefinitionId ?? id('item') : null;
  const items = definitionId && !project.items.some(i => i.id === definitionId) ? [...project.items, { id: definitionId, name: object.name, description: object.notes, tags: [...object.tags], imageAssetId: object.imageAssetId, equipmentSlot: null, capacityBonus: 0, modifiers: {} }] : project.items;
  return parseProject({ ...project, items, objects: project.objects.map(o => o.id === objectId ? { ...o, kind, container: kind === 'container' ? o.container ?? { capacity: 8, acceptedTags: [] } : null, interaction: { ...o.interaction, canTake: kind === 'item', itemDefinitionId: definitionId } } : o) });
}

function mapCondition(condition: Condition | null, objects: Map<string, string>, checks = new Map<string, string>()): Condition | null {
  if (!condition) return null;
  if (condition.type === 'all' || condition.type === 'any') return { ...condition, conditions: condition.conditions.map(c => mapCondition(c, objects, checks)!) };
  if (condition.type === 'not') return { ...condition, condition: mapCondition(condition.condition, objects, checks)! };
  if (condition.type === 'compare' && condition.source === 'check') return { ...condition, key: checks.get(condition.key) ?? condition.key };
  if (condition.type === 'compare' && condition.source === 'object') return { ...condition, key: objects.get(condition.key) ?? condition.key };
  return structuredClone(condition);
}

function copyGraph(target: Project, source: Project, objectIds: string[], locationId: string, offset: Point2, locations = new Map<string, string>()) {
  const originals = objectIds.map(objectId => { const o = source.objects.find(o => o.id === objectId); if (!o) throw new Error('Копируемый объект не найден'); return o; });
  const objects = new Map(originals.map(o => [o.id, id('object')]));
  const initialRules = source.rules.filter(r => r.targetObjectId && objects.has(r.targetObjectId));
  const initialScripts = originals.flatMap(o => o.interaction.scriptId ? [o.interaction.scriptId] : []);
  for (const rule of initialRules) for (const action of rule.actions) if (action.type === 'openScript') initialScripts.push(action.scriptId);
  const { scriptIds, rules, timers } = scenarioDependencies(source, initialScripts, initialRules.map(r => r.id), true);
  const timerIds = new Map(timers.map(t => [t.id, id('timer')]));
  const ruleIds = new Map(rules.map(r => [r.id, id('rule')]));
  const checkSources = new Set([...source.scripts.filter(s => scriptIds.has(s.id)).flatMap(s => s.nodes.flatMap(n => n.choices.flatMap(c => c.checkId ? [c.checkId] : []))), ...rules.flatMap(r => r.checkId ? [r.checkId] : [])]);
  const checks = new Map([...checkSources].map(checkId => [checkId, id('check')]));
  const rewardIds = new Map<string, string>();
  const rewardCopy = (a: Project['rules'][number]['actions'][number]) => { if (a.type !== 'giveItemOnce') return {}; if (!rewardIds.has(a.rewardId)) rewardIds.set(a.rewardId, id('reward')); return { rewardId: rewardIds.get(a.rewardId)! }; };
  const recipes = source.recipes.filter(r => r.containerObjectId && objects.has(r.containerObjectId));
  const recipeIds = new Map(recipes.map(r => [r.id, id('recipe')]));
  const scripts = new Map([...scriptIds].map(s => [s, id('script')]));
  type Action = Project['rules'][number]['actions'][number];
  const mapAction = (a: Action): Action => ({ ...structuredClone(a), ...('timerId' in a ? { timerId: timerIds.get(a.timerId) ?? a.timerId } : {}), ...rewardCopy(a), ...('objectId' in a ? { objectId: objects.get(a.objectId) ?? a.objectId } : {}), ...('locationId' in a ? { locationId: locations.get(a.locationId) ?? a.locationId } : {}), ...('recipeId' in a ? { recipeId: recipeIds.get(a.recipeId) ?? a.recipeId } : {}), ...('scriptId' in a ? { scriptId: scripts.get(a.scriptId) ?? a.scriptId } : {}) } as Action);
  const copied = originals.map(o => ({ ...structuredClone(o), id: objects.get(o.id)!, name: `${o.name.slice(0, 150)} (копия)`, locationId, transform: { ...structuredClone(o.transform), position: [o.transform.position[0] + offset.x, o.transform.position[1], o.transform.position[2] + offset.z] }, visibleWhen: mapCondition(o.visibleWhen, objects, checks), ...(o.light ? { light: { ...structuredClone(o.light), condition: mapCondition(o.light.condition, objects, checks) } } : {}), ...(o.spatialAudio ? { spatialAudio: { ...structuredClone(o.spatialAudio), condition: mapCondition(o.spatialAudio.condition, objects, checks) } } : {}), interaction: { ...o.interaction, condition: mapCondition(o.interaction.condition, objects, checks), scriptId: o.interaction.scriptId ? scripts.get(o.interaction.scriptId)! : null }, transition: o.transition ? { ...structuredClone(o.transition), locationId: locations.get(o.transition.locationId) ?? o.transition.locationId } : null }));
  const copiedScripts = source.scripts.filter(s => scripts.has(s.id)).map(s => {
    const nodes = new Map(s.nodes.map(n => [n.id, id('node')]));
    return { ...structuredClone(s), id: scripts.get(s.id)!, entryNodeId: nodes.get(s.entryNodeId)!, nodes: s.nodes.map(n => ({ ...structuredClone(n), id: nodes.get(n.id)!, ...(n.entryCondition != null ? { entryCondition: mapCondition(n.entryCondition, objects, checks) } : {}), choices: n.choices.map(c => ({ ...structuredClone(c), id: id('choice'), nextNodeId: c.nextNodeId ? nodes.get(c.nextNodeId)! : null, failureNodeId: c.failureNodeId ? nodes.get(c.failureNodeId)! : null, checkId: c.checkId ? checks.get(c.checkId)! : null, failureActions: c.failureActions.map(mapAction), condition: mapCondition(c.condition, objects, checks), actions: c.actions.map(mapAction) })) })) };
  });
  const copiedRules = rules.map(r => ({ ...structuredClone(r), id: ruleIds.get(r.id)!, targetObjectId: r.targetObjectId ? objects.get(r.targetObjectId) ?? r.targetObjectId : null, checkId: r.checkId ? checks.get(r.checkId)! : null, condition: mapCondition(r.condition, objects, checks), actions: r.actions.map(mapAction) }));
  const copiedTimers = timers.map(t => ({ ...structuredClone(t), id: timerIds.get(t.id)!, ruleId: t.ruleId ? ruleIds.get(t.ruleId)! : null, initiallyActive: false }));
  const copiedChecks = source.checks.filter(c => checks.has(c.id)).map(c => ({ ...structuredClone(c), id: checks.get(c.id)!, name: c.name.slice(0, 150) + ' (копия)', retryWhen: mapCondition(c.retryWhen, objects, checks) }));
  const copiedRecipes = recipes.map(r => ({ ...structuredClone(r), id: recipeIds.get(r.id)!, containerObjectId: objects.get(r.containerObjectId!)!, condition: mapCondition(r.condition, objects, checks) }));
  const schedules = source.schedules.filter(s => objects.has(s.objectId)).map(s => ({ ...structuredClone(s), id: id('schedule'), objectId: objects.get(s.objectId)!, condition: mapCondition(s.condition, objects, checks) }));
  return { project: parseProject({ ...target, objects: [...target.objects, ...copied], scripts: [...target.scripts, ...copiedScripts], rules: [...target.rules, ...copiedRules], timers: [...target.timers, ...copiedTimers], schedules: [...target.schedules, ...schedules], recipes: [...target.recipes, ...copiedRecipes], checks: [...target.checks, ...copiedChecks] }), ids: copied.map(o => o.id) };
}

export function copyObjects(project: Project, ids: string[]): ObjectClipboard {
  if (!ids.length || ids.some(id => !project.objects.some(o => o.id === id))) throw new Error('Выберите объект для копирования');
  return { project: structuredClone(project), ids: [...new Set(ids)] };
}

export function pasteObjects(project: Project, clipboard: ObjectClipboard, locationId: string) {
  const location = requireLocation(project, locationId);
  if (project.id !== clipboard.project.id) throw new Error('Буфер относится к другому проекту');
  const first = clipboard.project.objects.find(o => o.id === clipboard.ids[0])!;
  const offset = first.locationId === locationId ? { x: .5, z: .5 } : { x: location.spawn.position[0] - first.transform.position[0], z: location.spawn.position[2] - first.transform.position[2] };
  return copyGraph(project, clipboard.project, clipboard.ids, locationId, offset);
}

export function duplicateLocation(project: Project, locationId: string) {
  const original = requireLocation(project, locationId), location = { ...structuredClone(original), id: id('location'), name: `${original.name.slice(0, 150)} (копия)`, rooms: original.rooms.map(r => ({ ...structuredClone(r), id: id('room') })) };
  const copied = copyGraph({ ...project, locations: [...project.locations, location] }, project, project.objects.filter(o => o.locationId === locationId).map(o => o.id), location.id, { x: 0, z: 0 }, new Map([[locationId, location.id]]));
  return { project: copied.project, id: location.id };
}

export function deleteObject(project: Project, objectId: string) {
  if (!project.objects.some(o => o.id === objectId)) throw new Error('Объект не найден');
  return checkedDeletion({ ...project, objects: project.objects.filter(o => o.id !== objectId), rules: project.rules.filter(r => r.targetObjectId !== objectId), schedules: project.schedules.filter(s => s.objectId !== objectId) }, "объект «" + project.objects.find(o => o.id === objectId)!.name + "»", project);
}

export function deleteLocation(project: Project, locationId: string) {
  requireLocation(project, locationId);
  if (project.locations.length <= 1) throw new Error('В проекте должна остаться хотя бы одна локация');
  const objects = new Set(project.objects.filter(o => o.locationId === locationId).map(o => o.id));
  const locations = project.locations.filter(l => l.id !== locationId);
  return checkedDeletion({ ...project, locations, objects: project.objects.filter(o => !objects.has(o.id)).map(o => o.transition?.locationId === locationId ? { ...o, transition: null } : o), settings: { ...project.settings, startLocationId: project.settings.startLocationId === locationId ? locations[0].id : project.settings.startLocationId }, rules: project.rules.filter(r => !r.targetObjectId || !objects.has(r.targetObjectId)), schedules: project.schedules.filter(s => !objects.has(s.objectId)) }, "локацию «" + requireLocation(project, locationId).name + "»", project);
}

export function deleteRoom(project: Project, locationId: string, roomId: string) {
  const location = requireLocation(project, locationId);
  if (!location.rooms.some(r => r.id === roomId)) throw new Error('Комната не найдена');
  if (location.rooms.length <= 1) throw new Error('В локации должна остаться хотя бы одна комната');
  const rooms = location.rooms.filter(r => r.id !== roomId), nextLocation = { ...location, rooms };
  const spawn = location.spawn.position;
  if (!canStandAt({ x: spawn[0], z: spawn[2] }, collisionWorld(nextLocation, project.objects.filter(o => o.locationId === locationId)))) {
    const room = rooms[0]; nextLocation.spawn = { ...location.spawn, position: [room.origin[0] + room.width / 2, room.origin[1] + 1.65, room.origin[2] + room.depth / 2] };
  }
  return parseProject({ ...project, locations: project.locations.map(l => l.id === locationId ? nextLocation : l) });
}

export function createReturnDoor(project: Project, objectId: string) {
  const door = project.objects.find(o => o.id === objectId);
  if (!door?.transition) throw new Error('Сначала назначьте локацию перехода');
  const source = requireLocation(project, door.locationId), destination = requireLocation(project, door.transition.locationId);
  const destinationObjects = project.objects.filter(o => o.locationId === destination.id);
  assertArrival(destination, destinationObjects, door.transition.position);
  assertArrival(source, project.objects.filter(o => o.locationId === source.id), source.spawn.position);
  const [x, , z] = door.transition.position;
  const world = collisionWorld(destination, destinationObjects);
  const points = [{ x: x - Math.sin(door.transition.yaw), z: z - Math.cos(door.transition.yaw) }, { x: x + 1, z }, { x: x - 1, z }, { x, z: z + 1 }];
  const point = points.find(p => canStandAt(p, world));
  if (!point) throw new Error('Рядом с точкой появления нет места для обратной двери. Измените точку появления.');
  const floor = destination.rooms.find(r => point.x >= r.origin[0] && point.x <= r.origin[0] + r.width && point.z >= r.origin[2] && point.z <= r.origin[2] + r.depth)!.origin[1];
  const result = addObject(project, destination.id, 'exit', point);
  const next = { ...result.project, objects: result.project.objects.map(o => o.id === result.id ? { ...o, name: `Дверь в ${source.name}`.slice(0, 160), transform: { ...o.transform, position: [point.x, floor, point.z] }, transition: { locationId: source.id, position: [...source.spawn.position], yaw: source.spawn.yaw } } : o) };
  return { project: parseProject(next), id: result.id, locationId: destination.id };
}

export function spatialIssues(project: Project, location: Location): string[] {
  const objects = project.objects.filter(o => o.locationId === location.id), issues: string[] = [];
  try { assertArrival(location, objects, location.spawn.position); } catch (e) { issues.push(`Начало: ${e instanceof Error ? e.message : 'неверная позиция'}`); }
  for (const o of objects) {
    if (!location.rooms.some(r => o.transform.position[0] >= r.origin[0] && o.transform.position[0] <= r.origin[0] + r.width && o.transform.position[2] >= r.origin[2] && o.transform.position[2] <= r.origin[2] + r.depth)) issues.push(`«${o.name}» находится вне комнат.`);
    if (o.transition) {
      const target = project.locations.find(l => l.id === o.transition!.locationId);
      if (!target) issues.push(`«${o.name}»: локация назначения отсутствует.`);
      else try { assertArrival(target, project.objects.filter(o => o.locationId === target.id), o.transition.position); } catch (e) { issues.push(`«${o.name}»: ${e instanceof Error ? e.message : 'неверный переход'}`); }
    }
  }
  return issues;
}
