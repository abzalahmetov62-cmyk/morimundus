import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root = process.cwd();
const output = path.join(root, '.sites-runtime', 'space-check-' + process.pid);
const modules = ['editor/deletion', 'engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'editor/spatial-operations', 'editor/scenario-dependencies', 'editor/history', 'player/room-geometry', 'storage/asset-format', 'storage/client', 'storage/backup'];
const originIndex = process.argv.indexOf('--origin');
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, a + ' != ' + b);

try {
  for (const module of modules) {
    const source = await fs.readFile(path.join(root, 'lib', module + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, name) => 'from ' + quote + name + '.mjs' + quote);
    const file = path.join(output, module + '.mjs');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, compiled);
  }
  const load = module => import(pathToFileURL(path.join(output, module + '.mjs')).href);
  const { createSampleProject } = await load('engine/sample-project');
  const { parseProject } = await load('engine/project');
  const { parseGameState } = await load('engine/game-state');
  const { TestSession } = await load('engine/session');
  const { canStandAt, collisionWorld, movePlayer, assertArrival, presentObjects, buildWalls } = await load('engine/spatial');
  const { rectangle, createLocation, addRoom, addObject, setObjectKind, copyObjects, pasteObjects, duplicateLocation, deleteObject, deleteLocation, deleteRoom, createReturnDoor, spatialIssues } = await load('editor/spatial-operations');
  const { DraftHistory } = await load('editor/history');
  const { roomGeometry } = await load('player/room-geometry');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  const base = createSampleProject();
  function linked() {
    const created = createLocation(base, 'Коридор', 4, 4, 3);
    const destination = created.project.locations.find(l => l.id === created.id);
    const p = parseProject({ ...created.project, objects: created.project.objects.map(o => o.id === 'door' ? { ...o, transition: { locationId: destination.id, position: [...destination.spawn.position], yaw: .8 } } : o) });
    const returned = createReturnDoor(p, 'door');
    return { project: returned.project, destinationId: destination.id, returnId: returned.id };
  }
  function graph() {
    const p = createSampleProject();
    const condition = { type: 'all', conditions: [{ type: 'not', condition: { type: 'compare', source: 'object', key: 'pot', operator: 'eq', value: false } }] };
    const choice = (id, actions) => ({ id, label: 'Продолжить', nextNodeId: null, condition, unavailableReason: '', checkId: null, actions });
    p.scripts = [
      { id: 's-a', name: 'Осмотр', entryNodeId: 'n-a', nodes: [{ id: 'n-a', paragraphs: [], choices: [{ ...choice('c-a', [{ type: 'setPresence', objectId: 'pot', present: false }, { type: 'openScript', scriptId: 's-b' }]), nextNodeId: 'n-b' }] }, { id: 'n-b', paragraphs: [], choices: [] }] },
      { id: 's-b', name: 'Ответ', entryNodeId: 'n-c', nodes: [{ id: 'n-c', paragraphs: [], choices: [choice('c-b', [{ type: 'openScript', scriptId: 's-a' }])] }] },
    ];
    p.objects[0].interaction.scriptId = 's-a'; p.objects[1].visibleWhen = condition;
    p.rules = [{ id: 'r-a', name: 'Правило двери', trigger: 'interact', targetObjectId: 'door', itemDefinitionId: null, itemTag: null, priority: 1, condition, actions: [{ type: 'setObjectState', objectId: 'door', key: 'open', value: true }, { type: 'transition', locationId: 'apartment' }, { type: 'openScript', scriptId: 's-b' }], once: true }];
    p.schedules = [{ id: 'schedule-pot', objectId: 'pot', fromSeconds: 0, toSeconds: 20, present: false, condition }];
    return parseProject(p);
  }

  if (originIndex < 0) {
    await check('New locations retain the authored start and have valid independent rooms and spawns', () => {
      const before = JSON.stringify(base), a = createLocation(base, 'Вторая', 4, 3, 2.5), b = createLocation(a.project, 'Третья');
      assert.equal(b.project.settings.startLocationId, 'apartment'); assert.equal(b.project.locations.length, 3);
      assert.notEqual(a.id, b.id); assert.notEqual(b.project.locations[1].rooms[0].id, b.project.locations[2].rooms[0].id);
      assertArrival(a.project.locations[1], [], a.project.locations[1].spawn.position);
      assert.throws(() => createLocation(base, '', 4, 3, 2.5)); assert.throws(() => createLocation(base, 'Низкая', 4, 3, 1));
      assert.equal(JSON.stringify(base), before);
    });
    await check('Reverse drawing snaps to the grid and adjoining corridor remains walkable', () => {
      assert.deepEqual(rectangle({ x: 9, z: 3 }, { x: 6, z: 2 }), { x: 6, z: 2, width: 3, depth: 1 });
      const added = addRoom(base, 'apartment', { x: 9, z: 3 }, { x: 6, z: 2 });
      const world = collisionWorld(added.project.locations[0], []);
      const position = movePlayer([5.5, 1.65, 2.5], { x: 3, z: 0 }, world);
      near(position[0], 8.5); assert.ok(canStandAt({ x: position[0], z: position[2] }, world));
      assert.throws(() => addRoom(base, 'apartment', { x: 1, z: 1 }, { x: 1.1, z: 1.1 }));
    });
    await check('Plan collision and actual Three room surfaces share boundaries, heights and textures', () => {
      const p = structuredClone(base);
      p.assets = ['floor', 'wall', 'ceiling'].map(id => ({ id, name: id, kind: 'image', mime: 'image/png', bytes: 1, sha256: '0'.repeat(64) }));
      Object.assign(p.locations[0].rooms[0], { floorAssetId: 'floor', wallAssetId: 'wall', ceilingAssetId: 'ceiling' });
      const next = addRoom(parseProject(p), 'apartment', { x: 6, z: 2 }, { x: 9, z: 3 }).project.locations[0];
      const walls = buildWalls(next.rooms), parts = roomGeometry(next);
      try {
        assert.equal(parts.filter(p => p.kind === 'wall').length, walls.length);
        assert.equal(parts.filter(p => p.kind === 'floor').length, 2);
        assert.equal(parts.filter(p => p.kind === 'ceiling').length, 2);
        for (const part of parts) {
          assert.equal(part.assetId, part.kind);
          const mesh = new THREE.Mesh(part.geometry);
          mesh.position.set(...part.position); mesh.rotation.set(...part.rotation); mesh.updateMatrixWorld();
          const bounds = new THREE.Box3().setFromObject(mesh);
          if (part.kind === 'floor') near(bounds.max.y, 0);
          else if (part.kind === 'ceiling') near(bounds.min.y, 2.8);
          else { near(bounds.min.y, 0); near(bounds.max.y, 2.8); }
        }
        assert.equal(walls.some(w => w.start.x === 6 && w.end.x === 6 && w.start.z <= 2.5 && w.end.z >= 2.5), false);
      } finally { for (const part of parts) part.geometry.dispose(); }
    });
    await check('Every object kind has safe defaults; converting a prop creates a valid item definition', () => {
      let p = base;
      for (const kind of ['prop', 'item', 'npc', 'container', 'exit']) {
        const added = addObject(p, 'apartment', kind, { x: 2, z: 2 }); p = added.project;
        const o = p.objects.find(o => o.id === added.id);
        assert.equal(o.kind, kind); assert.deepEqual(o.transform.position, [2, 0, 2]);
        assert.equal(o.interaction.canTake, kind === 'item'); assert.equal(!!o.container, kind === 'container');
      }
      const changed = setObjectKind(base, 'door', 'item');
      assert.ok(changed.items.some(i => i.id === changed.objects[0].interaction.itemDefinitionId));
      assert.equal(new TestSession(changed, 1).takeObject('door'), 'Дверь');
    });
    await check('Clipboard freezes its source and copies have independent world instances', () => {
      const source = structuredClone(base), clipboard = copyObjects(source, ['paper']);
      source.objects.find(o => o.id === 'paper').name = 'Изменено после копирования';
      const copied = pasteObjects(source, clipboard, 'apartment');
      assert.equal(copied.project.objects.at(-1).name, 'Смятая бумага (копия)');
      assert.notEqual(copied.ids[0], 'paper');
      const session = new TestSession(copied.project, 1); session.takeObject(copied.ids[0]);
      assert.equal(session.objectPresent('paper'), true); assert.equal(session.objectPresent(copied.ids[0]), false);
      parseGameState(session.snapshot(), session.project);
      assert.throws(() => pasteObjects({ ...source, id: 'other' }, clipboard, 'apartment'), /другому/);
    });
    await check('Copy remaps attached script cycles, local conditions, rules, nodes and schedules', () => {
      const source = graph(), before = JSON.stringify(source), result = pasteObjects(source, copyObjects(source, ['door', 'pot']), 'apartment');
      const [door, pot] = result.ids.map(id => result.project.objects.find(o => o.id === id));
      const script = result.project.scripts.find(s => s.id === door.interaction.scriptId);
      const nextScriptId = script.nodes[0].choices[0].actions.find(a => a.type === 'openScript').scriptId;
      const nested = result.project.scripts.find(s => s.id === nextScriptId);
      assert.notEqual(script.id, 's-a'); assert.notEqual(nextScriptId, 's-b');
      assert.equal(nested.nodes[0].choices[0].actions[0].scriptId, script.id);
      assert.equal(script.nodes[0].choices[0].actions[0].objectId, pot.id);
      assert.equal(script.nodes[0].choices[0].nextNodeId, script.nodes[1].id);
      assert.equal(pot.visibleWhen.conditions[0].condition.key, pot.id);
      const rule = result.project.rules.find(r => r.targetObjectId === door.id);
      assert.equal(rule.actions[0].objectId, door.id);
      assert.equal(result.project.schedules.find(s => s.objectId === pot.id).condition.conditions[0].condition.key, pot.id);
      assert.equal(JSON.stringify(source), before);
    });
    await check('Location duplication remaps self doors and local scripts while preserving external links', () => {
      const pair = linked(), authored = graph();
      let p = parseProject({ ...authored, locations: pair.project.locations, objects: [...authored.objects.map(o => o.id === 'door' ? { ...o, transition: { locationId: 'apartment', position: [...base.locations[0].spawn.position], yaw: 0 } } : o), pair.project.objects.find(o => o.id === pair.returnId)] });
      const extra = addObject(p, 'apartment', 'exit', { x: 1, z: 3 }); p = extra.project;
      p.objects.at(-1).transition = { locationId: pair.destinationId, position: [2, 1.65, 2], yaw: 0 };
      const cloned = duplicateLocation(parseProject(p), 'apartment'), copied = cloned.project.objects.filter(o => o.locationId === cloned.id);
      assert.equal(copied.find(o => o.name === 'Дверь (копия)').transition.locationId, cloned.id);
      assert.equal(copied.find(o => o.id !== 'door' && o.transition?.locationId === pair.destinationId).transition.locationId, pair.destinationId);
      assert.notEqual(cloned.project.locations.at(-1).rooms[0].id, base.locations[0].rooms[0].id);
      const rule = cloned.project.rules.find(r => r.targetObjectId === copied.find(o => o.name === 'Дверь (копия)').id);
      assert.equal(rule.actions.find(a => a.type === 'transition').locationId, cloned.id);
      assert.equal(cloned.project.settings.startLocationId, 'apartment');
    });
    await check('Deletion protects final rooms/locations and external references without mutating the draft', () => {
      assert.throws(() => deleteRoom(base, 'apartment', 'room-main'), /одна комната/);
      assert.throws(() => deleteLocation(base, 'apartment'), /одна локация/);
      const source = graph(), before = JSON.stringify(source);
      assert.throws(() => deleteObject(source, 'pot'), /отсутствующий/); assert.equal(JSON.stringify(source), before);
      const pair = linked();
      const blocked = parseProject({ ...pair.project, rules: [{ ...source.rules[0], targetObjectId: 'door', condition: null, actions: [{ type: 'transition', locationId: pair.destinationId }] }] });
      assert.throws(() => deleteLocation(blocked, pair.destinationId), /отсутствующий/);
    });
    await check('Deleting a destination unsets inbound doors; undo restores the entire linked graph', () => {
      const pair = linked(), p = { ...pair.project, settings: { ...pair.project.settings, startLocationId: pair.destinationId } };
      const next = deleteLocation(p, pair.destinationId), history = new DraftHistory();
      history.record(p, next);
      assert.equal(next.objects.find(o => o.id === 'door').transition, null);
      assert.equal(next.settings.startLocationId, 'apartment');
      assert.equal(next.objects.some(o => o.id === pair.returnId), false);
      assert.deepEqual(history.undo(next), p);
    });
    await check('Deleting a room retains object positions and relocates a stranded hero', () => {
      const added = addRoom(base, 'apartment', { x: 6, z: 0 }, { x: 9, z: 3 });
      const p = structuredClone(added.project); p.locations[0].spawn.position = [7, 1.65, 1];
      const next = deleteRoom(p, 'apartment', added.id);
      assert.deepEqual(next.objects, p.objects);
      assertArrival(next.locations[0], next.objects, next.locations[0].spawn.position);
    });
    await check('Grouped text edits undo together; branching clears redo; history snapshots are isolated and bounded', () => {
      const history = new DraftHistory(2);
      let p = { text: '' };
      const change = (text, group, time) => { const next = { text }; history.record(p, next, group, time); p = next; };
      change('а', 'typing', 1); change('аб', 'typing', 100); change('абв', 'typing', 300);
      p = history.undo(p); assert.deepEqual(p, { text: '' });
      p.text = 'outside'; p = history.redo(p); assert.deepEqual(p, { text: 'абв' });
      p = history.undo(p); change('new', undefined, 1000); assert.equal(history.status().canRedo, false);
      change('two', undefined, 2000); change('three', undefined, 3000);
      p = history.undo(p); assert.equal(p.text, 'two'); p = history.undo(p); assert.equal(p.text, 'new'); assert.equal(history.undo(p), null);
      history.clear(); assert.deepEqual(history.status(), { canUndo: false, canRedo: false });
    });
    await check('Door and return preserve inventory, flags, world changes, clock and pause reasons', () => {
      const pair = linked(), before = JSON.stringify(pair.project), session = new TestSession(pair.project, 8);
      session.takeObject('paper'); session.setFlag('awakened', true); session.setObjectPresence('pot', false); session.tick(15);
      session.setPose([3, 1.65, 3], .4, .5); session.pause('menu'); session.pause('hidden');
      const state = session.snapshot(), revision = session.worldRevision();
      const destination = session.destination('door'); destination.position[0] = 99;
      session.transitionThrough('door');
      assert.equal(session.snapshot().locationId, pair.destinationId); assert.deepEqual(session.pose(), { position: [2, 1.65, 2], yaw: .8, pitch: 0 });
      assert.equal(session.worldRevision(), revision + 1);
      const travelled = session.snapshot();
      for (const key of ['flags', 'objects', 'items', 'clock', 'quests']) assert.deepEqual(travelled[key], state[key]);
      assert.deepEqual(travelled.player.inventory, state.player.inventory);
      assert.throws(() => session.transitionThrough('door'), /недоступен/);
      session.transitionThrough(pair.returnId); assert.equal(session.snapshot().locationId, 'apartment');
      assert.equal(session.objectPresent('paper'), false); assert.equal(session.snapshot().flags.awakened, true);
      parseGameState(session.snapshot(), session.project); assert.equal(JSON.stringify(pair.project), before);
    });
    await check('Testing a selected location does not alter the project start location', () => {
      const pair = linked(), session = new TestSession(pair.project, 1, pair.destinationId);
      assert.equal(session.snapshot().locationId, pair.destinationId); assert.equal(pair.project.settings.startLocationId, 'apartment');
      assert.throws(() => new TestSession(pair.project, 1, 'missing'), /не найдена/);
    });
    await check('Arrival outside rooms, near a wall, below floor or above ceiling is rejected atomically', () => {
      for (const position of [[9, 1.65, 9], [.05, 1.65, 2], [2, 0, 2], [2, 4, 2]]) {
        const pair = linked(), p = structuredClone(pair.project); p.objects.find(o => o.id === 'door').transition.position = position;
        const session = new TestSession(parseProject(p), 1), before = session.snapshot(), revision = session.worldRevision();
        assert.throws(() => session.transitionThrough('door'));
        assert.deepEqual(session.snapshot(), before); assert.equal(session.worldRevision(), revision);
        assert.ok(spatialIssues(p, p.locations[0]).some(issue => issue.includes('Дверь')));
      }
    });
    await check('Arrival respects live obstacles and accepts an obstacle removed from the test world', () => {
      const pair = linked(), added = addObject(pair.project, pair.destinationId, 'prop', { x: 2, z: 2 });
      const p = structuredClone(added.project); p.objects.at(-1).collision = { solid: true, radius: .5 };
      const session = new TestSession(parseProject(p), 1), before = session.snapshot();
      assert.throws(() => session.transitionThrough('door')); assert.deepEqual(session.snapshot(), before);
      session.setObjectPresence(added.id, false); session.transitionThrough('door');
      assert.equal(session.snapshot().locationId, pair.destinationId); assert.equal(presentObjects(p.objects, session.snapshot()).some(o => o.id === added.id), false);
    });
    await check('Unavailable doors and inventory-owned objects cannot be used as transitions', () => {
      const pair = linked(), p = structuredClone(pair.project);
      p.objects.find(o => o.id === 'paper').transition = structuredClone(p.objects.find(o => o.id === 'door').transition);
      const session = new TestSession(parseProject(p), 1), before = session.snapshot();
      assert.throws(() => session.transitionThrough(pair.returnId)); assert.deepEqual(session.snapshot(), before);
      session.setObjectPresence('door', false); assert.throws(() => session.transitionThrough('door'));
      session.takeObject('paper'); session.setObjectPresence('paper', true); assert.throws(() => session.transitionThrough('paper'));
    });
    await check('Return-door placement uses the floor and validates both arrival points before editing', () => {
      const pair = linked(), door = pair.project.objects.find(o => o.id === pair.returnId);
      assert.equal(door.transform.position[1], 0);
      assert.equal(door.transition.locationId, 'apartment');
      const invalid = structuredClone(pair.project); invalid.objects.find(o => o.id === 'door').transition.position = [20, 1.65, 20];
      const before = JSON.stringify(invalid); assert.throws(() => createReturnDoor(invalid, 'door')); assert.equal(JSON.stringify(invalid), before);
    });
  } else {
    const origin = process.argv[originIndex + 1], realFetch = globalThis.fetch;
    const api = (route, options) => realFetch(new URL(route, origin), options);
    const initialResponse = await api('/api/project'); assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    let current = initial;
    const save = async project => {
      const response = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: current.revision }) });
      assert.equal(response.status, 200, await response.clone().text()); current = await response.json(); return current;
    };
    try {
      await check('Real project API saves and reloads two locations, a corridor, transforms, textures and paired doors', async () => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
        const form = new FormData(); form.set('file', new File([png], 'stage3-floor.png', { type: 'image/png' }));
        const upload = await api('/api/assets', { method: 'POST', body: form }); assert.equal(upload.status, 201);
        const asset = await upload.json(), pair = linked();
        let p = structuredClone(pair.project); p.assets.push(asset);
        Object.assign(p.locations[0].rooms[0], { floorAssetId: asset.id, wallAssetId: asset.id, ceilingAssetId: asset.id });
        p = addRoom(parseProject(p), 'apartment', { x: 6, z: 2 }, { x: 9, z: 3 }).project;
        p.objects.find(o => o.id === 'door').transform = { position: [5.5, 0, 2.5], rotation: [0, .2, 0], scale: [1.25, 2.25, 1] };
        await save(p);
        const reopened = await (await api('/api/project')).json(); assert.deepEqual(reopened, current); assert.deepEqual(reopened.project, p);
        const resource = await api('/api/assets/' + asset.id); assert.equal(resource.status, 200); assert.deepEqual(Buffer.from(await resource.arrayBuffer()), png);
        const session = new TestSession(reopened.project, reopened.revision);
        session.transitionThrough('door'); session.transitionThrough(pair.returnId); assert.equal(session.snapshot().locationId, 'apartment');
      });
      await check('Full backup and restore preserve saved spatial authoring and transition IDs with real resources', async () => {
        globalThis.fetch = (url, options) => realFetch(new URL(url, origin), options);
        const backup = await parseBackup(new File([JSON.stringify(await createBackup(current.project))], 'stage3.json'));
        assert.deepEqual(await restoreBackup(backup), current.project);
        const cloned = duplicateLocation(current.project, 'apartment');
        await save(cloned.project);
        const reopened = await (await api('/api/project')).json(); assert.deepEqual(reopened.project, cloned.project);
        assert.ok(reopened.project.objects.some(o => o.locationId === cloned.id && o.transition));
      });
    } finally {
      globalThis.fetch = realFetch;
      const latest = await (await api('/api/project')).json(); current = latest;
      await save(initial.project);
      assert.deepEqual((await (await api('/api/project')).json()).project, initial.project);
      console.log('PASS Original local author project restored after spatial HTTP checks'); passed++;
    }
  }
  console.log('Spatial checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
