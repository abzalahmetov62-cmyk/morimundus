'use client';
import { Switch } from '@/components/ui/switch';
import type { Project } from '@/lib/engine/project';
import { NumberField } from './number-field';

export function TraitModifiers({ project, value, onChange, prefix }: { project: Project; value: Record<string, number>; onChange: (modifiers: Record<string, number>) => void; prefix: string }) {
  const traits = [...project.character.stats, ...project.character.skills].filter((t, i, list) => list.findIndex(v => v.id === t.id) === i);
  return <>{traits.map(t => <div className="item-modifier-row" key={t.id}><label><Switch aria-label={'Изменять ' + t.name} checked={Object.hasOwn(value, t.id)} onCheckedChange={checked => { const next = { ...value }; if (checked) next[t.id] = 1; else delete next[t.id]; onChange(next); }} />{t.name}</label>{Object.hasOwn(value, t.id) && <NumberField id={prefix + '-' + t.id} label="Изменение при действующем статусе" value={value[t.id]} min={-1000} max={1000} onCommit={bonus => onChange({ ...value, [t.id]: bonus })} />}</div>)}{!traits.length && <p className="field-help">Сначала добавь характеристики или навыки.</p>}</>;
}
