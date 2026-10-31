import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'interactions-check-' + process.pid);
const modules = ['editor/deletion', 'engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'editor/spatial-operations', 'editor/scenario-dependencies', 'storage/asset-format', 'storage/client', 'storage/backup'];
const originIndex = process.argv.indexOf('--origin'); let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
try {
  for (const module of modules) {
    const source = await fs.readFile(path.join(root, 'lib', module + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, q, name) => 'from ' + q + name + '.mjs' + q);
    const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, compiled);
  }
  const load = name => import(pathToFileURL(path.join(output, name + '.mjs')).href);
  const { createSampleProject } = await load('engine/sample-project');
  const { parseProject } = await load('engine/project');
  const { parseGameState } = await load('engine/game-state');
  const { TestSession } = await load('engine/session');
  const { containerContents, matchIngredients } = await load('engine/item-interactions');
  const { createLocation, copyObjects, pasteObjects, deleteObject } = await load('editor/spatial-operations');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  function rule(patch = {}) { return { id: 'rule', name: 'Применение', trigger: 'useItem', targetObjectId: 'guard', itemDefinitionId: null, itemTag: null, priority: 0, condition: null, unavailableReason: '', actions: [], once: false, ...patch }; }
  function fixture() {
    const created = createLocation(createSampleProject(), 'Следующая комната', 4, 4, 3), p = created.project;
    p.settings.startScriptId = null; p.flags = { ...p.flags, doorOpen: false, reaction: '', allowed: true };
    const paper = p.objects.find(o => o.id === 'paper'), pot = p.objects.find(o => o.id === 'pot');
    pot.container.acceptedTags = []; pot.transform.position = [3, 0, 3];
    p.objects.find(o => o.id === 'door').interaction.condition = { type: 'compare', source: 'flag', key: 'doorOpen', operator: 'eq', value: true };
    p.objects.find(o => o.id === 'door').transition = { locationId: created.id, position: [2, 1.65, 2], yaw: 0 };
    p.objects.push({ ...structuredClone(pot), id: 'bin', name: 'Мусорный бак', container: { capacity: 1, acceptedTags: ['trash'] }, interaction: { ...pot.interaction, itemUseReason: 'Сюда кладут только мусор.' } }, { ...structuredClone(pot), id: 'guard', name: 'Проверяющий', kind: 'npc', container: null, interaction: { ...pot.interaction, itemUseReason: 'Нужен верный документ.' } });
    const definition = p.items[0];
    for (const [id, tags] of [['document', ['document']], ['wrong-document', ['document']], ['multi', ['a', 'b', 'food']], ['a', ['a', 'food']], ['b', ['b', 'food']], ['meal', ['food']]]) p.items.push({ ...structuredClone(definition), id, name: id, tags });
    for (const id of ['document', 'wrong-document', 'multi', 'a', 'b', 'extra', 'paper-2', 'paper-3']) p.objects.push({ ...structuredClone(paper), id, name: id, interaction: { ...paper.interaction, itemDefinitionId: id.startsWith('paper') || id === 'extra' ? definition.id : id } });
    p.recipes = [{ id: 'meal-recipe', name: 'Проверочный рецепт', ingredientTags: ['a', 'b'], resultItemId: 'meal', durationSeconds: 0, condition: null, containerObjectId: 'pot', allowExtraIngredients: false, unavailableReason: '' }];
    return parseProject(p);
  }
  const session = project => { const s = new TestSession(project, 1); s.setPose([3, 1.65, 3.6], 0, 0); return s; };
  const put = (s, id, container = 'pot') => { s.takeObject(id); s.putInContainer(container, 'instance-' + id); };
  if (originIndex < 0) {
    await check('Legacy project and snapshot receive safe defaults without changing authored data', () => {
      const p = fixture(), raw = structuredClone(p); for (const o of raw.objects) delete o.interaction.itemUseReason; raw.rules = [rule()]; delete raw.rules[0].unavailableReason; for (const r of raw.recipes) { delete r.containerObjectId; delete r.allowExtraIngredients; delete r.unavailableReason; }
      const migrated = parseProject(raw); assert.equal(migrated.recipes[0].containerObjectId, null); assert.equal(migrated.objects[0].interaction.itemUseReason, 'Эта вещь здесь не подходит.'); const old = session(migrated).snapshot(); delete old.cooking; assert.deepEqual(TestSession.restore(migrated, 1, old).snapshot().cooking, {});
    });
    await check('Only the exact valid document opens the gated passage, without consuming it', () => {
      const p = fixture(); p.rules = [rule({ itemDefinitionId: 'document', actions: [{ type: 'setFlag', key: 'doorOpen', value: true }] })]; const s = session(parseProject(p)); assert.throws(() => s.transitionThrough('door')); s.takeObject('wrong-document'); const before = s.snapshot(); assert.throws(() => s.interactObject('guard'), /верный документ/); assert.deepEqual(s.snapshot(), before); s.dropItem(); s.takeObject('document'); assert.equal(s.interactObject('guard'), 'applied'); assert.equal(s.snapshot().items['instance-document'].owner.type, 'inventory'); s.transitionThrough('door'); assert.notEqual(s.locationId(), 'apartment');
    });
    await check('Exact target/item rule outranks a generic tag even with lower explicit priority; only one executes', () => {
      const p = fixture(); p.rules = [rule({ id: 'generic', itemTag: 'document', priority: 100, actions: [{ type: 'setFlag', key: 'reaction', value: 'generic' }, { type: 'consumeUsedItem' }] }), rule({ id: 'exact', itemDefinitionId: 'document', priority: -10, actions: [{ type: 'setFlag', key: 'reaction', value: 'exact' }] })]; const s = session(parseProject(p)); s.takeObject('document'); s.interactObject('guard'); assert.equal(s.snapshot().flags.reaction, 'exact'); assert.ok(s.snapshot().items['instance-document']);
    });
    await check('Equal specificity uses explicit priority and stable author order', () => {
      const p = fixture(); p.rules = ['first', 'second', 'low'].map((id, i) => rule({ id, itemDefinitionId: 'document', priority: i < 2 ? 2 : 0, actions: [{ type: 'setFlag', key: 'reaction', value: id }] })); const s = session(parseProject(p)); s.takeObject('document'); s.interactObject('guard'); assert.equal(s.snapshot().flags.reaction, 'first');
    });
    await check('False item-rule conditions report the authored rejection and preserve every field', () => {
      const p = fixture(); p.rules = [rule({ itemDefinitionId: 'document', condition: { type: 'literal', value: false }, unavailableReason: 'Документ просрочен.', actions: [{ type: 'consumeUsedItem' }] })]; const s = session(parseProject(p)); s.takeObject('document'); const before = s.snapshot(); assert.throws(() => s.interactObject('guard'), /просрочен/); assert.deepEqual(s.snapshot(), before);
    });
    await check('An unavailable exact rule can fall back to an explicitly authored generic rule', () => {
      const p = fixture(); p.rules = [rule({ itemDefinitionId: 'document', condition: { type: 'literal', value: false } }), rule({ id: 'fallback', itemTag: 'document', actions: [{ type: 'setFlag', key: 'reaction', value: 'fallback' }] })]; const s = session(parseProject(p)); s.takeObject('document'); s.interactObject('guard'); assert.equal(s.snapshot().flags.reaction, 'fallback');
    });
    await check('Ordinary interaction is explicit while holding an item; an empty selected slot also stays ordinary', () => {
      const s = session(fixture()); s.takeObject('document'); assert.equal(s.interactObject('guard', false), 'inspect'); assert.throws(() => s.interactObject('guard'), /верный документ/); s.selectSlot(2); assert.equal(s.interactObject('guard'), 'inspect'); assert.equal(s.interactObject('pot'), 'container');
    });
    await check('Cleaning rule moves the original rubbish instance into its container', () => {
      const p = fixture(); p.rules = [rule({ targetObjectId: 'bin', itemTag: 'trash', actions: [{ type: 'putUsedItem', objectId: 'bin' }, { type: 'setFlag', key: 'reaction', value: 'cleaned' }] })]; const s = session(parseProject(p)), authored = JSON.stringify(p); s.takeObject('paper'); const count = Object.keys(s.snapshot().items).length; s.interactObject('bin'); assert.equal(s.snapshot().flags.reaction, 'cleaned'); assert.deepEqual(s.snapshot().items['instance-paper'].owner, { type: 'container', objectId: 'bin' }); assert.equal(s.snapshot().objects.paper.present, false); assert.equal(Object.keys(s.snapshot().items).length, count); assert.equal(JSON.stringify(p), authored);
    });
    await check('Container fallback accepts allowed items, preserves identity over repeated put/take and excludes ownership conditions', () => {
      const p = fixture(), s = session(p); s.takeObject('paper'); assert.equal(s.interactObject('bin'), 'container'); const count = Object.keys(s.snapshot().items).length; for (let i = 0; i < 12; i++) { s.takeFromContainer('bin', 'instance-paper'); s.putInContainer('bin'); } assert.equal(Object.keys(s.snapshot().items).length, count); assert.equal(s.snapshot().player.inventory.filter(Boolean).length, 0); parseGameState(s.snapshot(), p);
    });
    await check('A rejected container combination uses the authored response and consumes nothing', () => {
      const s = session(fixture()); s.takeObject('document'); const before = s.snapshot(); assert.throws(() => s.interactObject('bin'), /только мусор/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Full container and full inventory block transfer atomically', () => {
      const s = session(fixture()); put(s, 'paper', 'bin'); s.takeObject('paper-2'); const before = s.snapshot(); assert.throws(() => s.putInContainer('bin'), /заполнен/); assert.deepEqual(s.snapshot(), before); s.takeObject('paper-3'); s.takeObject('document'); const full = s.snapshot(); assert.throws(() => s.takeFromContainer('bin', 'instance-paper'), /свободной/); assert.deepEqual(s.snapshot(), full);
    });
    await check('Hidden, absent, locked, remote and already moved containers/items are guarded on each action', () => {
      const p = fixture(), s = session(p); put(s, 'paper', 'bin'); assert.throws(() => s.takeFromContainer('pot', 'instance-paper'), /отсутствует/); s.setObjectPresence('bin', false); const hidden = s.snapshot(); assert.throws(() => s.takeFromContainer('bin', 'instance-paper'), /недоступен/); assert.deepEqual(s.snapshot(), hidden); s.setObjectPresence('bin', true); s.setPose([.3, 1.65, .3], 0, 0); assert.throws(() => s.takeFromContainer('bin', 'instance-paper'), /ближе/);
      p.objects.find(o => o.id === 'bin').interaction.condition = { type: 'compare', source: 'flag', key: 'allowed', operator: 'eq', value: true }; const locked = session(parseProject(p)); put(locked, 'paper', 'bin'); locked.setFlag('allowed', false); assert.throws(() => locked.takeFromContainer('bin', 'instance-paper'));
    });
    await check('Failure after consumption rolls back the whole item-use rule, scene and once marker', () => {
      const p = fixture(); p.rules = [rule({ once: true, actions: [{ type: 'consumeUsedItem' }, { type: 'setFlag', key: 'reaction', value: 'partial' }, { type: 'giveItem', itemDefinitionId: 'meal' }, { type: 'giveItem', itemDefinitionId: 'meal' }] })]; const s = session(parseProject(p)); for (const id of ['document', 'paper', 'a']) s.takeObject(id); const before = s.snapshot(); assert.throws(() => s.interactObject('guard'), /свободной/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Consumption frees a slot for a reward and a once rule stays once after restore', () => {
      const p = fixture(); p.rules = [rule({ itemTag: 'document', once: true, actions: [{ type: 'consumeUsedItem' }, { type: 'giveItem', itemDefinitionId: 'meal' }] })]; const project = parseProject(p), s = session(project); for (const id of ['document', 'paper', 'a']) s.takeObject(id); s.interactObject('guard'); assert.equal(s.snapshot().items['instance-document'], undefined); assert.equal(s.snapshot().player.inventory.filter(Boolean).length, 3); s.dropItem(); s.takeObject('wrong-document'); const restored = TestSession.restore(project, 1, s.snapshot()), before = restored.snapshot(); assert.throws(() => restored.interactObject('guard'), /уже выполнено/); assert.deepEqual(restored.snapshot(), before);
    });
    await check('Replacing a used item keeps the same instance/slot and changes later drop/repick definition', () => {
      const p = fixture(); p.rules = [rule({ itemDefinitionId: 'document', actions: [{ type: 'replaceUsedItem', itemDefinitionId: 'meal' }] })]; const s = session(parseProject(p)); s.takeObject('document'); s.interactObject('guard'); assert.equal(s.snapshot().player.inventory[0], 'instance-document'); assert.equal(s.snapshot().items['instance-document'].definitionId, 'meal'); s.dropItem(); assert.equal(s.worldObject('drop:instance-document').name, 'meal'); s.takeObject('drop:instance-document'); assert.equal(s.snapshot().items['instance-document'].definitionId, 'meal');
    });
    await check('Item use can open text, update status/presence and select audio as one transaction', () => {
      const p = fixture(); p.character.statuses.push({ id: 'ready', name: 'Готов', description: '', initiallyActive: false }); p.assets.push({ id: 'sound', name: 'Проверка', kind: 'audio', mime: 'audio/wav', bytes: 44, sha256: 'a'.repeat(64) }); p.scripts.push({ id: 'scene', name: 'Реакция', entryNodeId: 'entry', nodes: [{ id: 'entry', paragraphs: [{ spans: [{ text: 'Принято.', marks: [] }], audioAssetId: null }], choices: [] }] }); p.rules = [rule({ actions: [{ type: 'setStatus', statusId: 'ready', active: true }, { type: 'setPresence', objectId: 'paper', present: false }, { type: 'openScript', scriptId: 'scene' }, { type: 'playAudio', assetId: 'sound' }] })]; const s = session(parseProject(p)); s.takeObject('document'); assert.equal(s.interactObject('guard'), 'scene'); assert.deepEqual(s.snapshot().player.statuses, ['ready']); assert.equal(s.snapshot().objects.paper.present, false); assert.equal(s.snapshot().audio.events.at(-1).assetId, 'sound'); assert.ok(s.snapshot().clock.pausedBy.includes('interaction'));
    });
    await check('Repeated ingredient tags require distinct instances; multitag ingredients are matched without a greedy failure', () => {
      const p = fixture(), s = session(p); put(s, 'multi'); const before = s.snapshot(); assert.throws(() => s.cook('pot', 'meal-recipe')); assert.deepEqual(s.snapshot(), before); put(s, 'a'); const ids = matchIngredients(p, s.snapshot(), 'pot', p.recipes[0]); assert.deepEqual(ids, ['instance-a', 'instance-multi']);
      p.recipes[0].ingredientTags = ['a', 'a']; const r = session(parseProject(p)); put(r, 'multi'); put(r, 'b'); assert.throws(() => r.cook('pot', 'meal-recipe'), /Не хватает/);
    });
    await check('Instant cooking replaces the matched contents with one result, even with a full inventory', () => {
      const p = fixture(), s = session(p); put(s, 'multi'); put(s, 'a'); for (const id of ['paper', 'paper-2', 'paper-3']) s.takeObject(id); s.cook('pot', 'meal-recipe'); const state = s.snapshot(), contents = containerContents(state, 'pot'); assert.equal(contents.length, 1); assert.equal(contents[0].definitionId, 'meal'); assert.equal(state.items['instance-multi'], undefined); assert.equal(state.items['instance-a'], undefined); assert.equal(state.objects.pot.state.cookingState, 'ready'); assert.equal(state.player.inventory.filter(Boolean).length, 3); assert.equal(state.timers.length, 0); parseGameState(state, p);
    });
    await check('Exact recipes reject extras; optional extras survive cooking in the same container', () => {
      const p = fixture(), s = session(p); for (const id of ['multi', 'a', 'extra']) put(s, id); const before = s.snapshot(); assert.throws(() => s.cook('pot', 'meal-recipe'), /ровно/); assert.deepEqual(s.snapshot(), before); p.recipes[0].allowExtraIngredients = true; const project = parseProject(p), restored = TestSession.restore(project, 1, before); restored.cook('pot', 'meal-recipe'); assert.equal(containerContents(restored.snapshot(), 'pot').length, 2); assert.deepEqual(restored.snapshot().items['instance-extra'].owner, { type: 'container', objectId: 'pot' });
    });
    await check('Recipe conditions and incompatible output preserve ingredients and explain the refusal', () => {
      const p = fixture(); p.recipes[0].condition = { type: 'literal', value: false }; p.recipes[0].unavailableReason = 'Нет огня.'; const s = session(parseProject(p)); put(s, 'a'); put(s, 'b'); const before = s.snapshot(); assert.throws(() => s.cook('pot', 'meal-recipe'), /Нет огня/); assert.deepEqual(s.snapshot(), before);
      p.recipes[0].condition = null; p.objects.find(o => o.id === 'pot').container.acceptedTags = ['a', 'b']; const r = session(parseProject(p)); put(r, 'a'); put(r, 'b'); const unchanged = r.snapshot(); assert.throws(() => r.cook('pot', 'meal-recipe'), /не подходит/); assert.deepEqual(r.snapshot(), unchanged);
    });
    await check('Timed cooking stores exact ingredients and linked timer; pending contents cannot be moved or restarted', () => {
      const p = fixture(); p.recipes[0].durationSeconds = 30; const project = parseProject(p), s = session(project); put(s, 'multi'); put(s, 'a'); s.cook('pot', 'meal-recipe'); const cooking = s.snapshot().cooking.pot; assert.equal(s.snapshot().timers.find(t => t.id === cooking.timerId).remainingSeconds, 30); assert.deepEqual(cooking.ingredientIds, ['instance-a', 'instance-multi']); s.takeObject('paper'); const before = s.snapshot(); assert.throws(() => s.takeFromContainer('pot', 'instance-a'), /уже идёт/); assert.throws(() => s.putInContainer('pot'), /уже идёт/); assert.throws(() => s.cook('pot', 'meal-recipe'), /уже идёт/); assert.deepEqual(s.snapshot(), before); s.pause('menu'); s.tick(100); assert.deepEqual(s.snapshot().cooking, before.cooking); assert.deepEqual(s.snapshot().timers, before.timers); const restored = TestSession.restore(project, 1, s.snapshot()); assert.deepEqual(restored.snapshot().cooking, before.cooking); assert.deepEqual(restored.snapshot().timers, before.timers);
    });
    await check('A recipe started by a rule participates in the same atomic batch', () => {
      const p = fixture(); p.rules = [rule({ trigger: 'interact', targetObjectId: 'pot', actions: [{ type: 'startRecipe', objectId: 'pot', recipeId: 'meal-recipe' }, { type: 'giveItem', itemDefinitionId: 'meal' }] })]; const s = session(parseProject(p)); put(s, 'a'); put(s, 'b'); for (const id of ['paper', 'paper-2', 'paper-3']) s.takeObject(id); const before = s.snapshot(); assert.throws(() => s.interactObject('pot', false), /свободной/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Container access failure after ordinary rule effects also rolls back the whole batch', () => {
      const p = fixture(); p.rules = [rule({ trigger: 'interact', targetObjectId: 'pot', actions: [{ type: 'setFlag', key: 'reaction', value: 'partial' }] })]; const s = session(parseProject(p)); s.setPose([.3, 1.65, .3], 0, 0); const before = s.snapshot(); assert.throws(() => s.interactObject('pot', false), /ближе/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Restoring rejects overfilled/wrong-tag contents, duplicated or missing ingredients, timers and mismatched tags', () => {
      const p = fixture(), s = session(p); put(s, 'paper', 'bin'); const bad = s.snapshot(); bad.items['instance-paper-2'].owner = { type: 'container', objectId: 'bin' }; bad.objects['paper-2'].present = false; assert.throws(() => parseGameState(bad, p), /переполнен/); const tags = s.snapshot(); tags.items['instance-paper'].definitionId = 'document'; assert.throws(() => parseGameState(tags, p), /не подходит/);
      p.recipes[0].durationSeconds = 30; const project = parseProject(p), cooking = session(project); put(cooking, 'multi'); put(cooking, 'a'); cooking.cook('pot', 'meal-recipe'); for (const mutation of [x => x.cooking.pot.ingredientIds.push(x.cooking.pot.ingredientIds[0]), x => x.timers.splice(0), x => x.items['instance-a'].definitionId = 'b', x => x.cooking.pot.recipeId = 'missing', x => x.objects.pot.state.cookingState = 'ready']) { const state = cooking.snapshot(); mutation(state); assert.throws(() => TestSession.restore(project, 1, state)); }
    });
    await check('Project validation protects new references and context-bound item actions', () => {
      const p = fixture(); for (const action of [{ type: 'putUsedItem', objectId: 'guard' }, { type: 'startRecipe', objectId: 'bin', recipeId: 'meal-recipe' }, { type: 'replaceUsedItem', itemDefinitionId: 'missing' }]) assert.throws(() => parseProject({ ...p, rules: [rule({ actions: [action] })] })); assert.throws(() => parseProject({ ...p, rules: [rule({ trigger: 'enter', actions: [{ type: 'consumeUsedItem' }] })] })); const legacy = parseProject({ ...p, recipes: [{ ...p.recipes[0], ingredientTags: [] }] }), empty = session(legacy), before = empty.snapshot(); assert.throws(() => empty.cook('pot', 'meal-recipe'), /не заданы ингредиенты/); assert.deepEqual(empty.snapshot(), before);
    });
    await check('Copying a container remaps its bound recipes and all related recipe/put actions', () => {
      const p = fixture(); p.rules = [rule({ targetObjectId: 'pot', actions: [{ type: 'putUsedItem', objectId: 'pot' }, { type: 'startRecipe', objectId: 'pot', recipeId: 'meal-recipe' }] })]; const project = parseProject(p), result = pasteObjects(project, copyObjects(project, ['pot']), 'apartment'), objectId = result.ids[0], copied = result.project.recipes.find(r => r.containerObjectId === objectId), copiedRule = result.project.rules.find(r => r.targetObjectId === objectId); assert.ok(copied); assert.notEqual(copied.id, 'meal-recipe'); assert.equal(copiedRule.actions[0].objectId, objectId); assert.equal(copiedRule.actions[1].recipeId, copied.id); assert.equal(copiedRule.actions[1].objectId, objectId); assert.throws(() => deleteObject(project, 'pot')); assert.equal(project.objects.some(o => o.id === 'pot'), true);
    });
    await check('Containers remain in their original location and retain exact contents after travel/restore', () => {
      const p = fixture(), s = session(p); put(s, 'paper', 'bin'); s.setFlag('doorOpen', true); s.transitionThrough('door'); const before = s.snapshot(); assert.throws(() => s.takeFromContainer('bin', 'instance-paper'), /недоступен/); assert.deepEqual(s.snapshot(), before); const restored = TestSession.restore(p, 1, before); assert.deepEqual(restored.snapshot().items['instance-paper'].owner, { type: 'container', objectId: 'bin' });
    });
  } else {
    const origin = process.argv[originIndex + 1], realFetch = globalThis.fetch, api = (route, options) => realFetch(new URL(route, origin), options);
    const initial = await (await api('/api/project')).json(); let current = initial;
    const save = async project => { const r = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: current.revision }) }); assert.equal(r.status, 200, await r.clone().text()); current = await r.json(); };
    try {
      await check('D1 round trip retains exact/tag rules, container settings and recipes; loaded author data runs item use', async () => { const p = fixture(); p.rules = [rule({ targetObjectId: 'bin', itemTag: 'trash', actions: [{ type: 'putUsedItem', objectId: 'bin' }] })]; await save(parseProject(p)); const reopened = await (await api('/api/project')).json(); assert.deepEqual(reopened, current); const s = new TestSession(reopened.project, reopened.revision); s.setPose([3, 1.65, 3.6], 0, 0); s.takeObject('paper'); s.interactObject('bin'); assert.equal(s.snapshot().items['instance-paper'].owner.type, 'container'); });
      await check('Backup restore retains item-use reasons, selectors/actions, ingredient multiplicity and bound recipes', async () => { globalThis.fetch = (url, options) => realFetch(new URL(url, origin), options); const backup = await parseBackup(new File([JSON.stringify(await createBackup(current.project))], 'stage6.json')); assert.deepEqual(await restoreBackup(backup), current.project); });
      await check('Server rejects invalid recipe references without altering the saved author project', async () => { const project = structuredClone(current.project); project.recipes[0].containerObjectId = 'missing'; const response = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: current.revision }) }); assert.equal(response.status, 422); assert.deepEqual(await (await api('/api/project')).json(), current); });
    } finally { globalThis.fetch = realFetch; current = await (await api('/api/project')).json(); await save(initial.project); assert.deepEqual((await (await api('/api/project')).json()).project, initial.project); console.log('PASS Original local author project restored after item interaction HTTP checks'); passed++; }
  }
  console.log('Item interaction checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
