import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'choice-ui-check-' + process.pid), compiled = new Set();
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
  const { createSampleProject } = await load('lib/engine/sample-project');
  const { ChoiceCheckEditor, ChoiceUsageEditor } = await load('components/editor/choice-check-editor');
  const { RpgWorkbench } = await load('components/editor/rpg-workbench');
  const { ScriptWorkbench } = await load('components/editor/script-workbench');
  const { RpgPanel } = await load('components/player/rpg-panel');
  const { TestSession } = await load('lib/engine/session');
  const project = createSampleProject(); project.character.skills = [{ id: 'speech', name: 'Речь', initial: 3, min: 0, max: 10 }];
  const check = { id: 'trial', name: 'Убедить', skillId: 'speech', statId: null, difficulty: 5, repeatable: true, retryWhen: null, retryReason: '', maxAttempts: 3, retryGrowth: { skillId: 'speech', reference: 'attempt', attempt: 2 }, formula: { mode: 'dice', dieSides: 6, skillWeight: 1, statWeight: 0 } };
  project.checks = [check]; const choice = { id: 'try', label: 'Попробовать', checkId: check.id, nextNodeId: 'success', failureNodeId: 'failure', failureActions: [], actions: [], unavailableReason: '', condition: null, usageLimit: { period: 'day', maxUses: 1, seconds: 86400 } };
  project.scripts = [{ id: 'talk', name: 'Разговор', entryNodeId: 'entry', nodes: [{ id: 'entry', paragraphs: [], choices: [choice] }, { id: 'success', paragraphs: [], choices: [] }, { id: 'failure', paragraphs: [], choices: [] }] }];
  project.settings.startScriptId = null;
  await checkMarkup('Answer editor exposes skill, die, growth reference and independent attempt limit together', () => {
    const html = renderToStaticMarkup(createElement(ChoiceCheckEditor, { project, choice, onChange() {} }));
    for (const label of ['Проверка внутри ответа', 'Проверяемый навык', 'Сложность', 'Грани кости', 'Ограничить общее число попыток', 'Номер опорной попытки', 'Какой навык должен вырасти']) assert.ok(html.includes(label), label);
    assert.ok(html.includes('role="switch"')); assert.ok(html.includes('value="2"')); assert.ok(html.includes('value="3"'));
  });
  await checkMarkup('Daily frequency controls explain game midnight and allow N uses', () => {
    const html = renderToStaticMarkup(createElement(ChoiceUsageEditor, { choice, onChange() {} })); assert.ok(html.includes('Частота выбора ответа')); assert.ok(html.includes('Максимум выборов')); assert.ok(html.includes('в полночь по игровым часам'));
  });
  await checkMarkup('Full dialogue editor contains embedded check and both outcome branches without a check-library selector', () => {
    const html = renderToStaticMarkup(createElement(ScriptWorkbench, { project, edit() {}, selectedId: 'talk', onSelect() {}, onTest() {} }));
    assert.ok(html.includes('После успеха')); assert.ok(html.includes('После провала')); assert.ok(html.includes('Проверка внутри ответа')); assert.ok(html.includes('Частота выбора ответа')); assert.ok(!html.includes('id="choice-check-try"'));
  });
  await checkMarkup('Quest workbench and player journal no longer expose separate check libraries', () => {
    const html = renderToStaticMarkup(createElement(RpgWorkbench, { project, edit() {} })); assert.ok(!html.includes('Добавить проверку')); assert.ok(!html.includes('Настройки проверки'));
    const s = new TestSession(project, 1); const journal = renderToStaticMarkup(createElement(RpgPanel, { session: s, state: s.snapshot(), onRetry() {}, onClose() {}, onPause() {} })); assert.ok(!journal.includes('Вернуться к попытке')); assert.ok(!journal.includes('<h3>Проверки</h3>')); assert.ok(journal.includes('Задания'));
  });
  console.log('Choice UI checks passed: ' + passed);
} finally { await fs.rm(output, { recursive: true, force: true }); }
async function checkMarkup(name, run) { return check(name, run); }
