'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Music2, Upload, FileImage, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { EditProject, Operation } from '@/lib/editor/use-project';
import type { Asset, Project } from '@/lib/engine/project';
import { assetUseIndex, removeAsset } from '@/lib/editor/asset-operations';
import { resourceNameMatches } from '@/lib/editor/resource-search';
import { voiceProfiles } from '@/lib/engine/voices';
import { VoiceResources } from './voice-resources';
import { assetUrl, probeAsset } from '@/lib/storage/client';

const acceptImage = 'image/png,image/jpeg,image/webp,image/gif';
const acceptAudio = 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg';

function ResourcePreview({ asset, refresh }: { asset: Asset; refresh: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.id, refresh]);
  const url = assetUrl(asset.id) + (refresh ? '?retry=' + refresh : '');
  return <div className="resource-preview">{failed ? <p role="alert">Не удалось открыть «{asset.name}». Проверь файл или замени его.</p> : asset.kind === 'image' ? <img key={url} src={url} alt={asset.name} loading="lazy" onError={() => setFailed(true)} /> : <><Music2 size={32} strokeWidth={1} /><audio key={url} aria-label={asset.name} controls preload="none" src={url} onError={() => setFailed(true)} /></>}</div>;
}

export function Resources({ project, edit, busy, upload, replace }: { project: Project; edit: EditProject; busy: Operation | null; upload: (files: File[]) => void; replace: (id: string, file: File) => Promise<unknown> }) {
  const input = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
  const [replacing, setReplacing] = useState<Asset | null>(null), [replacement, setReplacement] = useState<File | null>(null);
  const [refresh, setRefresh] = useState(0), [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const checkLifetime = useRef<AbortController | null>(null);
  useEffect(() => () => checkLifetime.current?.abort(), []);
  const uses = useMemo(() => assetUseIndex(project), [project]);
  const files = project.assets.filter(a => (filter === 'all' || a.kind === filter) && resourceNameMatches(a.name, query));
  const matchingVoices = filter === 'image' ? [] : voiceProfiles(project).filter(voice => resourceNameMatches(voice.name, query));
  const showVoices = filter !== 'image' && (!query.trim() || matchingVoices.length > 0);
  function remove(id: string) { try { edit(p => removeAsset(p, id)); } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось убрать ресурс'); } }
  async function checkFiles() {
    checkLifetime.current?.abort();
    const lifetime = new AbortController(); checkLifetime.current = lifetime; setChecking(true); setChecks({});
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, project.assets.length) }, async () => {
      while (index < project.assets.length && !lifetime.signal.aborted) {
        const asset = project.assets[index++]; let status = 'Файл доступен';
        try { await probeAsset(asset, lifetime.signal); } catch (cause) { status = cause instanceof Error ? cause.message : 'Не удалось проверить файл'; }
        if (!lifetime.signal.aborted) setChecks(previous => ({ ...previous, [asset.id]: status }));
      }
    }));
    if (!lifetime.signal.aborted) setChecking(false);
  }
  return <div className="resources-workspace"><div className="resource-controls"><Tabs value={filter} onValueChange={setFilter}><TabsList variant="line"><TabsTrigger value="all">Все · {project.assets.length}</TabsTrigger><TabsTrigger value="image"><Image size={16} />Изображения</TabsTrigger><TabsTrigger value="audio"><Music2 size={16} />Аудио</TabsTrigger></TabsList></Tabs><div className="resource-actions"><Button variant="outline" disabled={checking || !!busy || !project.assets.length} onClick={() => void checkFiles()}>{checking ? 'Проверяю файлы…' : 'Проверить файлы'}</Button><Button disabled={!!busy} onClick={() => input.current?.click()}><Upload />{busy === 'upload' ? 'Загружаю…' : 'Добавить ресурсы'}</Button></div><input ref={input} hidden multiple type="file" aria-label="Добавить изображения или аудио" accept={acceptImage + ',' + acceptAudio} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) upload(files); }} /></div>
    <div className="resource-search"><Input type="search" aria-label="Найти ресурс по названию" placeholder="Найти по названию" value={query} onChange={e => setQuery(e.target.value)} />{query && <Button variant="ghost" onClick={() => setQuery('')} aria-label="Очистить поиск ресурсов">Сбросить поиск</Button>}<Button variant="ghost" onClick={() => setRefresh(value => value + 1)}><RefreshCw />Повторить предпросмотр</Button></div>
    <p className="resource-hint">PNG, JPEG, WEBP, GIF, MP3, WAV, OGG — до 24 МБ на файл. Замена обновляет все назначения и отменяется общей кнопкой отмены. После изменений сохрани проект.</p>
    {query.trim() && <p className="field-help" role="status">Найдено: {files.length + matchingVoices.length}</p>}
    {showVoices && <VoiceResources project={project} edit={edit} busy={!!busy} query={query} />}
    {files.length ? <div className="resource-grid">{files.map(a => <article className="resource-card" key={a.id}><ResourcePreview asset={a} refresh={refresh} /><div className="resource-card-body"><Input aria-label={`Название ресурса ${a.name}`} value={a.name} maxLength={160} onChange={e => edit(p => ({ ...p, assets: p.assets.map(v => v.id === a.id ? { ...v, name: e.target.value } : v) }), 'asset-name:' + a.id)} /><div className="resource-meta"><span>{a.mime.split('/')[1].toUpperCase()} · {(a.bytes / 1024 / 1024).toFixed(2)} МБ</span><Button variant="ghost" size="icon-sm" disabled={!!busy} aria-label={`Убрать ресурс ${a.name} из проекта`} onClick={() => remove(a.id)}><Trash2 size={16} /></Button></div>
      <details className="resource-uses"><summary>Назначений: {uses.get(a.id)?.length ?? 0}</summary>{uses.get(a.id)?.length ? <ul>{uses.get(a.id)!.map(u => <li key={u.path}>{u.label}</li>)}</ul> : <p>Ресурс пока не назначен.</p>}</details>
      {checks[a.id] && <p className="field-help" role="status">{checks[a.id]}</p>}<Button variant="outline" disabled={!!busy} onClick={() => { setReplacing(a); if (replacementInput.current) { replacementInput.current.accept = a.kind === 'audio' ? acceptAudio : acceptImage; replacementInput.current.click(); } }}>{busy === 'replace' && replacing?.id === a.id ? 'Заменяю…' : 'Заменить файл'}</Button>
    </div></article>)}</div> : showVoices ? null : <div className="resource-empty"><FileImage size={44} strokeWidth={1} /><h2>{query.trim() || project.assets.length ? 'Ресурсы не найдены' : 'Первые рисунки для мира'}</h2><p>{query.trim() || project.assets.length ? 'Измени название в поиске или выбранный тип.' : 'Добавь рисунки и звук, затем назначь их в свойствах локаций, объектов и текста.'}</p>{!project.assets.length && <Button variant="outline" disabled={!!busy} onClick={() => input.current?.click()}><Upload />Выбрать файлы</Button>}</div>}
    <input ref={replacementInput} hidden type="file" aria-label="Новый файл для замены ресурса" accept={replacing?.kind === 'audio' ? acceptAudio : acceptImage} onChange={e => { setReplacement(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    <AlertDialog open={!!replacement} onOpenChange={open => { if (!open) setReplacement(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Заменить «{replacing?.name}»?</AlertDialogTitle><AlertDialogDescription>Новый файл: {replacement?.name}. Обновится назначений: {replacing ? uses.get(replacing.id)?.length ?? 0 : 0}. Название ресурса останется прежним. Можно отменить правку до сохранения проекта.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => { if (replacing && replacement) void replace(replacing.id, replacement).catch(() => {}); setReplacement(null); }}>Заменить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
