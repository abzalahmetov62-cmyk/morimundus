'use client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Scalar } from '@/lib/engine/project';
import { NumberField } from './number-field';

export function ScalarField({ id, label = 'Значение', value, onChange }: { id: string; label?: string; value: Scalar; onChange: (value: Scalar) => void }) {
  const type = value === null ? 'null' : typeof value;
  return <div className="scalar-field"><div className="form-field"><Label htmlFor={id + '-type'}>{label}</Label><Select value={type} onValueChange={v => onChange(v === 'boolean' ? false : v === 'number' ? 0 : v === 'null' ? null : '')}><SelectTrigger id={id + '-type'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="boolean">Да / нет</SelectItem><SelectItem value="number">Число</SelectItem><SelectItem value="string">Текст</SelectItem><SelectItem value="null">Пусто</SelectItem></SelectContent></Select></div>
    {typeof value === 'boolean' ? <div className="boolean-value"><Switch id={id} checked={value} onCheckedChange={onChange} /><Label htmlFor={id}>{value ? 'Да' : 'Нет'}</Label></div> : typeof value === 'number' ? <NumberField id={id} label={label + ': число'} value={value} min={-1e12} max={1e12} step={1} onCommit={onChange} /> : typeof value === 'string' ? <Input id={id} aria-label={label + ': текст'} value={value} maxLength={8000} onChange={e => onChange(e.target.value)} /> : null}
  </div>;
}
