import { parseProject, type Action, type Asset, type Condition, type Project, type ScriptChoice, type ScriptNode, type WorldObject } from './project';
import { createSampleProject } from './sample-project';

export const GAME_CYCLE_NAME = 'Контрольное утро';
export function createGameCycle(pulse: Asset | null = null, prefix = 'cycle'): Project {
  const id = (name: string) => prefix + '-' + name;
  const compare = (source: 'flag' | 'check', key: string, value: boolean, field?: string): Condition => ({ type: 'compare', source, key: id(key), operator: 'eq', value, ...(field ? { field } : {}) });
  const awake = compare('flag', 'awake', true), prepared = compare('flag', 'prepared', true);
  const clean: Condition = { type: 'all', conditions: [compare('flag', 'paper-cleared', true), compare('flag', 'bottle-cleared', true)] };
  const ready: Condition = { type: 'all', conditions: [clean, compare('check', 'memory', true, 'succeeded'), { type: 'not', condition: compare('flag', 'served', true) }] };
  const choice = (name: string, label: string, actions: Action[] = [], extra: Partial<ScriptChoice> = {}): ScriptChoice => ({ id: id(name), label, nextNodeId: null, failureNodeId: null, checkId: null, condition: null, unavailableReason: '', actions, failureActions: [], ...extra });
  const paragraph = (text: string, sound = false) => ({ spans: [{ text, marks: [] }], audioAssetId: sound ? pulse?.id ?? null : null, audioLoop: sound, audioVolume: .45 });
  const node = (name: string, texts: string[], choices: ScriptChoice[] = []): ScriptNode => ({ id: id(name), paragraphs: texts.map(text => paragraph(text)), choices });
  const script = (name: string, title: string, nodes: ScriptNode[]) => ({ id: id(name), name: title, entryNodeId: nodes[0].id, nodes });
  const setFlag = (key: string, value = true): Action => ({ type: 'setFlag', key: id(key), value });
  const rule = (name: string, actions: Action[], extra: Partial<Project['rules'][number]> = {}): Project['rules'][number] => ({ id: id(name), name: GAME_CYCLE_NAME + ': ' + name, trigger: 'useItem', targetObjectId: null, checkId: null, itemDefinitionId: null, itemTag: null, priority: 10, condition: null, unavailableReason: '', actions, once: false, ...extra });
  const item = (name: string, title: string, tags: string[] = []): Project['items'][number] => ({ id: id(name), name: title, description: 'Контрольная вещь. Рисунок и описание можно заменить в библиотеке предметов.', tags, imageAssetId: null, equipmentSlot: null, capacityBonus: 0, modifiers: {}, showsTime: false });
  const object = (name: string, title: string, kind: WorldObject['kind'], position: [number, number, number], extra: Partial<WorldObject> = {}): WorldObject => ({
    id: id(name), name: title, kind, locationId: id('home'), notes: 'Объект контрольной сцены. Геометрическую заглушку можно заменить своим рисунком.', tags: [],
    transform: { position, rotation: [0, 0, 0], scale: [kind === 'npc' ? .8 : .45, kind === 'npc' ? 1.7 : .5, 1] },
    imageAssetId: null, billboard: 'vertical', collision: { solid: false, radius: .25 }, initialState: {}, visibleWhen: null,
    interaction: { scriptId: null, itemDefinitionId: null, canTake: false, reach: 2, audioAssetId: null, showsTime: false, condition: awake, unavailableReason: 'Сначала закончи пробуждение.', itemUseReason: 'Эта вещь здесь не подходит.' }, container: null, transition: null, ...extra,
  });
  const take = (name: string, title: string, definition: string, position: [number, number, number]) => {
    const value = object(name, title, 'item', position); value.interaction = { ...value.interaction, canTake: true, itemDefinitionId: id(definition) }; return value;
  };
  const p = createSampleProject();
  p.meta.title = 'Morimundus · ' + GAME_CYCLE_NAME;
  p.meta.description = 'Проверочная квартира и лестничная площадка: уборка, еда, часы и разговор. Тестовые тексты и ресурсы предназначены для замены автором.';
  p.meta.createdAt = '2026-10-09T00:00:00.000Z';
  p.settings.startLocationId = id('home'); p.settings.startScriptId = id('wake'); p.settings.startWorldSeconds = 7 * 3600;
  p.assets = pulse ? [pulse] : [];
  p.flags = Object.fromEntries(['awake', 'prepared', 'paper-cleared', 'bottle-cleared', 'served', 'reminder'].map(name => [id(name), false]));
  p.locations = [
    { id: id('home'), name: GAME_CYCLE_NAME + ' · квартира', notes: 'Кровать слева, стол и кастрюля впереди, дверь справа. Два предмета мусора, пальто и часы доступны для подбора.', rooms: [{ id: id('home-room'), origin: [0, 0, 0], width: 8, depth: 6, height: 2.8, floorAssetId: null, wallAssetId: null, ceilingAssetId: null }], spawn: { position: [4, 1.65, 4.6], yaw: 0, pitch: 0 }, audio: { musicAssetId: null, ambienceAssetId: null, volume: .5 } },
    { id: id('landing'), name: GAME_CYCLE_NAME + ' · площадка', notes: 'Сосед бывает здесь с 07:00 до 20:00. Дверь ведёт обратно в квартиру.', rooms: [{ id: id('landing-room'), origin: [0, 0, 0], width: 8, depth: 4, height: 2.8, floorAssetId: null, wallAssetId: null, ceilingAssetId: null }], spawn: { position: [4, 1.65, 2.8], yaw: 0, pitch: 0 }, audio: { musicAssetId: null, ambienceAssetId: null, volume: .5 } },
  ];
  const bed = object('bed', 'Кровать', 'prop', [1.8, 0, 1.2]); bed.transform.scale = [1.6, .5, 1]; bed.billboard = 'none'; bed.collision = { solid: true, radius: .7 }; bed.interaction.scriptId = id('wake'); bed.interaction.condition = { type: 'not', condition: awake }; bed.interaction.unavailableReason = 'Ты уже проснулся.';
  const pot = object('pot', 'Кастрюля', 'container', [4, 0, 1.4], { container: { capacity: 6, acceptedTags: ['food'] } });
  const bin = object('bin', 'Мусорное ведро', 'container', [1.1, 0, 3], { container: { capacity: 8, acceptedTags: ['trash'] } });
  const clock = object('clock', 'Настенные часы', 'prop', [6.7, .8, 1.2]); clock.interaction.showsTime = true;
  const notebook = object('notebook', 'Записка на столе', 'prop', [5.8, 0, 2.2]); notebook.interaction.scriptId = id('note');
  const door = object('door', 'Дверь на площадку', 'exit', [7.5, 0, 4.6], { transition: { locationId: id('landing'), position: [4, 1.65, 2.8], yaw: 0 } }); door.transform.scale = [1, 2, 1];
  const back = object('back', 'Дверь в квартиру', 'exit', [7.5, 0, 2.8], { locationId: id('landing'), transition: { locationId: id('home'), position: [6.8, 1.65, 4.6], yaw: Math.PI / 2 } }); back.transform.scale = [1, 2, 1];
  const neighbour = object('neighbour', 'Сосед', 'npc', [3, 0, 1.2], { locationId: id('landing') }); neighbour.interaction.scriptId = id('talk');
  p.objects = [bed, pot, bin, clock, notebook, door, back, neighbour,
    take('paper-object', 'Смятая бумага', 'paper', [2.5, 0, 4.2]), take('bottle-object', 'Пустая бутылка', 'bottle', [2.5, 0, 3.1]),
    take('coat-object', 'Пальто с карманами', 'coat', [1.1, 0, 4.5]), take('watch-object', 'Наручные часы', 'watch', [5.4, 0, 3.3]),
    take('grain-object', 'Крупа', 'grain', [3.2, 0, 2.6]), take('water-object', 'Вода', 'water', [4.4, 0, 2.6]),
  ];
  const coat = item('coat', 'Пальто с карманами'); coat.equipmentSlot = 'torso'; coat.capacityBonus = 2;
  const watch = item('watch', 'Наручные часы'); watch.equipmentSlot = 'accessory'; watch.showsTime = true;
  p.items = [item('paper', 'Смятая бумага', ['trash']), item('bottle', 'Пустая бутылка', ['trash']), coat, watch, item('grain', 'Крупа', ['food', 'grain']), item('water', 'Вода', ['food', 'water']), item('soup', 'Каша', ['food']), item('token', 'Записка соседа')];
  p.character.stats = [{ id: id('focus'), name: 'Контроль: внимание', initial: 2, min: 0, max: 10 }];
  p.character.skills = [{ id: id('observe'), name: 'Контроль: наблюдение', initial: 2, min: 0, max: 10 }];
  p.character.statuses = [{ id: id('drowsy'), name: 'Сонливость', description: 'Тестовый статус пробуждения. Проходит после записки или напоминания.', initiallyActive: false, modifiers: {} }];
  const firstWake = node('wake-start', ['В темноте слышится собственный пульс.', 'На полу лежит мусор. На столе — крупа и вода. За дверью слышны шаги.'], [choice('get-up', 'Встать', [setFlag('awake'), { type: 'setStatus', statusId: id('drowsy'), active: true }, { type: 'setQuestStage', questId: id('morning'), stageId: id('awake-stage') }, { type: 'startTimer', timerId: id('reminder-timer') }], { condition: { type: 'not', condition: awake }, unavailableReason: 'Пробуждение уже завершено.' })]);
  firstWake.paragraphs[0] = paragraph('В темноте слышится собственный пульс.', true);
  firstWake.paragraphs[1] = { ...firstWake.paragraphs[1], audioStop: true };
  p.scripts = [
    script('wake', 'Пробуждение с пульсом', [firstWake]),
    script('note', 'Записка на столе', [node('note-start', ['«Убрать бумагу и бутылку. Сварить кашу. Заглянуть к соседу».', 'Ты вспоминаешь, о чём хотел спросить.'], [choice('remember', 'Запомнить', [setFlag('prepared'), { type: 'changeTrait', kind: 'skill', traitId: id('observe'), mode: 'set', value: 6 }, { type: 'setStatus', statusId: id('drowsy'), active: false }], { condition: { type: 'not', condition: prepared }, unavailableReason: 'Ты уже запомнил записку.' })])]),
    script('talk', 'Разговор на площадке', [
      node('talk-start', ['Сосед придерживает дверь. «Ты собирался о чём-то спросить?»'], [choice('ask', 'Вспомнить свой вопрос', [], { checkId: id('memory'), nextNodeId: id('talk-success'), failureNodeId: id('talk-failed') }), choice('leave', 'Вернуться позже')]),
      node('talk-failed', ['Мысль ускользает. Похоже, стоит перечитать свою записку.', 'Сосед ждёт, пока ты соберёшься с мыслями.']),
      node('talk-success', ['Теперь вопрос складывается в слова.', '«Когда уберёшься и приготовишь еду, принеси немного каши. Я оставлю тебе записку».']),
    ]),
    script('thanks', 'Утро завершено', [node('thanks-start', ['Сосед принимает кашу и протягивает записку.', 'Ты успел убрать квартиру, приготовить еду и вернуться к разговору.'])]),
  ];
  p.checks = [{ id: id('memory'), name: 'Вспомнить вопрос', skillId: id('observe'), statId: id('focus'), difficulty: 7, repeatable: true, retryWhen: prepared, retryReason: 'Перечитай записку в квартире.', maxAttempts: 3 }];
  p.quests = [{ id: id('morning'), name: GAME_CYCLE_NAME, description: 'Убери два предмета мусора, приготовь кашу и принеси её соседу после разговора.', initialStageId: null, stages: [{ id: id('awake-stage'), name: 'Привести утро в порядок', description: 'Вещи и тексты доступны после пробуждения.' }], rewards: [{ type: 'giveItemOnce', itemDefinitionId: id('token'), rewardId: id('morning-reward') }] }];
  p.rules = [
    rule('clear-paper', [{ type: 'putUsedItem', objectId: id('bin') }, setFlag('paper-cleared')], { targetObjectId: id('bin'), itemDefinitionId: id('paper') }),
    rule('clear-bottle', [{ type: 'putUsedItem', objectId: id('bin') }, setFlag('bottle-cleared')], { targetObjectId: id('bin'), itemDefinitionId: id('bottle') }),
    rule('serve', [{ type: 'consumeUsedItem' }, setFlag('served'), { type: 'completeQuest', questId: id('morning') }, { type: 'openScript', scriptId: id('thanks') }], { targetObjectId: id('neighbour'), itemDefinitionId: id('soup'), condition: ready, unavailableReason: 'Сначала убери бумагу и бутылку и закончи разговор с соседом.', once: true }),
    rule('reminder', [setFlag('reminder'), { type: 'setStatus', statusId: id('drowsy'), active: false }], { trigger: 'timer', once: true }),
  ];
  p.recipes = [{ id: id('porridge'), name: 'Каша из крупы и воды', ingredientTags: ['grain', 'water'], resultItemId: id('soup'), durationSeconds: 20, condition: awake, containerObjectId: id('pot'), allowExtraIngredients: false, unavailableReason: 'Сначала проснись.' }];
  p.timers = [{ id: id('reminder-timer'), name: 'Утреннее напоминание', durationSeconds: 60, ruleId: id('reminder'), initiallyActive: false }];
  p.schedules = [{ id: id('neighbour-shift'), objectId: id('neighbour'), fromSeconds: 7 * 3600, toSeconds: 20 * 3600, present: true, condition: null }];
  return parseProject(p);
}

