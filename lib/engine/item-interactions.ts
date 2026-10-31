import type { GameState } from './game-state';
import type { Project, Recipe } from './project';
import { conditionResult, evaluateCondition, objectIsPresent } from './conditions';

export type ItemUseContext = { itemInstanceId: string; objectId: string };
export function containerContents(state: GameState, objectId: string) {
  return Object.values(state.items).filter(i => i.owner.type === 'container' && i.owner.objectId === objectId);
}
export function accessibleContainer(project: Project, state: GameState, objectId: string) {
  const object = project.objects.find(o => o.id === objectId);
  if (!object?.container) throw new Error('Контейнер не найден');
  if (object.locationId !== state.locationId || !objectIsPresent(project, state, objectId) || !evaluateCondition(object.visibleWhen, state, project)) throw new Error('Контейнер недоступен');
  const available = conditionResult(object.interaction.condition, project, state);
  if (!available.allowed) throw new Error(object.interaction.unavailableReason.trim() || available.reason);
  const [x, y, z] = state.player.position, [ox, oy, oz] = object.transform.position, [w, h] = object.transform.scale;
  const distance = Math.hypot(Math.max(0, Math.abs(x - ox) - w / 2), Math.max(0, oy - y, y - oy - h), Math.max(0, Math.abs(z - oz) - w / 2));
  if (distance > object.interaction.reach) throw new Error('Подойди ближе к контейнеру');
  return object;
}
function unlocked(state: GameState, objectId: string) {
  if (state.cooking[objectId]) throw new Error('Приготовление уже идёт. Содержимое занято этим процессом.');
}
export function usedInventoryItem(state: GameState, context?: ItemUseContext) {
  if (!context) throw new Error('Действию нужна используемая вещь');
  const item = state.items[context.itemInstanceId];
  if (!item || item.owner.type !== 'inventory' || state.player.inventory[item.owner.slot] !== item.id) throw new Error('Используемая вещь уже израсходована или перемещена');
  return item;
}
export function consumeUsedItem(state: GameState, context?: ItemUseContext) {
  const item = usedInventoryItem(state, context);
  state.player.inventory[(item.owner as { slot: number }).slot] = null;
  delete state.items[item.id];
}
export function replaceUsedItem(project: Project, state: GameState, definitionId: string, context?: ItemUseContext) {
  if (!project.items.some(d => d.id === definitionId)) throw new Error('Определение новой вещи не найдено');
  usedInventoryItem(state, context).definitionId = definitionId;
}
function accepts(project: Project, object: ReturnType<typeof accessibleContainer>, definitionId: string) {
  const definition = project.items.find(d => d.id === definitionId);
  if (!definition || (object.container!.acceptedTags.length && !definition.tags.some(t => object.container!.acceptedTags.includes(t)))) throw new Error('Эта вещь не подходит для контейнера');
}
export function putItemInContainer(project: Project, state: GameState, objectId: string, itemId: string) {
  const object = accessibleContainer(project, state, objectId); unlocked(state, objectId);
  const item = usedInventoryItem(state, { objectId, itemInstanceId: itemId });
  accepts(project, object, item.definitionId);
  if (containerContents(state, objectId).length >= object.container!.capacity) throw new Error('Контейнер заполнен');
  state.player.inventory[(item.owner as { slot: number }).slot] = null;
  item.owner = { type: 'container', objectId };
  if (state.objects[objectId].state.cookingState === 'ready') state.objects[objectId].state.cookingState = 'idle';
}
export function takeContainerItem(project: Project, state: GameState, objectId: string, itemId: string) {
  accessibleContainer(project, state, objectId); unlocked(state, objectId);
  const item = state.items[itemId];
  if (!item || item.owner.type !== 'container' || item.owner.objectId !== objectId) throw new Error('Вещь уже отсутствует в контейнере');
  const slot = state.player.inventory.indexOf(null);
  if (slot < 0) throw new Error('В инвентаре нет свободной ячейки');
  item.owner = { type: 'inventory', slot }; state.player.inventory[slot] = item.id;
  if (state.objects[objectId].state.cookingState === 'ready') state.objects[objectId].state.cookingState = 'idle';
}

