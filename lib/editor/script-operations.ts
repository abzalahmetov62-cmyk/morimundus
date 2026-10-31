import { scenarioDependencies } from './scenario-dependencies';
import { checkedDeletion } from './deletion';
import { parseProject, type Project, type Script, type ScriptChoice, type ScriptNode, type Rule, type Condition } from '../engine/project';

const id = (prefix: string) => prefix + '-' + crypto.randomUUID();
export const blankParagraph = (): ScriptNode['paragraphs'][number] => ({ spans: [{ text: '', marks: [] }], audioAssetId: null, audioLoop: false, audioVolume: 1 });
export const blankNode = (): ScriptNode => ({ id: id('node'), paragraphs: [blankParagraph()], choices: [] });
export const blankChoice = (): ScriptChoice => ({ id: id('choice'), label: 'Новый ответ', nextNodeId: null, condition: null, unavailableReason: '', checkId: null, failureNodeId: null, failureActions: [], actions: [] });
export function createScript(project: Project, name = 'Новая сцена') {
  const node = blankNode(), script: Script = { id: id('script'), name, entryNodeId: node.id, nodes: [node] };
  return { project: parseProject({ ...project, scripts: [...project.scripts, script] }), id: script.id };
}
export function duplicateScript(project: Project, scriptId: string) {
  const source = project.scripts.find(s => s.id === scriptId);
  if (!source) throw new Error('Сцена не найдена');
  const script = structuredClone(source), scriptCopyId = id('script'), nodes = new Map(script.nodes.map(n => [n.id, id('node')]));
  const checkIds = new Map([...new Set(script.nodes.flatMap(n => n.choices.flatMap(c => c.checkId ? [c.checkId] : [])))].map(checkId => [checkId, id('check')]));
  const copyCondition = (c: Condition | null): Condition | null => { if (!c) return null; if (c.type === 'all' || c.type === 'any') return { ...c, conditions: c.conditions.map(v => copyCondition(v)!) }; if (c.type === 'not') return { ...c, condition: copyCondition(c.condition)! }; return c.type === 'compare' && c.source === 'check' ? { ...c, key: checkIds.get(c.key) ?? c.key } : c; };
  const dependencies = scenarioDependencies(project, [scriptId], [], false, true);
  const timerIds = new Map(dependencies.timers.map(t => [t.id, id('timer')])), ruleIds = new Map(dependencies.rules.map(r => [r.id, id('rule')]));
  const rewardIds = new Map<string, string>();
  const actionCopy = (a: Project['rules'][number]['actions'][number]) => { if (a.type === 'giveItemOnce' && !rewardIds.has(a.rewardId)) rewardIds.set(a.rewardId, id('reward')); return 'timerId' in a ? { ...a, timerId: timerIds.get(a.timerId) ?? a.timerId } : a.type === 'openScript' && a.scriptId === scriptId ? { ...a, scriptId: scriptCopyId } : a.type === 'giveItemOnce' ? { ...a, rewardId: rewardIds.get(a.rewardId)! } : a; };
  script.id = scriptCopyId; script.name = script.name.slice(0, 150) + ' (копия)'; script.entryNodeId = nodes.get(script.entryNodeId)!;
  for (const node of script.nodes) {
    node.id = nodes.get(node.id)!;
    if (node.entryCondition != null) node.entryCondition = copyCondition(node.entryCondition);
    for (const choice of node.choices) {
      choice.id = id('choice');
      if (choice.nextNodeId) choice.nextNodeId = nodes.get(choice.nextNodeId)!;
      if (choice.failureNodeId) choice.failureNodeId = nodes.get(choice.failureNodeId)!;
      if (choice.checkId) choice.checkId = checkIds.get(choice.checkId)!;
      choice.condition = copyCondition(choice.condition);
      choice.actions = choice.actions.map(actionCopy); choice.failureActions = choice.failureActions.map(actionCopy);
    }
  }
  const rules = dependencies.rules.map(r => ({ ...structuredClone(r), id: ruleIds.get(r.id)!, name: r.name.slice(0, 150) + ' (копия)', checkId: r.checkId ? checkIds.get(r.checkId) ?? r.checkId : null, condition: copyCondition(r.condition), actions: r.actions.map(actionCopy) }));
  const timers = dependencies.timers.map(t => ({ ...structuredClone(t), id: timerIds.get(t.id)!, ruleId: t.ruleId ? ruleIds.get(t.ruleId)! : null, initiallyActive: false }));
  return { project: parseProject({ ...project, timers: [...project.timers, ...timers], rules: [...project.rules, ...rules], scripts: [...project.scripts, script], checks: [...project.checks, ...project.checks.filter(c => checkIds.has(c.id)).map(c => ({ ...structuredClone(c), id: checkIds.get(c.id)!, name: c.name.slice(0, 150) + ' (копия)', retryWhen: copyCondition(c.retryWhen) }))] }), id: scriptCopyId };
}
export function deleteScript(project: Project, scriptId: string) {
  if (!project.scripts.some(s => s.id === scriptId)) throw new Error('Сцена не найдена');
  return checkedDeletion({ ...project, scripts: project.scripts.filter(s => s.id !== scriptId), settings: { ...project.settings, startScriptId: project.settings.startScriptId === scriptId ? null : project.settings.startScriptId }, objects: project.objects.map(o => o.interaction.scriptId === scriptId ? { ...o, interaction: { ...o.interaction, scriptId: null } } : o) }, "сцену «" + project.scripts.find(s => s.id === scriptId)!.name + "»", project);
}
export function addNode(project: Project, scriptId: string) {
  const node = blankNode();
  if (!project.scripts.some(s => s.id === scriptId)) throw new Error('Сцена не найдена');
  return { project: parseProject({ ...project, scripts: project.scripts.map(s => s.id === scriptId ? { ...s, nodes: [...s.nodes, node] } : s) }), id: node.id };
}
export function deleteNode(project: Project, scriptId: string, nodeId: string) {
  const script = project.scripts.find(s => s.id === scriptId);
  if (!script?.nodes.some(n => n.id === nodeId)) throw new Error('Фрагмент не найден');
  if (script.nodes.length <= 1) throw new Error('В сцене должен остаться хотя бы один фрагмент');
  const nodes = script.nodes.filter(n => n.id !== nodeId).map(n => ({ ...n, choices: n.choices.map(c => ({ ...c, nextNodeId: c.nextNodeId === nodeId ? null : c.nextNodeId, failureNodeId: c.failureNodeId === nodeId ? null : c.failureNodeId })) }));
  return parseProject({ ...project, scripts: project.scripts.map(s => s.id === scriptId ? { ...s, entryNodeId: s.entryNodeId === nodeId ? nodes[0].id : s.entryNodeId, nodes } : s) });
}
export function createRule(project: Project, objectId: string | null = null) {
  const rule: Rule = { id: id('rule'), name: 'Новая реакция', trigger: 'interact', checkId: null, targetObjectId: objectId, itemDefinitionId: null, itemTag: null, priority: 0, condition: null, unavailableReason: '', actions: [], once: false };
  return { project: parseProject({ ...project, rules: [...project.rules, rule] }), id: rule.id };
}

