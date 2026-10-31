import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'scenario-check-' + process.pid);
const modules = ['editor/deletion', 'engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'editor/spatial-operations', 'editor/scenario-dependencies', 'editor/script-operations', 'editor/scenario-dependencies', 'editor/rich-text', 'editor/history', 'storage/asset-format', 'storage/client', 'storage/backup'];
const originIndex = process.argv.indexOf('--origin');
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
try {
  for (const module of [...modules, 'rich-paragraph']) {
    const sourcePath = module === 'rich-paragraph' ? 'components/player/rich-paragraph.tsx' : 'lib/' + module + '.ts';
    const source = await fs.readFile(path.join(root, sourcePath), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, name) => 'from ' + quote + name + '.mjs' + quote);
    const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, compiled);
  }
  const load = name => import(pathToFileURL(path.join(output, name + '.mjs')).href);
  const { parseProject } = await load('engine/project');
  const { createSampleProject } = await load('engine/sample-project');
  const { TestSession } = await load('engine/session');
  const { parseGameState } = await load('engine/game-state');
  const { evaluateCondition, conditionResult } = await load('engine/conditions');
  const { collisionWorld } = await load('engine/spatial');
  const { createLocation, duplicateLocation } = await load('editor/spatial-operations');
  const { createScript, duplicateScript, deleteScript, addNode, deleteNode } = await load('editor/script-operations');
  const { textOf, toggleMark, replaceText, marksAt } = await load('editor/rich-text');
  const { DraftHistory } = await load('editor/history');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  const { RichParagraph } = await load('rich-paragraph');
  const compare = (source, key, value, operator = 'eq', field) => ({ type: 'compare', source, key, value, operator, ...(field ? { field } : {}) });
  const paragraph = text => ({ spans: [{ text, marks: [] }], audioAssetId: null });
  const choice = (id, nextNodeId = null, actions = [], condition = null) => ({ id, label: id, nextNodeId, actions, condition, unavailableReason: '', checkId: null });
  const rule = (id, targetObjectId, actions, overrides = {}) => ({ id, name: id, trigger: 'interact', targetObjectId, itemDefinitionId: null, itemTag: null, priority: 0, condition: null, actions, once: false, ...overrides });
  function fixture() {
    const created = createLocation(createSampleProject(), 'Коридор', 4, 4, 3), p = created.project, corridorId = created.id;
    p.flags = { awakened: false, unlocked: false, stage: 0, text: 'нет', empty: null };
    p.character.stats = [{ id: 'will', name: 'Воля', initial: 4, min: 0, max: 10 }];
    p.character.skills = [{ id: 'talk', name: 'Речь', initial: 3, min: 0, max: 10 }];
    p.character.statuses = [{ id: 'tired', name: 'Усталость', description: '', initiallyActive: true }];
    p.quests = [{ id: 'quest', name: 'Задача', stages: [{ id: 'first', name: 'Начало' }, { id: 'second', name: 'Дальше' }], initialStageId: 'first' }];
    p.assets = [{ id: 'voice', name: 'Голос', kind: 'audio', mime: 'audio/wav', bytes: 46, sha256: '0'.repeat(64) }];
    p.objects.find(o => o.id === 'door').transition = { locationId: corridorId, position: [2, 1.65, 2], yaw: .5 };
    p.objects.find(o => o.id === 'pot').interaction.scriptId = 'talk-scene';
    p.objects.find(o => o.id === 'pot').initialState = { done: false };
    p.objects.push({ ...structuredClone(p.objects[0]), id: 'corridor-npc', kind: 'npc', name: 'Персонаж коридора', locationId: corridorId, transition: null, transform: { position: [1, 0, 1], scale: [1, 2, 1], rotation: [0, 0, 0] } });
    p.scripts = [
      { id: 'wake', name: 'Пробуждение', entryNodeId: 'wake-entry', nodes: [
        { id: 'wake-entry', paragraphs: [paragraph('Первый абзац.'), paragraph('Второй абзац.')], choices: [choice('wake-up', 'wake-end', [{ type: 'setFlag', key: 'awakened', value: true }])] },
        { id: 'wake-end', paragraphs: [paragraph('Герой встал.')], choices: [] },
      ] },
      { id: 'talk-scene', name: 'Разговор', entryNodeId: 'talk-entry', nodes: [
        { id: 'talk-entry', paragraphs: [{ spans: [{ text: 'Дверь ', marks: ['bold'] }, { text: 'закрыта?', marks: ['italic', 'underline', 'strike'] }], audioAssetId: 'voice' }], choices: [
          choice('unlock', 'talk-end', [{ type: 'setFlag', key: 'unlocked', value: true }], { type: 'not', condition: compare('flag', 'unlocked', true) }),
          { ...choice('go', null, [{ type: 'transition', locationId: corridorId }], compare('flag', 'unlocked', true)), unavailableReason: 'Сначала открой дверь.' },
        ] },
        { id: 'talk-end', paragraphs: [paragraph('Дверь открыта.')], choices: [] },
      ] },
    ];
    p.settings.startScriptId = 'wake';
    return { project: parseProject(p), corridorId };
  }
  if (originIndex < 0) {
    await check('Conditional entries select by priority, NOT, stable ties, fallback and explicit transitions', async () => {
      const { openScene } = await load('engine/scenarios');
      const { project } = fixture(), script = project.scripts[0];
      const original = JSON.stringify(project);
      assert.equal(JSON.stringify(parseProject(project)), original);
      script.nodes.push({ id: 'conditional-a', paragraphs: [paragraph('A')], choices: [], entryCondition: compare('flag', 'unlocked', true), entryPriority: 10 });
      script.nodes.push({ id: 'conditional-b', paragraphs: [paragraph('B')], choices: [], entryCondition: { type: 'not', condition: compare('flag', 'unlocked', true) }, entryPriority: 5 });
      const parsed = parseProject(project), state = new TestSession(parsed, 1).snapshot();
      openScene(parsed, state, script.id); assert.equal(state.interaction.nodeId, 'conditional-b');
      state.flags.unlocked = true; openScene(parsed, state, script.id); assert.equal(state.interaction.nodeId, 'conditional-a');
      openScene(parsed, state, script.id, 'wake-end'); assert.equal(state.interaction.nodeId, 'wake-end');
      parsed.scripts[0].nodes[3].entryCondition = { type: 'literal', value: true }; parsed.scripts[0].nodes[3].entryPriority = 10;
      openScene(parsed, state, script.id); assert.equal(state.interaction.nodeId, 'conditional-a');
      parsed.scripts[0].nodes[2].entryCondition = parsed.scripts[0].nodes[3].entryCondition = { type: 'literal', value: false };
      openScene(parsed, state, script.id); assert.equal(state.interaction.nodeId, 'wake-entry');
      const invalid = structuredClone(parsed); invalid.scripts[0].nodes[2].entryCondition = compare('flag', 'missing-flag', true);
      assert.throws(() => parseProject(invalid));
      assert.deepEqual(parseProject(parsed).scripts[0].nodes[2].entryCondition, { type: 'literal', value: false });
      const copy = duplicateScript(parsed, script.id); assert.deepEqual(copy.project.scripts.find(s => s.id === copy.id).nodes[2].entryCondition, { type: 'literal', value: false });
    });
    await check('Nested AND/OR/NOT evaluate strict scalars and distinguish missing fields from null', () => {
      const { project } = fixture(), state = new TestSession(project, 1).snapshot();
      const condition = { type: 'all', conditions: [compare('stat', 'will', 4, 'gte'), { type: 'any', conditions: [compare('flag', 'awakened', true), { type: 'not', condition: compare('flag', 'unlocked', true) }] }] };
      assert.equal(evaluateCondition(condition, state), true);
      assert.equal(evaluateCondition(compare('flag', 'stage', '0'), state), false);
      assert.equal(evaluateCondition(compare('flag', 'empty', null), state), true);
      assert.equal(evaluateCondition(compare('object', 'pot', null, 'eq', 'missing'), state), false);
      assert.equal(evaluateCondition(compare('flag', 'awakened', false, 'gte'), state), false);
      assert.ok(conditionResult(compare('stat', 'will', 5, 'gt'), project, state).reason.includes('Воля'));
    });
    await check('All condition sources include object fields, quest completion and scoped item ownership', () => {
      const { project } = fixture(), state = new TestSession(project, 1).snapshot();
      for (const c of [compare('skill', 'talk', 3), compare('status', 'tired', true), compare('quest', 'quest', 'first'), compare('quest', 'quest', false, 'eq', 'completed'), compare('object', 'pot', true), compare('object', 'pot', false, 'eq', 'done'), compare('time', 'worldSeconds', 7 * 3600), compare('time', 'playedSeconds', 0), compare('inventory', 'paper-item', 0)]) assert.equal(evaluateCondition(c, state), true);
      project.items[0].equipmentSlot = 'head';
      state.items['instance-paper'].owner = { type: 'equipment', slot: 'head' }; state.player.equipment.head = 'instance-paper';
      parseGameState(state, project);
      assert.equal(evaluateCondition(compare('inventory', 'paper-item', 1), state), true);
      assert.equal(evaluateCondition(compare('inventory', 'paper-item', 1, 'eq', 'equipment'), state), true);
      assert.equal(evaluateCondition(compare('inventory', 'paper-item', 0, 'eq', 'inventory'), state), true);
    });
    await check('Startup reveals paragraphs incrementally, blocks early answers and runs once', () => {
      const { project } = fixture(), session = new TestSession(project, 1), authored = JSON.stringify(project);
      session.start(); assert.equal(session.snapshot().interaction.paragraph, 1); assert.deepEqual(session.choices(), []);
      const before = session.snapshot(); assert.throws(() => session.choose('wake-up'), /дочитайте/); assert.deepEqual(session.snapshot(), before);
      session.nextParagraph(); session.choose('wake-up');
      assert.equal(session.snapshot().flags.awakened, true); assert.equal(session.snapshot().interaction.nodeId, 'wake-end');
      assert.equal(session.snapshot().interaction.transcript.length, 4); assert.equal(session.snapshot().interaction.transcript[2].type, 'choice');
      session.start(); assert.equal(session.snapshot().interaction.nodeId, 'wake-end');
      session.finishInteraction(); session.start(); assert.equal(session.hasInteraction(), false); assert.equal(JSON.stringify(project), authored);
    });
    await check('Direct scene preview overrides awakening while another location skips the global start scene', () => {
      const { project, corridorId } = fixture(), other = new TestSession(project, 1, corridorId); other.start(); assert.equal(other.hasInteraction(), false);
      const preview = new TestSession(project, 1, undefined, { startScriptId: 'talk-scene' }); preview.start(); assert.equal(preview.snapshot().interaction.scriptId, 'talk-scene');
    });
    await check('The same scene changes available branches after a flag changes and reports the authored reason', () => {
      const { project, corridorId } = fixture(), session = new TestSession(project, 1, undefined, { startScriptId: null });
      session.start(); assert.equal(session.interactObject('pot', false), 'scene');
      assert.deepEqual(session.choices().map(c => c.allowed), [true, false]); assert.equal(session.choices()[1].reason, 'Сначала открой дверь.');
      const before = session.snapshot(); assert.throws(() => session.choose('go'), /открой/); assert.deepEqual(session.snapshot(), before);
      session.choose('unlock'); session.finishInteraction(); session.interactObject('pot', false);
      assert.deepEqual(session.choices().map(c => c.allowed), [false, true]); session.choose('go'); assert.equal(session.locationId(), corridorId); assert.equal(session.hasInteraction(), false);
    });
    await check('Text, menu and hidden-tab pauses preserve clock and current position until the last reason clears', () => {
      const { project } = fixture(), session = new TestSession(project, 1); session.start(); session.nextParagraph();
      session.pause('menu'); session.pause('hidden'); const before = session.snapshot(); session.tick(100); assert.deepEqual(session.snapshot(), before);
      session.resume('hidden'); session.resume('menu'); session.tick(100); assert.equal(session.snapshot().interaction.paragraph, 2); assert.equal(session.snapshot().clock.worldSeconds, before.clock.worldSeconds);
      session.pause('menu'); session.choose('wake-up'); session.finishInteraction(); session.tick(100); assert.equal(session.isPaused(), true);
      session.resume('menu'); session.tick(2); assert.equal(session.isPaused(), false); assert.equal(session.snapshot().clock.playedSeconds, 2);
    });
    await check('Restoring a snapshot preserves reading progress, transcript, flags and once markers without replay', () => {
      const { project } = fixture(); project.rules = [rule('start-once', null, [{ type: 'giveItem', itemDefinitionId: 'paper-item' }], { trigger: 'enter', once: true })];
      const session = new TestSession(parseProject(project), 7); session.start(); session.nextParagraph();
      const saved = JSON.parse(JSON.stringify(session.snapshot())), restored = TestSession.restore(project, 7, saved); restored.start();
      assert.deepEqual(restored.snapshot(), saved); restored.choose('wake-up'); assert.equal(restored.snapshot().flags.awakened, true);
      assert.equal(restored.snapshot().player.inventory.filter(Boolean).length, 1); assert.throws(() => TestSession.restore(project, 8, saved), /другой версии/);
      const damaged = structuredClone(saved); damaged.interaction.transcript[0].index = 100; assert.throws(() => TestSession.restore(project, 7, damaged), /История/);
    });
    await check('Visibility updates live obstacles and gates NPCs, doors and item pickup separately', () => {
      const { project } = fixture(); project.settings.startScriptId = null;
      project.objects.find(o => o.id === 'pot').visibleWhen = compare('flag', 'unlocked', true);
      project.objects.find(o => o.id === 'pot').collision = { solid: true, radius: .4 };
      for (const id of ['door', 'paper']) Object.assign(project.objects.find(o => o.id === id).interaction, { condition: compare('flag', 'unlocked', true), unavailableReason: 'Нужен ключ.' });
      const session = new TestSession(parseProject(project), 1); session.start();
      assert.equal(session.visibleObjects().some(o => o.id === 'pot'), false); assert.equal(collisionWorld(project.locations[0], session.visibleObjects()).obstacles.length, 0);
      const before = session.snapshot(); assert.throws(() => session.transitionThrough('door'), /Нужен ключ/); assert.throws(() => session.takeObject('paper'), /Нужен ключ/); assert.deepEqual(session.snapshot(), before);
      session.setFlag('unlocked', true); assert.equal(session.visibleObjects().some(o => o.id === 'pot'), true); assert.equal(collisionWorld(project.locations[0], session.visibleObjects()).obstacles.length, 1); session.takeObject('paper'); assert.equal(session.visibleObjects().some(o => o.id === 'paper'), false);
    });
    await check('Rules use descending priority, stable tie order and observe preceding effects', () => {
      const { project } = fixture(); project.settings.startScriptId = null;
      project.rules = [rule('late', 'door', [{ type: 'setFlag', key: 'stage', value: 9 }], { priority: -1 }), rule('first', 'door', [{ type: 'setFlag', key: 'stage', value: 1 }], { priority: 10 }), rule('second', 'door', [{ type: 'setFlag', key: 'unlocked', value: true }], { priority: 10, condition: compare('flag', 'stage', 1) })];
      const session = new TestSession(parseProject(project), 1); session.start(); session.interactObject('door', false);
      assert.equal(session.snapshot().flags.stage, 9); assert.equal(session.snapshot().flags.unlocked, true);
    });
    await check('One-time rules cannot duplicate a reward across repeated interactions or restored snapshots', () => {
      const { project } = fixture(); project.settings.startScriptId = null;
      project.rules = [rule('reward', 'door', [{ type: 'giveItem', itemDefinitionId: 'paper-item' }], { once: true })];
      const session = new TestSession(parseProject(project), 1); session.start(); session.interactObject('door', false); session.interactObject('door', false);
      const restored = TestSession.restore(project, 1, session.snapshot()); restored.interactObject('door', false);
      assert.equal(restored.snapshot().player.inventory.filter(Boolean).length, 1); assert.deepEqual(restored.snapshot().appliedRules, ['reward']);
    });
    await check('A failed action batch rolls back flags, transcript, earlier rewards and the once marker', () => {
      const { project } = fixture(); project.rules = [rule('overflow', 'door', [{ type: 'setFlag', key: 'unlocked', value: true }, ...Array.from({ length: 4 }, () => ({ type: 'giveItem', itemDefinitionId: 'paper-item' }))], { once: true })];
      const session = new TestSession(parseProject(project), 1, undefined, { startScriptId: null }); session.start(); const before = session.snapshot();
      assert.throws(() => session.interactObject('door', false), /свободной/); assert.deepEqual(session.snapshot(), before);
      project.rules = []; project.scripts[1].nodes[0].choices[0].actions = [{ type: 'setFlag', key: 'unlocked', value: true }, ...Array.from({ length: 4 }, () => ({ type: 'giveItem', itemDefinitionId: 'paper-item' }))];
      const conversation = new TestSession(parseProject(project), 1, undefined, { startScriptId: 'talk-scene' }); conversation.start(); const dialogue = conversation.snapshot(); assert.throws(() => conversation.choose('unlock'), /свободной/); assert.deepEqual(conversation.snapshot(), dialogue);
    });
    await check('Ordered actions update scalar state, presence, inventory, time, quest, status and audio metadata', () => {
      const { project } = fixture(); project.settings.startScriptId = null;
      project.rules = [rule('effects', 'door', [{ type: 'setFlag', key: 'stage', value: 5 }, { type: 'setObjectState', objectId: 'pot', key: 'done', value: true }, { type: 'setPresence', objectId: 'paper', present: false }, { type: 'giveItem', itemDefinitionId: 'paper-item' }, { type: 'advanceTime', seconds: 60 }, { type: 'setQuestStage', questId: 'quest', stageId: 'second' }, { type: 'setStatus', statusId: 'tired', active: false }, { type: 'playAudio', assetId: 'voice' }])];
      const session = new TestSession(parseProject(project), 1); session.start(); session.interactObject('door', false); const state = session.snapshot();
      assert.equal(state.flags.stage, 5); assert.equal(state.objects.pot.state.done, true); assert.equal(state.objects.paper.present, false); assert.equal(state.player.inventory.filter(Boolean).length, 1); assert.equal(state.clock.worldSeconds, 7 * 3600 + 60); assert.equal(state.clock.playedSeconds, 0); assert.equal(state.quests.quest.stageId, 'second'); assert.deepEqual(state.player.statuses, []); assert.equal(state.audio.events.at(-1).assetId, 'voice'); assert.equal(state.audio.interactionTrackId, null);
    });
    await check('An explicit scene action replaces the normal next fragment and retains the transcript', () => {
      const { project } = fixture(); project.scripts[0].nodes[0].choices[0].actions.push({ type: 'openScript', scriptId: 'talk-scene' });
      const session = new TestSession(parseProject(project), 1); session.start(); session.nextParagraph(); session.choose('wake-up');
      assert.equal(session.snapshot().interaction.scriptId, 'talk-scene'); assert.equal(session.snapshot().interaction.transcript.length, 4);
    });
    await check('Door preparation includes destination entry rules but commits only after load and merges current pauses', () => {
      const { project, corridorId } = fixture(); project.settings.startScriptId = null;
      project.rules = [rule('enter-corridor', 'corridor-npc', [{ type: 'setFlag', key: 'stage', value: 2 }, { type: 'openScript', scriptId: 'talk-scene' }], { trigger: 'enter', once: true })];
      const session = new TestSession(parseProject(project), 1); session.start(); session.pause('menu'); const before = session.snapshot(), prepared = session.prepareTransition('door');
      assert.deepEqual(session.snapshot(), before); assert.equal(prepared.state.locationId, corridorId); assert.equal(prepared.state.flags.stage, 2);
      session.pause('hidden'); session.commitTransition(prepared); assert.deepEqual(new Set(session.snapshot().clock.pausedBy), new Set(['menu', 'hidden', 'interaction'])); assert.equal(session.hasInteraction(), true);
    });
    await check('A stale prepared transition cannot overwrite a newer world state', () => {
      const { project } = fixture(), session = new TestSession(project, 1, undefined, { startScriptId: null }); session.start(); const prepared = session.prepareTransition('door'); session.setFlag('unlocked', true); const before = session.snapshot(); assert.throws(() => session.commitTransition(prepared), /изменилось/); assert.deepEqual(session.snapshot(), before);
    });
    await check('Chained entry transitions load the final location and cyclic entries roll back the whole choice', () => {
      const { project, corridorId } = fixture(), third = createLocation(project, 'Третья', 4, 4, 3); let p = third.project;
      p.rules = [rule('redirect', 'corridor-npc', [{ type: 'transition', locationId: third.id }], { trigger: 'enter' })];
      const session = new TestSession(parseProject(p), 1, undefined, { startScriptId: null }); session.start(); const prepared = session.prepareTransition('door'); assert.equal(prepared.state.locationId, third.id); session.commitTransition(prepared); assert.equal(session.locationId(), third.id);
      p.rules = [rule('to-a', 'corridor-npc', [{ type: 'transition', locationId: 'apartment' }], { trigger: 'enter' }), rule('to-b', 'door', [{ type: 'transition', locationId: corridorId }], { trigger: 'enter' })];
      const cycle = new TestSession(parseProject(p), 1, undefined, { startScriptId: 'talk-scene' }); cycle.openScript('talk-scene'); cycle.setFlag('unlocked', true); const before = cycle.snapshot(); assert.throws(() => cycle.choose('go'), /бесконечную/); assert.deepEqual(cycle.snapshot(), before);
    });
    await check('Legacy author data gets unconditional interaction defaults and new condition references are validated', () => {
      const { project } = fixture(); for (const object of project.objects) { delete object.interaction.condition; delete object.interaction.unavailableReason; }
      const parsed = parseProject(project); assert.equal(parsed.formatVersion, 1); assert.equal(parsed.objects[0].interaction.condition, null); assert.equal(parsed.objects[0].interaction.unavailableReason, '');
      parsed.objects[0].interaction.condition = compare('flag', 'missing', true); assert.throws(() => parseProject(parsed), /Флаг не найден/);
      parsed.objects[0].interaction.condition = compare('object', 'missing-object', true); assert.throws(() => parseProject(parsed), /отсутствующий/);
    });
    await check('Scene copying remaps node, choice and self-scene links while preserving external links', () => {
      const { project } = fixture(); project.scripts[0].nodes[0].choices[0].actions.push({ type: 'openScript', scriptId: 'wake' }, { type: 'openScript', scriptId: 'talk-scene' });
      const duplicated = duplicateScript(parseProject(project), 'wake'), copy = duplicated.project.scripts.find(s => s.id === duplicated.id);
      assert.notEqual(copy.entryNodeId, 'wake-entry'); assert.notEqual(copy.nodes[0].choices[0].id, 'wake-up'); assert.equal(copy.nodes[0].choices[0].nextNodeId, copy.nodes[1].id); assert.equal(copy.nodes[0].choices[0].actions[1].scriptId, copy.id); assert.equal(copy.nodes[0].choices[0].actions[2].scriptId, 'talk-scene');
      const spatialCopy = duplicateLocation(duplicated.project, 'apartment'); assert.ok(spatialCopy.project.scripts.length > duplicated.project.scripts.length);
    });
    await check('Deleting nodes repairs incoming links; deleting scenes clears attachments and protects external references', () => {
      const { project } = fixture(); const removedNode = deleteNode(project, 'wake', 'wake-end'); assert.equal(removedNode.scripts[0].nodes[0].choices[0].nextNodeId, null); assert.throws(() => deleteNode(removedNode, 'wake', 'wake-entry'), /хотя бы/);
      const removedScene = deleteScript(project, 'wake'); assert.equal(removedScene.settings.startScriptId, null);
      const removedTalk = deleteScript(project, 'talk-scene'); assert.equal(removedTalk.objects.find(o => o.id === 'pot').interaction.scriptId, null);
      const referenced = structuredClone(project); referenced.rules = [rule('reference', 'door', [{ type: 'openScript', scriptId: 'wake' }])]; assert.throws(() => deleteScript(parseProject(referenced), 'wake'), /отсутствующий/);
      const created = createScript(project), added = addNode(created.project, created.id), history = new DraftHistory(); history.record(project, added.project); assert.deepEqual(history.undo(added.project), project); assert.deepEqual(history.redo(project), added.project);
    });
    await check('Formatting selected text preserves other marks and typing uses the actual caret in repeated text', () => {
      const spans = [{ text: 'AB', marks: ['italic'] }, { text: 'AB', marks: [] }];
      const bold = toggleMark(spans, 1, 3, 'bold'); assert.equal(textOf(bold), 'ABAB'); assert.deepEqual(marksAt(bold, 1), ['bold', 'italic']); assert.deepEqual(marksAt(bold, 2), ['bold']);
      assert.deepEqual(toggleMark(bold, 1, 3, 'bold'), spans);
      const repeated = [{ text: 'a', marks: ['bold'] }, { text: 'aa', marks: ['italic'] }];
      const inserted = replaceText(repeated, 'aaaa', ['underline'], { start: 1, end: 1 }); assert.deepEqual(marksAt(inserted, 1), ['underline']); assert.deepEqual(marksAt(inserted, 2), ['italic']);
      const deleted = replaceText(repeated, 'aa', undefined, { start: 0, end: 1 }); assert.deepEqual(deleted, [{ text: 'aa', marks: ['italic'] }]);
      assert.equal(textOf(replaceText(spans, 'Зима ❄', ['strike'])), 'Зима ❄');
    });
    await check('Rich paragraph output supports all four marks and escapes user text as text', () => {
      const html = renderToStaticMarkup(createElement(RichParagraph, { paragraph: { spans: [{ text: '<img onerror="evil()">', marks: ['bold', 'italic', 'underline', 'strike'] }], audioAssetId: null } }));
      for (const tag of ['strong', 'em', 'u', 's']) assert.ok(html.includes('<' + tag + '>'));
      assert.ok(html.includes('&lt;img')); assert.equal(html.includes('<img'), false);
    });
  } else {
    const origin = process.argv[originIndex + 1], realFetch = globalThis.fetch;
    const api = (route, options) => realFetch(new URL(route, origin), options);
    const response = await api('/api/project'); assert.equal(response.status, 200); const initial = await response.json(); let current = initial;
    const save = async project => { const response = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: current.revision }) }); assert.equal(response.status, 200, await response.clone().text()); current = await response.json(); return current; };
    try {
      await check('Real D1 save/read preserves formatted text, branches, ordered actions, object bindings and awakening', async () => {
        const data = fixture(); data.project.assets = []; for (const node of data.project.scripts[1].nodes) for (const paragraph of node.paragraphs) paragraph.audioAssetId = null;
        data.project.objects.find(o => o.id === 'door').interaction.condition = compare('flag', 'unlocked', true);
        data.project.objects.find(o => o.id === 'door').interaction.unavailableReason = 'Дверь заперта.';
        data.project.rules = [rule('once-door', 'door', [{ type: 'advanceTime', seconds: 10 }, { type: 'setFlag', key: 'stage', value: 2 }], { once: true })];
        await save(parseProject(data.project)); const reopened = await (await api('/api/project')).json(); assert.deepEqual(reopened, current);
        const session = new TestSession(reopened.project, reopened.revision); session.start(); session.nextParagraph(); session.choose('wake-up'); session.finishInteraction(); assert.throws(() => session.interactObject('door', false), /заперта/);
        session.interactObject('pot', false); session.choose('unlock'); session.finishInteraction(); session.interactObject('door', false); session.interactObject('door', false); assert.equal(session.snapshot().clock.worldSeconds, 7 * 3600 + 10); assert.equal(session.snapshot().flags.stage, 2); session.transitionThrough('door'); assert.equal(session.locationId(), data.corridorId);
      });
      await check('Full backup and restore retain scenario graph, formatting and availability conditions', async () => {
        globalThis.fetch = (url, options) => realFetch(new URL(url, origin), options);
        const backup = await parseBackup(new File([JSON.stringify(await createBackup(current.project))], 'stage4.json')); assert.deepEqual(await restoreBackup(backup), current.project);
        const copied = duplicateScript(current.project, 'talk-scene'); await save(copied.project); assert.deepEqual((await (await api('/api/project')).json()).project, copied.project);
      });
    } finally {
      globalThis.fetch = realFetch; current = await (await api('/api/project')).json(); await save(initial.project); assert.deepEqual((await (await api('/api/project')).json()).project, initial.project); console.log('PASS Original local author project restored after scenario HTTP checks'); passed++;
    }
  }
  console.log('Scenario checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
