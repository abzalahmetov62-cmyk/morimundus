'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project, Script } from '@/lib/engine/project';
import { dialogueGraph, dialogueNodeName, type DialogueEdge, type DialogueLink } from '@/lib/editor/dialogue-graph';
import { textOf } from '@/lib/editor/rich-text';

type Props = { project: Project; script: Script; selectedId: string; onSelect: (id: string) => void; onOpenScript: (id: string) => void; onConnect: (link: DialogueLink, targetId: string | null) => boolean; onNewTarget: (link: DialogueLink) => boolean; onNewReply: (nodeId: string) => void };
type Lines = { width: number; height: number; paths: { id: string; d: string; kind: DialogueEdge['kind']; selected: boolean }[] };

export function DialogueTree({ project, script, selectedId, onSelect, onOpenScript, onConnect, onNewTarget, onNewReply }: Props) {
  const graph = useMemo(() => dialogueGraph(script), [script]);
  const edgesByChoice = useMemo(() => { const result = new Map<string, DialogueEdge[]>(); for (const edge of graph.edges) { const values = result.get(edge.nodeId + ':' + edge.choiceId) ?? []; values.push(edge); result.set(edge.nodeId + ':' + edge.choiceId, values); } return result; }, [graph]);
  const names = new Map(script.nodes.map((node, index) => [node.id, dialogueNodeName(node, index)]));
  const canvas = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>()), ports = useRef(new Map<string, HTMLButtonElement>());
  const [link, setLink] = useState<DialogueLink | null>(null), [lines, setLines] = useState<Lines>({ width: 0, height: 0, paths: [] });
  const marker = 'dialogue-' + useId().replace(/:/g, '');
  const linkingChoice = link && script.nodes.find(node => node.id === link.nodeId)?.choices.find(choice => choice.id === link.choiceId);
  useEffect(() => { if (link && !linkingChoice) setLink(null); }, [link, linkingChoice]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    let frame = 0;
    const measure = () => {
      const origin = element.getBoundingClientRect(), paths: Lines['paths'] = [];
      for (const edge of graph.edges) {
        if (edge.target.type !== 'node' || !edge.target.id) continue;
        const start = ports.current.get(edge.id)?.getBoundingClientRect(), end = cards.current.get(edge.target.id)?.getBoundingClientRect();
        if (!start || !end) continue;
        const x = start.right - origin.left, y = start.top + start.height / 2 - origin.top, tx = end.left - origin.left, ty = end.top + Math.min(40, end.height / 2) - origin.top;
        const d = tx > x ? `M ${x} ${y} C ${x + 32} ${y}, ${tx - 32} ${ty}, ${tx} ${ty}` : `M ${x} ${y} H ${x + 20} V ${Math.max(6, Math.min(y, end.top - origin.top) - 16)} H ${tx - 16} V ${ty} H ${tx}`;
        paths.push({ id: edge.id, d, kind: edge.kind, selected: edge.nodeId === selectedId });
      }
      const next = { width: element.scrollWidth, height: element.scrollHeight, paths };
      setLines(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule); observer.observe(element); cards.current.forEach(card => observer.observe(card));
    schedule(); return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [graph, selectedId]);
  useEffect(() => {
    const view = viewport.current, card = cards.current.get(selectedId), element = canvas.current;
    if (!view || !card || !element) return;
    const rect = card.getBoundingClientRect(), bounds = view.getBoundingClientRect(), origin = element.getBoundingClientRect();
    if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) view.scrollTo({ left: Math.max(0, rect.left - origin.left - 24), top: Math.max(0, rect.top - origin.top - 24) });
  }, [selectedId, script.nodes.length]);
  const select = (id: string) => { if (link) { if (onConnect(link, id)) setLink(null); } else onSelect(id); };
  const targetName = (edge: DialogueEdge) => edge.target.type === 'end' ? 'Конец диалога' : edge.target.type === 'node' ? names.get(edge.target.id!) ?? 'Фрагмент' : edge.target.type === 'script' ? 'Сцена: ' + (project.scripts.find(value => value.id === edge.target.id)?.name ?? '') : 'Локация: ' + (project.locations.find(value => value.id === edge.target.id)?.name ?? '');
  return <section className="dialogue-tree" aria-label="Дерево диалога">
    <div className="dialogue-tree-heading"><h3>Дерево диалога</h3><Button variant="outline" size="sm" onClick={() => { setLink(null); onSelect(script.entryNodeId); }}>К началу</Button></div>
    <p className="field-help">Выбери фрагмент для редактирования. Нажми переход под ответом, затем фрагмент назначения. Пунктир — провал или возврат; условия редактируются в ответе.</p>
    {link && linkingChoice && <div className="dialogue-linking" role="status"><p>{link.branch === 'failure' ? 'После провала' : linkingChoice.checkId ? 'После успеха' : 'После ответа'} «{linkingChoice.label}»: выбери фрагмент.</p><div><Button variant="outline" size="sm" onClick={() => { if (onNewTarget(link)) setLink(null); }}><Plus />Новая реплика</Button><Button variant="outline" size="sm" onClick={() => { if (onConnect(link, null)) setLink(null); }}>Конец диалога</Button><Button variant="ghost" size="sm" onClick={() => setLink(null)}><X />Отмена</Button></div></div>}
    <div className="dialogue-tree-viewport" ref={viewport} tabIndex={0} aria-label="Схема связей, прокручивается в обе стороны"><div className="dialogue-tree-canvas" ref={canvas}>
      <svg className="dialogue-tree-lines" width={lines.width} height={lines.height} aria-hidden="true"><defs>{['answer', 'success', 'failure'].map(kind => <marker key={kind} id={marker + '-' + kind} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 Z" className={'dialogue-arrow ' + kind} /></marker>)}</defs>{lines.paths.map(path => <path key={path.id} d={path.d} className={'dialogue-connection ' + path.kind + (path.selected ? ' is-selected' : '')} markerEnd={'url(#' + marker + '-' + path.kind + ')'} />)}</svg>
      {graph.columns.map((column, index) => <div className="dialogue-tree-column" key={index}>{column.disconnected && <p className="field-help">Отдельные ветви</p>}{column.nodes.map(node => <div key={node.id} ref={element => { if (element) cards.current.set(node.id, element); else cards.current.delete(node.id); }} className={'dialogue-node' + (node.id === selectedId ? ' is-selected' : '') + (link ? ' is-target' : '')}>
        <button type="button" className="dialogue-node-title" aria-pressed={node.id === selectedId} onClick={() => select(node.id)} title={names.get(node.id)}>{node.id === script.entryNodeId && <span className="dialogue-entry">Начало</span>}<strong>Фрагмент {script.nodes.indexOf(node) + 1}</strong>{node.entryCondition != null && <span className="dialogue-entry">Условное начало · {node.entryPriority ?? 0}</span>}<span>{textOf(node.paragraphs[0]?.spans ?? []).trim().slice(0, 160) || 'Пустая реплика'}</span></button>
        {!node.choices.length && <p className="dialogue-ending">Конец после текста</p>}
        {node.choices.slice(0, node.id === selectedId ? node.choices.length : 3).map(choice => <div className="dialogue-tree-answer" key={choice.id}><button type="button" className="dialogue-answer-label" onClick={() => onSelect(node.id)}>{choice.label}</button>{choice.condition && <span className="dialogue-choice-meta">Есть условие</span>}{choice.checkId && <span className="dialogue-choice-meta">{project.checks.find(check => check.id === choice.checkId)?.name ?? 'Проверка навыка'}</span>}{(edgesByChoice.get(node.id + ':' + choice.id) ?? []).map(edge => <Button key={edge.id} ref={element => { if (element) ports.current.set(edge.id, element); else ports.current.delete(edge.id); }} variant="ghost" size="sm" className={'dialogue-port ' + edge.kind + (link?.nodeId === edge.nodeId && link.choiceId === edge.choiceId && link.branch === edge.branch ? ' is-linking' : '')} title={(edge.explicit ? 'Переход задан последствиями. ' : 'Изменить переход. ') + targetName(edge)} onClick={() => { if (edge.explicit) { if (edge.target.type === 'script') onOpenScript(edge.target.id!); else onSelect(node.id); } else { onSelect(edge.nodeId); setLink({ nodeId: edge.nodeId, choiceId: edge.choiceId, branch: edge.branch }); } }}><span>{edge.kind === 'failure' ? 'Провал' : edge.kind === 'success' ? 'Успех' : 'Ответ'}</span><span>{targetName(edge)}</span></Button>)}</div>)}
        {node.id !== selectedId && node.choices.length > 3 && <Button variant="ghost" size="sm" onClick={() => onSelect(node.id)}>Показать ещё {node.choices.length - 3} ответов</Button>}
        {node.id === selectedId && !link && <Button variant="outline" size="sm" className="dialogue-add-reply" disabled={node.choices.length >= 100 || script.nodes.length >= 1000} onClick={() => onNewReply(node.id)}><Plus />Ответ с новой репликой</Button>}
      </div>)}</div>)}
    </div></div>
  </section>;
}
