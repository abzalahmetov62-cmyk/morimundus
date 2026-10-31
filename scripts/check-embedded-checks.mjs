import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = process.cwd(), output = path.join(root, '.sites-runtime', 'embedded-check-' + process.pid);
const modules = ['engine/save-game', 'editor/deletion', 'engine/project', 'engine/voices', 'engine/sample-project', 'engine/game-state', 'engine/session', 'engine/object-effects', 'engine/spatial', 'engine/conditions', 'engine/scenarios', 'engine/inventory', 'engine/item-interactions', 'engine/rpg', 'engine/time', 'engine/audio-state', 'editor/script-operations', 'editor/scenario-dependencies', 'editor/spatial-operations', 'storage/asset-format', 'storage/client', 'storage/backup'];
let passed = 0; const originIndex = process.argv.indexOf('--origin');
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
try {
  for (const module of modules) { const source = await fs.readFile(path.join(root, 'lib', module + '.ts'), 'utf8'), compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(\.[^'"]+)\1/g, (_, q, name) => 'from ' + q + name + '.mjs' + q); const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, compiled); }
  const load = name => import(pathToFileURL(path.join(output, name + '.mjs')).href);
  const { parseProject } = await load('engine/project'), { createSampleProject } = await load('engine/sample-project'), { TestSession } = await load('engine/session'), { parseGameState } = await load('engine/game-state');
  const { checkAvailability, retryAvailability, checkValues } = await load('engine/rpg'), { evaluateCondition, effectiveTraitValue } = await load('engine/conditions');
  const { duplicateScript, deleteNode } = await load('editor/script-operations'), { copyObjects, pasteObjects, createLocation } = await load('editor/spatial-operations');
  const { createBackup, parseBackup, restoreBackup } = await load('storage/backup');
  const compare = (source, key, value, field) => ({ type: 'compare', source, key, operator: 'eq', value, ...(field ? { field } : {}) });
  const choice = (id, actions = [], checkId = null, extra = {}) => ({ id, label: id, nextNodeId: null, failureNodeId: null, condition: null, unavailableReason: '', checkId, actions, failureActions: [], ...extra });
  const paragraph = text => ({ spans: [{ text, marks: [] }], audioAssetId: null });
  const rule = (id, trigger, actions, extra = {}) => ({ id, name: id, trigger, targetObjectId: null, checkId: 'trial', itemDefinitionId: null, itemTag: null, priority: 0, condition: null, unavailableReason: '', actions, once: false, ...extra });
  function fixture() {
    const p = createSampleProject(); p.settings.startScriptId = null; p.flags = { ...p.flags, retry: false, reaction: '', successRule: false, failureRule: false };
    p.character.stats = [{ id: 'strength', name: 'Сила', min: 0, max: 10, initial: 2 }]; p.character.skills = [{ id: 'speech', name: 'Речь', min: 0, max: 10, initial: 3 }];
    p.character.statuses = [{ id: 'focus', name: 'Сосредоточен', description: 'Лучше убеждает.', initiallyActive: false, modifiers: { speech: 2 } }, { id: 'tired', name: 'Усталость', description: 'Труднее говорить.', initiallyActive: false, modifiers: { speech: -2 } }];
    p.items.push({ ...structuredClone(p.items[0]), id: 'coat', name: 'Пальто', equipmentSlot: 'torso', modifiers: { speech: 3, strength: 1 } });
    const paper = p.objects.find(o => o.id === 'paper'), door = p.objects.find(o => o.id === 'door');
    p.objects.push({ ...structuredClone(paper), id: 'coat', interaction: { ...paper.interaction, itemDefinitionId: 'coat' } }, { ...structuredClone(door), id: 'guard', name: 'Собеседник', kind: 'npc', transform: { ...door.transform, position: [3, 0, 3] }, interaction: { ...door.interaction, scriptId: 'trial-scene' } });
    p.checks = [{ id: 'trial', name: 'Убедить собеседника', skillId: 'speech', statId: null, difficulty: 5, repeatable: true, retryWhen: compare('flag', 'retry', true), retryReason: 'Нужно подготовиться.', maxAttempts: null }];
    p.quests = [{ id: 'quest', name: 'Проверочное задание', description: 'Поговорить с собеседником.', stages: [{ id: 'start', name: 'Поговорить', description: 'Начальный этап.' }, { id: 'done', name: 'Договорились', description: 'Результат получен.' }], initialStageId: 'start', rewards: [{ type: 'giveItem', itemDefinitionId: 'paper-item' }] }];
    p.scripts = [{ id: 'trial-scene', name: 'Проверка', entryNodeId: 'entry', nodes: [{ id: 'entry', paragraphs: [paragraph('Попытаться убедить.')], choices: [choice('attempt', [{ type: 'setFlag', key: 'reaction', value: 'success' }], 'trial', { nextNodeId: 'success', failureNodeId: 'failure', failureActions: [{ type: 'setFlag', key: 'reaction', value: 'failure' }] })] }, { id: 'success', paragraphs: [paragraph('Согласен.')], choices: [] }, { id: 'failure', paragraphs: [paragraph('Не согласен.')], choices: [] }] }, { id: 'reward-scene', name: 'Завершение', entryNodeId: 'reward-entry', nodes: [{ id: 'reward-entry', paragraphs: [], choices: [choice('finish', [{ type: 'setQuestStage', questId: 'quest', stageId: 'done' }, { type: 'completeQuest', questId: 'quest' }])] }] }];
    return parseProject(p);
  }
  const session = (p = fixture(), seed = 1) => { const fresh = new TestSession(p, 1), state = fresh.snapshot(); state.randomState = seed; return TestSession.restore(p, 1, state); };
  const attempt = s => { s.interactObject('guard', false); s.choose('attempt'); };
  const { createSavedGame, restoreSavedGame, projectFingerprint, checksum } = await load('engine/save-game');
  const { editChoiceCheck } = await load('editor/script-operations');
  const { choiceUsageKey } = await load('engine/rpg');
  const setup = ({ limit = null, growth = null, maxAttempts = null, formula, checked = true } = {}) => {
    const p = fixture(); p.rules = []; p.checks[0] = { ...p.checks[0], difficulty: 100, retryWhen: null, repeatable: true, retryGrowth: growth, maxAttempts, ...(formula ? { formula } : {}) };
    const c = p.scripts[0].nodes[0].choices[0]; c.usageLimit = limit; if (!checked) c.checkId = null;
    return parseProject(p);
  };
  const open = s => s.openScript('trial-scene');
  const allowed = s => s.choices().find(c => c.choice.id === 'attempt').allowed;
  const limit = (period, maxUses = 1, seconds = 3600) => ({ period, maxUses, seconds });
  const growth = (reference = 'last', attempt = 1, skillId = 'speech') => ({ reference, attempt, skillId });
  await check('Daily reply closes until the exact next game midnight, including failed attempts', () => {
    const p = setup({ limit: limit('day') }), s = session(p); open(s); s.choose('attempt'); open(s); assert.equal(allowed(s), false); const now = s.snapshot().clock.worldSeconds; s.advanceTime(86400 - now % 86400 - 1); assert.equal(allowed(s), false); s.advanceTime(1); assert.equal(allowed(s), true); s.choose('attempt'); assert.equal(s.snapshot().checks.trial.attempts, 2);
  });
  await check('N uses per day also works on ordinary answers without a skill check', () => {
    const s = session(setup({ limit: limit('day', 2), checked: false })); open(s); s.choose('attempt'); open(s); assert.equal(allowed(s), true); s.choose('attempt'); open(s); assert.equal(allowed(s), false); assert.throws(() => s.choose('attempt'), /лимит/); assert.deepEqual(s.snapshot().checks, {});
  });
  await check('Sliding interval reopens at exact expiry and expires each use individually', () => {
    const s = session(setup({ limit: limit('interval', 2) })); open(s); s.choose('attempt'); s.advanceTime(600); open(s); s.choose('attempt'); open(s); assert.equal(allowed(s), false); s.advanceTime(2999.5); assert.equal(allowed(s), false); s.advanceTime(.5); assert.equal(allowed(s), true); s.choose('attempt'); open(s); assert.equal(allowed(s), false); s.advanceTime(600); assert.equal(allowed(s), true);
  });
  await check('Lifetime frequency never resets on midnight or elapsed days', () => {
    const s = session(setup({ limit: limit('ever') })); open(s); s.choose('attempt'); s.advanceTime(86400 * 3); open(s); assert.equal(allowed(s), false);
  });
  await check('Equal reply IDs in different nodes have independent counters', () => {
    const p = setup({ limit: limit('day'), checked: false }); p.scripts[0].nodes[2].choices = [{ ...p.scripts[0].nodes[0].choices[0], nextNodeId: 'entry' }]; const s = session(parseProject(p)); open(s); s.choose('attempt'); s.openScript('trial-scene'); assert.equal(allowed(s), false); const st = s.snapshot(); st.interaction.nodeId = 'failure'; st.interaction.paragraph = 1; const other = TestSession.restore(p, 1, st); assert.equal(allowed(other), true); other.choose('attempt'); assert.equal(Object.keys(other.snapshot().choiceUsage).length, 2);
  });
  await check('Last-attempt growth requires a strictly greater effective skill every time', () => {
    const s = session(setup({ growth: growth() })); open(s); s.choose('attempt'); open(s); assert.equal(allowed(s), false); s.changeTrait('skill', 'speech', 3); assert.equal(allowed(s), false); s.changeTrait('skill', 'speech', 4); assert.equal(allowed(s), true); s.choose('attempt'); open(s); assert.equal(allowed(s), false); s.changeTrait('skill', 'speech', 5); assert.equal(allowed(s), true);
  });
  await check('First-attempt reference remains fixed for later retries', () => {
    const s = session(setup({ growth: growth('attempt', 1) })); open(s); s.choose('attempt'); s.changeTrait('skill', 'speech', 4); open(s); s.choose('attempt'); open(s); assert.equal(allowed(s), true); s.changeTrait('skill', 'speech', 3); assert.equal(allowed(s), false);
  });
  for (const n of [2, 3]) await check('Specific attempt ' + n + ' is recorded before it starts gating later attempts', () => {
    const s = session(setup({ growth: growth('attempt', n) })); for (let i = 1; i <= n; i++) { open(s); assert.equal(allowed(s), true); s.choose('attempt'); } open(s); assert.equal(allowed(s), false); s.changeTrait('skill', 'speech', 4); assert.equal(allowed(s), true);
  });
  await check('Total attempts remain capped despite midnight and skill growth', () => {
    const s = session(setup({ growth: growth(), limit: limit('day'), maxAttempts: 2 })); open(s); s.choose('attempt'); s.changeTrait('skill', 'speech', 4); s.advanceTime(86400); open(s); s.choose('attempt'); s.changeTrait('skill', 'speech', 5); s.advanceTime(86400); open(s); assert.equal(allowed(s), false); assert.throws(() => s.choose('attempt'), /попытки/); assert.equal(s.snapshot().checks.trial.attempts, 2);
  });
  await check('Retry skill may differ from checked skill and preserves fractional values', () => {
    const p = setup(); p.checks[0].retryGrowth = growth('last', 1, 'craft'); p.character.skills.push({ id: 'craft', name: 'Ремесло', min: 0, max: 10, initial: 2.5 }); const s = session(parseProject(p)); open(s); s.choose('attempt'); open(s); s.changeTrait('skill', 'speech', 10); assert.equal(allowed(s), false); s.changeTrait('skill', 'craft', 2.6); assert.equal(allowed(s), true);
  });
  await check('Equipment bonuses count for retry growth without changing base skill', () => {
    const s = session(setup({ growth: growth() })); open(s); s.choose('attempt'); s.takeObject('coat'); s.equip('instance-coat', 'torso'); open(s); assert.equal(allowed(s), true); assert.equal(s.snapshot().player.skills.speech, 3);
  });
  await check('Attempt snapshot is captured before success/failure consequences change skill', () => {
    const p = setup({ growth: growth() }); p.scripts[0].nodes[0].choices[0].failureActions.push({ type: 'changeTrait', kind: 'skill', traitId: 'speech', mode: 'add', value: 1 }); const s = session(parseProject(p)); open(s); s.choose('attempt'); assert.equal(s.snapshot().checks.trial.lastSkills.speech, 3); open(s); assert.equal(allowed(s), true);
  });
  await check('Success and failure select their configured branches and apply only their consequences', () => {
    const p = setup(); p.checks[0].difficulty = 3; const s = session(parseProject(p)); open(s); s.choose('attempt'); assert.equal(s.snapshot().interaction.nodeId, 'success'); assert.equal(s.snapshot().flags.reaction, 'success'); open(s); assert.equal(allowed(s), false); const bad = session(setup()); open(bad); bad.choose('attempt'); assert.equal(bad.snapshot().interaction.nodeId, 'failure'); assert.equal(bad.snapshot().flags.reaction, 'failure');
  });
  await check('Per-answer threshold overrides global dice and equality succeeds without a roll', () => {
    const p = setup({ formula: { mode: 'threshold', dieSides: 6, skillWeight: 2, statWeight: 0 } }); p.settings.checkFormula.mode = 'dice'; p.checks[0].difficulty = 6; const s = session(parseProject(p)); open(s); s.choose('attempt'); const r = s.snapshot().checks.trial.lastResult; assert.equal(r.roll, null); assert.equal(r.score, 6); assert.equal(r.succeeded, true);
  });
  await check('Per-answer dice uses its own die, weights and deterministic saved random state', () => {
    const p = setup({ formula: { mode: 'dice', dieSides: 6, skillWeight: 1, statWeight: 0 } }); const a = session(p, 12345), b = session(p, 12345); open(a); open(b); a.choose('attempt'); b.choose('attempt'); assert.deepEqual(a.snapshot().checks.trial.lastResult, b.snapshot().checks.trial.lastResult); const r = a.snapshot().checks.trial.lastResult; assert.equal(r.mode, 'dice'); assert.ok(r.roll >= 1 && r.roll <= 6); assert.equal(r.score, 3 + r.roll);
  });
  await check('Inline authoring creates, edits and detaches checks without a library selection', () => {
    let p = setup({ checked: false }); p = editChoiceCheck(p, 'trial-scene', 'entry', 'attempt', {}); const id = p.scripts[0].nodes[0].choices[0].checkId; assert.ok(id); p = editChoiceCheck(p, 'trial-scene', 'entry', 'attempt', { difficulty: 9 }); assert.equal(p.checks.find(c => c.id === id).difficulty, 9); p = editChoiceCheck(p, 'trial-scene', 'entry', 'attempt', null); assert.equal(p.scripts[0].nodes[0].choices[0].checkId, null);
  });
  await check('Editing a legacy shared check makes this answer independent', () => {
    let p = setup(); p.scripts[0].nodes[0].choices.push({ ...p.scripts[0].nodes[0].choices[0], id: 'second' }); p = editChoiceCheck(parseProject(p), 'trial-scene', 'entry', 'attempt', { difficulty: 8 }); const [a, b] = p.scripts[0].nodes[0].choices; assert.notEqual(a.checkId, b.checkId); assert.equal(p.checks.find(c => c.id === b.checkId).difficulty, 100);
  });
  await check('Detaching a shared legacy check preserves outcome hooks and self-referencing retry conditions', () => {
    let p = setup(); p.scripts[0].nodes[0].choices.push({ ...p.scripts[0].nodes[0].choices[0], id: 'second' });
    p.rules = [rule('failure-hook', 'checkFailure', [{ type: 'setFlag', key: 'failureRule', value: true }])];
    p.checks[0].retryWhen = { type: 'compare', source: 'check', key: 'trial', field: 'attempts', operator: 'gte', value: 1 };
    p = editChoiceCheck(parseProject(p), 'trial-scene', 'entry', 'attempt', { difficulty: 8 });
    const c = p.scripts[0].nodes[0].choices[0], own = p.checks.find(v => v.id === c.checkId);
    assert.equal(own.retryWhen.key, own.id); const s = session(p); open(s); s.choose('attempt'); assert.equal(s.snapshot().flags.failureRule, true); open(s); assert.equal(allowed(s), true); assert.equal(s.snapshot().checks.trial, undefined);
  });
  await check('Duplicating a scene copies retry settings and creates independent check/counter identities', () => {
    const p = setup({ growth: growth('attempt', 3), limit: limit('day'), formula: { mode: 'dice', dieSides: 6, skillWeight: 1, statWeight: 0 } }); const copy = duplicateScript(p, 'trial-scene'), c = copy.project.scripts.find(s => s.id === copy.id).nodes[0].choices[0]; assert.notEqual(c.checkId, 'trial'); assert.notEqual(c.id, 'attempt'); assert.deepEqual(c.usageLimit, p.scripts[0].nodes[0].choices[0].usageLimit); assert.deepEqual(copy.project.checks.find(v => v.id === c.checkId).retryGrowth, growth('attempt', 3));
  });
  await check('Save/restore preserves frequency, numbered attempts and retry requirements', async () => {
    const p = setup({ growth: growth(), limit: limit('day') }), s = session(p); open(s); s.choose('attempt'); const written = await createSavedGame(p, 1, s.snapshot()); const restored = await restoreSavedGame(written.save, written.checksum, p, 1); const next = TestSession.restore(p, 1, restored); next.advanceTime(86400); open(next); assert.equal(allowed(next), false); next.changeTrait('skill', 'speech', 4); assert.equal(allowed(next), true); next.choose('attempt'); assert.equal(next.snapshot().checks.trial.attempts, 2);
  });
  await check('Older projects and checksummed saves are unchanged when new optional fields are absent', async () => {
    const p = fixture(), s = session(p); const before = await projectFingerprint(p); assert.equal(await projectFingerprint(parseProject(p)), before); const state = s.snapshot(); delete state.choiceUsage; const save = { formatVersion: 1, projectFingerprint: before, state }; assert.deepEqual(await restoreSavedGame(save, await checksum(save), p, 1), state);
  });
  await check('Blocked choices cannot consume attempts, alter random state or write usage', () => {
    const s = session(setup({ limit: limit('day') })); open(s); s.choose('attempt'); open(s); const before = s.snapshot(); assert.throws(() => s.choose('attempt')); assert.deepEqual(s.snapshot(), before);
  });
  await check('Invalid limits, missing retry skills and corrupted saved history are rejected', () => {
    for (const bad of [limit('day', 0), limit('interval', 1, 0)]) assert.throws(() => setup({ limit: bad })); assert.throws(() => setup({ growth: growth('last', 1, 'missing') })); const p = setup({ limit: limit('day') }), s = session(p); open(s); s.choose('attempt'); const st = s.snapshot(); st.checks.trial.attemptSkills[0].attempt = 20; assert.throws(() => parseGameState(st, p)); const st2 = s.snapshot(); Object.values(st2.choiceUsage)[0].times.push(st2.clock.worldSeconds + 1); assert.throws(() => parseGameState(st2, p));
  });
  console.log('Embedded checks: ' + passed + ' checks passed.');
} finally { await fs.rm(output, { recursive: true, force: true }); }
