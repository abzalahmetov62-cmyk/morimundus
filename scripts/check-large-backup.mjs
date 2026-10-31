import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'large-backup-' + process.pid), compiled = new Set();
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function compile(module) {
  if (compiled.has(module)) return;
  compiled.add(module);
  const dependencies = [], source = await fs.readFile(path.join(root, module + '.ts'), 'utf8');
  const text = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, q, name) => { dependencies.push(path.normalize(path.join(path.dirname(module), name))); return 'from ' + q + name + '.mjs' + q; });
  const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text);
  for (const dependency of dependencies) await compile(dependency);
}
const load = async module => { await compile(module); return import(pathToFileURL(path.join(output, module + '.mjs')).href); };
const originalFetch = globalThis.fetch;
try {
  const { createSampleProject } = await load('lib/engine/sample-project'), { parseProject } = await load('lib/engine/project');
  const { createBackup, backupBlob, parseBackup, restoreBackup, downloadBackup } = await load('lib/storage/backup');
  const bytes = Buffer.alloc(16 * 1024 * 1024);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const p = createSampleProject(); p.meta.title = 'Большой проект «Моримундус»';
  p.assets = Array.from({ length: 5 }, (_, i) => ({ id: 'large-' + i, name: 'Звук "' + i + '".wav', kind: 'audio', mime: 'audio/wav', bytes: bytes.length, sha256 }));
  p.locations[0].audio.musicAssetId = p.assets[0].id;
  const project = parseProject(p), before = JSON.stringify(project);
  let downloaded = 0, backup, file, parsed;
  globalThis.fetch = async url => { assert.ok(project.assets.some(a => url === '/api/assets/' + a.id)); downloaded++; return new Response(bytes); };
  await check('Export includes 80 MiB of actual resources without the previous 100 MiB estimate rejection', async () => { backup = await createBackup(project); assert.equal(downloaded, 5); assert.equal(backup.resources.length, 5); assert.equal(JSON.stringify(project), before); });
  await check('Download serialization creates a compatible JSON file larger than 100 MiB', () => { const blob = backupBlob(backup); assert.equal(blob.type, 'application/json'); assert.ok(blob.size > 100 * 1024 * 1024); file = new File([blob], 'Morimundus-large.json', { type: blob.type }); console.log('Backup file size: ' + (blob.size / 1024 / 1024).toFixed(2) + ' MiB'); });
  await check('The actual download action receives the complete large Blob and a JSON filename', () => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, document = Object.getOwnPropertyDescriptor(globalThis, 'document'); let clicks = 0;
    URL.createObjectURL = blob => { assert.equal(blob.size, file.size); return 'blob:large-backup-check'; }; URL.revokeObjectURL = () => {};
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ href: '', download: '', click() { assert.equal(this.href, 'blob:large-backup-check'); assert.match(this.download, /^Morimundus-\d{4}-\d{2}-\d{2}\.json$/); clicks++; } }) } });
    try { downloadBackup(backup); assert.equal(clicks, 1); }
    finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; }
  });
  await check('Import reads the large file and validates every resource checksum and format', async () => { parsed = await parseBackup(file); assert.deepEqual(parsed.project, project); for (const [i, resource] of parsed.resources.entries()) assert.equal(resource.base64, backup.resources[i].base64); });
  await check('A large imported backup restores into empty storage with correct asset remapping', async () => {
    let uploads = 0;
    globalThis.fetch = async (url, options) => {
      if (url !== '/api/assets') return new Response(null, { status: 404 });
      assert.equal(options.method, 'POST'); const file = options.body.get('file'), asset = project.assets[uploads];
      assert.equal(file.name, asset.name); assert.equal(file.size, bytes.length); assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toString('hex'), sha256);
      return Response.json({ ...asset, id: 'restored-' + uploads++ });
    };
    const restored = await restoreBackup(parsed); assert.equal(uploads, 5); assert.equal(restored.locations[0].audio.musicAssetId, 'restored-0'); assert.equal(restored.assets.length, 5); assert.deepEqual(restored.assets.map(a => a.name), project.assets.map(a => a.name)); assert.equal(JSON.stringify(project), before);
  });
  console.log('Large backup checks passed: ' + passed);
} finally { globalThis.fetch = originalFetch; await fs.rm(output, { recursive: true, force: true }); }