export function editChoiceCheck(project: Project, scriptId: string, nodeId: string, choiceId: string, patch: Partial<Project['checks'][number]> | null) {
  const choice = project.scripts.find(s => s.id === scriptId)?.nodes.find(n => n.id === nodeId)?.choices.find(c => c.id === choiceId);
  if (!choice) throw new Error('Ответ не найден');
  const current = project.checks.find(c => c.id === choice.checkId);
  if (patch && !current && !project.character.skills.length) throw new Error('Сначала добавь навык в настройках героя');
  const shared = current && project.scripts.flatMap(s => s.nodes.flatMap(n => n.choices)).filter(c => c.checkId === current.id).length > 1;
  const checkId = patch === null ? null : current && !shared ? current.id : id('check');
  const copyCondition = (condition: Condition | null): Condition | null => {
    if (!condition) return null;
    if (condition.type === 'all' || condition.type === 'any') return { ...condition, conditions: condition.conditions.map(c => copyCondition(c)!) };
    if (condition.type === 'not') return { ...condition, condition: copyCondition(condition.condition)! };
    return shared && condition.type === 'compare' && condition.source === 'check' && condition.key === current?.id ? { ...condition, key: checkId! } : condition;
  };
  const check = patch === null ? null : { ...(current ?? { name: choice.label, formula: { ...project.settings.checkFormula }, skillId: project.character.skills[0].id, statId: null, difficulty: 5, repeatable: false, retryWhen: null, retryReason: '', maxAttempts: null }), ...patch, id: checkId! };
  if (check) check.retryWhen = copyCondition(check.retryWhen);
  const rules = shared && check ? [...project.rules, ...project.rules.filter(r => r.checkId === current.id).map(r => ({ ...r, id: id('rule'), checkId: check.id, condition: copyCondition(r.condition) }))] : project.rules;
  return parseProject({ ...project, rules, checks: check ? current && !shared ? project.checks.map(c => c.id === current.id ? check : c) : [...project.checks, check] : project.checks, scripts: project.scripts.map(s => s.id !== scriptId ? s : { ...s, nodes: s.nodes.map(n => n.id !== nodeId ? n : { ...n, choices: n.choices.map(c => c.id !== choiceId ? c : { ...c, checkId }) }) }) });
}
