import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.sites-runtime', 'project-snapshot-' + process.pid);
const data = path.join(root, 'game-data');
const read = async name => JSON.parse(await fs.readFile(path.join(data, name), 'utf8'));
try {
  await fs.mkdir(output, { recursive: true });
  for (const name of ['project', 'voices']) {
    const source = await fs.readFile(path.join(root, 'lib/engine', name + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, name) => 'from ' + quote + name + '.mjs' + quote);
    await fs.writeFile(path.join(output, name + '.mjs'), compiled);
  }
  const { parseProject } = await import(pathToFileURL(path.join(output, 'project.mjs')).href);
  const author = parseProject((await read('author.json')).project);
  const published = parseProject((await read('published.json')).project);
  const assets = await read('assets.json');
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  assert.equal(byId.size, assets.length, 'Duplicate asset identifiers');
  for (const project of [author, published]) {
    for (const asset of project.assets) {
      const stored = byId.get(asset.id);
      assert.ok(stored, 'Missing asset ' + asset.id);
      for (const key of ['sha256', 'bytes', 'mime', 'kind']) assert.equal(stored[key], asset[key], 'Conflicting ' + key + ': ' + asset.id);
    }
  }
  let total = 0;
  const extract = process.argv.includes('--extract-assets');
  const extracted = path.join(root, 'work', 'restored-assets');
  if (extract) await fs.mkdir(extracted, { recursive: true });
  for (const asset of assets) {
    assert.match(asset.file, /^assets\/[A-Za-z0-9_-]+\.[a-z0-9]+(?:\.gz)?$/);
    const stored = await fs.readFile(path.join(data, asset.file));
    if (asset.compression) {
      assert.equal(asset.compression, 'gzip');
      assert.equal(stored.length, asset.storedBytes);
      assert.equal(createHash('sha256').update(stored).digest('hex'), asset.storedSHA256);
    }
    const bytes = asset.compression === 'gzip' ? gunzipSync(stored) : stored;
    assert.equal(bytes.length, asset.bytes, 'Size mismatch: ' + asset.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, 'SHA-256 mismatch: ' + asset.id);
    if (extract) {
      const target = path.join(extracted, path.basename(asset.file).replace(/\.gz$/, ''));
      try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        assert.equal(createHash('sha256').update(await fs.readFile(target)).digest('hex'), asset.sha256, 'Existing output differs: ' + target);
      }
    }
    total += bytes.length;
  }
  const snapshot = await read('snapshot.json');
  assert.equal(snapshot.counts.assets, assets.length);
  assert.equal(snapshot.counts.assetBytes, total);
  assert.equal(snapshot.counts.scripts, author.scripts.length);
  assert.equal(snapshot.counts.locations, author.locations.length);
  if (extract) console.log('Original assets restored to ' + extracted);
  console.log(`Snapshot passed: ${author.scripts.length} scenes, ${author.locations.length} locations, ${assets.length} verified assets (${total} bytes).`);
} finally {
  await fs.rm(output, { recursive: true, force: true });
}
