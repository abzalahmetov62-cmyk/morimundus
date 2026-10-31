import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'asset-recovery-check-' + process.pid), compiled = new Set();
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
const original = new Map(['fetch', 'Image', 'document', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const nativeTimeout = globalThis.setTimeout;
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
try {
  const { retryAsset, fetchAssetImage, AssetLoadError, abortable, recoverImage } = await load('lib/player/asset-loading');
  const { PlayerAssets } = await load('lib/player/assets'), { ResourcePool } = await load('lib/player/resource-pool');
  const { LocationScene } = await load('lib/player/location-scene'), { FirstPersonWorld } = await load('lib/player/world');
  const { createSampleProject } = await load('lib/engine/sample-project');
  const response = () => new Response(new Blob(['png'], { type: 'image/png' }), { headers: { 'content-length': '3' } });
  await check('Transient HTTP and network errors retry and bypass the failed cache entry', async () => {
    const requests = [];
    setGlobal('fetch', async (_, options) => { requests.push(options.cache); if (requests.length === 1) return new Response('', { status: 503 }); if (requests.length === 2) throw new TypeError('offline'); return response(); });
    const signal = new AbortController().signal;
    assert.equal((await retryAsset(attempt => fetchAssetImage('/asset', signal, attempt), signal, () => 0)).size, 3);
    assert.deepEqual(requests, ['default', 'reload', 'reload']);
  });
  await check('Permanent missing/private assets fail once; repeated transient failures stop after three tries', async () => {
    for (const status of [401, 403, 404, 422]) {
      let calls = 0; setGlobal('fetch', async () => { calls++; return new Response('', { status }); });
      const signal = new AbortController().signal;
      await assert.rejects(retryAsset(attempt => fetchAssetImage('/asset', signal, attempt), signal, () => 0)); assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(retryAsset(async () => { calls++; throw new TypeError('offline'); }, new AbortController().signal, () => 0)); assert.equal(calls, 3);
  });
  await check('Empty, truncated and non-image responses cannot become textures', async () => {
    for (const body of [new Response(new Blob([])), new Response(new Blob(['png'], { type: 'image/png' }), { headers: { 'content-length': '9' } })]) {
      setGlobal('fetch', async () => body); await assert.rejects(fetchAssetImage('/asset', new AbortController().signal, 0), error => error instanceof AssetLoadError && error.retryable);
    }
    setGlobal('fetch', async () => new Response('login page', { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(fetchAssetImage('/asset', new AbortController().signal, 0), error => !error.retryable);
  });
  await check('Abort releases a hanging decode and cancels the retry delay', async () => {
    const controller = new AbortController(), pending = abortable(new Promise(() => {}), controller.signal);
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    const lifetime = new AbortController(); let calls = 0;
    const retry = retryAsset(async () => { calls++; throw new Error('offline'); }, lifetime.signal, () => 60000);
    await flush(); lifetime.abort(); await assert.rejects(retry, { name: 'AbortError' }); assert.equal(calls, 1);
  });

  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }) }) });
  setGlobal('document', { createElement: canvas });
  setGlobal('setTimeout', (callback, ms, ...args) => nativeTimeout(callback, ms <= 2000 ? 0 : ms, ...args));
  await check('The actual texture loader retries a decode error, shares the result and revokes every object URL', async () => {
    let requests = 0, decodes = 0, created = 0, revoked = 0;
    const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = blob => { created++; return createUrl(blob); }; URL.revokeObjectURL = url => { revoked++; revokeUrl(url); };
    setGlobal('fetch', async () => { requests++; return response(); });
    setGlobal('Image', class { naturalWidth = 2; naturalHeight = 2; src = ''; async decode() { if (++decodes === 1) throw new Error('decode failed'); } });
    const assets = new PlayerAssets();
    try {
      const a = assets.acquire('picture'), b = assets.acquire('picture');
      const [first, second] = await Promise.all([a.promise, b.promise]); assert.equal(first, second); assert.equal(requests, 2); assert.equal(created, revoked); assert.equal(first.alpha.values.length, 4);
      a.release(); b.release(); assets.dispose(); assert.equal(first.texture.image.width, 0);
    } finally { assets.dispose(); URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; }
  });
  await check('Unreadable optimized images fall back to the original on the final texture attempt', async () => {
    const requests = []; let lastRequest;
    setGlobal('fetch', async url => { lastRequest = url; requests.push(url); return response(); });
    setGlobal('Image', class { naturalWidth = 2; naturalHeight = 2; src = ''; async decode() { if (lastRequest.includes('variant=')) throw new Error('bad optimized copy'); } });
    const assets = new PlayerAssets(), lease = assets.acquire('fallback');
    try { await lease.promise; assert.deepEqual(requests, ['/api/assets/fallback?variant=game', '/api/assets/fallback?variant=game', '/api/assets/fallback']); }
    finally { lease.release(); assets.dispose(); }
  });
  await check('Disposal cancels a stuck real image decode and releases the pool', async () => {
    let decoding; const started = new Promise(resolve => { decoding = resolve; });
    setGlobal('fetch', async () => response()); setGlobal('Image', class { src = ''; decode() { decoding(); return new Promise(() => {}); } });
    const assets = new PlayerAssets(), lease = assets.acquire('stuck'); await started;
    assets.dispose(); await assert.rejects(lease.promise, { name: 'AbortError' }); await flush(); assert.equal(assets.stats().loading, 0);
  });
  setGlobal('setTimeout', nativeTimeout);
  await check('A failed resource lease can be reacquired without poisoning the cache', async () => {
    let calls = 0; const pool = new ResourcePool({ load: async () => { if (++calls === 1) throw new Error('offline'); return 'ok'; }, bytes: () => 1, dispose() {} });
    const first = pool.acquire('asset'); await assert.rejects(first.promise); first.release(); const next = pool.acquire('asset'); assert.equal(await next.promise, 'ok'); assert.equal(calls, 2); next.release(); pool.dispose();
  });
  await check('Room and object textures recover together in place; good textures are not downloaded again', async () => {
    const project = createSampleProject(), location = project.locations[0]; location.rooms[0].wallAssetId = 'missing'; location.rooms[0].floorAssetId = 'good';
    const object = { ...project.objects[0], imageAssetId: 'missing' }, calls = new Map(), missing = { texture: new THREE.Texture(), alpha: { width: 1, height: 1, values: new Uint8Array([255]) }, aspect: 2 };
    let available = false;
    const assets = { acquire(id) { calls.set(id, (calls.get(id) ?? 0) + 1); return { promise: id === 'missing' && !available ? Promise.reject(new Error('offline')) : Promise.resolve(missing), release() {} }; }, placeholder: () => new THREE.Texture(), tiled: texture => texture.clone() };
    const scene = new LocationScene(location, [object], '#ffffff', false, assets); await scene.load();
    assert.equal(calls.get('missing'), 1); assert.equal(calls.get('good'), 1); assert.ok(scene.warnings.length > 0);
    const roots = [...scene.scene.children], drawable = scene.drawables.get(object.id); available = true;
    const a = scene.retryMissing(), b = scene.retryMissing(); assert.equal(a, b); await a;
    assert.deepEqual(scene.scene.children, roots); assert.equal(scene.drawables.get(object.id), drawable); assert.equal(drawable.mesh.material.map, missing.texture); assert.equal(drawable.aspect, 2); assert.equal(drawable.mesh.userData.alpha, missing.alpha);
    assert.equal(scene.warnings.length, 0); assert.equal(calls.get('missing'), 2); assert.equal(calls.get('good'), 1); await scene.retryMissing(); assert.equal(calls.get('missing'), 2); scene.dispose();
  });
  await check('Disposing a room while recovery is pending never updates released geometry', async () => {
    const project = createSampleProject(), object = { ...project.objects[0], imageAssetId: 'late' }; let complete, calls = 0;
    const assets = { acquire() { return { promise: ++calls === 1 ? Promise.reject(new Error('offline')) : new Promise(resolve => { complete = resolve; }), release() {} }; }, placeholder: () => new THREE.Texture() };
    const scene = new LocationScene(project.locations[0], [object], '#ffffff', false, assets); await scene.load(); const pending = scene.retryMissing(); scene.dispose(); complete({ texture: new THREE.Texture(), alpha: null, aspect: 1 }); await pending; assert.equal(scene.drawables.size, 0); assert.equal(scene.scene.children.length, 0);
  });
  await check('World recovery preserves input, position and interaction mode and coalesces concurrent requests', async () => {
    let complete, calls = 0, warnings; const visual = { warnings: [], retryMissing() { calls++; return new Promise(resolve => { complete = resolve; }); } };
    const world = Object.create(FirstPersonWorld.prototype); Object.assign(world, { visual, disposed: false, travelling: false, callbacks: { onResources: value => { warnings = value; }, onTravel() { assert.fail('no travel'); } }, input: { pause() { assert.fail('no input change'); } }, session: { pose() { assert.fail('no pose change'); } } });
    const first = world.retryResources(), second = world.retryResources(); assert.equal(first, second); complete(); await first; assert.equal(calls, 1); assert.deepEqual(warnings, []); assert.equal(world.dirty, true);
  });

  await check('DOM pictures retry twice, recover after online and stop when loaded or unmounted', async () => {
    const tasks = new Map(); let serial = 0;
    setGlobal('setTimeout', fn => { tasks.set(++serial, fn); return serial; }); setGlobal('clearTimeout', id => tasks.delete(id));
    const tick = async () => { const first = tasks.entries().next().value; if (first) { tasks.delete(first[0]); first[1](); } await flush(); };
    class Picture extends EventTarget { src = '/picture'; complete = true; naturalWidth = 0; }
    const image = new Picture(), host = new EventTarget(), dispose = recoverImage(image, '/picture?size=small', host);
    assert.equal(tasks.size, 1); await tick(); assert.equal(image.src, '/picture?size=small&image_retry=1'); image.dispatchEvent(new Event('error')); await tick(); image.dispatchEvent(new Event('error')); assert.equal(tasks.size, 0);
    host.dispatchEvent(new Event('online')); assert.equal(tasks.size, 1); await tick(); assert.equal(image.src, '/picture?size=small&image_retry=3'); image.dispatchEvent(new Event('error')); image.dispatchEvent(new Event('load')); assert.equal(tasks.size, 0);
    image.dispatchEvent(new Event('error')); dispose(); const before = image.src; await tick(); host.dispatchEvent(new Event('online')); assert.equal(image.src, before); assert.equal(tasks.size, 0);
    const stalled = new Picture(); stalled.complete = false;
    const stop = recoverImage(stalled, '/stalled', host); assert.equal(tasks.size, 1); await tick(); await tick(); assert.equal(stalled.src, '/stalled?image_retry=1'); stop(); assert.equal(tasks.size, 0);
  });
  console.log('Asset recovery checks passed: ' + passed);
} finally {
  for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await fs.rm(output, { recursive: true, force: true });
}
