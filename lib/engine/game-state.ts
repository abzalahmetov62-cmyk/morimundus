import { z } from 'zod';
import { idSchema, type Project } from './project';

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const angle = z.number().finite();
const equipmentSlot = z.enum(['head', 'torso', 'legs', 'feet', 'accessory']);
const instanceId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const checkResultSchema = z.object({ mode: z.enum(['threshold', 'dice']), dieSides: z.number().int().min(2).max(100), skillWeight: z.number().finite(), statWeight: z.number().finite(), skillValue: z.number().finite(), statValue: z.number().finite(), roll: z.number().int().positive().nullable(), score: z.number().finite(), difficulty: z.number().finite(), succeeded: z.boolean() }).strict().superRefine((r, ctx) => {
  const score = r.skillValue * r.skillWeight + r.statValue * r.statWeight + (r.roll ?? 0);
  if ((r.mode === 'threshold' ? r.roll !== null : !r.roll || r.roll > r.dieSides) || Math.abs(score - r.score) > 1e-8 || r.succeeded !== (r.score >= r.difficulty)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Результат проверки повреждён' });
});
const transcriptEntry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), scriptId: idSchema, nodeId: idSchema, index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('choice'), scriptId: idSchema, nodeId: idSchema, choiceId: idSchema, label: z.string().max(160) }).strict(),
  z.object({ type: z.literal('check'), scriptId: idSchema, nodeId: idSchema, checkId: idSchema, result: checkResultSchema }).strict(),
]);
export const itemOwnerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('world'), locationId: idSchema, position: vector, dropped: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('inventory'), slot: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('equipment'), slot: equipmentSlot }).strict(),
  z.object({ type: z.literal('container'), objectId: idSchema }).strict(),
]);

