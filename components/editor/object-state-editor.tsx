'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { idSchema, type Scalar } from '@/lib/engine/project';
import { ScalarField } from './scalar-field';

export function ObjectStateEditor({ value, onChange }: { value: Record<string, Scalar>; onChange: (value: Record<string, Scalar>) => void }) {
  const [key, setKey] = useState('');
  const canAdd = idSchema.safeParse(key).success && !Object.hasOwn(value, key);
  return <div className="object-state-editor">{Object.entries(value).map(([name, scalar]) => <div className="object-state-row" key={name}><code>{name}</code><ScalarField id={'object-state-' + name} value={scalar} onChange={next => onChange({ ...value, [name]: next })} /><Button size="sm" variant="ghost" aria-label={'Удалить поле ' + name} onClick={() => { const next = { ...value }; delete next[name]; onChange(next); }}><Trash2 /></Button></div>)}<div className="action-add"><Input aria-label="Новое поле состояния" value={key} maxLength={100} placeholder="done" onChange={e => setKey(e.target.value)} /><Button size="sm" variant="outline" disabled={!canAdd} onClick={() => { onChange({ ...value, [key]: false }); setKey(''); }}><Plus />Поле</Button></div><p className="field-help">Поле можно проверять в условиях и менять последствием ответа или реакции.</p></div>;
}
