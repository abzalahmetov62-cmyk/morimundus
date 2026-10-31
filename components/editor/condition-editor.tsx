'use client';
import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Condition, Project } from '@/lib/engine/project';
import { ScalarField } from './scalar-field';

type Compare = Extract<Condition, { type: 'compare' }>;
const sources = { flag: 'Флаг', stat: 'Характеристика', skill: 'Навык', status: 'Статус', inventory: 'Предметы у героя', time: 'Время', quest: 'Задание', object: 'Объект', check: 'Проверка навыка' };
const operators = { eq: 'Равно', neq: 'Не равно', gt: 'Больше', gte: 'Не меньше', lt: 'Меньше', lte: 'Не больше' };
function optionsFor(project: Project, source: Compare['source']) {
  switch (source) {
    case 'flag': return Object.keys(project.flags).map(id => ({ id, name: id }));
    case 'stat': return project.character.stats;
    case 'skill': return project.character.skills;
    case 'status': return project.character.statuses;
    case 'inventory': return project.items;
    case 'time': return [{ id: 'worldSeconds', name: 'Время мира, секунды' }, { id: 'timeOfDaySeconds', name: 'Время суток, секунд с полуночи' }, { id: 'playedSeconds', name: 'Прошедшее время игры, секунды' }];
    case 'check': return project.checks;
    case 'quest': return project.quests;
    case 'object': return project.objects;
  }
}
function compareFor(project: Project, source: Compare['source'] = 'flag'): Compare {
  if (!optionsFor(project, source).length) source = 'time';
  const key = optionsFor(project, source)[0].id;
  const value = source === 'flag' ? project.flags[key] : source === 'status' || source === 'object' || source === 'check' ? true : source === 'quest' ? project.quests.find(q => q.id === key)?.initialStageId ?? null : 0;
  return { type: 'compare', source, key, operator: 'eq', value };
}