export const gameStateSchema = z.object({
  formatVersion: z.literal(1), id: idSchema, projectId: idSchema, projectRevision: z.number().int().positive(), locationId: idSchema,
  player: z.object({ position: vector, yaw: angle, pitch: angle.min(-Math.PI / 2).max(Math.PI / 2), stats: z.record(idSchema, z.number().finite()), skills: z.record(idSchema, z.number().finite()), statuses: z.array(idSchema), inventory: z.array(instanceId.nullable()).min(3).max(153), activeSlot: z.number().int().nonnegative(), equipment: z.record(equipmentSlot, instanceId.nullable()) }).strict(),
  flags: z.record(idSchema, scalar),
  objects: z.record(idSchema, z.object({ present: z.boolean(), state: z.record(idSchema, scalar) }).strict()),
  items: z.record(instanceId, z.object({ id: instanceId, definitionId: idSchema, owner: itemOwnerSchema }).strict()),
  quests: z.record(idSchema, z.object({ stageId: idSchema.nullable(), completed: z.boolean(), rewarded: z.boolean().default(false) }).strict()),
  claimedRewards: z.array(idSchema).max(10000).default([]),
  randomState: z.number().int().min(1).max(0xffffffff).default(1),
  clock: z.object({ worldSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER), playedSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER), pausedBy: z.array(z.enum(['interaction', 'menu', 'hidden', 'debug'])).max(4) }).strict(),
  timers: z.array(z.object({ id: idSchema, remainingSeconds: z.number().finite().nonnegative().max(365 * 86400), ruleId: idSchema.nullable() }).strict()).max(4000),
  cooking: z.record(idSchema, z.object({ recipeId: idSchema, ingredientIds: z.array(instanceId).min(1).max(64), timerId: idSchema }).strict()).default({}),
  interaction: z.object({ scriptId: idSchema, nodeId: idSchema, objectId: idSchema.nullable().default(null), paragraph: z.number().int().nonnegative(), history: z.array(z.string()).max(2000), transcript: z.array(transcriptEntry).max(2000).default([]) }).strict().nullable(),
  choiceUsage: z.record(z.string().max(500), z.object({ total: z.number().int().nonnegative(), day: z.number().int().nonnegative(), dayUses: z.number().int().nonnegative(), times: z.array(z.number().finite().nonnegative()).max(1000) }).strict()).optional(),
  checks: z.record(idSchema, z.object({ attempts: z.number().int().nonnegative(), succeeded: z.boolean(), resumeNodeId: idSchema.nullable(), resumeScriptId: idSchema.nullable().default(null), resumeChoiceId: idSchema.nullable().default(null), resumeLocationId: idSchema.nullable().default(null), objectId: idSchema.nullable().default(null), lastResult: checkResultSchema.nullable().default(null), attemptSkills: z.array(z.object({ attempt: z.number().int().min(1), skills: z.record(idSchema, z.number().finite()) }).strict()).max(1000).optional(), lastSkills: z.record(idSchema, z.number().finite()).optional() }).strict()),
  audio: z.object({ locationTrackId: idSchema.nullable(), offset: z.number().finite().nonnegative(), ambienceTrackId: idSchema.nullable().default(null), ambienceOffset: z.number().finite().nonnegative().default(0), interactionTrackId: idSchema.nullable(), interactionSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), interactionOffset: z.number().finite().nonnegative().default(0), interactionLoop: z.boolean().default(false), interactionVolume: z.number().min(0).max(1).default(1), eventSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), events: z.array(z.object({ id: z.number().int().positive(), assetId: idSchema, volume: z.number().min(0).max(1) }).strict()).max(64).default([]) }).strict(),
  appliedRules: z.array(idSchema),
}).strict().superRefine((state, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (state.player.activeSlot >= state.player.inventory.length) issue('Выбранная ячейка отсутствует');
  const slots = new Set<string>();
  function occupy(id: string | null, type: 'inventory' | 'equipment', slot: number | string) {
    if (!id) return;
    if (slots.has(id)) issue('Один предмет находится в нескольких ячейках');
    slots.add(id);
    const owner = state.items[id]?.owner;
    if (!owner || owner.type !== type || !('slot' in owner) || owner.slot !== slot) issue('Ячейка не совпадает с владельцем предмета');
  }
  state.player.inventory.forEach((id, slot) => occupy(id, 'inventory', slot));
  Object.entries(state.player.equipment).forEach(([slot, id]) => occupy(id, 'equipment', slot));
  for (const [id, item] of Object.entries(state.items)) {
    if (id !== item.id) issue('Идентификатор экземпляра предмета не совпадает');
    if (item.owner.type === 'inventory' && state.player.inventory[item.owner.slot] !== id) issue('Предмет не найден в своей ячейке');
    if (item.owner.type === 'equipment' && state.player.equipment[item.owner.slot] !== id) issue('Экипированный предмет не найден в своей ячейке');
  }
  if (new Set(state.clock.pausedBy).size !== state.clock.pausedBy.length) issue('Повторяются причины паузы');
  if (new Set(state.timers.map(t => t.id)).size !== state.timers.length) issue('Повторяются таймеры');
  if (state.audio.events.some((e, i) => e.id > state.audio.eventSequence || (i > 0 && e.id <= state.audio.events[i - 1].id))) issue('Порядок звуковых событий повреждён');
  if (new Set(state.appliedRules).size !== state.appliedRules.length) issue('Повторяются выполненные правила');
  if (new Set(state.claimedRewards).size !== state.claimedRewards.length) issue('Повторяются одноразовые награды');
});

export type GameState = z.infer<typeof gameStateSchema>;
export type PauseReason = GameState['clock']['pausedBy'][number];
export type TranscriptEntry = z.infer<typeof transcriptEntry>;

const choiceKeysByProject = new WeakMap<Project, Set<string>>();
function projectChoiceKeys(project: Project) {
  let keys = Object.isFrozen(project) ? choiceKeysByProject.get(project) : undefined;
  if (!keys) {
    keys = new Set(project.scripts.flatMap(s => s.nodes.flatMap(n => n.choices.map(c => JSON.stringify([s.id, n.id, c.id])))));
    if (Object.isFrozen(project)) choiceKeysByProject.set(project, keys);
  }
  return keys;
}

