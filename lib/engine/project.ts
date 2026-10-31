import { z } from 'zod';
import { builtinVoiceIds, builtinVoiceSampleIds } from './voices';

export const FORMAT_VERSION = 1;
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const name = z.string().trim().min(1).max(160);
const scalar = z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]);
const values = z.record(idSchema, scalar);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const ref = idSchema.nullable();
const tags = z.array(z.string().trim().min(1).max(60)).max(64);
const named = z.object({ id: idSchema, name });

export type Condition =
  | { type: 'literal'; value: boolean }
  | { type: 'all' | 'any'; conditions: Condition[] }
  | { type: 'not'; condition: Condition }
  | { type: 'compare'; source: 'flag' | 'stat' | 'skill' | 'status' | 'inventory' | 'time' | 'quest' | 'object' | 'check'; key: string; field?: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: string | number | boolean | null };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ type: z.literal('literal'), value: z.boolean() }).strict(),
  z.object({ type: z.enum(['all', 'any']), conditions: z.array(conditionSchema).min(1).max(64) }).strict(),
  z.object({ type: z.literal('not'), condition: conditionSchema }).strict(),
  z.object({ type: z.literal('compare'), source: z.enum(['flag', 'stat', 'skill', 'status', 'inventory', 'time', 'quest', 'object', 'check']), key: idSchema, field: idSchema.optional(), operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']), value: scalar }).strict(),
]));