// Bipartite matching: a multi-tag item cannot satisfy two ingredient positions.
export function matchIngredients(project: Project, state: GameState, objectId: string, recipe: Recipe): string[] {
  const items = containerContents(state, objectId), assigned = new Map<number, number>();
  if (!recipe.allowExtraIngredients && items.length !== recipe.ingredientTags.length) throw new Error('В контейнере должно быть ровно столько вещей, сколько ингредиентов в рецепте');
  const visit = (tagIndex: number, visited: Set<number>): boolean => {
    for (let i = 0; i < items.length; i++) {
      if (visited.has(i) || !project.items.find(d => d.id === items[i].definitionId)!.tags.includes(recipe.ingredientTags[tagIndex])) continue;
      visited.add(i);
      const previous = assigned.get(i);
      if (previous === undefined || visit(previous, visited)) { assigned.set(i, tagIndex); return true; }
    }
    return false;
  };
  for (let tag = 0; tag < recipe.ingredientTags.length; tag++) if (!visit(tag, new Set())) throw new Error('Не хватает отдельного ингредиента с признаком «' + recipe.ingredientTags[tag] + '»');
  const result = Array<string>(recipe.ingredientTags.length);
  for (const [item, tag] of assigned) result[tag] = items[item].id;
  return result;
}
export function recipePreparation(project: Project, state: GameState, objectId: string, recipeId: string) {
  const object = accessibleContainer(project, state, objectId); unlocked(state, objectId);
  const recipe = project.recipes.find(r => r.id === recipeId);
  if (!recipe || (recipe.containerObjectId && recipe.containerObjectId !== objectId)) throw new Error('Рецепт не подходит для этого контейнера');
  if (!recipe.ingredientTags.length) throw new Error('В рецепте ещё не заданы ингредиенты');
  const condition = conditionResult(recipe.condition, project, state);
  if (!condition.allowed) throw new Error(recipe.unavailableReason.trim() || condition.reason);
  const ingredientIds = matchIngredients(project, state, objectId, recipe);
  accepts(project, object, recipe.resultItemId);
  return { recipe, ingredientIds };
}
export function startRecipe(project: Project, state: GameState, objectId: string, recipeId: string) {
  const { recipe, ingredientIds } = recipePreparation(project, state, objectId, recipeId);
  if (recipe.durationSeconds > 0) {
    const timerId = 'cook-' + crypto.randomUUID();
    state.timers.push({ id: timerId, remainingSeconds: recipe.durationSeconds, ruleId: null });
    state.cooking[objectId] = { recipeId, ingredientIds, timerId };
    state.objects[objectId].state.cookingState = 'cooking';
  } else {
    for (const id of ingredientIds) delete state.items[id];
    const id = 'instance-' + crypto.randomUUID();
    state.items[id] = { id, definitionId: recipe.resultItemId, owner: { type: 'container', objectId } };
    state.objects[objectId].state.cookingState = 'ready';
  }
}

export function finishRecipe(project: Project, state: GameState, objectId: string) {
  const cooking = state.cooking[objectId], object = project.objects.find(o => o.id === objectId), recipe = project.recipes.find(r => r.id === cooking?.recipeId);
  if (!cooking || !object?.container || !recipe) throw new Error('Процесс приготовления повреждён');
  accepts(project, object, recipe.resultItemId);
  for (const id of cooking.ingredientIds) {
    const item = state.items[id];
    if (!item || item.owner.type !== 'container' || item.owner.objectId !== objectId) throw new Error('Ингредиенты приготовления перемещены');
  }
  for (const id of cooking.ingredientIds) delete state.items[id];
  const id = 'instance-' + crypto.randomUUID();
  state.items[id] = { id, definitionId: recipe.resultItemId, owner: { type: 'container', objectId } };
  delete state.cooking[objectId]; state.objects[objectId].state.cookingState = 'ready';
}