export function parseGameState(input: unknown, project: Project): GameState {
  const state = gameStateSchema.parse(input);
  if (state.projectId !== project.id || !project.locations.some(l => l.id === state.locationId)) throw new Error('Сохранение относится к другому проекту или локации');
  for (const [id, item] of Object.entries(state.items)) {
    if (!project.items.some(d => d.id === item.definitionId)) throw new Error(`Неизвестное определение предмета: ${id}`);
    if (item.owner.type === 'world') {
      const locationId = item.owner.locationId;
      if (!project.locations.some(l => l.id === locationId)) throw new Error('Неизвестная локация предмета');
    }
    if (item.owner.type === 'container') {
      const objectId = item.owner.objectId;
      if (!project.objects.some(o => o.id === objectId && o.container)) throw new Error('Контейнер предмета не найден');
    }
  }
  if (project.settings.equipmentSlots.some(slot => !Object.hasOwn(state.player.equipment, slot))) throw new Error('Состояние экипировки неполное');
  let capacity = project.settings.baseInventorySlots as number;
  for (const [slot, id] of Object.entries(state.player.equipment)) {
    if (!project.settings.equipmentSlots.includes(slot as typeof project.settings.equipmentSlots[number])) throw new Error('Неизвестный слот экипировки');
    if (!id) continue;
    const definition = project.items.find(d => d.id === state.items[id]?.definitionId);
    if (definition?.equipmentSlot !== slot) throw new Error('Предмет не подходит для слота экипировки');
    capacity += definition.capacityBonus;
  }
  if (state.player.inventory.length !== capacity) throw new Error('Вместимость инвентаря не совпадает с экипировкой');
  for (const id of Object.keys(state.objects)) if (!project.objects.some(o => o.id === id)) throw new Error('Неизвестный объект в сохранении');
  if (project.objects.some(o => !Object.hasOwn(state.objects, o.id))) throw new Error('Состояние объектов неполное');
  for (const id of state.player.statuses) if (!project.character.statuses.some(s => s.id === id)) throw new Error('Неизвестный статус');
  if (new Set(state.player.statuses).size !== state.player.statuses.length) throw new Error('Повторяются активные статусы');
  for (const kind of ['stats', 'skills'] as const) {
    if (Object.keys(state.player[kind]).some(id => !project.character[kind].some(t => t.id === id)) || project.character[kind].some(t => state.player[kind][t.id] === undefined || state.player[kind][t.id] < t.min || state.player[kind][t.id] > t.max)) throw new Error('Значения героя неполные или выходят за границы');
  }
  for (const id of Object.keys(state.quests)) {
    const quest = project.quests.find(q => q.id === id);
    if (!quest || (state.quests[id].stageId && !quest.stages.some(s => s.id === state.quests[id].stageId))) throw new Error('Неизвестный этап задания');
    if (state.quests[id].rewarded && !state.quests[id].completed) throw new Error('Награда задания выдана до завершения');
  }
  if (project.quests.some(q => !state.quests[q.id])) throw new Error('Состояние заданий неполное');
  if (state.interaction) {
    const interaction = state.interaction;
    const node = project.scripts.find(s => s.id === interaction.scriptId)?.nodes.find(n => n.id === interaction.nodeId);
    if (!node || interaction.paragraph > node.paragraphs.length) throw new Error('Точка продолжения текста не найдена');
    if (interaction.objectId && !project.objects.some(o => o.id === interaction.objectId)) throw new Error('Источник разговора не найден');
    for (const entry of interaction.transcript) {
      const source = project.scripts.find(s => s.id === entry.scriptId)?.nodes.find(n => n.id === entry.nodeId);
      if (!source || (entry.type === 'paragraph' ? entry.index >= source.paragraphs.length : entry.type === 'choice' ? !source.choices.some(c => c.id === entry.choiceId) : !project.checks.some(c => c.id === entry.checkId) || !source.choices.some(c => c.checkId === entry.checkId))) throw new Error('История разговора повреждена');
    }
  }
  const choiceKeys = state.choiceUsage ? projectChoiceKeys(project) : null;
  for (const [key, usage] of Object.entries(state.choiceUsage ?? {})) {
    if (!choiceKeys?.has(key)) throw new Error('Ответ в истории выбора не найден');
    if (usage.day > Math.floor(state.clock.worldSeconds / 86400) || usage.dayUses > usage.total || usage.times.length > usage.total || usage.times.some((t, i) => t > state.clock.worldSeconds || (i > 0 && t < usage.times[i - 1]))) throw new Error('История выбора ответа повреждена');
  }
  if (Object.keys(state.checks).some(id => !project.checks.some(c => c.id === id))) throw new Error('Неизвестная проверка');
  for (const [id, saved] of Object.entries(state.checks)) {
    const check = project.checks.find(c => c.id === id)!;
    if (saved.lastSkills && (Object.keys(saved.lastSkills).some(id => !project.character.skills.some(s => s.id === id)) || (saved.lastResult && saved.lastSkills[check.skillId] !== saved.lastResult.skillValue))) throw new Error('Последнее значение навыка не совпадает с результатом');
    if (saved.attemptSkills?.some((a, i) => a.attempt > saved.attempts || (i > 0 && a.attempt <= saved.attemptSkills![i - 1].attempt) || Object.keys(a.skills).some(id => !project.character.skills.some(s => s.id === id)))) throw new Error('История попыток повреждена');
    if (check.maxAttempts !== null && saved.attempts > check.maxAttempts) throw new Error('Число попыток проверки превышено');
    if (saved.lastResult && (!saved.attempts || saved.lastResult.succeeded !== saved.succeeded || saved.lastResult.difficulty !== check.difficulty)) throw new Error('Результат не совпадает с проверкой');
    if (saved.resumeScriptId) {
      const choice = project.scripts.find(s => s.id === saved.resumeScriptId)?.nodes.find(n => n.id === saved.resumeNodeId)?.choices.find(c => c.id === saved.resumeChoiceId);
      if (!choice || choice.checkId !== id || !project.locations.some(l => l.id === saved.resumeLocationId)) throw new Error('Точка повторной проверки повреждена');
    } else if (saved.resumeChoiceId || saved.resumeLocationId) throw new Error('Точка повторной проверки неполная');
    if (saved.objectId && !project.objects.some(o => o.id === saved.objectId)) throw new Error('Источник проверки не найден');
  }
  const rewardIds = new Set([...project.rules.flatMap(r => r.actions), ...project.scripts.flatMap(s => s.nodes.flatMap(n => n.choices.flatMap(c => [...c.actions, ...c.failureActions]))), ...project.quests.flatMap(q => q.rewards)].flatMap(a => a.type === 'giveItemOnce' ? [a.rewardId] : []));
  if (state.claimedRewards.some(id => !rewardIds.has(id))) throw new Error('Одноразовая награда не найдена');
  if (state.appliedRules.some(id => !project.rules.some(r => r.id === id))) throw new Error('Неизвестное правило');
  for (const assetId of [state.audio.locationTrackId, state.audio.ambienceTrackId, state.audio.interactionTrackId, ...state.audio.events.map(e => e.assetId)]) if (assetId && !project.assets.some(a => a.id === assetId && a.kind === 'audio')) throw new Error('Звуковой ресурс не найден');
  for (const timer of state.timers) {
    if (timer.ruleId && !project.rules.some(r => r.id === timer.ruleId && r.trigger === 'timer')) throw new Error('Правило таймера не найдено');
    const definition = project.timers.find(t => t.id === timer.id);
    if (definition && (timer.ruleId !== definition.ruleId || timer.remainingSeconds > definition.durationSeconds)) throw new Error('Настройки таймера повреждены');
  }
  for (const object of project.objects.filter(o => o.container)) {
    const contents = Object.values(state.items).filter(i => i.owner.type === 'container' && i.owner.objectId === object.id);
    if (contents.length > object.container!.capacity) throw new Error('Контейнер переполнен');
    if (contents.some(i => object.container!.acceptedTags.length && !project.items.find(d => d.id === i.definitionId)!.tags.some(tag => object.container!.acceptedTags.includes(tag)))) throw new Error('Предмет не подходит для контейнера');
  }
  const cookingTimers = new Set<string>();
  for (const [objectId, cooking] of Object.entries(state.cooking)) {
    const object = project.objects.find(o => o.id === objectId), recipe = project.recipes.find(r => r.id === cooking.recipeId);
    if (!object?.container || !recipe || (recipe.containerObjectId && recipe.containerObjectId !== objectId)) throw new Error('Процесс приготовления ссылается на неверный контейнер или рецепт');
    if (new Set(cooking.ingredientIds).size !== cooking.ingredientIds.length || cooking.ingredientIds.length !== recipe.ingredientTags.length) throw new Error('Неверные ингредиенты приготовления');
    for (const [index, id] of cooking.ingredientIds.entries()) { const item = state.items[id]; if (!item || item.owner.type !== 'container' || item.owner.objectId !== objectId) throw new Error('Ингредиенты приготовления уже перемещены'); if (!project.items.find(d => d.id === item.definitionId)!.tags.includes(recipe.ingredientTags[index])) throw new Error('Ингредиент приготовления не соответствует рецепту'); }
    const timer = state.timers.find(t => t.id === cooking.timerId);
    if (!timer || timer.ruleId || cookingTimers.has(timer.id) || timer.remainingSeconds > recipe.durationSeconds || recipe.durationSeconds === 0) throw new Error('Таймер приготовления повреждён');
    cookingTimers.add(timer.id);
    if (state.objects[objectId].state.cookingState !== 'cooking') throw new Error('Состояние приготовления не совпадает с процессом');
  }
  if (state.timers.some(t => !cookingTimers.has(t.id) && !project.timers.some(d => d.id === t.id))) throw new Error('Неизвестный таймер');
  return state;
}
