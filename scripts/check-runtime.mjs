import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0', '--var', 'MORIMUNDUS_AUTHOR_EMAIL:author@morimundus.test'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { log += chunk; if (log.includes('Ready on http://127.0.0.1:8787')) readyResolve(); });
server.on('exit', code => readyReject(new Error(`Worker exited: ${code}`)));
const timeout = setTimeout(() => readyReject(new Error('Worker startup timed out')), 30000);
try {
  await ready;
  clearTimeout(timeout);
  const ordinary = process.argv.includes('--accounts-only') ? [] : process.argv.includes('--saves-only') ? ['saves'] : process.argv.includes('--cycle-only') ? ['game-cycle'] : ['foundation', 'space', 'scenarios', 'inventory', 'interactions', 'rpg', 'time-audio', 'authoring', 'saves', 'game-cycle'];
  for (const name of ordinary) {
    const auth = name === 'game-cycle' ? [] : ['--import', './scripts/check-auth.mjs'];
    const child = spawn(process.execPath, [...auth, 'scripts/check-' + name + '.mjs', '--origin', 'http://127.0.0.1:8787'], { stdio: 'inherit' });
    assert.equal(await new Promise(resolve => child.on('exit', resolve)), 0, name + ' HTTP checks failed');
  }
  if (!process.argv.includes('--saves-only') && !process.argv.includes('--cycle-only')) {
    const child = spawn(process.execPath, ['scripts/check-accounts.mjs', '--origin', 'http://127.0.0.1:8787'], { stdio: 'inherit' });
    assert.equal(await new Promise(resolve => child.on('exit', resolve)), 0, 'Account HTTP checks failed');
  }
  const response = await fetch('http://127.0.0.1:8787/', { headers: { 'oai-authenticated-user-id': 'stage11-check-author', 'oai-authenticated-user-email': 'author@morimundus.test' } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('MORIMUNDUS'));
  assert.ok(html.includes('Сохранить'));
  console.log('PASS Built page returns HTTP 200 with the editor shell');
} catch (error) {
  console.error(log.slice(-4000));
  throw error;
} finally {
  clearTimeout(timeout);
  await fs.mkdir('.sites-runtime', { recursive: true });
  await fs.writeFile('.sites-runtime/runtime-check.log', log);
  try { process.kill(-server.pid, 'SIGTERM'); } catch { }
}
