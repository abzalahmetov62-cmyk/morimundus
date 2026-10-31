import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'inventory-display-' + process.pid);
const modules = ['components/player/asset-image', 'lib/player/asset-loading', 'lib/engine/project', 'lib/engine/voices', 'lib/engine/sample-project', 'lib/engine/game-state', 'lib/engine/session', 'lib/engine/object-effects', 'lib/engine/spatial', 'lib/engine/conditions', 'lib/engine/scenarios', 'lib/engine/inventory', 'lib/engine/item-interactions', 'lib/engine/rpg', 'lib/engine/time', 'lib/engine/audio-state', 'lib/engine/save-game', 'lib/editor/spatial-operations', 'lib/editor/scenario-dependencies', 'lib/editor/deletion', 'lib/editor/history', 'lib/player/inventory-controls', 'lib/storage/client', 'lib/utils', 'components/ui/button', 'components/player/inventory-panel', 'components/player/trait-panel', 'lib/engine/presentation', 'components/ui/tabs'];
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }

try {
  for (const module of modules) {
    const source = await fs.readFile(path.join(root, module + (module.startsWith('components/') ? '.tsx' : '.ts')), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, q, name) => 'from ' + q + name + '.mjs' + q).replace(/from (['"])@\/([^'"]+)\1/g, (_, q, name) => { const relative = path.relative(path.dirname(module), name); return 'from ' + q + (relative.startsWith('.') ? relative : './' + relative) + '.mjs' + q; });
    const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, compiled);
  }
  const load = name => import(pathToFileURL(path.join(output, name + '.mjs')).href);
  const { createSampleProject } = await load('lib/engine/sample-project'), { parseProject } = await load('lib/engine/project'), { TestSession } = await load('lib/engine/session');
  const { itemPresentation, droppedObjectId } = await load('lib/engine/inventory'), { replaceUsedItem } = await load('lib/engine/item-interactions');
  const { createSavedGame, restoreSavedGame, projectFingerprint } = await load('lib/engine/save-game');
  const { setObjectImage } = await load('lib/editor/spatial-operations'), { DraftHistory } = await load('lib/editor/history');
  const { attachInventoryKeys } = await load('lib/player/inventory-controls'), { InventoryPanel } = await load('components/player/inventory-panel');
  const ids = ['paper', 'shirt', 'bottle'];
  function fixture() {
    const p = createSampleProject(), source = p.objects.find(o => o.id === 'paper'), definition = p.items[0];
    p.assets = ids.flatMap(id => ['world', 'icon'].map(kind => ({ id: id + '-' + kind, name: id + '-' + kind, kind: 'image', mime: 'image/png', bytes: 46, sha256: 'a'.repeat(64) })));
    p.assets.push({ ...p.assets[0], id: 'new-world', name: 'new-world' });
    p.items = ids.map(id => ({ ...structuredClone(definition), id: id + '-item', name: 'Name ' + id, description: 'Description ' + id, imageAssetId: id + '-icon', equipmentSlot: id === 'shirt' ? 'torso' : null }));
    p.objects = [...p.objects.filter(o => o.id !== 'paper'), ...ids.map(id => ({ ...structuredClone(source), id, name: 'World ' + id, notes: 'World description ' + id, imageAssetId: id + '-world', interaction: { ...source.interaction, itemDefinitionId: id + '-item', reach: 10 } }))];
    return parseProject(p);
  }
  const markup = session => renderToStaticMarkup(createElement(InventoryPanel, { session, state: session.snapshot(), onChange() {}, onClose() {}, onPause() {} }));
  const card = session => markup(session).split('<aside class="inventory-description">')[1].split('</aside>')[0];
  function assertCard(session, id) {
    const html = card(session); assert.ok(html.includes('<h3>Name ' + id + '</h3>')); assert.ok(html.includes('src="/api/assets/' + id + '-icon?variant=game"')); assert.ok(html.includes('<p>Description ' + id + '</p>'));
    for (const other of ids.filter(value => value !== id)) { assert.ok(!html.includes('Description ' + other)); assert.ok(!html.includes('/api/assets/' + other + '-icon')); }
  }
  function key(target, code, repeat = false) { const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat }); target.dispatchEvent(event); return event; }

  await check('All six pickup orders render each selected instance with its own picture and description', () => {
    for (const order of [ids, ['paper', 'bottle', 'shirt'], ['shirt', 'paper', 'bottle'], ['shirt', 'bottle', 'paper'], ['bottle', 'paper', 'shirt'], ['bottle', 'shirt', 'paper']]) {
      const s = new TestSession(fixture(), 1); order.forEach(id => s.takeObject(id));
      order.forEach((id, slot) => { s.selectSlot(slot); assertCard(s, id); });
    }
  });
  await check('Actual inventory keyboard events select another item and update the rendered detail card', () => {
    const s = new TestSession(fixture(), 1), target = new EventTarget(); ids.forEach(id => s.takeObject(id)); let changed = 0;
    const detach = attachInventoryKeys(target, () => s.snapshot().player.inventory.length, { onSelectSlot: slot => { s.selectSlot(slot); changed++; }, onClose() {}, onPause() {} });
    try { assertCard(s, 'paper'); assert.equal(key(target, 'Digit2').defaultPrevented, true); assertCard(s, 'shirt'); assert.equal(key(target, 'Numpad3').defaultPrevented, true); assertCard(s, 'bottle'); assert.equal(changed, 2); }
    finally { detach(); }
    key(target, 'Digit1'); assertCard(s, 'bottle'); assert.equal(changed, 2);
  });
  await check('Unavailable keys and repeats do not change selection; empty slots show no stale description', () => {
    const s = new TestSession(fixture(), 1), target = new EventTarget(); s.takeObject('paper'); let closed = 0, paused = 0;
    const detach = attachInventoryKeys(target, () => s.snapshot().player.inventory.length, { onSelectSlot: slot => s.selectSlot(slot), onClose: () => closed++, onPause: () => paused++ });
    try { key(target, 'Digit2', true); assertCard(s, 'paper'); assert.equal(key(target, 'Digit9').defaultPrevented, false); assertCard(s, 'paper'); key(target, 'Digit3'); assert.ok(card(s).includes('Пустая ячейка')); assert.ok(!card(s).includes('paper-icon')); assert.ok(!card(s).includes('Description paper')); key(target, 'Tab'); key(target, 'Escape'); assert.equal(closed, 1); assert.equal(paused, 1); }
    finally { detach(); }
  });
  await check('Editing the world drawing preserves the explicitly assigned inventory image and supports undo', () => {
    const p = fixture(), before = structuredClone(p), history = new DraftHistory(), changed = setObjectImage(p, 'paper', 'new-world'); history.record(p, changed);
    assert.deepEqual(changed.items, p.items); assert.equal(changed.objects.find(o => o.id === 'paper').imageAssetId, 'new-world'); assert.deepEqual(p, before); assert.deepEqual(history.undo(changed), p); assert.deepEqual(history.redo(p), changed);
    const s = new TestSession(changed, 1); s.takeObject('paper'); assertCard(s, 'paper'); assert.throws(() => setObjectImage(p, 'missing', null));
  });
  await check('Objects sharing a type use their own exact origin for unset inventory images and descriptions', () => {
    const p = fixture(); p.items[0].imageAssetId = null; p.items[0].description = ''; p.objects.find(o => o.id === 'bottle').interaction.itemDefinitionId = 'paper-item';
    const s = new TestSession(parseProject(p), 1); s.takeObject('bottle'); s.takeObject('paper');
    assert.equal(itemPresentation(s.project, s.snapshot(), 'instance-bottle').imageAssetId, 'bottle-world'); assert.equal(itemPresentation(s.project, s.snapshot(), 'instance-bottle').description, 'World description bottle');
    assert.equal(itemPresentation(s.project, s.snapshot(), 'instance-paper').imageAssetId, 'paper-world'); s.dropItem('instance-bottle');
    const dropped = s.worldObject(droppedObjectId('instance-bottle')); assert.equal(dropped.imageAssetId, 'bottle-world'); assert.equal(dropped.notes, 'World description bottle'); s.takeObject(dropped.id); assert.equal(itemPresentation(s.project, s.snapshot(), 'instance-bottle').description, 'World description bottle');
  });
  await check('Rewards without their own image or description never borrow the first world object', () => {
    const p = fixture(); p.items[0].imageAssetId = null; p.items[0].description = ''; const s = new TestSession(parseProject(p), 1); s.giveTestItem('paper-item');
    const id = s.snapshot().player.inventory[0], value = itemPresentation(s.project, s.snapshot(), id); assert.equal(value.imageAssetId, null); assert.equal(value.description, ''); assert.equal(itemPresentation(s.project, s.snapshot(), null), null); assert.equal(itemPresentation(s.project, s.snapshot(), 'missing'), null);
  });
  await check('Reusing a vacated slot and equipping clothing do not retain the first item presentation', () => {
    const s = new TestSession(fixture(), 1); s.takeObject('paper'); assertCard(s, 'paper'); s.dropItem(); s.takeObject('shirt'); assertCard(s, 'shirt'); s.equip('instance-shirt', 'torso'); s.takeObject('bottle'); assertCard(s, 'bottle');
    assert.equal(itemPresentation(s.project, s.snapshot(), s.snapshot().player.equipment.torso).imageAssetId, 'shirt-icon'); s.unequip('torso'); s.selectSlot(s.snapshot().player.inventory.indexOf('instance-shirt')); assertCard(s, 'shirt');
  });
  await check('A transformed item uses the new type and does not leak its former world picture or notes', () => {
    const p = fixture(); p.items.find(i => i.id === 'bottle-item').imageAssetId = null; p.items.find(i => i.id === 'bottle-item').description = '';
    const s = new TestSession(parseProject(p), 1); s.takeObject('paper'); const state = s.snapshot(); replaceUsedItem(s.project, state, 'bottle-item', { objectId: 'pot', itemInstanceId: 'instance-paper' });
    const changed = TestSession.restore(s.project, 1, state), value = itemPresentation(changed.project, changed.snapshot(), 'instance-paper'); assert.equal(value.name, 'Name bottle'); assert.equal(value.imageAssetId, null); assert.equal(value.description, '');
  });
  await check('Existing save format and content fingerprint remain compatible after pickup, selection and restoration', async () => {
    const p = fixture(), s = new TestSession(p, 1); s.takeObject('paper'); s.takeObject('bottle'); s.selectSlot(1); const before = await projectFingerprint(p), packet = await createSavedGame(p, 1, s.snapshot());
    const restored = TestSession.restore(p, 1, await restoreSavedGame(packet.save, packet.checksum, p, 1)); assertCard(restored, 'bottle'); assert.equal(await projectFingerprint(p), before); assert.deepEqual(restored.snapshot().items, s.snapshot().items);
  });
  console.log('Inventory display checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