export function ConditionEditor({ project, value, onChange, depth = 0, label = 'Условие' }: { project: Project; value: Condition | null; onChange: (value: Condition | null) => void; depth?: number; label?: string }) {
  const id = useId();
  const kind = !value ? 'none' : value.type === 'literal' ? value.value ? 'true' : 'false' : value.type;
  const nested = value?.type === 'all' || value?.type === 'any' ? value : null;
  const compare = value?.type === 'compare' ? value : null;
  function setKind(type: string) {
    if (type === 'none') onChange(null);
    else if (type === 'true' || type === 'false') onChange({ type: 'literal', value: type === 'true' });
    else if (type === 'all' || type === 'any') onChange({ type, conditions: [value ?? { type: 'literal', value: true }] });
    else if (type === 'not') onChange({ type, condition: value ?? { type: 'literal', value: true } });
    else onChange(compareFor(project));
  }
  const changeCompare = (patch: Partial<Compare>) => { if (compare) onChange({ ...compare, ...patch }); };
  return <div className={'condition-editor depth-' + Math.min(depth, 3)}><div className="form-field"><Label htmlFor={id + '-kind'}>{label}</Label><Select value={kind} onValueChange={setKind}><SelectTrigger id={id + '-kind'}><SelectValue /></SelectTrigger><SelectContent>{depth === 0 && <SelectItem value="none">Без условия</SelectItem>}<SelectItem value="true">Всегда</SelectItem><SelectItem value="false">Никогда</SelectItem><SelectItem value="compare">Сравнение</SelectItem><SelectItem value="all" disabled={depth >= 8}>И — все условия</SelectItem><SelectItem value="any" disabled={depth >= 8}>ИЛИ — любое условие</SelectItem><SelectItem value="not" disabled={depth >= 8}>НЕ — обратное условие</SelectItem></SelectContent></Select></div>
    {nested && <div className="condition-children">{nested.conditions.map((condition, index) => <div className="condition-child" key={index}><ConditionEditor project={project} value={condition} depth={depth + 1} label={'Условие ' + (index + 1)} onChange={next => onChange({ ...nested, conditions: nested.conditions.map((c, i) => i === index ? next ?? { type: 'literal', value: true } : c) })} /><Button variant="ghost" size="sm" disabled={nested.conditions.length <= 1} aria-label={'Удалить условие ' + (index + 1)} onClick={() => onChange({ ...nested, conditions: nested.conditions.filter((_, i) => i !== index) })}><Trash2 /></Button></div>)}<Button size="sm" variant="outline" disabled={nested.conditions.length >= 64} onClick={() => onChange({ ...nested, conditions: [...nested.conditions, { type: 'literal', value: true }] })}><Plus />Ещё условие</Button></div>}
    {value?.type === 'not' && <div className="condition-children"><ConditionEditor project={project} value={value.condition} depth={depth + 1} label="Обратное условие" onChange={condition => onChange({ type: 'not', condition: condition ?? { type: 'literal', value: true } })} /></div>}
    {compare && <div className="condition-comparison"><div className="two-number-fields"><div className="form-field"><Label htmlFor={id + '-source'}>Что проверять</Label><Select value={compare.source} onValueChange={source => onChange(compareFor(project, source as Compare['source']))}><SelectTrigger id={id + '-source'}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(sources).map(([source, text]) => <SelectItem key={source} value={source} disabled={!optionsFor(project, source as Compare['source']).length}>{text}</SelectItem>)}</SelectContent></Select></div><div className="form-field"><Label htmlFor={id + '-key'}>Выбор</Label><Select value={compare.key || '__missing'} onValueChange={key => changeCompare({ key, ...(compare.source === 'flag' ? { value: project.flags[key] } : {}) })}><SelectTrigger id={id + '-key'}><SelectValue placeholder="Выберите значение" /></SelectTrigger><SelectContent>{optionsFor(project, compare.source).map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div></div>
      {compare.source === 'object' && <><div className="collision-toggle"><Label htmlFor={id + '-object-field'}>Проверять поле состояния</Label><Switch id={id + '-object-field'} checked={compare.field !== undefined} onCheckedChange={checked => { const next = { ...compare }; if (checked) { next.field = Object.keys(project.objects.find(o => o.id === compare.key)?.initialState ?? {})[0] ?? 'done'; next.value = false; } else { delete next.field; next.value = true; } onChange(next); }} /></div>{compare.field !== undefined && <div className="form-field"><Label htmlFor={id + '-field'}>Поле состояния</Label><Input id={id + '-field'} value={compare.field} maxLength={100} placeholder="done" onChange={e => changeCompare({ field: e.target.value })} /></div>}</>}
      {compare.source === 'inventory' && <div className="form-field"><Label htmlFor={id + '-owner'}>Где считать</Label><Select value={compare.field ?? 'owned'} onValueChange={field => { const next = { ...compare }; if (field === 'owned') delete next.field; else next.field = field; onChange(next); }}><SelectTrigger id={id + '-owner'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">В ячейках и экипировке</SelectItem><SelectItem value="inventory">Только в ячейках</SelectItem><SelectItem value="equipment">Только в экипировке</SelectItem></SelectContent></Select></div>}
      {compare.source === 'check' && <div className="form-field"><Label htmlFor={id + '-check-field'}>Результат или попытки</Label><Select value={compare.field ?? 'succeeded'} onValueChange={field => changeCompare({ field, value: field === 'attempts' ? 0 : true })}><SelectTrigger id={id + '-check-field'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="succeeded">Успешно пройдена</SelectItem><SelectItem value="attempts">Число попыток</SelectItem></SelectContent></Select></div>}
      {compare.source === 'quest' && <div className="collision-toggle"><Label htmlFor={id + '-quest-field'}>Проверять завершение задания</Label><Switch id={id + '-quest-field'} checked={compare.field === 'completed'} onCheckedChange={checked => { const next = { ...compare }; if (checked) { next.field = 'completed'; next.value = true; } else { delete next.field; next.value = project.quests.find(q => q.id === compare.key)?.initialStageId ?? null; } onChange(next); }} /></div>}
      <div className="form-field"><Label htmlFor={id + '-operator'}>Сравнение</Label><Select value={compare.operator} onValueChange={operator => changeCompare({ operator: operator as Compare['operator'] })}><SelectTrigger id={id + '-operator'}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(operators).map(([operator, text]) => <SelectItem key={operator} value={operator}>{text}</SelectItem>)}</SelectContent></Select></div><ScalarField id={id + '-value'} label="С чем сравнивать" value={compare.value} onChange={value => changeCompare({ value })} />
    </div>}
  </div>;
}
