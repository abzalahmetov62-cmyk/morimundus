import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'image-optimization-check-' + process.pid), compiled = new Set();
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
const originals = new Map(['fetch', 'Image', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const webp = new Uint8Array(Buffer.from('UklGRnwAAABXRUJQVlA4WAoAAAAQAAAAPwAAHwAAQUxQSCEAAAABFyAQSFKffI2ICAdFbRsxJdnjj2bPZ0T/JwANCrU/Vx0AVlA4IDQAAAAwAwCdASpAACAAPikSh0IhoQsGqmYMAUJaQAAPl1CC99yAAP7+hn//5cg152n//K0AAAAA', 'base64'));
const lossless = new Uint8Array(Buffer.from('UklGRjQAAABXRUJQVlA4TCgAAAAvP8AHEBcwIAMyIAKCoudMD/gIito2YsqfSQ/ons+I/k8AGqRof646', 'base64'));
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAZklEQVR4nO3QsRGAMAwEwceVqFMoVaW4AxOZY8a3sYLTJ5JOdr0dVNWT5N6fskd3L38cX4X8lQPQATQHoANoDkAH0ByADqA5AB1AcwA6gOYAdADNAegAmgPQATQHoANoDkAHSBJpAhD/BDDr5udCAAAAAElFTkSuQmCC', 'base64'));
try {
  const { optimizationCandidate, optimizedImageKey, imageSize, worthwhileImage, webpInfo, animatedImage, IMAGE_VARIANT_PREFIX } = await load('lib/storage/image-optimization');
  const { optimizeImage, ImageEncoderUnavailable } = await load('lib/editor/optimize-image');
  const { prepareGameImages } = await load('lib/editor/image-preparation'), { assetUrl } = await load('lib/storage/client');
  const { retryImageUrl } = await load('lib/player/asset-loading');
  const asset = { id: 'picture', name: 'Drawing', kind: 'image', mime: 'image/png', bytes: 200000, sha256: 'a'.repeat(64) };
  const paddedPng = new Uint8Array(asset.bytes); paddedPng.set(png);
  await check('Only large static image formats qualify; audio, GIFs and tiny files retain their original path', () => {
    assert.ok(optimizationCandidate(asset)); for (const change of [{ kind: 'audio' }, { mime: 'image/gif' }, { bytes: 1000 }]) assert.equal(optimizationCandidate({ ...asset, ...change }), false);
    assert.equal(assetUrl('a b'), '/api/assets/a%20b'); assert.equal(assetUrl('a b', 'game'), '/api/assets/a%20b?variant=game');
    assert.equal(retryImageUrl(assetUrl('picture', 'game'), 2), '/api/assets/picture?image_retry=2');
    assert.equal(optimizedImageKey(asset.sha256), IMAGE_VARIANT_PREFIX + asset.sha256 + '.webp'); assert.throws(() => optimizedImageKey('../original'));
  });
  await check('Game copies keep aspect ratio, never upscale and require meaningful savings', () => {
    assert.deepEqual(imageSize(4096, 2048), { width: 1024, height: 512 }); assert.deepEqual(imageSize(50, 100), { width: 50, height: 100 }); assert.deepEqual(imageSize(1, 8000), { width: 1, height: 1024 });
    assert.throws(() => imageSize(0, 1)); assert.ok(worthwhileImage(200000, 50000)); assert.equal(worthwhileImage(200000, 190000), false); assert.equal(worthwhileImage(200000, 0), false);
  });
  await check('Real lossy-alpha and lossless WebP fixtures parse; corrupt and truncated files do not', () => {
    for (const bytes of [webp, lossless]) assert.deepEqual(webpInfo(bytes), { width: 64, height: 32, animated: false });
    assert.equal(webpInfo(webp.slice(0, -1)), null); assert.equal(webpInfo(png), null);
    const animated = webp.slice(); animated[20] |= 2; assert.equal(animatedImage(animated, 'image/webp'), true);
    const apng = new Uint8Array(53); apng.set(png.slice(0, 33)); apng.set([0, 0, 0, 8, 97, 99, 84, 76], 33);
    assert.equal(animatedImage(apng, 'image/png'), true); assert.equal(animatedImage(png, 'image/png'), false);
  });
  const canvases = []; let decodes = 0, outputBlob = new Blob([webp], { type: 'image/webp' }), encodingQuality, drawn;
  setGlobal('Image', class { src = ''; naturalWidth = 4096; naturalHeight = 2048; async decode() { decodes++; } });
  setGlobal('document', { createElement() { const canvas = { width: 0, height: 0, getContext: () => ({ drawImage(...args) { drawn = args.slice(1); }, fillRect() { assert.fail('transparency must not be flattened'); } }), toBlob(callback, type, quality) { encodingQuality = [type, quality]; callback(outputBlob); } }; canvases.push(canvas); return canvas; } });
  await check('The browser compressor draws a transparent canvas at game resolution and releases its buffers', async () => {
    const source = new Blob([paddedPng], { type: 'image/png' }), result = await optimizeImage(source, new AbortController().signal);
    assert.equal(result, outputBlob); assert.deepEqual(drawn, [0, 0, 1024, 512]); assert.deepEqual(encodingQuality, ['image/webp', .92]); assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)); assert.equal(source.size, 200000);
  });
  await check('Unsupported WebP encoding cannot create a permanent skip marker; larger output is discarded', async () => {
    outputBlob = new Blob([webp], { type: 'image/png' }); await assert.rejects(optimizeImage(new Blob([paddedPng], { type: 'image/png' }), new AbortController().signal), ImageEncoderUnavailable);
    outputBlob = new Blob([paddedPng], { type: 'image/webp' }); assert.equal(await optimizeImage(new Blob([paddedPng], { type: 'image/png' }), new AbortController().signal), null);
    const before = decodes; assert.equal(await optimizeImage(new Blob([webp.map((value, index) => index === 20 ? value | 2 : value)], { type: 'image/webp' }), new AbortController().signal), null); assert.equal(decodes, before);
    outputBlob = new Blob([webp], { type: 'image/webp' });
  });
  await check('Closing the editor cancels a hanging decode and clears its canvas', async () => {
    let start; const started = new Promise(resolve => { start = resolve; }); setGlobal('Image', class { src = ''; decode() { start(); return new Promise(() => {}); } });
    const lifetime = new AbortController(), pending = optimizeImage(new Blob([paddedPng], { type: 'image/png' }), lifetime.signal); await started; lifetime.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.ok(canvases.every(canvas => canvas.width === 0));
  });
  await check('Automatic preparation skips completed hashes, deduplicates files and uploads copies sequentially without editing metadata', async () => {
    const assets = [asset, { ...asset, id: 'same-image' }, { ...asset, id: 'other', sha256: 'b'.repeat(64) }, { ...asset, id: 'done', sha256: 'c'.repeat(64) }, { ...asset, id: 'sound', kind: 'audio', mime: 'audio/wav' }], before = JSON.stringify(assets), requests = [], progress = [];
    setGlobal('fetch', async (url, options = {}) => { requests.push([url, options]); if (url === '/api/assets/optimization') return Response.json({ completed: ['c'.repeat(64)] }); if (options.method === 'PUT') return Response.json({ ready: true }); return new Response(new Blob([paddedPng], { type: 'image/png' })); });
    let active = 0, maximum = 0, calls = 0;
    await prepareGameImages(assets, new AbortController().signal, value => progress.push(value), async () => { active++; maximum = Math.max(active, maximum); await flush(); active--; return ++calls === 1 ? outputBlob : null; });
    assert.equal(maximum, 1); assert.equal(calls, 2); assert.equal(requests.length, 5); assert.equal(requests.filter(([url]) => url.includes('?')).length, 0);
    const puts = requests.filter(([, options]) => options.method === 'PUT'); assert.equal(puts[0][1].body, outputBlob); assert.equal(puts[1][1].body, '{"skip":true}'); assert.deepEqual(progress.at(-1), { done: 3, total: 3, failed: 0, running: false, unavailable: false }); assert.equal(JSON.stringify(assets), before);
  });
  await check('A failed upload is postponed, other files proceed, and unavailable encoders never mark a file completed', async () => {
    const progress = [], requests = [];
    setGlobal('fetch', async (url, options = {}) => { requests.push([url, options]); if (url.endsWith('/optimization')) return Response.json({ completed: [] }); if (options.method === 'PUT') return url.includes('/picture/') ? new Response('', { status: 503 }) : Response.json({ ready: true }); return new Response(new Blob([paddedPng], { type: 'image/png' })); });
    await prepareGameImages([asset, { ...asset, id: 'other', sha256: 'b'.repeat(64) }], new AbortController().signal, value => progress.push(value), async () => outputBlob);
    assert.equal(progress.at(-1).failed, 1); assert.equal(progress.at(-1).done, 1);
    requests.length = 0; await prepareGameImages([asset], new AbortController().signal, value => progress.push(value), async () => { throw new ImageEncoderUnavailable(); }); assert.equal(progress.at(-1).unavailable, true); assert.equal(requests.some(([, options]) => options.method === 'PUT'), false);
  });

  // Exercise actual route handlers with storage and identity adapters, without a preview server.
  await compile('app/api/assets/[id]/route'); await compile('app/api/assets/[id]/optimized/route'); await compile('app/api/assets/optimization/route');
  const stub = async (module, source) => fs.writeFile(path.join(output, module + '.mjs'), source);
  await stub('lib/storage/server', `export class StorageError extends Error { constructor(message,status=503){super(message);this.status=status;} } export const bucket=()=>globalThis.__compression.bucket; export const readAsset=async id=>{const asset=globalThis.__compression.assets.get(id);if(!asset)throw new StorageError('missing',404);return {asset,key:'resources/'+id};}; export const rejectCrossSite=request=>{if(request.headers.get('sec-fetch-site')==='cross-site')throw new StorageError('cross site',403);}; export const errorResponse=error=>Response.json({error:error.message},{status:error.status??503});`);
  await stub('lib/storage/access', `import {StorageError} from './server.mjs'; export const requireAuthor=async()=>{if(!globalThis.__compression.author)throw new StorageError('author only',403);}; export const authorAccess=async()=>globalThis.__compression.author;`);
  await stub('lib/storage/publication-server', `export const readPublication=async()=>({project:{assets:[{id:'picture'}]}});`);
  await stub('app/chatgpt-auth', `export const getChatGPTUser=async()=>null;`);
  const routes = await load('app/api/assets/[id]/route'), write = await load('app/api/assets/[id]/optimized/route'), status = await load('app/api/assets/optimization/route');
  const objects = new Map(), calls = [];
  const record = (body, type) => ({ bytes: new Uint8Array(body), httpMetadata: { contentType: type } });
  const read = key => { const object = objects.get(key); return object ? { size: object.bytes.length, httpMetadata: object.httpMetadata, body: new Blob([object.bytes]).stream() } : null; };
  globalThis.__compression = { author: true, assets: new Map([['picture', asset], ['private-picture', { ...asset, id: 'private-picture', sha256: 'b'.repeat(64) }]]), bucket: { async get(key) { calls.push(['get', key]); return read(key); }, async head(key) { calls.push(['head', key]); return read(key); }, async put(key, body, options) { calls.push(['put', key]); objects.set(key, record(typeof body === 'string' ? new TextEncoder().encode(body) : body, options.httpMetadata.contentType)); }, async list() { return { objects: [...objects.keys()].map(key => ({ key })), truncated: false }; } } };
  objects.set('resources/picture', record(paddedPng, 'image/png')); objects.set('resources/private-picture', record(paddedPng, 'image/png'));
  const context = id => ({ params: Promise.resolve({ id }) });
  const request = (query = '') => new Request('https://game.test/api/assets/picture' + query);
  const upload = (body = webp, type = 'image/webp', headers = {}) => new Request('https://game.test/api/assets/picture/optimized', { method: 'PUT', headers: { 'Content-Type': type, ...headers }, body });
  await check('Writing an optimized copy preserves original bytes and original asset metadata exactly', async () => {
    const before = JSON.stringify(asset); assert.equal((await write.PUT(upload(), context('picture'))).status, 200); assert.deepEqual(objects.get('resources/picture').bytes, paddedPng); assert.equal(JSON.stringify(asset), before); assert.deepEqual(objects.get(optimizedImageKey(asset.sha256)).bytes, webp);
  });
  await check('Game URLs serve the copy while backup and validation URLs retain the exact original', async () => {
    const game = await routes.GET(request('?variant=game'), context('picture')); assert.equal(game.headers.get('content-type'), 'image/webp'); assert.equal(game.headers.get('content-length'), String(webp.length)); assert.deepEqual(new Uint8Array(await game.arrayBuffer()), webp);
    const original = await routes.GET(request(), context('picture')); assert.equal(original.headers.get('content-type'), 'image/png'); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), paddedPng);
    const head = await routes.HEAD(request(), context('picture')); assert.equal(head.headers.get('content-length'), String(asset.bytes)); assert.equal(await head.text(), '');
  });
  await check('Private originals and their variants remain inaccessible to players; write and status APIs require the author', async () => {
    globalThis.__compression.author = false;
    assert.equal((await routes.GET(new Request('https://game.test/api/assets/private-picture?variant=game'), context('private-picture'))).status, 404);
    assert.equal((await write.PUT(upload(), context('picture'))).status, 403); assert.equal((await status.GET()).status, 403);
    const published = await routes.GET(request('?variant=game'), context('picture')); assert.equal(published.status, 200); assert.equal(published.headers.get('cache-control'), 'private, max-age=3600'); globalThis.__compression.author = true;
  });
  await check('Cross-site, oversized, malformed, animated and wrong-format copies cannot enter storage', async () => {
    const big = webp.slice(); big[24] = 255; big[25] = 7;
    const animation = webp.slice(); animation[20] |= 2;
    for (const [req, code] of [[upload(webp, 'image/webp', { 'sec-fetch-site': 'cross-site' }), 403], [upload(png), 422], [upload(animation), 422], [upload(big), 422], [upload(webp, 'image/png'), 422], [upload(new Uint8Array(200000)), 413], [upload('{"skip":true}' + ' '.repeat(200), 'application/json'), 413]]) {
      const before = calls.filter(([kind]) => kind === 'put').length; assert.equal((await write.PUT(req, context('picture'))).status, code); assert.equal(calls.filter(([kind]) => kind === 'put').length, before);
    }
  });
  await check('Missing variants fall back to the original without caching an unfinished decision', async () => {
    objects.delete(optimizedImageKey(asset.sha256)); globalThis.__compression.author = false;
    const fallback = await routes.GET(request('?variant=game'), context('picture')); assert.equal(fallback.status, 200); assert.equal(fallback.headers.get('x-morimundus-image'), 'original'); assert.equal(fallback.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()), paddedPng); globalThis.__compression.author = true;
    assert.equal((await write.PUT(upload('{"skip":true}', 'application/json'), context('picture'))).status, 200);
    globalThis.__compression.author = false; assert.equal((await routes.GET(request('?variant=game'), context('picture'))).headers.get('cache-control'), 'private, max-age=3600'); globalThis.__compression.author = true;
  });
  await check('Tiny originals keep normal browser caching and avoid redundant variant lookups', async () => {
    globalThis.__compression.assets.set('picture', { ...asset, bytes: 1024 }); objects.set('resources/picture', record(paddedPng.slice(0, 1024), 'image/png')); globalThis.__compression.author = false; calls.length = 0;
    const small = await routes.GET(request('?variant=game'), context('picture')); assert.equal(small.status, 200); assert.equal(small.headers.get('cache-control'), 'private, max-age=3600'); assert.equal(calls.some(([, key]) => key.startsWith(IMAGE_VARIANT_PREFIX)), false);
    globalThis.__compression.assets.set('picture', asset); objects.set('resources/picture', record(paddedPng, 'image/png')); globalThis.__compression.author = true;
  });
  await check('Completed hashes include both useful copies and measured no-savings decisions, without changing original records', async () => {
    objects.set(optimizedImageKey('b'.repeat(64)), record(webp, 'image/webp')); objects.set(IMAGE_VARIANT_PREFIX + 'garbage', record(webp, 'image/webp'));
    assert.deepEqual((await (await status.GET()).json()).completed.sort(), ['a'.repeat(64), 'b'.repeat(64)]); assert.equal(globalThis.__compression.assets.size, 2); assert.equal(objects.get('resources/picture').bytes.length, asset.bytes);
  });
  console.log('Image optimization checks passed: ' + passed);
} finally {
  delete globalThis.__compression;
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await fs.rm(output, { recursive: true, force: true });
}
