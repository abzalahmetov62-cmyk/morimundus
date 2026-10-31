import type { Project, WorldObject, ItemDefinition } from './project';
import type { GameState } from './game-state';
import { collisionWorld, movePlayer, presentObjects } from './spatial';

export const equipmentNames = { head: 'Голова', torso: 'Тело', legs: 'Ноги', feet: 'Обувь', accessory: 'Аксессуар' };
export type EquipmentSlot = keyof typeof equipmentNames;
export const droppedObjectId = (instanceId: string) => 'drop:' + instanceId;
export function itemDefinition(project: Project, state: GameState, id: string): ItemDefinition {
  const item = state.items[id], definition = project.items.find(d => d.id === item?.definitionId);
  if (!item || !definition) throw new Error('Предмет не найден');
  return definition;
}
export function itemPresentation(project: Project, state: GameState, id: string | null): ItemDefinition | null {
  const item = id ? state.items[id] : null;
  if (!item) return null;
  const definition = project.items.find(d => d.id === item.definitionId);
  if (!definition) return null;
  if (definition.imageAssetId && definition.description) return definition;
  const source = project.objects.find(o => 'instance-' + o.id === item.id && o.interaction.itemDefinitionId === item.definitionId);
  return { ...definition, imageAssetId: definition.imageAssetId ?? source?.imageAssetId ?? null, description: definition.description || source?.notes || '' };
}
export function inventoryCapacity(project: Project, state: GameState) {
  return project.settings.baseInventorySlots + Object.values(state.player.equipment).reduce((sum, id) => sum + (id ? itemDefinition(project, state, id).capacityBonus : 0), 0);
}
function restoreSelection(state: GameState, active: string | null, previousSlot: number) {
  const slot = active ? state.player.inventory.indexOf(active) : -1;
  state.player.activeSlot = slot >= 0 ? slot : Math.min(previousSlot, state.player.inventory.length - 1);
}
function resizeInventory(project: Project, state: GameState, active: string | null, previousSlot: number) {
  const capacity = inventoryCapacity(project, state), inventory = state.player.inventory;
  if (inventory.filter(Boolean).length > capacity) throw new Error('Нельзя снять или заменить одежду: для вещей не хватает оставшихся ячеек. Освободи место в инвентаре.');
  const overflow = inventory.slice(capacity).filter((id): id is string => id !== null);
  state.player.inventory = inventory.slice(0, capacity);
  while (state.player.inventory.length < capacity) state.player.inventory.push(null);
  for (const id of overflow) state.player.inventory[state.player.inventory.indexOf(null)] = id;
  state.player.inventory.forEach((id, slot) => { if (id) state.items[id].owner = { type: 'inventory', slot }; });
  restoreSelection(state, active, previousSlot);
}
export function equipItem(project: Project, state: GameState, id: string, slot: EquipmentSlot) {
  const item = state.items[id], definition = itemDefinition(project, state, id);
  if (item.owner.type !== 'inventory') throw new Error('Можно надеть только предмет из инвентаря');
  if (!Object.hasOwn(state.player.equipment, slot) || !project.settings.equipmentSlots.includes(slot)) throw new Error('Этот слот экипировки недоступен');
  if (definition.equipmentSlot !== slot) throw new Error('Эта вещь не подходит для слота «' + equipmentNames[slot] + '»');
  const active = state.player.inventory[state.player.activeSlot], selectedSlot = state.player.activeSlot, old = state.player.equipment[slot];
  state.player.inventory[item.owner.slot] = null; item.owner = { type: 'equipment', slot }; state.player.equipment[slot] = id;
  resizeInventory(project, state, active, selectedSlot);
  if (old) {
    const free = state.player.inventory.indexOf(null);
    if (free < 0) throw new Error('Нельзя заменить одежду: для снятой вещи нет свободной ячейки');
    state.player.inventory[free] = old; state.items[old].owner = { type: 'inventory', slot: free };
  }
}
export function unequipItem(project: Project, state: GameState, slot: EquipmentSlot) {
  const id = state.player.equipment[slot];
  if (!id) throw new Error('Этот слот пуст');
  const active = state.player.inventory[state.player.activeSlot], selectedSlot = state.player.activeSlot;
  state.player.equipment[slot] = null;
  resizeInventory(project, state, active, selectedSlot);
  const free = state.player.inventory.indexOf(null);
  if (free < 0) throw new Error('Нельзя снять одежду: для неё нет свободной ячейки. Освободи место в инвентаре.');
  state.player.inventory[free] = id; state.items[id].owner = { type: 'inventory', slot: free };
}
export function droppedObjects(project: Project, state: GameState, locationId = state.locationId): WorldObject[] {
  return Object.values(state.items).flatMap(item => {
    if (item.owner.type !== 'world' || !item.owner.dropped || item.owner.locationId !== locationId) return [];
    const definition = itemPresentation(project, state, item.id)!;
    return [{ id: droppedObjectId(item.id), name: definition.name, kind: 'item' as const, locationId, notes: definition.description, tags: [...definition.tags], transform: { position: [...item.owner.position] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [.45, .45, 1] as [number, number, number] }, imageAssetId: definition.imageAssetId, billboard: 'vertical' as const, collision: { solid: false, radius: 0 }, initialState: {}, visibleWhen: null, container: null, transition: null, interaction: { scriptId: null, itemDefinitionId: definition.id, canTake: true, reach: 2, audioAssetId: null, showsTime: false, condition: null, unavailableReason: '', itemUseReason: 'Эта вещь здесь не подходит.' } }];
  });
}
export function dropItem(project: Project, state: GameState, id: string) {
  const item = state.items[id]; itemDefinition(project, state, id);
  if (item.owner.type !== 'inventory') throw new Error('Можно выбросить только предмет из инвентаря');
  const location = project.locations.find(l => l.id === state.locationId)!;
  const position = movePlayer(state.player.position, { x: -Math.sin(state.player.yaw) * .75, z: -Math.cos(state.player.yaw) * .75 }, collisionWorld(location, presentObjects(project.objects, state, state.locationId, project)));
  const room = location.rooms.find(r => position[0] >= r.origin[0] && position[0] <= r.origin[0] + r.width && position[2] >= r.origin[2] && position[2] <= r.origin[2] + r.depth);
  if (!room) throw new Error('Здесь нельзя оставить предмет');
  state.player.inventory[item.owner.slot] = null;
  item.owner = { type: 'world', locationId: location.id, position: [position[0], room.origin[1], position[2]], dropped: true };
}
export function takeDroppedItem(project: Project, state: GameState, objectId: string) {
  const id = objectId.startsWith('drop:') ? objectId.slice(5) : '', item = state.items[id];
  if (!item || item.owner.type !== 'world' || !item.owner.dropped || item.owner.locationId !== state.locationId) throw new Error('Предмет уже перемещён или находится в другой локации');
  const free = state.player.inventory.indexOf(null);
  if (free < 0) throw new Error('В инвентаре нет свободной ячейки');
  item.owner = { type: 'inventory', slot: free }; state.player.inventory[free] = id;
  return itemDefinition(project, state, id).name;
}