export function addGameCycle(project: Project, pulse: Asset, startHere = false) {
  const known = [project.locations, project.objects, project.items, project.scripts, project.rules, project.checks, project.quests, project.recipes, project.timers, project.schedules, project.character.stats, project.character.skills, project.character.statuses].flat().map(value => value.id).concat(Object.keys(project.flags));
  let prefix = 'cycle', number = 1;
  while (known.some(value => value.startsWith(prefix + '-'))) prefix = 'cycle' + ++number;
  const cycle = createGameCycle(pulse, prefix);
  const next = { ...project, assets: project.assets.some(asset => asset.id === pulse.id) ? project.assets : [...project.assets, pulse],
    settings: { ...project.settings, ...(startHere ? { startLocationId: cycle.settings.startLocationId, startScriptId: cycle.settings.startScriptId } : {}) },
    flags: { ...project.flags, ...cycle.flags }, character: { ...project.character, stats: [...project.character.stats, ...cycle.character.stats], skills: [...project.character.skills, ...cycle.character.skills], statuses: [...project.character.statuses, ...cycle.character.statuses] },
    locations: [...project.locations, ...cycle.locations], objects: [...project.objects, ...cycle.objects], items: [...project.items, ...cycle.items], scripts: [...project.scripts, ...cycle.scripts],
    rules: [...project.rules, ...cycle.rules], checks: [...project.checks, ...cycle.checks], quests: [...project.quests, ...cycle.quests], recipes: [...project.recipes, ...cycle.recipes], timers: [...project.timers, ...cycle.timers], schedules: [...project.schedules, ...cycle.schedules],
  };
  return { project: parseProject(next), locationId: cycle.settings.startLocationId, scriptId: cycle.settings.startScriptId! };
}
