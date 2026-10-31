import { parseProject, type Project, type Script, type ScriptChoice, type ScriptNode } from '../engine/project';
import { blankChoice, blankNode } from './script-operations';
import { textOf } from './rich-text';

export type DialogueBranch = 'next' | 'failure';
export type DialogueLink = { nodeId: string; choiceId: string; branch: DialogueBranch };
export type DialogueEdge = DialogueLink & { id: string; kind: 'answer' | 'success' | 'failure'; target: { type: 'node' | 'script' | 'location' | 'end'; id: string | null }; explicit: boolean };
export const dialogueNodeName = (node: ScriptNode, index: number) => 'Фрагмент ' + (index + 1) + (textOf(node.paragraphs[0]?.spans ?? []).trim() ? ' · ' + textOf(node.paragraphs[0].spans).trim().slice(0, 34) : '');

function redirect(choice: ScriptChoice, branch: DialogueBranch) {
  return (branch === 'failure' ? choice.failureActions : choice.actions).findLast(action => action.type === 'openScript' || action.type === 'transition');
}

export function dialogueGraph(script: Script) {
  const edges: DialogueEdge[] = [];
  for (const node of script.nodes) for (const choice of node.choices) {
    for (const branch of (choice.checkId ? ['next', 'failure'] : ['next']) as DialogueBranch[]) {
      const action = redirect(choice, branch), targetId = branch === 'failure' ? choice.failureNodeId : choice.nextNodeId;
      const target: DialogueEdge['target'] = action?.type === 'openScript' ? action.scriptId === script.id ? { type: 'node', id: script.entryNodeId } : { type: 'script', id: action.scriptId }
        : action?.type === 'transition' ? { type: 'location', id: action.locationId } : targetId ? { type: 'node', id: targetId } : { type: 'end', id: null };
      edges.push({ id: node.id + ':' + choice.id + ':' + branch, nodeId: node.id, choiceId: choice.id, branch, kind: branch === 'failure' ? 'failure' : choice.checkId ? 'success' : 'answer', target, explicit: !!action });
    }
  }
  const outgoing = new Map<string, DialogueEdge[]>();
  for (const edge of edges) { const list = outgoing.get(edge.nodeId) ?? []; list.push(edge); outgoing.set(edge.nodeId, list); }
  const levels = new Map<string, number>([[script.entryNodeId, 0]]), queue = [script.entryNodeId];
  for (let index = 0; index < queue.length; index++) for (const edge of outgoing.get(queue[index]) ?? []) {
    if (edge.target.type !== 'node' || !edge.target.id || levels.has(edge.target.id)) continue;
    levels.set(edge.target.id, levels.get(queue[index])! + 1); queue.push(edge.target.id);
  }
  const disconnected = script.nodes.filter(node => !levels.has(node.id));
  const last = Math.max(0, ...levels.values()) + 1;
  const columns: { nodes: ScriptNode[]; disconnected: boolean }[] = Array.from({ length: last }, () => ({ nodes: [], disconnected: false }));
  for (const node of script.nodes) if (levels.has(node.id)) columns[levels.get(node.id)!].nodes.push(node);
  if (disconnected.length) columns.push({ nodes: disconnected, disconnected: true });
  return { edges, columns };
}

function source(project: Project, scriptId: string, link: DialogueLink) {
  const script = project.scripts.find(script => script.id === scriptId), node = script?.nodes.find(node => node.id === link.nodeId), choice = node?.choices.find(choice => choice.id === link.choiceId);
  if (!script || !node || !choice) throw new Error('Ответ уже удалён. Выбери другой.');
  if (link.branch === 'failure' && !choice.checkId) throw new Error('Ветка провала доступна только для проверки навыка.');
  if (redirect(choice, link.branch)) throw new Error('Переход задан в последствиях ответа. Измени его в карточке ответа.');
  return { script, node, choice };
}

export function connectDialogue(project: Project, scriptId: string, link: DialogueLink, targetId: string | null) {
  const { script } = source(project, scriptId, link);
  if (targetId && !script.nodes.some(node => node.id === targetId)) throw new Error('Фрагмент назначения не найден.');
  const field = link.branch === 'failure' ? 'failureNodeId' : 'nextNodeId';
  return parseProject({ ...project, scripts: project.scripts.map(value => value.id !== scriptId ? value : { ...value, nodes: value.nodes.map(node => node.id !== link.nodeId ? node : { ...node, choices: node.choices.map(choice => choice.id !== link.choiceId ? choice : { ...choice, [field]: targetId }) }) }) });
}

export function addDialogueTarget(project: Project, scriptId: string, link: DialogueLink) {
  source(project, scriptId, link);
  const node = blankNode();
  const added = { ...project, scripts: project.scripts.map(script => script.id === scriptId ? { ...script, nodes: [...script.nodes, node] } : script) };
  return { project: connectDialogue(added, scriptId, link, node.id), nodeId: node.id };
}

export function addDialogueReply(project: Project, scriptId: string, nodeId: string) {
  const script = project.scripts.find(script => script.id === scriptId);
  if (!script?.nodes.some(node => node.id === nodeId)) throw new Error('Фрагмент не найден.');
  const target = blankNode(), choice = { ...blankChoice(), nextNodeId: target.id };
  return { nodeId: target.id, project: parseProject({ ...project, scripts: project.scripts.map(value => value.id !== scriptId ? value : { ...value, nodes: [...value.nodes.map(node => node.id === nodeId ? { ...node, choices: [...node.choices, choice] } : node), target] }) }) };
}
