import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
const root = process.cwd(), output = path.join(root, '.sites-runtime', 'inventory-check-' + process.pid);
const modules = ['editor/deletion', 'engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'editor/spatial-operations', 'editor/scenario-dependencies', 'player/location-scene', 'player/object-lights', 'player/assets', 'player/asset-loading', 'player/resource-pool', 'player/picking', 'player/billboard', 'player/room-geometry', 'storage/asset-format', 'storage/client', 'storage/backup'];
let passed = 0; const originIndex = process.argv.indexOf('--origin');
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
  const { TestSession } = await load('engine/session');
  const { parseGameState } = await load('engine/game-state');
  const { evaluateCondition, effectiveTraitValue } = await load('engine/conditions');
  const { droppedObjectId, inventoryCapacity } = await load('engine/inventory');
  const { createLocation } = await load('editor/spatial-operations');
  const { LocationScene } = await load('player/location-scene');
  const { pickTarget } = await load('player/picking');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  function fixture() {
    const created = createLocation(createSampleProject(), 'Коридор', 4, 4, 3), p = created.project;
    p.objects.find(o => o.id === 'pot').interaction.reach = 10;
    const paper = p.objects.find(o => o.id === 'paper');
    p.character.stats = [{ id: 'strength', name: 'Сила', initial: 4, min: 0, max: 10 }];
    p.character.skills = [{ id: 'speech', name: 'Речь', initial: 3, min: 0, max: 10 }];
    p.items.push({ ...structuredClone(p.items[0]), id: 'coat', name: 'Пальто', description: 'Пальто с двумя карманами.', equipmentSlot: 'torso', capacityBonus: 2, modifiers: { strength: 2, speech: -.1 } }, { ...structuredClone(p.items[0]), id: 'light-coat', name: 'Лёгкое пальто', equipmentSlot: 'torso', capacityBonus: 0, modifiers: {} }, { ...structuredClone(p.items[0]), id: 'hat', name: 'Шляпа', equipmentSlot: 'head', capacityBonus: 1, modifiers: { strength: .1 } });
    p.objects.push(...['coat', 'light-coat', 'hat', 'paper-2', 'paper-3', 'paper-4', 'paper-5'].map((id, index) => ({ ...structuredClone(paper), id, name: id, transform: { ...paper.transform, position: [1 + index * .25, 0, 2] }, interaction: { ...paper.interaction, itemDefinitionId: id.startsWith('paper') ? 'paper-item' : id } })));
    p.objects.find(o => o.id === 'door').transition = { locationId: created.id, position: [2, 1.65, 2], yaw: 0 };
    p.objects.push({ ...structuredClone(p.objects[0]), id: 'return', locationId: created.id, transform: { position: [3.5, 0, 2], rotation: [0, 0, 0], scale: [1, 2, 1] }, transition: { locationId: 'apartment', position: [3, 1.65, 3.5], yaw: 0 } });
    return { project: parseProject(p), corridorId: created.id };
  }
  if (originIndex < 0) {
    await check('Selection stays in range; empty slots cannot drop a phantom item', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.selectSlot(2); assert.equal(s.snapshot().player.activeSlot, 2); const before = s.snapshot(); for (const slot of [-1, 3, 1.5]) assert.throws(() => s.selectSlot(slot)); assert.throws(() => s.dropItem(), /пуста/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Pickup, drop and repick retain exactly one instance and do not mutate the author project', () => {
      const { project } = fixture(), s = new TestSession(project, 1), authored = JSON.stringify(project); s.takeObject('paper'); const count = Object.keys(s.snapshot().items).length; s.dropItem();
      const drop = s.worldObject(droppedObjectId('instance-paper')); assert.ok(drop); assert.equal(s.visibleObjects().some(o => o.id === 'paper'), false); assert.equal(drop.notes, project.items[0].description);
      for (let i = 0; i < 10; i++) { s.takeObject(drop.id); assert.throws(() => s.takeObject(drop.id)); s.dropItem(); }
      assert.equal(Object.keys(s.snapshot().items).length, count); assert.equal(JSON.stringify(project), authored); assert.equal(s.snapshot().player.inventory.filter(Boolean).length, 0); parseGameState(s.snapshot(), project);
    });
    await check('Dropped positions survive a door round trip and snapshot restore without reviving the original object', () => {
      const { project, corridorId } = fixture(), s = new TestSession(project, 2); s.takeObject('paper'); s.transitionThrough('door'); s.dropItem(); const owner = s.snapshot().items['instance-paper'].owner; s.transitionThrough('return'); assert.equal(s.worldObject(droppedObjectId('instance-paper')), undefined);
      s.transitionThrough('door'); const restored = TestSession.restore(project, 2, s.snapshot()); assert.equal(restored.locationId(), corridorId); assert.deepEqual(restored.worldObject(droppedObjectId('instance-paper')).transform.position, owner.position); restored.takeObject(droppedObjectId('instance-paper')); assert.equal(restored.snapshot().items['instance-paper'].owner.type, 'inventory'); assert.equal(restored.snapshot().objects.paper.present, false);
    });
    await check('Script-given items can be dropped and repicked without requiring an authored world object', () => {
      const { project } = fixture(); project.rules = [{ id: 'gift', name: 'Подарок', trigger: 'interact', targetObjectId: 'pot', itemDefinitionId: null, itemTag: null, priority: 0, condition: null, actions: [{ type: 'giveItem', itemDefinitionId: 'hat' }], once: true }];
      const s = new TestSession(parseProject(project), 1); s.interactObject('pot', false); const id = s.snapshot().player.inventory[0]; s.dropItem(id); const drop = s.worldObject(droppedObjectId(id)); assert.equal(drop.name, 'Шляпа'); s.takeObject(drop.id); s.interactObject('pot', false); assert.equal(s.snapshot().player.inventory.filter(Boolean).length, 1);
    });
    await check('Equipping adds capacity and effective bonuses while preserving base traits and item identity', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('coat'); const before = s.snapshot().player.stats.strength; s.equip('instance-coat', 'torso'); const state = s.snapshot(); assert.equal(state.player.inventory.length, 5); assert.equal(state.player.equipment.torso, 'instance-coat'); assert.equal(state.items['instance-coat'].owner.type, 'equipment'); assert.equal(state.player.stats.strength, before); assert.equal(effectiveTraitValue(project, state, 'stats', 'strength'), 6); assert.equal(effectiveTraitValue(project, state, 'skills', 'speech'), 2.9);
      assert.equal(evaluateCondition({ type: 'compare', source: 'inventory', key: 'coat', field: 'equipment', operator: 'eq', value: 1 }, state, project), true); assert.equal(evaluateCondition({ type: 'compare', source: 'inventory', key: 'coat', field: 'inventory', operator: 'eq', value: 0 }, state, project), true);
    });
    await check('Incompatible slots, non-clothing and already equipped instances fail atomically', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('coat'); s.takeObject('paper'); const before = s.snapshot(); assert.throws(() => s.equip('instance-coat', 'head'), /не подходит/); assert.throws(() => s.equip('instance-paper', 'torso'), /не подходит/); assert.deepEqual(s.snapshot(), before); s.equip('instance-coat', 'torso'); const worn = s.snapshot(); assert.throws(() => s.equip('instance-coat', 'torso'), /инвентаря/); assert.deepEqual(s.snapshot(), worn);
    });
    await check('A full expanded inventory blocks removal and smaller replacement without losing items or bonuses', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('coat'); s.equip('instance-coat', 'torso'); for (const id of ['light-coat', 'paper', 'paper-2', 'paper-3', 'paper-4']) s.takeObject(id); const before = s.snapshot(); assert.throws(() => s.unequip('torso'), /не хватает|нет свободной/); assert.throws(() => s.equip('instance-light-coat', 'torso'), /не хватает/); assert.deepEqual(s.snapshot(), before); assert.equal(effectiveTraitValue(project, s.snapshot(), 'stats', 'strength'), 6);
    });
    await check('Shrinking packs overflow into free slots, repairs owners and preserves the selected instance', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('coat'); s.equip('instance-coat', 'torso'); for (const id of ['paper', 'paper-2', 'paper-3', 'paper-4', 'paper-5']) s.takeObject(id); s.selectSlot(4); for (const id of ['instance-paper', 'instance-paper-2', 'instance-paper-3']) s.dropItem(id); s.unequip('torso'); const state = s.snapshot(); assert.equal(state.player.inventory.length, 3); assert.equal(state.player.inventory[state.player.activeSlot], 'instance-paper-5'); assert.equal(state.player.inventory.filter(Boolean).length, 3); assert.equal(state.player.equipment.torso, null); parseGameState(state, project);
    });
    await check('Replacement returns old clothing to inventory and several equipped bonuses compose', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('coat'); s.equip('instance-coat', 'torso'); s.takeObject('hat'); s.equip('instance-hat', 'head'); assert.equal(inventoryCapacity(project, s.snapshot()), 6); assert.equal(effectiveTraitValue(project, s.snapshot(), 'stats', 'strength'), 6.1);
      s.takeObject('light-coat'); s.equip('instance-light-coat', 'torso'); const state = s.snapshot(); assert.equal(state.player.inventory.length, 4); assert.equal(state.items['instance-coat'].owner.type, 'inventory'); assert.equal(state.player.equipment.torso, 'instance-light-coat'); assert.equal(effectiveTraitValue(project, state, 'stats', 'strength'), 4.1); parseGameState(state, project);
    });
    await check('Repeated dressing never accumulates bonus or float drift in base stats', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('hat'); for (let i = 0; i < 30; i++) { s.equip('instance-hat', 'head'); assert.equal(effectiveTraitValue(project, s.snapshot(), 'stats', 'strength'), 4.1); s.unequip('head'); } assert.equal(s.snapshot().player.stats.strength, 4); assert.equal(s.snapshot().player.inventory.length, 3);
    });
    await check('Worn bonuses immediately affect visibility and rule conditions', () => {
      const { project } = fixture(); const condition = { type: 'compare', source: 'stat', key: 'strength', operator: 'gte', value: 6 }; project.objects.find(o => o.id === 'pot').visibleWhen = condition; project.rules = [{ id: 'strong', name: 'Сильный', trigger: 'interact', targetObjectId: 'door', itemDefinitionId: null, itemTag: null, priority: 0, condition, actions: [{ type: 'setFlag', key: 'awakened', value: true }], once: false }]; const s = new TestSession(parseProject(project), 1); assert.equal(s.worldObject('pot'), undefined); s.takeObject('coat'); s.equip('instance-coat', 'torso'); assert.ok(s.worldObject('pot')); s.interactObject('door', false); assert.equal(s.snapshot().flags.awakened, true); s.unequip('torso'); assert.equal(s.worldObject('pot'), undefined);
    });
    await check('Full inventory prevents repicking a dropped item, preserving its exact world position', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('paper'); s.dropItem(); for (const id of ['paper-2', 'paper-3', 'paper-4']) s.takeObject(id); const before = s.snapshot(); assert.throws(() => s.takeObject(droppedObjectId('instance-paper')), /свободной/); assert.deepEqual(s.snapshot(), before);
    });
    await check('Drop placement stops at room boundaries and cannot put an item through a wall', () => {
      const { project } = fixture(), s = new TestSession(project, 1); s.takeObject('paper'); s.setPose([.23, 1.65, 2], Math.PI / 2, 0); s.dropItem(); const position = s.snapshot().items['instance-paper'].owner.position; assert.ok(position[0] >= .22); assert.equal(position[1], 0); assert.equal(s.worldObject(droppedObjectId('instance-paper')).locationId, 'apartment');
    });
    await check('Malformed capacity or incompatible ownership cannot be restored and legacy world owners default safely', () => {
      const { project } = fixture(), s = new TestSession(project, 1), state = s.snapshot(); state.player.inventory.push(null); assert.throws(() => TestSession.restore(project, 1, state), /Вместимость/); const incomplete = s.snapshot(); delete incomplete.player.equipment.head; assert.throws(() => TestSession.restore(project, 1, incomplete), /неполное/); const incompatible = s.snapshot(); incompatible.items['instance-paper'].owner = { type: 'equipment', slot: 'head' }; incompatible.player.equipment.head = 'instance-paper'; assert.throws(() => TestSession.restore(project, 1, incompatible), /не подходит/);
      const legacy = s.snapshot(); for (const item of Object.values(legacy.items)) if (item.owner.type === 'world') delete item.owner.dropped; const restored = TestSession.restore(project, 1, legacy); assert.equal(restored.snapshot().items['instance-paper'].owner.dropped, false);
    });
    await check('Dynamic dropped sprites use actual Three geometry, can be targeted and disappear after repick', async () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'document'); const { project } = fixture(), s = new TestSession(project, 1); let scene;
      Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) }) } });
      try { scene = new LocationScene(project.locations[0], project.objects.filter(o => o.locationId === 'apartment'), '#e8e1d7'); await scene.load(); s.takeObject('paper'); s.dropItem(); await scene.syncObjects(s.visibleObjects()); const object = s.worldObject(droppedObjectId('instance-paper')); const camera = new THREE.PerspectiveCamera(65, 1, .05, 160); camera.position.set(...s.pose().position); camera.lookAt(object.transform.position[0], .225, object.transform.position[2]); camera.updateMatrixWorld(); scene.align(camera); assert.equal(pickTarget(camera, scene.sprites, scene.occluders, new THREE.Raycaster()).objectId, object.id); s.takeObject(object.id); await scene.syncObjects(s.visibleObjects()); assert.equal(scene.drawables.get(object.id).root.visible, false); scene.dispose(); assert.equal(scene.sprites.length, 0); }
      finally { scene?.dispose(); if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; }
    });
  } else {
    const origin = process.argv[originIndex + 1], realFetch = globalThis.fetch, api = (route, options) => realFetch(new URL(route, origin), options);
    const response = await api('/api/project'); assert.equal(response.status, 200); const initial = await response.json(); let current = initial;
    const save = async project => { const r = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: current.revision }) }); assert.equal(r.status, 200, await r.clone().text()); current = await r.json(); };
    try {
      await check('D1 save/read retains clothing definition, slots, capacity and modifiers for a new independent session', async () => { const { project } = fixture(); await save(project); const reopened = await (await api('/api/project')).json(); assert.deepEqual(reopened, current); const s = new TestSession(reopened.project, reopened.revision); s.takeObject('coat'); s.equip('instance-coat', 'torso'); s.takeObject('paper'); s.dropItem(); assert.equal(s.snapshot().player.inventory.length, 5); assert.equal(effectiveTraitValue(reopened.project, s.snapshot(), 'stats', 'strength'), 6); assert.equal(s.worldObject(droppedObjectId('instance-paper')).name, 'Смятая бумага'); });
      await check('Backup restore preserves item descriptions, equipment settings and links without saving test mutations', async () => { globalThis.fetch = (url, options) => realFetch(new URL(url, origin), options); const backup = await parseBackup(new File([JSON.stringify(await createBackup(current.project))], 'stage5.json')); assert.deepEqual(await restoreBackup(backup), current.project); assert.equal((await (await api('/api/project')).json()).project.objects.find(o => o.id === 'paper').interaction.canTake, true); });
    } finally { globalThis.fetch = realFetch; current = await (await api('/api/project')).json(); await save(initial.project); assert.deepEqual((await (await api('/api/project')).json()).project, initial.project); console.log('PASS Original local author project restored after inventory HTTP checks'); passed++; }
  }
  console.log('Inventory checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
