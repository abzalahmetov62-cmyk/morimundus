'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function TagsField({ id, label, value, onChange, repeated = false, required = false, help }: { id: string; label: string; value: string[]; onChange: (tags: string[]) => void; repeated?: boolean; required?: boolean; help?: string }) {
  const canonical = value.join(', '), [text, setText] = useState(canonical), [error, setError] = useState('');
  useEffect(() => { setText(canonical); setError(''); }, [canonical]);
  const commit = () => {
    const tags = text.split(',').map(t => t.trim()).filter(Boolean), next = repeated ? tags : [...new Set(tags)];
    if (next.length > 64 || next.some(t => t.length > 60) || (required && !next.length)) { setError('Укажи от 1 до 64 признаков, каждый до 60 символов.'); return; }
    setError(''); onChange(next); setText(next.join(', '));
  };
  return <div className="form-field"><Label htmlFor={id}>{label}</Label><Input id={id} value={text} maxLength={4000} aria-invalid={!!error} aria-describedby={id + '-help'} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} /><p className="field-help" id={id + '-help'}>{help || 'Через запятую. Сохраняются после Enter или выхода из поля.'}</p>{error && <p role="alert">{error}</p>}</div>;
}
