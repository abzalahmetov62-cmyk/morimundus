'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { publicationInfoSchema, type PublicationInfo } from '@/lib/engine/publication';
import type { Project } from '@/lib/engine/project';
import { responseData } from '@/lib/storage/client';

const resultSchema = z.object({ publication: publicationInfoSchema.nullable() }).strict();
export function PublicationPanel({ project, revision, dirty, busy }: { project: Project; revision: number; dirty: boolean; busy: boolean }) {
  const [publication, setPublication] = useState<PublicationInfo | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [confirm, setConfirm] = useState(false), [publishing, setPublishing] = useState(false);
  const requestLifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifetime = new AbortController(); requestLifetime.current = lifetime;
    setLoading(true); setError('');
    void fetch('/api/publication', { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      const body = await responseData(response, 'Не удалось открыть сведения о публикации');
      if (!lifetime.signal.aborted) setPublication(resultSchema.parse(body).publication);
    }).catch(cause => { if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось открыть публикацию'); }).finally(() => { if (!lifetime.signal.aborted) setLoading(false); });
    return () => lifetime.abort();
  }, [refresh]);
  async function publish() {
    setConfirm(false); setPublishing(true); setError('');
    const lifetime = requestLifetime.current;
    try {
      const response = await fetch('/api/publication', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedAuthorRevision: revision, expectedPublicationRevision: publication?.revision ?? 0 }), signal: lifetime ? AbortSignal.any([lifetime.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      const body = await responseData(response, 'Не удалось опубликовать игру');
      if (!lifetime?.signal.aborted) setPublication(resultSchema.parse(body).publication);
    } catch (cause) { if (!lifetime?.signal.aborted) setError(cause instanceof Error ? cause.message : 'Публикация не завершена. Обнови сведения перед повтором.'); }
    finally { if (!lifetime?.signal.aborted) setPublishing(false); }
  }
  return <section className="publication-workspace"><h2>Опубликованная игра</h2><p>Игроки получают отдельную редакцию. Изменения в мастерской попадут в неё после публикации.</p>
    {loading ? <p role="status"><LoaderCircle className="animate-spin" size={18} />Открываю сведения…</p> : publication ? <div className="publication-summary"><strong>{publication.title} · редакция {publication.revision}</strong><p>Опубликована {new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qyzylorda' }).format(new Date(publication.publishedAt))}</p><p>Из авторского проекта версии {publication.authorRevision}. Сейчас сохранена версия {revision}.</p></div> : <p>Игра ещё не опубликована.</p>}
    {error && <p role="alert">{error}</p>}{dirty && <p className="field-help">Сначала сохрани авторский проект. Несохранённые правки в публикацию не попадут.</p>}
    <div className="publication-actions"><Button disabled={loading || publishing || busy || dirty || !!error} onClick={() => setConfirm(true)}>{publishing ? 'Публикую…' : publication ? 'Опубликовать новую редакцию' : 'Опубликовать игру'}</Button><Button variant="outline" disabled={loading || publishing} onClick={() => setRefresh(value => value + 1)}>Обновить сведения</Button>{publication && <a href="/play" target="_blank" rel="noopener noreferrer">Открыть игру</a>}</div>
    <p className="field-help">Ссылка игры: <code>/play</code>. Доступ определяется настройками сайта. Прохождения хранятся отдельно от черновика; при изменении содержания прежний слот остаётся видимым, но может не подходить к новой редакции.</p>
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Опубликовать сохранённый проект?</AlertDialogTitle><AlertDialogDescription>«{project.meta.title}», версия {revision}: {project.locations.length} локаций, {project.objects.length} объектов, {project.scripts.length} сцен. Эта редакция станет доступна по ссылке игры. Черновик останется в мастерской.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction disabled={dirty || busy} onClick={() => void publish()}>Опубликовать</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