export const assetSchema = named.extend({
  kind: z.enum(['image', 'audio']), mime: z.string().max(100),
  bytes: z.number().int().min(1).max(24 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const voiceSchema = named.extend({ imageAssetId: ref, samples: z.array(z.union([z.object({ assetId: idSchema }).strict(), z.object({ builtinSampleId: z.enum(builtinVoiceSampleIds) }).strict()])).min(1).max(20), rate: z.number().min(.5).max(2), pitchVariation: z.number().min(0).max(3), volumeVariation: z.number().min(0).max(.5), intervalSeconds: z.number().min(.06).max(.5) }).strict();
const audio = z.object({ musicAssetId: ref, ambienceAssetId: ref, volume: z.number().min(0).max(1) }).strict();
const roomSchema = named.extend({
  ambientLight: z.number().min(0).max(1).optional(),
  notes: z.string().max(20000),
  rooms: z.array(z.object({ id: idSchema, origin: vec3, width: z.number().positive().max(100), depth: z.number().positive().max(100), height: z.number().positive().max(20), floorAssetId: ref, wallAssetId: ref, ceilingAssetId: ref }).strict()).min(1).max(100),
  spawn: z.object({ position: vec3, yaw: z.number().finite(), pitch: z.number().min(-Math.PI / 2).max(Math.PI / 2) }).strict(),
  audio,
}).strict();
const lightSchema = z.object({ enabled: z.boolean(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), intensity: z.number().min(0).max(100), distance: z.number().min(.1).max(200), offset: vec3, portable: z.boolean(), condition: conditionSchema.nullable() }).strict();
const spatialAudioSchema = z.object({ enabled: z.boolean(), assetId: ref, volume: z.number().min(0).max(1), loop: z.boolean(), near: z.number().min(.1).max(199.9), far: z.number().min(.2).max(200), offset: vec3, portable: z.boolean(), condition: conditionSchema.nullable() }).strict().superRefine((sound, ctx) => { if (sound.far <= sound.near) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Дальность звука должна быть больше расстояния полной громкости' }); });
const objectSchema = named.extend({
  light: lightSchema.nullable().optional(), spatialAudio: spatialAudioSchema.nullable().optional(),
  locationId: idSchema, kind: z.enum(['prop', 'item', 'npc', 'container', 'exit']),
  notes: z.string().max(20000), tags,
  transform: z.object({ position: vec3, rotation: vec3, scale: vec3 }).strict(),
  imageAssetId: ref, billboard: z.enum(['vertical', 'camera', 'none']),
  collision: z.object({ solid: z.boolean(), radius: z.number().min(0).max(10) }).strict(),
  initialState: values, visibleWhen: conditionSchema.nullable(),
  interaction: z.object({ scriptId: ref, itemDefinitionId: ref, canTake: z.boolean(), reach: z.number().positive().max(10), audioAssetId: ref, showsTime: z.boolean().default(false), condition: conditionSchema.nullable().default(null), unavailableReason: z.string().max(500).default(''), itemUseReason: z.string().max(500).default('Эта вещь здесь не подходит.') }).strict(),
  container: z.object({ capacity: z.number().int().positive().max(1000), acceptedTags: tags }).strict().nullable(),
  transition: z.object({ locationId: idSchema, position: vec3, yaw: z.number().finite() }).strict().nullable(),
}).strict();
const slot = z.enum(['head', 'torso', 'legs', 'feet', 'accessory']);
const itemSchema = named.extend({ description: z.string().max(20000), tags, imageAssetId: ref, showsTime: z.boolean().default(false), equipmentSlot: slot.nullable(), capacityBonus: z.number().int().min(0).max(30), modifiers: z.record(idSchema, z.number().finite()) }).strict();
const trait = named.extend({
  initial: z.number().finite(), min: z.number().finite(), max: z.number().finite(),
  description: z.string().max(5000).optional(), imageAssetId: ref.optional(),
  imageVariants: z.array(z.object({ value: z.number().finite(), imageAssetId: ref }).strict()).max(100).optional(),
  imageRanges: z.array(z.object({ min: z.number().finite(), max: z.number().finite(), imageAssetId: ref }).strict()).max(100).optional(),
  barAssets: z.object({ frameAssetId: ref, fillAssetId: ref }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (!(v.min <= v.initial && v.initial <= v.max)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Начальное значение должно быть в пределах характеристики' });
  const ranges = v.imageRanges ?? [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.min > range.max) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['imageRanges', i], message: 'Начало диапазона не может быть больше конца' });
    if (ranges.some((other, j) => j < i && range.min <= other.max && other.min <= range.max)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['imageRanges', i], message: 'Диапазоны изображений не должны пересекаться' });
  }
  if (new Set(v.imageVariants?.map(image => image.value)).size !== (v.imageVariants?.length ?? 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Одному значению навыка можно назначить только один вариант изображения' });
});
const typewriterSchema = z.object({ enabled: z.boolean(), charactersPerSecond: z.number().min(1).max(120), soundAssetId: ref, volume: z.number().min(0).max(1) }).strict();
const check = z.object({ id: idSchema, name: name.default('Проверка навыка'), skillId: idSchema, statId: ref.default(null), difficulty: z.number().finite(), repeatable: z.boolean(), retryWhen: conditionSchema.nullable(), retryReason: z.string().max(500).default(''), maxAttempts: z.number().int().min(1).max(1000).nullable().default(null), formula: z.object({ mode: z.enum(['threshold', 'dice']), dieSides: z.number().int().min(2).max(100), skillWeight: z.number().finite().min(-100).max(100), statWeight: z.number().finite().min(-100).max(100) }).strict().optional(), retryGrowth: z.object({ skillId: idSchema, reference: z.enum(['last', 'attempt']), attempt: z.number().int().min(1).max(1000) }).strict().nullable().optional() }).strict();
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setFlag'), key: idSchema, value: scalar }).strict(),
  z.object({ type: z.literal('setObjectState'), objectId: idSchema, key: idSchema, value: scalar }).strict(),
  z.object({ type: z.literal('setPresence'), objectId: idSchema, present: z.boolean() }).strict(),
  z.object({ type: z.literal('giveItem'), itemDefinitionId: idSchema }).strict(),
  z.object({ type: z.literal('giveItemOnce'), itemDefinitionId: idSchema, rewardId: idSchema }).strict(),
  z.object({ type: z.literal('changeTrait'), kind: z.enum(['stat', 'skill']), traitId: idSchema, mode: z.enum(['set', 'add']), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('completeQuest'), questId: idSchema }).strict(),
  z.object({ type: z.literal('openScript'), scriptId: idSchema }).strict(),
  z.object({ type: z.literal('playAudio'), assetId: idSchema, volume: z.number().min(0).max(1).default(1) }).strict(),
  z.object({ type: z.literal('startTimer'), timerId: idSchema }).strict(),
  z.object({ type: z.literal('cancelTimer'), timerId: idSchema }).strict(),
  z.object({ type: z.literal('advanceTime'), seconds: z.number().nonnegative().max(86400 * 365) }).strict(),
  z.object({ type: z.literal('setQuestStage'), questId: idSchema, stageId: idSchema }).strict(),
  z.object({ type: z.literal('setStatus'), statusId: idSchema, active: z.boolean() }).strict(),
  z.object({ type: z.literal('transition'), locationId: idSchema }).strict(),
  z.object({ type: z.literal('consumeUsedItem') }).strict(),
  z.object({ type: z.literal('replaceUsedItem'), itemDefinitionId: idSchema }).strict(),
  z.object({ type: z.literal('putUsedItem'), objectId: idSchema }).strict(),
  z.object({ type: z.literal('startRecipe'), objectId: idSchema, recipeId: idSchema }).strict(),
]);
const scriptSchema = named.extend({ entryNodeId: idSchema, nodes: z.array(z.object({
  id: idSchema, entryCondition: conditionSchema.nullable().optional(), entryPriority: z.number().int().min(-100000).max(100000).optional(), paragraphs: z.array(z.object({ spans: z.array(z.object({ text: z.string().max(20000), marks: z.array(z.enum(['bold', 'italic', 'underline', 'strike'])).max(4) }).strict()).max(100), audioAssetId: ref, voiceId: ref.optional(), audioLoop: z.boolean().default(false), audioVolume: z.number().min(0).max(1).default(1), audioStop: z.boolean().optional(), audioRestart: z.boolean().optional() }).strict()).max(1000),
  choices: z.array(z.object({ id: idSchema, label: name, nextNodeId: ref, condition: conditionSchema.nullable(), unavailableReason: z.string().max(500), checkId: ref, usageLimit: z.object({ period: z.enum(['day', 'interval', 'ever']), maxUses: z.number().int().min(1).max(1000), seconds: z.number().finite().positive().max(365 * 86400) }).strict().nullable().optional(), failureNodeId: ref.default(null), failureActions: z.array(actionSchema).max(100).default([]), actions: z.array(actionSchema).max(100) }).strict()).max(100),
}).strict()).min(1).max(1000) }).strict();
const ruleSchema = named.extend({ trigger: z.enum(['interact', 'useItem', 'enter', 'timer', 'checkSuccess', 'checkFailure']), targetObjectId: ref, checkId: ref.default(null), itemDefinitionId: ref, itemTag: z.string().trim().max(60).nullable(), priority: z.number().int(), condition: conditionSchema.nullable(), unavailableReason: z.string().max(500).default(''), actions: z.array(actionSchema).max(100), once: z.boolean() }).strict();

const shape = z.object({
  formatVersion: z.literal(FORMAT_VERSION), id: idSchema,
  meta: z.object({ title: name, author: z.string().max(160), description: z.string().max(20000), createdAt: z.string().datetime(), language: z.literal('ru') }).strict(),
  settings: z.object({ paperColor: z.string().regex(/^#[a-fA-F0-9]{6}$/), startLocationId: idSchema, startScriptId: ref, baseInventorySlots: z.literal(3), worldSecondsPerRealSecond: z.number().positive().max(3600), startWorldSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER), pauseOnInteraction: z.literal(true), pauseOnMenu: z.literal(true), pauseWhenHidden: z.literal(true), elapsedWhileClosed: z.literal(false), checkFormula: z.object({ mode: z.enum(['threshold', 'dice']), dieSides: z.number().int().min(2).max(100), skillWeight: z.number().finite().min(-100).max(100), statWeight: z.number().finite().min(-100).max(100) }).strict().default({ mode: 'threshold', dieSides: 20, skillWeight: 1, statWeight: 1 }), equipmentSlots: z.array(slot).min(1).max(5), typewriter: typewriterSchema.optional() }).strict(),
  voices: z.array(voiceSchema).max(200).optional(),
  assets: z.array(assetSchema).max(500), locations: z.array(roomSchema).min(1).max(1000), objects: z.array(objectSchema).max(20000), items: z.array(itemSchema).max(5000),
  character: z.object({ name, stats: z.array(trait).max(100), skills: z.array(trait).max(100), statuses: z.array(named.extend({ description: z.string().max(2000), initiallyActive: z.boolean(), modifiers: z.record(idSchema, z.number().finite()).default({}) }).strict()).max(100) }).strict(),
  flags: values, scripts: z.array(scriptSchema).max(5000), rules: z.array(ruleSchema).max(10000), checks: z.array(check).max(5000),
  quests: z.array(named.extend({ description: z.string().max(20000).default(''), stages: z.array(named.extend({ description: z.string().max(2000).default('') }).strict()).min(1).max(100), initialStageId: ref, rewards: z.array(actionSchema).max(100).default([]) }).strict()).max(1000),
  recipes: z.array(named.extend({ ingredientTags: tags, resultItemId: idSchema, durationSeconds: z.number().nonnegative().max(365 * 86400), condition: conditionSchema.nullable(), containerObjectId: ref.default(null), allowExtraIngredients: z.boolean().default(false), unavailableReason: z.string().max(500).default('') }).strict()).max(1000),
  timers: z.array(named.extend({ durationSeconds: z.number().finite().positive().max(365 * 86400), ruleId: ref, initiallyActive: z.boolean().default(false) }).strict()).max(1000).default([]),
  schedules: z.array(z.object({ id: idSchema, objectId: idSchema, fromSeconds: z.number().nonnegative().lt(86400), toSeconds: z.number().positive().max(86400), present: z.boolean(), condition: conditionSchema.nullable() }).strict()).max(1000),
}).strict();

export const projectSchema = shape.superRefine((p, ctx) => {
  const report = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  const lists = { voices: p.voices ?? [], assets: p.assets, locations: p.locations, objects: p.objects, items: p.items, stats: p.character.stats, skills: p.character.skills, statuses: p.character.statuses, scripts: p.scripts, rules: p.rules, checks: p.checks, quests: p.quests, recipes: p.recipes, schedules: p.schedules, timers: p.timers };
  const ids = Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, new Set(list.map(x => x.id))]));
  for (const [key, list] of Object.entries(lists)) if (ids[key].size !== list.length) report(`Повторяются идентификаторы: ${key}`);
  const exists = (key: string, id: string | null, path: (string | number)[]) => { if (id !== null && !ids[key].has(id)) report(`Ссылка на отсутствующий элемент: ${id}`, path); };
  const asset = (id: string | null, kind: 'image' | 'audio', path: (string | number)[]) => { exists('assets', id, path); if (id && p.assets.find(a => a.id === id)?.kind !== kind) report('Неверный вид ресурса', path); };
  exists('locations', p.settings.startLocationId, ['settings', 'startLocationId']);
  exists('scripts', p.settings.startScriptId, ['settings', 'startScriptId']);
  if (new Set(p.settings.equipmentSlots).size !== p.settings.equipmentSlots.length) report('Повторяются ячейки экипировки', ['settings', 'equipmentSlots']);
  const condition = (c: Condition | null) => {
    if (!c || c.type === 'literal') return;
    if (c.type === 'all' || c.type === 'any') { c.conditions.forEach(condition); return; }
    if (c.type === 'not') { condition(c.condition); return; }
    if (c.type !== 'compare') return;
    const source = { stat: 'stats', skill: 'skills', status: 'statuses', inventory: 'items', quest: 'quests', object: 'objects', check: 'checks' };
    if (c.source === 'flag' && !Object.hasOwn(p.flags, c.key)) report(`Флаг не найден: ${c.key}`);
    else if (c.source === 'time' && !['worldSeconds', 'playedSeconds', 'timeOfDaySeconds'].includes(c.key)) report('Неизвестный параметр времени');
    else if (c.source !== 'flag' && c.source !== 'time') exists(source[c.source], c.key, ['condition']);
  };
  const action = (a: z.infer<typeof actionSchema>) => {
    if (a.type === 'setFlag' && !Object.hasOwn(p.flags, a.key)) report(`Флаг не найден: ${a.key}`);
    if ('objectId' in a) exists('objects', a.objectId, ['rules']);
    if ('itemDefinitionId' in a) exists('items', a.itemDefinitionId, ['rules']);
    if ('recipeId' in a) exists('recipes', a.recipeId, ['rules']);
    if ('timerId' in a) exists('timers', a.timerId, ['actions']);
    if ((a.type === 'putUsedItem' || a.type === 'startRecipe') && !p.objects.find(o => o.id === a.objectId)?.container) report('Действию нужен контейнер');
    if (a.type === 'startRecipe') { const recipe = p.recipes.find(r => r.id === a.recipeId); if (recipe?.containerObjectId && recipe.containerObjectId !== a.objectId) report('Рецепт назначен другому контейнеру'); }
    if ('scriptId' in a) exists('scripts', a.scriptId, ['rules']);
    if ('locationId' in a) exists('locations', a.locationId, ['rules']);
    if ('assetId' in a) asset(a.assetId, 'audio', ['rules']);
    if ('statusId' in a) exists('statuses', a.statusId, ['rules']);
    if ('questId' in a) { exists('quests', a.questId, ['rules']); if ('stageId' in a && !p.quests.find(q => q.id === a.questId)?.stages.some(s => s.id === a.stageId)) report('Этап задания не найден'); }
    if (a.type === 'changeTrait') exists(a.kind === 'stat' ? 'stats' : 'skills', a.traitId, ['actions']);
  };
  p.locations.forEach((l, i) => {
    asset(l.audio.musicAssetId, 'audio', ['locations', i, 'audio']); asset(l.audio.ambienceAssetId, 'audio', ['locations', i, 'audio']);
    if (new Set(l.rooms.map(r => r.id)).size !== l.rooms.length) report('Повторяются комнаты', ['locations', i]);
    l.rooms.forEach(r => [r.floorAssetId, r.wallAssetId, r.ceilingAssetId].forEach(id => asset(id, 'image', ['locations', i, 'rooms'])));
  });
  p.objects.forEach((o, i) => {
    condition(o.visibleWhen);
    condition(o.interaction.condition); condition(o.light?.condition ?? null); condition(o.spatialAudio?.condition ?? null);
    asset(o.spatialAudio?.assetId ?? null, 'audio', ['objects', i, 'spatialAudio']);
    exists('locations', o.locationId, ['objects', i]); exists('scripts', o.interaction.scriptId, ['objects', i]); exists('items', o.interaction.itemDefinitionId, ['objects', i]);
    asset(o.imageAssetId, 'image', ['objects', i]); asset(o.interaction.audioAssetId, 'audio', ['objects', i]);
    if (o.transition) exists('locations', o.transition.locationId, ['objects', i, 'transition']);
    if (o.interaction.canTake && !o.interaction.itemDefinitionId) report('Предмету для подбора нужно определение', ['objects', i]);
    if (o.transform.scale.some(n => n <= 0)) report('Масштаб должен быть положительным', ['objects', i, 'transform']);
  });
  const modifier = (key: string) => { if (!ids.stats.has(key) && !ids.skills.has(key)) report('Модификатор ссылается на отсутствующую характеристику или навык: ' + key); };
  p.items.forEach((o, i) => { asset(o.imageAssetId, 'image', ['items', i]); Object.keys(o.modifiers).forEach(modifier); });
  p.character.statuses.forEach(s => Object.keys(s.modifiers).forEach(modifier));
  for (const kind of ['stats', 'skills'] as const) p.character[kind].forEach((t, i) => {
    const path = ['character', kind, i];
    asset(t.imageAssetId ?? null, 'image', path);
    asset(t.barAssets?.frameAssetId ?? null, 'image', path);
    asset(t.barAssets?.fillAssetId ?? null, 'image', path);
    t.imageVariants?.forEach(v => asset(v.imageAssetId, 'image', path));
    t.imageRanges?.forEach(v => asset(v.imageAssetId, 'image', path));
  });
  p.voices?.forEach((voice, i) => {
    if (new Set(voice.samples.map(sample => 'assetId' in sample ? 'asset:' + sample.assetId : 'builtin:' + sample.builtinSampleId)).size !== voice.samples.length) report('Сэмплы голоса повторяются', ['voices', i]);
    asset(voice.imageAssetId, 'image', ['voices', i]); voice.samples.forEach(sample => { if ('assetId' in sample) asset(sample.assetId, 'audio', ['voices', i]); });
  });
  asset(p.settings.typewriter?.soundAssetId ?? null, 'audio', ['settings', 'typewriter']);
  p.scripts.forEach((s, i) => {
    const nodes = new Set(s.nodes.map(n => n.id));
    if (nodes.size !== s.nodes.length || !nodes.has(s.entryNodeId)) report('Неверная структура текстовой сцены', ['scripts', i]);
    s.nodes.forEach(n => {
      condition(n.entryCondition ?? null);
      n.paragraphs.forEach(t => {
        asset(t.audioAssetId, 'audio', ['scripts', i]);
        if (t.voiceId && !ids.voices.has(t.voiceId) && !(builtinVoiceIds as readonly string[]).includes(t.voiceId)) report('Голос не найден', ['scripts', i]);
        if (t.voiceId && (t.audioAssetId || t.audioLoop)) report('Выбери голос или обычную аудиозапись для абзаца', ['scripts', i]);
      });
      if (new Set(n.choices.map(c => c.id)).size !== n.choices.length) report('Повторяются ответы', ['scripts', i]);
      n.choices.forEach(c => { condition(c.condition); if (c.nextNodeId && !nodes.has(c.nextNodeId)) report('Ответ ссылается на отсутствующий узел', ['scripts', i]); exists('checks', c.checkId, ['scripts', i]); c.actions.forEach(action); c.failureActions.forEach(action); if (c.failureNodeId && !nodes.has(c.failureNodeId)) report('Не найден фрагмент провала проверки', ['scripts', i]); });
    });
  });
  const needsItem = (a: z.infer<typeof actionSchema>) => ['consumeUsedItem', 'replaceUsedItem', 'putUsedItem'].includes(a.type);
  p.scripts.forEach(s => s.nodes.forEach(n => n.choices.forEach(c => { if ([...c.actions, ...c.failureActions].some(needsItem)) report('Действия с выбранной вещью доступны только в реакции использования предмета'); })));
  p.rules.forEach(r => { condition(r.condition); exists('objects', r.targetObjectId, ['rules']); exists('checks', r.checkId, ['rules']); exists('items', r.itemDefinitionId, ['rules']); r.actions.forEach(action); if (r.checkId && !['checkSuccess', 'checkFailure'].includes(r.trigger)) report('Привязка проверки требует события успеха или провала'); if (r.trigger !== 'useItem' && r.actions.some(needsItem)) report('Действия с выбранной вещью требуют события использования предмета'); });
  p.checks.forEach(c => { if (c.retryGrowth) exists('skills', c.retryGrowth.skillId, ['checks']); condition(c.retryWhen); exists('skills', c.skillId, ['checks']); exists('stats', c.statId, ['checks']); });
  p.recipes.forEach(r => { condition(r.condition); exists('items', r.resultItemId, ['recipes']); exists('objects', r.containerObjectId, ['recipes']); if (r.containerObjectId && !p.objects.find(o => o.id === r.containerObjectId)?.container) report('Рецепту нужен контейнер'); });
  p.schedules.forEach(s => { condition(s.condition); exists('objects', s.objectId, ['schedules']); if (s.fromSeconds === s.toSeconds) report('Начало и конец расписания совпадают'); });
  p.timers.forEach(t => { exists('rules', t.ruleId, ['timers']); if (t.ruleId && p.rules.find(r => r.id === t.ruleId)?.trigger !== 'timer') report('Таймеру нужна реакция события «Таймер»'); });
  p.quests.forEach(q => { q.rewards.forEach(action); if (q.rewards.some(needsItem)) report('Награда задания не может использовать выбранную вещь'); if (new Set(q.stages.map(s => s.id)).size !== q.stages.length || (q.initialStageId && !q.stages.some(s => s.id === q.initialStageId))) report('Неверные этапы задания'); });
});

export type Project = z.infer<typeof shape>;
export type ItemDefinition = Project['items'][number];
export type Asset = z.infer<typeof assetSchema>;
export type WorldObject = Project['objects'][number];
export type Location = Project['locations'][number];
export type Script = Project['scripts'][number];
export type ScriptNode = Script['nodes'][number];
export type ScriptChoice = ScriptNode['choices'][number];
export type Paragraph = ScriptNode['paragraphs'][number];
export type TextMark = Paragraph['spans'][number]['marks'][number];
export type Action = Project['rules'][number]['actions'][number];
export type Rule = Project['rules'][number];
export type Recipe = Project['recipes'][number];
export type Check = Project['checks'][number];
export type Quest = Project['quests'][number];
export type Trait = Project['character']['stats'][number];
export type Status = Project['character']['statuses'][number];
export type TimerDefinition = Project['timers'][number];
export type Scalar = string | number | boolean | null;

export function parseProject(input: unknown): Project {
  if (input && typeof input === 'object' && 'formatVersion' in input && input.formatVersion !== FORMAT_VERSION) throw new Error('Эта версия формата проекта пока не поддерживается');
  let nodes = 0;
  const inspect = (v: unknown, depth: number) => {
    if (++nodes > 350000 || depth > 60) throw new Error('Проект слишком сложный или повреждён');
    if (v && typeof v === 'object') for (const child of Object.values(v)) inspect(child, depth + 1);
  };
  inspect(input, 0);
  const result = projectSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}

export type Voice = z.infer<typeof voiceSchema>;
