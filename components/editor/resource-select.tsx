'use client';
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { resourceNameMatches } from '@/lib/editor/resource-search';

export type ResourceOption = { value: string; label: string };
export function ResourceSelect({ id, label, value, options, onChange, noneLabel = 'Не назначен' }: { id: string; label: string; value: string | null; options: ResourceOption[]; onChange: (value: string | null) => void; noneLabel?: string }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const selected = options.find(option => option.value === value);
  const matches = options.filter(option => resourceNameMatches(option.label, query));
  const changeOpen = (next: boolean) => { setOpen(next); setQuery(''); };
  const choose = (next: string | null) => { onChange(next); changeOpen(false); };
  const clearOption = <CommandItem value="__none" onSelect={() => choose(null)}><Check aria-hidden="true" style={{ visibility: value === null ? 'visible' : 'hidden' }} />{noneLabel}</CommandItem>;
  return <div className="form-field"><Label htmlFor={id}>{label}</Label><Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-controls={open ? id + '-options' : undefined} className="resource-select-trigger"><span>{selected?.label ?? (value ? 'Ресурс недоступен' : noneLabel)}</span><ChevronsUpDown size={16} aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="resource-select-popover"><Command shouldFilter={false} defaultValue={value ?? '__none'} label={label}>
      <CommandInput placeholder="Найти по названию…" aria-label={'Поиск: ' + label} value={query} onValueChange={setQuery} />
      <CommandList id={id + '-options'} aria-label={label}>
        {!query.trim() && clearOption}
        {matches.map(option => <CommandItem key={option.value} value={option.value} onSelect={() => choose(option.value)}><Check aria-hidden="true" style={{ visibility: value === option.value ? 'visible' : 'hidden' }} /><span className="resource-select-option-name">{option.label}</span></CommandItem>)}
        {query.trim() && clearOption}
        {!matches.length && <p className="resource-select-empty" role="status">{query.trim() ? 'Ресурсы не найдены. Измени название в поиске.' : 'Подходящих ресурсов пока нет.'}</p>}
      </CommandList>
    </Command></PopoverContent>
  </Popover></div>;
}
