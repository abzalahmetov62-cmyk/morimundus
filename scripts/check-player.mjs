import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root = process.cwd();
const output = path.join(root, '.sites-runtime', `player-check-${process.pid}`);
const modules = ['engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'player/picking', 'player/billboard', 'player/input', 'player/touch-input'];
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

try {
  for (const module of modules) {
    const source = await fs.readFile(path.join(root, 'lib', `${module}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, name) => `from ${quote}${name}.mjs${quote}`);
    const file = path.join(output, `${module}.mjs`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, compiled);
  }
  const load = module => import(pathToFileURL(path.join(output, `${module}.mjs`)).href);
  const { createSampleProject } = await load('engine/sample-project');
  const { parseProject } = await load('engine/project');
  const { parseGameState } = await load('engine/game-state');
  const { TestSession } = await load('engine/session');
  const { collisionWorld, canStandAt, movePlayer, walkDisplacement, turnView, PLAYER_RADIUS, WALK_SPEED } = await load('engine/spatial');
  const { pickTarget, opaqueAt } = await load('player/picking');
  const { alignBillboard } = await load('player/billboard');
  const { PlayerInput } = await load('player/input');
  const project = createSampleProject();
  const location = project.locations[0];
  const world = collisionWorld(location, []);

  await check('All room boundaries and diagonal corners stop a large movement', () => {
    for (const delta of [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: 0, z: -10 }, { x: 0, z: 10 }, { x: 10, z: 10 }]) {
      const position = movePlayer([3, 1.65, 2.5], delta, world);
      assert.ok(canStandAt({ x: position[0], z: position[2] }, world));
      assert.ok(position[0] >= PLAYER_RADIUS && position[0] <= 6 - PLAYER_RADIUS);
      assert.ok(position[2] >= PLAYER_RADIUS && position[2] <= 5 - PLAYER_RADIUS);
      near(position[1], 1.65);
    }
    assert.throws(() => movePlayer([3, 1.65, 2.5], { x: Infinity, z: 0 }, world));
    assert.equal(canStandAt({ x: NaN, z: 2 }, world), false);
  });
  await check('Walls permit sliding, while a narrow solid object cannot be crossed', () => {
    const slide = movePlayer([.3, 1.65, 1], { x: -1, z: 1 }, world);
    assert.ok(slide[0] >= PLAYER_RADIUS); near(slide[2], 2);
    const obstacle = structuredClone(project.objects[0]);
    obstacle.transform.position = [3, 0, 2.5]; obstacle.collision = { solid: true, radius: .05 };
    const solid = collisionWorld(location, [obstacle]);
    const stopped = movePlayer([1, 1.65, 2.5], { x: 4, z: 0 }, solid);
    assert.ok(stopped[0] < 3 - PLAYER_RADIUS - .05);
    assert.ok(canStandAt({ x: stopped[0], z: stopped[2] }, solid));
    obstacle.collision.solid = false;
    near(movePlayer([1, 1.65, 2.5], { x: 4, z: 0 }, collisionWorld(location, [obstacle]))[0], 5);
  });
  await check('Connected rooms remove only shared walls; gaps remain impassable', () => {
    const room = { ...location.rooms[0], width: 2, depth: 2 };
    const connected = collisionWorld({ ...location, rooms: [room, { ...room, id: 'room-two', origin: [2, 0, 0] }] }, []);
    near(movePlayer([1, 1.65, 1], { x: 2, z: 0 }, connected)[0], 3);
    assert.equal(connected.walls.some(w => w.start.x === 2 && w.end.x === 2), false);
    const separated = collisionWorld({ ...location, rooms: [room, { ...room, id: 'room-two', origin: [2.02, 0, 0] }] }, []);
    assert.ok(movePlayer([1, 1.65, 1], { x: 2, z: 0 }, separated)[0] < 2);
    const partial = collisionWorld({ ...location, rooms: [room, { ...room, id: 'room-two', origin: [2, 0, 1], depth: 1 }] }, []);
    assert.ok(movePlayer([1, 1.65, .5], { x: 2, z: 0 }, partial)[0] < 2);
    near(movePlayer([1, 1.65, 1.5], { x: 2, z: 0 }, partial)[0], 3);
  });
  await check('Movement speed is independent of diagonals, Shift, Space and frame gaps', () => {
    const forward = walkDisplacement(new Set(['KeyW']), 0, .1);
    const diagonal = walkDisplacement(new Set(['KeyW', 'KeyD']), 0, .1);
    near(Math.hypot(forward.x, forward.z), WALK_SPEED * .1);
    near(Math.hypot(diagonal.x, diagonal.z), WALK_SPEED * .1);
    assert.deepEqual(walkDisplacement(new Set(['KeyW', 'ShiftLeft', 'Space']), 0, 60), forward);
    near(walkDisplacement(new Set(['KeyW']), Math.PI / 2, .1).x, -WALK_SPEED * .1);
    assert.deepEqual(walkDisplacement(new Set(['KeyW', 'KeyS']), 0, .1), { x: 0, z: 0 });
    const turned = turnView(0, 0, 9999, -9999);
    assert.ok(Math.abs(turned.yaw) <= Math.PI); assert.ok(turned.pitch < Math.PI / 2);
    assert.deepEqual(turnView(0, 0, NaN, 0), { yaw: 0, pitch: 0 });
  });

  const camera = new THREE.PerspectiveCamera(65, 1, .05, 160);
  camera.position.set(0, 1, 0); camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const sprites = [];
  const resources = [];
  function sprite(id, distance, { reach = 2, alpha = null, visible = true, ready = true } = {}) {
    const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    resources.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(0, 1, -distance); mesh.visible = visible;
    mesh.userData = { object: { ...structuredClone(project.objects[2]), id, interaction: { ...project.objects[2].interaction, reach } }, alpha, ready };
    mesh.updateMatrixWorld(true); sprites.push(mesh); return mesh;
  }
  try {
    await check('The center ray respects reach and solid wall occlusion', () => {
      sprites.length = 0; sprite('paper', 1.5);
      assert.deepEqual(pickTarget(camera, sprites, [], raycaster), { objectId: 'paper', canTake: true });
      const wallGeometry = new THREE.BoxGeometry(4, 3, .05), wallMaterial = new THREE.MeshBasicMaterial();
      resources.push(wallGeometry, wallMaterial);
      const wall = new THREE.Mesh(wallGeometry, wallMaterial); wall.position.set(0, 1, -1); wall.updateMatrixWorld(true);
      assert.equal(pickTarget(camera, sprites, [wall], raycaster), null);
      sprites[0].userData.object.interaction.reach = 1;
      assert.equal(pickTarget(camera, sprites, [], raycaster), null);
    });
    await check('Transparent margins and holes pass the center ray to the next object', () => {
      sprites.length = 0;
      sprite('front', 1, { alpha: { width: 1, height: 1, values: new Uint8Array([0]) } }); sprite('behind', 1.5);
      assert.equal(pickTarget(camera, sprites, [], raycaster).objectId, 'behind');
      const mask = { width: 2, height: 2, values: new Uint8Array([255, 0, 0, 255]) };
      assert.equal(opaqueAt(mask, { x: 0, y: 1 }), true);
      assert.equal(opaqueAt(mask, { x: 1, y: 1 }), false);
      assert.equal(opaqueAt(mask, { x: 0, y: 0 }), false);
      assert.equal(opaqueAt(mask, { x: 1, y: 0 }), true);
      assert.equal(opaqueAt(mask, { x: -1, y: .5 }), false);
      sprites[0].userData.alpha.values[0] = 255;
      assert.equal(pickTarget(camera, sprites, [], raycaster).objectId, 'front');
      sprites[0].userData.object.interaction.reach = .5;
      assert.equal(pickTarget(camera, sprites, [], raycaster), null);
    });
    await check('Absent or still-loading objects cannot intercept an interaction', () => {
      sprites.length = 0; sprite('hidden', .5, { visible: false }); sprite('loading', 1, { ready: false }); sprite('available', 1.5);
      assert.equal(pickTarget(camera, sprites, [], raycaster).objectId, 'available');
    });
    await check('Vertical billboards face the player and stay upright during vertical look', () => {
      const mesh = sprites[0]; camera.position.set(3, 4, 2); camera.rotation.set(-.5, .7, 0); camera.updateMatrixWorld(true);
      alignBillboard(mesh, camera, 'vertical');
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
      near(up.y, 1); near(up.x, 0); near(up.z, 0);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const expected = new THREE.Vector3(camera.position.x - mesh.position.x, 0, camera.position.z - mesh.position.z).normalize();
      near(normal.dot(expected), 1);
      alignBillboard(mesh, camera, 'camera'); near(Math.abs(mesh.quaternion.dot(camera.quaternion)), 1);
      const before = mesh.quaternion.clone(); alignBillboard(mesh, camera, 'none'); assert.ok(before.equals(mesh.quaternion));
    });
  } finally { for (const resource of resources) resource.dispose(); }

  await check('Picking up a world item is atomic, removes it and never mutates author data', () => {
    const before = JSON.stringify(project), session = new TestSession(project, 1);
    assert.equal(session.takeObject('paper'), 'Смятая бумага');
    const state = session.snapshot();
    assert.equal(state.objects.paper.present, false);
    assert.equal(state.player.inventory[0], 'instance-paper');
    assert.deepEqual(state.items['instance-paper'].owner, { type: 'inventory', slot: 0 });
    parseGameState(state, project);
    assert.throws(() => session.takeObject('paper'));
    assert.throws(() => session.takeObject('door'));
    assert.equal(JSON.stringify(project), before);
    state.player.inventory[0] = null;
    assert.equal(session.snapshot().player.inventory[0], 'instance-paper');
    const pose = session.pose(); pose.position[0] = 999;
    assert.notEqual(session.pose().position[0], 999);
    assert.throws(() => session.setObjectPresence('toString', false));
  });
  await check('A full three-slot inventory leaves the fourth item unchanged', () => {
    const p = structuredClone(project);
    const source = p.objects.find(o => o.id === 'paper');
    p.objects = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(source), id: `paper-${i}` }));
    const session = new TestSession(parseProject(p), 1);
    for (let i = 0; i < 3; i++) session.takeObject(`paper-${i}`);
    const before = session.snapshot();
    assert.throws(() => session.takeObject('paper-3'), /свободной/);
    assert.deepEqual(session.snapshot(), before); parseGameState(before, session.project);
  });
  await check('A maximum-length author ID remains valid as a runtime item instance', () => {
    const p = structuredClone(project), id = 'x'.repeat(100);
    p.objects = p.objects.map(o => o.id === 'paper' ? { ...o, id } : o);
    const session = new TestSession(parseProject(p), 1); session.takeObject(id);
    parseGameState(session.snapshot(), session.project);
  });

  // EventTarget substitutes exercise the input controller only; they are not browser/Pointer Lock QA.
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let win, doc, canvas, input;
  function event(target, type, values = {}) {
    const e = new Event(type, { cancelable: true }); Object.assign(e, values); target.dispatchEvent(e); return e;
  }
  function setup(request) {
    win = new EventTarget(); doc = new EventTarget(); canvas = new EventTarget();
    doc.hidden = false; doc.pointerLockElement = null;
    doc.exitPointerLock = () => { doc.pointerLockElement = null; event(doc, 'pointerlockchange'); };
    canvas.focus = () => {};
    canvas.requestPointerLock = request ? () => request(doc, canvas) : undefined;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    const session = new TestSession(project, 1); session.pause('menu');
    const active = [], actions = [], slots = []; let pauses = 0, inventories = 0;
    input = new PlayerInput(canvas, session, { onActive: mode => active.push(mode), onPause: () => pauses++, onAction: action => actions.push(action), onInventory: () => inventories++, onSlot: slot => { slots.push(slot); session.selectSlot(slot); } });
    return { session, active, actions, slots, inventories: () => inventories, pauses: () => pauses };
  }
  try {
    await check('Input acquires the cursor, dispatches E/F once and pauses on unlock', async () => {
      const t = setup((document, element) => { document.pointerLockElement = element; event(document, 'pointerlockchange'); return Promise.resolve(); });
      input.resume(); assert.equal(input.active(), true); assert.deepEqual(t.active, ['locked']);
      assert.equal(event(win, 'keydown', { code: 'KeyW', repeat: false }).defaultPrevented, true);
      assert.ok(input.keys.has('KeyW'));
      event(win, 'keydown', { code: 'KeyE', repeat: false }); event(win, 'keydown', { code: 'KeyE', repeat: true }); event(win, 'keydown', { code: 'KeyF', repeat: false });
      assert.deepEqual(t.actions, ['interact', 'take']);
      const start = t.session.pose(); event(win, 'mousemove', { movementX: 30, movementY: 20 }); assert.notEqual(t.session.pose().yaw, start.yaw);
      doc.exitPointerLock(); assert.equal(input.active(), false); assert.equal(input.keys.size, 0); assert.equal(t.pauses(), 1);
      const time = t.session.snapshot().clock.worldSeconds; t.session.tick(60); assert.equal(t.session.snapshot().clock.worldSeconds, time);
      input.dispose(); await Promise.resolve();
    });
    await check('A locked click interacts once; loading blocks actions, movement and time without releasing the cursor', () => {
      const t = setup((document, element) => { document.pointerLockElement = element; event(document, 'pointerlockchange'); });
      input.resume(); event(canvas, 'mousedown', { button: 0 }); event(canvas, 'mousedown', { button: 2 });
      assert.deepEqual(t.actions, ['interact']);
      event(win, 'keydown', { code: 'KeyW' }); input.hold();
      assert.equal(input.keys.size, 0); assert.equal(input.active(), false); assert.equal(doc.pointerLockElement, canvas);
      const pose = t.session.pose(), clock = t.session.snapshot().clock;
      event(canvas, 'mousedown', { button: 0 }); event(win, 'keydown', { code: 'KeyE' }); event(win, 'mousemove', { movementX: 25, movementY: 20 });
      event(doc, 'pointerlockchange'); t.session.tick(10);
      assert.equal(input.active(), false); assert.deepEqual(t.active, ['locked']); assert.deepEqual(t.actions, ['interact']);
      assert.deepEqual(t.session.pose(), pose); assert.deepEqual(t.session.snapshot().clock, clock);
      input.finishHold(); assert.equal(input.active(), true); assert.deepEqual(t.active, ['locked', 'locked']); assert.equal(input.keys.size, 0);
      input.dispose();
    });
    await check('Escape or tab hiding during a location load keeps play paused until a new trusted resume', () => {
      const t = setup(); input.resume(); input.hold();
      event(win, 'keydown', { code: 'Escape' }); input.finishHold();
      assert.equal(input.active(), false); assert.deepEqual(t.session.snapshot().clock.pausedBy, ['menu']);
      input.resume(); input.hold(); doc.hidden = true; event(doc, 'visibilitychange');
      doc.hidden = false; event(doc, 'visibilitychange'); input.finishHold();
      assert.equal(input.active(), false); assert.deepEqual(t.session.snapshot().clock.pausedBy, ['menu']);
      input.resume(); assert.equal(input.active(), true); input.hold(); input.dispose(); input.finishHold(); assert.equal(input.active(), false);
    });
    await check('Denied Pointer Lock enables drag look; Escape and blur clear movement', async () => {
      const t = setup(() => Promise.reject(new Error('denied')));
      input.resume(); await Promise.resolve(); assert.deepEqual(t.active, ['drag']); assert.equal(input.active(), true);
      const before = t.session.pose(); event(win, 'mousemove', { movementX: 20, movementY: 0 }); assert.deepEqual(t.session.pose(), before);
      event(canvas, 'mousedown', { button: 0 }); event(win, 'mousemove', { movementX: 20, movementY: 0 }); assert.notEqual(t.session.pose().yaw, before.yaw);
      event(win, 'keydown', { code: 'KeyW' }); event(win, 'keydown', { code: 'Escape' }); assert.equal(input.active(), false); assert.equal(input.keys.size, 0);
      input.resume(); await Promise.resolve(); event(win, 'keydown', { code: 'KeyD' }); event(win, 'blur'); assert.equal(input.active(), false); assert.equal(input.keys.size, 0);
      input.dispose();
    });
    await check('Text and hidden-tab pauses compose; disposal removes all active listeners', () => {
      const t = setup(); input.resume(); t.session.pause('interaction');
      const before = t.session.pose(); event(win, 'mousemove', { movementX: 20, movementY: 20 }); event(win, 'keydown', { code: 'KeyF' }); assert.deepEqual(t.session.pose(), before); assert.deepEqual(t.actions, []);
      doc.hidden = true; event(doc, 'visibilitychange');
      doc.hidden = false; event(doc, 'visibilitychange'); t.session.resume('interaction');
      assert.equal(input.active(), false); assert.deepEqual(t.session.snapshot().clock.pausedBy, ['menu']);
      input.resume(); assert.equal(input.active(), true); input.dispose();
      const ended = t.session.snapshot(); event(win, 'keydown', { code: 'KeyE' }); event(win, 'mousemove', { movementX: 20, movementY: 20 }); event(win, 'blur'); assert.deepEqual(t.session.snapshot(), ended);
    });
    await check('Inventory keys select valid slots, wheel wraps, Q/I/R dispatch once and Tab pauses before opening', () => {
      const t = setup(); input.resume(); event(win, 'keydown', { code: 'Digit3' }); event(win, 'keydown', { code: 'Digit9' }); assert.deepEqual(t.slots, [2]);
      assert.equal(event(canvas, 'wheel', { deltaY: 1 }).defaultPrevented, true); assert.equal(t.session.snapshot().player.activeSlot, 0);
      event(win, 'keydown', { code: 'KeyQ' }); event(win, 'keydown', { code: 'KeyQ', repeat: true }); event(win, 'keydown', { code: 'KeyI' }); event(win, 'keydown', { code: 'KeyR' }); event(win, 'keydown', { code: 'KeyR', repeat: true }); assert.deepEqual(t.actions, ['drop', 'inspectItem', 'ordinaryInteract']);
      event(win, 'keydown', { code: 'KeyW' }); assert.equal(event(win, 'keydown', { code: 'Tab' }).defaultPrevented, true); assert.equal(t.inventories(), 1); assert.equal(input.active(), false); assert.equal(input.keys.size, 0); const time = t.session.snapshot().clock; t.session.tick(20); assert.deepEqual(t.session.snapshot().clock, time); event(win, 'keydown', { code: 'KeyQ' }); event(win, 'keydown', { code: 'KeyR' }); assert.deepEqual(t.actions, ['drop', 'inspectItem', 'ordinaryInteract']); input.dispose();
    });
    await check('Closing during a pending cursor request cancels it and releases a late lock', async () => {
      let resolve;
      const t = setup(() => new Promise(done => { resolve = done; }));
      input.resume(); input.dispose(); doc.pointerLockElement = canvas; resolve(); await Promise.resolve();
      assert.equal(doc.pointerLockElement, null); assert.deepEqual(t.active, []); assert.equal(input.keys.size, 0);
    });
  } finally {
    input?.dispose();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
  console.log(`Player checks passed: ${passed}`);
} finally { await fs.rm(output, { recursive: true, force: true }); }
