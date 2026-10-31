'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NumberField({ id, label, value, min = -10000, max = 10000, step = .25, onCommit }: { id: string; label: string; value: number; min?: number; max?: number; step?: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(Number(value.toFixed(4))));
  useEffect(() => { setText(String(Number(value.toFixed(4)))); }, [value]);
  return <div className="form-field number-field"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" min={min} max={max} step={step} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={() => {
    const n = text.trim() ? Number(text) : NaN;
    if (!Number.isFinite(n) || n < min || n > max) { setText(String(Number(value.toFixed(4)))); toast.error(`${label}: введите число от ${min} до ${max}`); return; }
    setText(String(Number(n.toFixed(4)))); if (n !== value) onCommit(n);
  }} /></div>;
}

export function VectorFields({ prefix, value, labels = ['X', 'Y', 'Z'], min, max, onCommit }: { prefix: string; value: [number, number, number]; labels?: [string, string, string]; min?: number; max?: number; onCommit: (value: [number, number, number]) => void }) {
  return <div className="vector-fields">{value.map((v, index) => <NumberField key={index} id={`${prefix}-${index}`} label={labels[index]} value={v} min={min} max={max} onCommit={n => { const next = [...value] as [number, number, number]; next[index] = n; onCommit(next); }} />)}</div>;
}
