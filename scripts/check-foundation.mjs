import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const output = path.join(root, '.sites-runtime', `foundation-check-${process.pid}`);
const modules = ['engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'storage/asset-format', 'storage/client', 'storage/backup'];
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const sha = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');

try {
  for (const module of modules) {
    const source = await fs.readFile(path.join(root, 'lib', `${module}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, name) => `from ${quote}${name}.mjs${quote}`);
    const file = path.join(output, `${module}.mjs`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, compiled);
  }
  const load = module => import(pathToFileURL(path.join(output, `${module}.mjs`)).href);
  const { parseProject } = await load('engine/project');
  const { createSampleProject } = await load('engine/sample-project');
  const { TestSession } = await load('engine/session');
  const { parseGameState } = await load('engine/game-state');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  const { detectAsset } = await load('storage/asset-format');
  const p = createSampleProject();

  await check('Project format round trip preserves all systems and stable IDs', () => {
    assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
    for (const key of ['assets', 'locations', 'objects', 'items', 'character', 'flags', 'scripts', 'rules', 'checks', 'quests', 'recipes', 'schedules']) assert.ok(Object.hasOwn(p, key));
    assert.equal(p.settings.baseInventorySlots, 3);
  });
  await check('Unknown versions and missing references are rejected', () => {
    assert.throws(() => parseProject({ ...p, formatVersion: 2 }), /версия/);
    assert.throws(() => parseProject({ ...p, settings: { ...p.settings, startLocationId: 'missing' } }), /отсутствующий/);
    assert.throws(() => parseProject({ ...p, objects: [...p.objects, p.objects[0]] }), /Повторяются/);
  });
  await check('Nested conditions validate references and excessive depth fails safely', () => {
    const nested = { type: 'all', conditions: [{ type: 'any', conditions: [{ type: 'compare', source: 'flag', key: 'awakened', operator: 'eq', value: true }, { type: 'not', condition: { type: 'literal', value: false } }] }] };
    parseProject({ ...p, objects: p.objects.map((o, i) => i ? o : { ...o, visibleWhen: nested }) });
    assert.throws(() => parseProject({ ...p, objects: p.objects.map((o, i) => i ? o : { ...o, visibleWhen: { type: 'compare', source: 'flag', key: 'missing', operator: 'eq', value: true } }) }), /Флаг не найден/);
    let deep = { type: 'literal', value: true };
    for (let i = 0; i < 70; i++) deep = { type: 'not', condition: deep };
    assert.throws(() => parseProject({ ...p, objects: p.objects.map((o, i) => i ? o : { ...o, visibleWhen: deep }) }), /сложный/);
  });
  await check('Test state never mutates the author draft or previous snapshots', () => {
    const before = JSON.stringify(p);
    const session = new TestSession(p, 3);
    session.setFlag('awakened', true);
    session.setObjectPresence('paper', false);
    const snapshot = session.snapshot();
    snapshot.flags.awakened = false;
    snapshot.player.position[0] = 99;
    assert.equal(session.snapshot().flags.awakened, true);
    assert.notEqual(session.snapshot().player.position[0], 99);
    assert.equal(JSON.stringify(p), before);
    assert.throws(() => { session.project.objects[0].initialState.changed = true; }, TypeError);
    assert.equal(new TestSession(p, 3).snapshot().objects.paper.present, true);
  });
  await check('Multiple pause reasons compose and time resumes only after all clear', () => {
    const session = new TestSession(p, 1);
    const initial = session.snapshot().clock.worldSeconds;
    session.pause('menu'); session.pause('interaction'); session.pause('menu');
    assert.equal(session.snapshot().clock.pausedBy.length, 2);
    session.tick(60); session.resume('menu'); session.tick(60);
    assert.equal(session.snapshot().clock.worldSeconds, initial);
    session.resume('interaction'); session.tick(60);
    assert.equal(session.snapshot().clock.worldSeconds, initial + 60);
    assert.throws(() => session.tick(-1));
  });
  await check('Save format rejects duplicate ownership and mismatched projects', () => {
    const state = new TestSession(p, 1).snapshot();
    assert.deepEqual(parseGameState(JSON.parse(JSON.stringify(state)), p), state);
    const id = 'instance-paper';
    state.items[id].owner = { type: 'inventory', slot: 0 };
    state.player.inventory[0] = id;
    parseGameState(state, p);
    state.player.inventory[1] = id;
    assert.throws(() => parseGameState(state, p), /предмет|владельцем/);
    assert.throws(() => parseGameState({ ...new TestSession(p, 1).snapshot(), projectId: 'other' }, p), /другому проекту/);
  });
  await check('File signatures reject unsupported bytes', () => {
    assert.deepEqual(detectAsset(png), { kind: 'image', mime: 'image/png' });
    assert.equal(detectAsset(new TextEncoder().encode('<svg onload="evil()"/>')), null);
  });

  const originalFetch = globalThis.fetch;
  const asset = { id: 'image-original', name: 'Рисунок.png', kind: 'image', mime: 'image/png', bytes: png.length, sha256: await sha(png) };
  const imageProject = parseProject({ ...p, assets: [asset], objects: p.objects.map((o, i) => i ? o : { ...o, imageAssetId: asset.id }) });
  try {
    globalThis.fetch = async url => {
      assert.equal(url, '/api/assets/image-original');
      return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    };
    const backup = await createBackup(imageProject);
    const file = new File([JSON.stringify(backup)], 'Morimundus.json', { type: 'application/json' });
    await check('Complete backup round trip includes and verifies resource bytes', async () => {
      const parsed = await parseBackup(file);
      assert.deepEqual(parsed.project, imageProject);
      assert.equal(parsed.resources.length, 1);
    });
    await check('Damaged backups fail without changing the active author data', async () => {
      const corrupted = { ...backup, resources: [{ id: asset.id, base64: btoa('broken') }] };
      await assert.rejects(parseBackup(new File([JSON.stringify(corrupted)], 'broken.json')), /повреждён/);
      await assert.rejects(parseBackup(new File([JSON.stringify({ ...backup, resources: [] })], 'missing.json')), /неполный/);
      await assert.rejects(parseBackup(new File(['{bad'], 'bad.json')), /резервной копии/);
      assert.equal(imageProject.objects[0].imageAssetId, asset.id);
    });
    await check('Restoring to fresh storage remaps IDs and retains every asset reference', async () => {
      globalThis.fetch = async (url, options) => {
        if (url === '/api/assets/image-original') return new Response('', { status: 404 });
        assert.equal(url, '/api/assets');
        assert.equal(options.method, 'POST');
        const file = options.body.get('file');
        assert.equal(await sha(new Uint8Array(await file.arrayBuffer())), asset.sha256);
        return Response.json({ ...asset, id: 'image-restored' }, { status: 201 });
      };
      const restored = await restoreBackup(await parseBackup(file));
      assert.equal(restored.assets[0].id, 'image-restored');
      assert.equal(restored.objects[0].imageAssetId, 'image-restored');
      assert.equal(imageProject.assets[0].id, 'image-original');
    });
  } finally { globalThis.fetch = originalFetch; }

  const originIndex = process.argv.indexOf('--origin');
  if (originIndex >= 0) {
    const origin = process.argv[originIndex + 1];
    const api = (route, options) => fetch(new URL(route, origin), options);
    const initial = await (await api('/api/project')).json();
    let current;
    await check('HTTP saves persist across a second independent read', async () => {
      const next = structuredClone(initial.project);
      next.meta.description = `${initial.project.meta.description}\nПроверка сохранения ${Date.now()}`;
      const response = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: next, expectedRevision: initial.revision }) });
      assert.equal(response.status, 200, await response.clone().text());
      current = await response.json();
      const reopened = await (await api('/api/project')).json();
      assert.equal(reopened.revision, initial.revision + 1);
      assert.deepEqual(reopened.project, next);
    });
    await check('A stale tab cannot overwrite a newer saved revision', async () => {
      const stale = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: initial.project, expectedRevision: initial.revision }) });
      assert.equal(stale.status, 409);
      assert.deepEqual((await (await api('/api/project')).json()).project, current.project);
    });
    await check('Malformed and cross-site writes are rejected without data loss', async () => {
      const invalid = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
      assert.equal(invalid.status, 422);
      const cross = await api('/api/project', { method: 'PUT', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' });
      assert.equal(cross.status, 403);
      const newer = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { ...current.project, formatVersion: 999 }, expectedRevision: current.revision }) });
      assert.equal(newer.status, 422);
    });
    await check('Upload, reference, read-back and backup use real persistent resource storage', async () => {
      const form = new FormData(); form.set('file', new File([png], 'check.png', { type: 'image/png' }));
      const response = await api('/api/assets', { method: 'POST', body: form });
      assert.equal(response.status, 201, await response.clone().text());
      const uploaded = await response.json();
      const wav = Buffer.alloc(46);
      wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40); wav[44] = 128; wav[45] = 128;
      const audioForm = new FormData(); audioForm.set('file', new File([wav], 'check.wav', { type: 'audio/wav' }));
      const audioResponse = await api('/api/assets', { method: 'POST', body: audioForm });
      assert.equal(audioResponse.status, 201, await audioResponse.clone().text());
      const audio = await audioResponse.json();
      assert.equal(audio.kind, 'audio');
      const audioRead = await api(`/api/assets/${audio.id}`);
      assert.equal(audioRead.headers.get('Content-Type'), 'audio/wav');
      assert.equal(await sha(new Uint8Array(await audioRead.arrayBuffer())), audio.sha256);
      const saved = structuredClone(current.project);
      saved.assets.push(uploaded, audio); saved.objects[0].imageAssetId = uploaded.id;
      saved.locations[0].audio.musicAssetId = audio.id;
      saved.objects[0].interaction.audioAssetId = audio.id;
      const savedResponse = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: saved, expectedRevision: current.revision }) });
      assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
      current = await savedResponse.json();
      const resource = await api(`/api/assets/${uploaded.id}`);
      assert.equal(resource.headers.get('Content-Type'), 'image/png');
      assert.equal(await sha(new Uint8Array(await resource.arrayBuffer())), uploaded.sha256);
      const realFetch = globalThis.fetch;
      try {
        globalThis.fetch = (url, options) => realFetch(new URL(url, origin), options);
        const backup = await parseBackup(new File([JSON.stringify(await createBackup(current.project))], 'real-backup.json'));
        assert.deepEqual(await restoreBackup(backup), current.project);
      } finally { globalThis.fetch = realFetch; }
    });
    await check('Unsupported uploads fail and original author project is restored', async () => {
      const form = new FormData(); form.set('file', new File(['not an image'], 'unsafe.svg', { type: 'image/svg+xml' }));
      assert.equal((await api('/api/assets', { method: 'POST', body: form })).status, 422);
      const restored = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: initial.project, expectedRevision: current.revision }) });
      assert.equal(restored.status, 200, await restored.clone().text());
      assert.deepEqual((await (await api('/api/project')).json()).project, initial.project);
    });
  }
  console.log(`Foundation checks passed: ${passed}`);
} finally { await fs.rm(output, { recursive: true, force: true }); }
