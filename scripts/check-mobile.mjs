import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'mobile-check-' + process.pid), compiled = new Set();
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function compile(module) {
  if (compiled.has(module)) return;
  compiled.add(module);
  let source; for (const extension of ['.ts', '.tsx']) { try { source = await fs.readFile(path.join(root, module + extension), 'utf8'); break; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  if (!source) throw new Error('Missing test module ' + module);
  const dependencies = [];
  const text = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(@\/[^'"]+|\.[^'"]+)\1/g, (_, q, name) => {
    const dependency = name.startsWith('@/') ? name.slice(2) : path.normalize(path.join(path.dirname(module), name)); dependencies.push(dependency);
    const relative = path.relative(path.dirname(module), dependency); return 'from ' + q + (relative.startsWith('.') ? relative : './' + relative) + '.mjs' + q;
  });
  const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text);
  for (const dependency of dependencies) await compile(dependency);
}
const load = async module => { await compile(module); return import(pathToFileURL(path.join(output, module + '.mjs')).href); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
try {
  const { createSampleProject } = await load('lib/engine/sample-project'), { parseProject } = await load('lib/engine/project'), { TestSession } = await load('lib/engine/session');
  const { attachContactDrag, touchControlsAvailable, subscribeTouchControls } = await load('lib/player/touch-input');
  const { PlayerInput, joystickVector } = await load('lib/player/input'), { walkDisplacement, movePlayer, collisionWorld, canStandAt, WALK_SPEED } = await load('lib/engine/spatial');
  const { contextAction } = await load('lib/player/picking');
  const { MobileControls, MobileBack } = await load('components/player/mobile-controls'), { InventoryPanel } = await load('components/player/inventory-panel'), { ScenePanel } = await load('components/player/scene-panel');
  const p = createSampleProject(); p.settings.startScriptId = null; p.rules = []; const project = parseProject(p);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
  await check('Joystick dead zone rejects drift, clamps long drags and preserves partial deflection', () => {
    assert.deepEqual(joystickVector(0, 0, 40), { x: 0, y: 0 }); assert.deepEqual(joystickVector(2, 0, 40), { x: 0, y: 0 }); near(joystickVector(400, 0, 40).x, 1); const half = joystickVector(20, 0, 40); assert.ok(half.x > 0 && half.x < 1); near(Math.hypot(...Object.values(joystickVector(400, 400, 40))), 1); assert.deepEqual(joystickVector(NaN, 0, 40), { x: 0, y: 0 });
  });
  await check('Analog movement preserves direction and speed across camera rotation without diagonal boost', () => {
    const none = new Set(); near(walkDisplacement(none, 0, .1, { x: 0, y: -1 }).z, -WALK_SPEED * .1); near(walkDisplacement(none, Math.PI / 2, .1, { x: 0, y: -1 }).x, -WALK_SPEED * .1); near(Math.hypot(...Object.values(walkDisplacement(none, 0, .1, { x: .5, y: 0 }))), WALK_SPEED * .05); near(Math.hypot(...Object.values(walkDisplacement(new Set(['KeyW']), 0, .1, { x: 1, y: -1 }))), WALK_SPEED * .1);
  });
  await check('Touch movement uses the same wall collision and cannot walk through a boundary', () => {
    const world = collisionWorld(project.locations[0], []); let pose = [...project.locations[0].spawn.position]; for (let i = 0; i < 300; i++) pose = movePlayer(pose, walkDisplacement(new Set(), 0, .1, { x: -1, y: 0 }), world); assert.ok(canStandAt({ x: pose[0], z: pose[2] }, world)); assert.ok(pose[0] > 0);
  });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const event = (target, type, properties = {}) => { const e = new Event(type, { cancelable: true }); Object.assign(e, properties); target.dispatchEvent(e); return e; };
  const setup = (options = {}) => {
    const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget(), captures = new Set(); doc.hidden = false; doc.pointerLockElement = null; doc.exitPointerLock = () => {}; let locks = 0, pauses = 0;
    if (options.nativeTouch) win.ontouchstart = null;
    canvas.focus = settings => { canvas.focusSettings = settings; }; canvas.requestPointerLock = () => { locks++; }; canvas.setPointerCapture = id => captures.add(id); canvas.hasPointerCapture = id => captures.has(id); canvas.releasePointerCapture = id => { captures.delete(id); event(canvas, 'lostpointercapture', { pointerId: id }); };
    if (options.capture === 'missing') canvas.setPointerCapture = undefined;
    if (options.capture === 'throws') canvas.setPointerCapture = () => { throw new DOMException('Inactive pointer', 'NotFoundError'); };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc }); const s = new TestSession(project, 1); s.pause('menu'); const active = [], actions = [];
    const input = new PlayerInput(canvas, s, { onActive: mode => active.push(mode), onPause: () => pauses++, onAction: action => actions.push(action) }); input.setTouchMode(true); input.resume(); return { win, doc, canvas, captures, s, input, active, actions, locks: () => locks, pauses: () => pauses };
  };
  try {
    await check('Touch resume starts immediately without requesting Pointer Lock', () => { const t = setup(); try { assert.equal(t.input.active(), true); assert.deepEqual(t.active, ['touch']); assert.equal(t.locks(), 0); } finally { t.input.dispose(); } });
    await check('Movement and camera gestures work simultaneously and releasing look does not stop the stick', () => {
      const t = setup(); try { t.input.setStick(0, -1); event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 }); event(t.canvas, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 130, clientY: 110 }); assert.notEqual(t.s.pose().yaw, 0); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0); event(t.canvas, 'pointerup', { pointerId: 2 }); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0); t.input.setStick(0, 0); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); } finally { t.input.dispose(); }
    });
    await check('A second view pointer cannot steal the gesture or cause a camera jump', () => {
      const t = setup(); try { event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 }); event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 500, clientY: 100 }); const before = t.s.pose(); event(t.canvas, 'pointermove', { pointerId: 3, clientX: 900, clientY: 100 }); assert.deepEqual(t.s.pose(), before); event(t.canvas, 'pointermove', { pointerId: 2, clientX: 110, clientY: 100 }); assert.notEqual(t.s.pose().yaw, before.yaw); } finally { t.input.dispose(); }
    });
    await check('Cancelled camera gestures ignore stale moves and never synthesize an interaction', () => {
      const t = setup(); try { event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 }); event(t.canvas, 'pointercancel', { pointerId: 1 }); const before = t.s.pose(); event(t.canvas, 'pointermove', { pointerId: 1, clientX: 200, clientY: 200 }); event(t.canvas, 'mousedown', { button: 0 }); event(t.win, 'mouseup', { button: 0 }); assert.deepEqual(t.s.pose(), before); assert.deepEqual(t.actions, []); } finally { t.input.dispose(); }
    });
    for (const kind of ['pause', 'blur', 'orientation', 'hidden', 'hold']) await check('Movement and captured look clear on ' + kind + ' without resuming a stale gesture', () => {
      const t = setup(); try { t.input.setStick(1, 1); event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 20, clientY: 20 }); if (kind === 'pause') t.input.pause(); else if (kind === 'blur') event(t.win, 'blur'); else if (kind === 'orientation') event(t.win, 'orientationchange'); else if (kind === 'hidden') { t.doc.hidden = true; event(t.doc, 'visibilitychange'); t.doc.hidden = false; event(t.doc, 'visibilitychange'); } else { t.input.hold(); t.input.finishHold(); }
        assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); assert.equal(t.captures.size, 0); const before = t.s.pose(); event(t.canvas, 'pointermove', { pointerId: 5, clientX: 200, clientY: 200 }); assert.deepEqual(t.s.pose(), before); if (kind !== 'hold') assert.equal(t.input.active(), false);
      } finally { t.input.dispose(); }
    });
    await check('Paused or disposed touch input cannot change movement, camera, world time or action history', () => {
      const t = setup(); t.input.pause(); const before = t.s.snapshot(); t.input.setStick(1, 1); t.input.look(20, 20); event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10 }); t.s.tick(10); assert.deepEqual(t.s.snapshot(), before); t.input.dispose(); event(t.win, 'keydown', { code: 'KeyE' }); assert.deepEqual(t.actions, []);
    });

    const touch = (target, type, id, x = 0, y = 0) => event(target, type, { changedTouches: [{ identifier: id, clientX: x, clientY: y }] });
    await check('An iPhone-style touch stream walks and looks simultaneously without pointer capture', () => {
      for (const cameraFirst of [false, true]) {
        const t = setup({ nativeTouch: true, capture: 'throws' }), stick = new EventTarget(); let updates = 0;
        const update = point => { updates++; const axis = joystickVector(point.x - 50, point.y - 50, 30); t.input.setStick(axis.x, axis.y); };
        const drag = attachContactDrag(stick, { start: point => { update(point); return true; }, move: update, end: () => t.input.setStick(0, 0) });
        try {
          const startLook = () => touch(t.canvas, 'touchstart', 2, 100, 100), startWalk = () => touch(stick, 'touchstart', 1, 50, 20);
          if (cameraFirst) { startLook(); startWalk(); } else { startWalk(); startLook(); }
          touch(t.win, 'touchmove', 2, 120, 110); assert.notEqual(t.s.pose().yaw, 0); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0);
          const world = collisionWorld(project.locations[0], []), before = t.s.pose().position, after = movePlayer(before, t.input.movement(.1), world); assert.notDeepEqual(after, before);
          touch(t.win, 'touchend', 2); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0);
          touch(t.win, 'touchcancel', 9); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0);
          touch(t.win, 'touchend', 1); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); assert.equal(updates, 1); assert.deepEqual(t.canvas.focusSettings, { preventScroll: true });
        } finally { drag.dispose(); t.input.dispose(); }
      }
    });
    await check('Lifting the joystick finger does not interrupt the independent look finger', () => {
      const t = setup({ nativeTouch: true }), stick = new EventTarget(), drag = attachContactDrag(stick, { start: () => { t.input.setStick(0, -1); return true; }, move() {}, end: () => t.input.setStick(0, 0) });
      try { touch(stick, 'touchstart', 1); touch(t.canvas, 'touchstart', 2, 100, 100); touch(t.win, 'touchend', 1); const before = t.s.pose(); touch(t.win, 'touchmove', 2, 130, 100); assert.notEqual(t.s.pose().yaw, before.yaw); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); } finally { drag.dispose(); t.input.dispose(); }
    });
    await check('Touch and compatibility pointer events never double the camera turn or steal a contact', () => {
      const t = setup({ nativeTouch: true });
      try { event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 101, clientX: 100, clientY: 100 }); touch(t.canvas, 'touchstart', 1, 100, 100); touch(t.canvas, 'touchstart', 2, 900, 100); touch(t.win, 'touchmove', 2, 950, 100); const before = t.s.pose().yaw; touch(t.win, 'touchmove', 1, 110, 100); const after = t.s.pose().yaw; event(t.canvas, 'pointermove', { pointerType: 'touch', pointerId: 101, clientX: 110, clientY: 100 }); near(t.s.pose().yaw, after); near(Math.abs(after - before), .04); assert.equal(t.captures.size, 0); } finally { t.input.dispose(); }
    });
    for (const capture of ['missing', 'throws']) await check('Pointer fallback still walks and looks when capture is ' + capture, () => {
      const t = setup({ capture }), stick = new EventTarget(); stick.setPointerCapture = t.canvas.setPointerCapture;
      const update = point => { const axis = joystickVector(point.x, point.y, 30); t.input.setStick(axis.x, axis.y); };
      const drag = attachContactDrag(stick, { start: point => { update(point); return true; }, move: update, end: () => t.input.setStick(0, 0) });
      try { event(stick, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: -30 }); assert.ok(Math.hypot(...Object.values(t.input.movement(.1))) > 0); event(t.canvas, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 }); event(t.win, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 130, clientY: 100 }); assert.notEqual(t.s.pose().yaw, 0); event(t.win, 'pointercancel', { pointerId: 1 }); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); } finally { drag.dispose(); t.input.dispose(); }
    });
    for (const kind of ['blur', 'orientationchange', 'hidden', 'dispose']) await check('Native touch gestures reset without stale movement after ' + kind, () => {
      const t = setup({ nativeTouch: true }), stick = new EventTarget(), drag = attachContactDrag(stick, { start: () => { t.input.setStick(0, -1); return true; }, move: () => t.input.setStick(0, -1), end: () => t.input.setStick(0, 0) });
      try { touch(stick, 'touchstart', 1); touch(t.canvas, 'touchstart', 2); if (kind === 'dispose') { drag.dispose(); t.input.dispose(); } else if (kind === 'hidden') { t.doc.hidden = true; event(t.doc, 'visibilitychange'); t.doc.hidden = false; event(t.doc, 'visibilitychange'); } else event(t.win, kind); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); const before = t.s.pose(); touch(t.win, 'touchmove', 1, 0, -30); touch(t.win, 'touchmove', 2, 100, 100); assert.deepEqual(t.s.pose(), before); assert.deepEqual(t.input.movement(.1), { x: 0, z: 0 }); } finally { drag.dispose(); t.input.dispose(); }
    });
    await check('A bubbling pointer event is processed only once across element and window listeners', () => {
      const t = setup(), control = new EventTarget(); let moves = 0; const drag = attachContactDrag(control, { start: () => true, move: () => moves++, end() {} });
      try { event(control, 'pointerdown', { pointerType: 'pen', pointerId: 10, clientX: 0, clientY: 0 }); const moved = new Event('pointermove', { cancelable: true }); Object.assign(moved, { pointerId: 10, clientX: 30, clientY: 20 }); control.dispatchEvent(moved); t.win.dispatchEvent(moved); assert.equal(moves, 1); } finally { drag.dispose(); t.input.dispose(); }
    });
  } finally { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window; if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document; }
  await check('Touch detection covers iPhone desktop mode, secondary touch input and ordinary desktops', () => {
    const host = (points, matches) => ({ navigator: { maxTouchPoints: points }, matchMedia: query => ({ matches: matches.includes(query) }) });
    assert.equal(touchControlsAvailable(host(5, [])), true); assert.equal(touchControlsAvailable(host(0, ['(pointer: coarse)'])), true); assert.equal(touchControlsAvailable(host(0, ['(any-pointer: coarse)'])), true); assert.equal(touchControlsAvailable(host(0, [])), false);
  });
  for (const legacy of [false, true]) await check('Touch mode subscriptions support ' + (legacy ? 'legacy Safari listeners' : 'modern media listeners') + ' and clean up', () => {
    const host = new EventTarget(), media = [], removals = []; let notifications = 0;
    host.matchMedia = () => { const m = { matches: true }; const add = (_, fn) => { m.notify = fn; }, remove = () => removals.push(true); if (legacy) { m.addListener = fn => add(null, fn); m.removeListener = remove; } else { m.addEventListener = add; m.removeEventListener = remove; } media.push(m); return m; };
    const stop = subscribeTouchControls(() => notifications++, host); media.forEach(m => m.notify()); host.dispatchEvent(new Event('pageshow')); assert.equal(notifications, 3); stop(); assert.equal(removals.length, 2); host.dispatchEvent(new Event('pageshow')); assert.equal(notifications, 3);
  });
  await check('Single context action changes between take and use; selecting an unrelated item never blocks dialogue', () => {
    const s = new TestSession(project, 1), state = s.snapshot(); assert.equal(contextAction(project, state, null), null); assert.equal(contextAction(project, state, { objectId: 'paper', canTake: true }), 'take'); assert.equal(contextAction(project, state, { objectId: 'door', canTake: false }), 'ordinaryInteract'); s.takeObject('paper'); assert.equal(contextAction(project, s.snapshot(), { objectId: 'door', canTake: false }), 'ordinaryInteract');
  });
  await check('Matching target/item rules select use; wrong target and wrong item do not override take', () => {
    const p = structuredClone(project); p.rules = [{ id: 'use-paper', name: 'Use paper', trigger: 'useItem', targetObjectId: 'door', checkId: null, itemDefinitionId: 'paper-item', itemTag: null, priority: 0, condition: null, unavailableReason: '', actions: [], once: false }]; const s = new TestSession(parseProject(p), 1); s.takeObject('paper'); assert.equal(contextAction(p, s.snapshot(), { objectId: 'door', canTake: false }), 'interact'); assert.equal(contextAction(p, s.snapshot(), { objectId: 'paper', canTake: true }), 'take');
  });
  await check('Mobile HUD renders exactly one context action, a two-part joystick and the supplied inventory art', () => {
    const html = renderToStaticMarkup(createElement(MobileControls, { action: 'take', targetName: 'Бумага', heldName: '', onMove() {}, onAction() {}, onInventory() {} })); assert.equal((html.match(/class="mobile-art-button mobile-context-action"/g) ?? []).length, 1); for (const asset of ['joystick-base','joystick-thumb','take','inventory']) assert.ok(html.includes('/mobile-ui/' + asset + '.webp')); assert.ok(!html.includes('/mobile-ui/use.webp')); const back = renderToStaticMarkup(createElement(MobileBack, { onBack() {}, label: 'Открыть меню' })); assert.ok(back.includes('aria-label="Открыть меню"'));
  });
  await check('Mobile inventory exposes vertical item/stat/skill tabs using the three assigned icons', () => {
    const s = new TestSession(project, 1), html = renderToStaticMarkup(createElement(InventoryPanel, { mobile: true, session: s, state: s.snapshot(), onChange() {}, onClose() {}, onPause() {} })); assert.ok(html.includes('data-orientation="vertical"')); for (const asset of ['inventory','stats','skills','back']) assert.ok(html.includes('/mobile-ui/' + asset + '.webp')); const desktop = renderToStaticMarkup(createElement(InventoryPanel, { session: s, state: s.snapshot(), onChange() {}, onClose() {}, onPause() {} })); assert.ok(!desktop.includes('/mobile-ui/'));
  });
  await check('Mobile dialogue keeps responses below text and exposes the back arrow for menu access', () => {
    const p = structuredClone(project); p.scripts = [{ id: 'talk', name: 'Разговор', entryNodeId: 'entry', nodes: [{ id: 'entry', paragraphs: [], choices: [{ id: 'answer', label: 'Ответ', nextNodeId: null, checkId: null, condition: null, unavailableReason: '', actions: [], failureActions: [], failureNodeId: null }] }] }]; const s = new TestSession(parseProject(p), 1); s.openScript('talk'); const html = renderToStaticMarkup(createElement(ScenePanel, { mobile: true, session: s, state: s.snapshot(), onChange() {}, onPause() {} })); assert.ok(html.includes('/mobile-ui/back.webp')); assert.ok(html.indexOf('scene-transcript') < html.indexOf('scene-player-actions')); assert.ok(html.includes('Ответ'));
  });
  await check('All nine mobile art files are present and display code references the supplied menu sign', async () => { for (const name of ['joystick-base','joystick-thumb','use','take','inventory','menu','back','stats','skills']) { const data = await fs.readFile(path.join(root, 'public/mobile-ui', name + '.webp')); assert.equal(data.subarray(8,12).toString(), 'WEBP'); } assert.ok((await fs.readFile(path.join(root,'components/player/first-person.tsx'),'utf8')).includes('/mobile-ui/menu.webp')); });
  console.log('Mobile checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
