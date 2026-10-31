'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Boxes, ChevronRight, Download, FileUp, FlaskConical, FolderOpen, Globe2, LayoutGrid, LoaderCircle, Map, Redo2, Save, Settings2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useImageOptimization } from '@/lib/editor/use-image-optimization';
import { useProject } from '@/lib/editor/use-project';
import { parseProject, type Project } from '@/lib/engine/project';
import type { GameState } from '@/lib/engine/game-state';
import { authorTestSnapshot, type TestPose } from '@/lib/editor/test-tools';
import { copyObjects, createLocation, deleteLocation, duplicateLocation, pasteObjects, type ObjectClipboard } from '@/lib/editor/spatial-operations';
import { parseBackup, type Backup } from '@/lib/storage/backup';
import { LocationEditor } from './location-editor';
import { Resources } from './resources';
import { ProjectSettings } from './project-settings';
import { TestPanel } from './test-panel';
import { useWorkbenchTools } from '@/lib/editor/webmcp';
import { LocationLibrary } from './location-library';
import { ItemLibrary } from './item-library';
import { RecipeLibrary } from './recipe-library';
import { TimeWorkbench } from './time-workbench';
import { RpgWorkbench } from './rpg-workbench';
import { ScriptWorkbench } from './script-workbench';
import { PublicationPanel } from './publication-panel';
import { GameCyclePanel } from './game-cycle-panel';

export default function Workbench({ accountName = '', signOutHref = '' }: { accountName?: string; signOutHref?: string }) {
  const store = useProject();
  const [view, setView] = useState<'workshop' | 'locations' | 'resources' | 'project' | 'scripts' | 'items' | 'recipes' | 'rpg' | 'time' | 'publication' | 'cycle'>('workshop');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testing, setTesting] = useState<{ locationId: string; scriptId?: string; authorSnapshot?: GameState; authorMode?: boolean } | null>(null);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ObjectClipboard | null>(null);
  const [pendingBackup, setPendingBackup] = useState<Backup | null>(null);
  const [reopen, setReopen] = useState(false);
  const [readingBackup, setReadingBackup] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const { project, document, dirty, busy, edit } = store;
  const images = useImageOptimization(project?.assets, !!busy || !!testing);
  const location = project?.locations.find(l => l.id === locationId) ?? project?.locations.find(l => l.id === project.settings.startLocationId);
  const objects = useMemo(() => project?.objects.filter(o => o.locationId === location?.id) ?? [], [project?.objects, location?.id]);
  const run = (action: Promise<unknown>) => { void action.catch(() => {}); };
  const openTest = (startId = view === 'workshop' ? location?.id : project?.settings.startLocationId) => {
    if (!project) return;
    try { parseProject(project); setTesting({ locationId: startId ?? project.settings.startLocationId }); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Проверьте данные проекта'); }
  };

  const openScript = (id: string) => { setScriptId(id); setView('scripts'); };
  const openAuthorTest = (id = location?.id ?? project?.settings.startLocationId, pose?: TestPose, script?: string) => {
    if (!project || !document || !id) return;
    try { const snapshot = authorTestSnapshot(project, document.revision, id, pose, script); setTesting({ locationId: id, scriptId: script, authorSnapshot: snapshot, authorMode: true }); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Проверь точку появления и ссылки проекта'); }
  };
  const testScript = (id: string) => openAuthorTest(location?.id ?? project?.settings.startLocationId, undefined, id);
  const openLocation = (id: string, selected?: string) => { setLocationId(id); setSelectedId(selected ?? null); setView('workshop'); };
  function apply(update: (p: Project) => Project) {
    try { edit(update); return true; } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось изменить проект'); return false; }
  }
  const copySelected = () => {
    if (!project || !selectedId || !objects.some(o => o.id === selectedId)) return;
    try { setClipboard(copyObjects(project, [selectedId])); toast.success('Объект скопирован'); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось скопировать'); }
  };
  const pasteSelected = () => {
    if (!clipboard || !location) return;
    let inserted: string | null = null;
    if (apply(p => { const next = pasteObjects(p, clipboard, location.id); inserted = next.ids[0]; return next.project; })) { setSelectedId(inserted); toast.success('Копия добавлена'); }
  };

  useWorkbenchTools({ store, setView, startTest: openTest });

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (testing) { if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') event.preventDefault(); return; }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault();
        if (!busy && project && dirty) void store.save().catch(() => {});
      }
      const target = event.target as HTMLElement | null;
      if (testing || target?.closest('input, textarea, [contenteditable=true], [role=textbox]')) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); store.redo(); }
      if (view === 'workshop' && (event.ctrlKey || event.metaKey) && event.code === 'KeyC' && selectedId) { event.preventDefault(); copySelected(); }
      if (view === 'workshop' && (event.ctrlKey || event.metaKey) && event.code === 'KeyV' && clipboard) { event.preventDefault(); pasteSelected(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [busy, project, dirty, store.save, store.undo, store.redo, testing, view, selectedId, clipboard, location]);

  async function readBackup(file: File) {
    setReadingBackup(true);
    try { setPendingBackup(await parseBackup(file)); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось прочитать резервную копию'); }
    finally { setReadingBackup(false); }
  }

  const nav = [
    { id: 'workshop' as const, label: 'Мастерская', icon: LayoutGrid },
    { id: 'locations' as const, label: 'Библиотека локаций', icon: Map },
    { id: 'scripts' as const, label: 'Текст и сценарии', icon: BookOpen },
    { id: 'items' as const, label: 'Предметы и одежда', icon: Boxes },
    { id: 'time' as const, label: 'Время и расписания', icon: Settings2 },
    { id: 'rpg' as const, label: 'Задания', icon: Settings2 },
    { id: 'recipes' as const, label: 'Рецепты', icon: Boxes },
    { id: 'resources' as const, label: 'Ресурсы', icon: Boxes },
    { id: 'project' as const, label: 'Проект', icon: Settings2 },
    { id: 'publication' as const, label: 'Игра по ссылке', icon: Globe2 },
    { id: 'cycle' as const, label: 'Контрольная сцена', icon: FlaskConical },
  ];

  return <SidebarProvider className="studio" style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
    <Sidebar className="studio-sidebar">
      <SidebarHeader className="studio-brand"><span className="brand-mark" aria-hidden="true">M</span><div><strong>MORIMUNDUS</strong><span>Авторская мастерская</span></div></SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>{nav.map(item => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view === item.id} onClick={() => setView(item.id)}><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
        <SidebarGroup><SidebarGroupLabel>Локации <span className="sidebar-count">{project?.locations.length ?? 0}</span></SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{project?.locations.map(l => <SidebarMenuItem key={l.id}><SidebarMenuButton isActive={view === 'workshop' && location?.id === l.id && !selectedId} onClick={() => { setLocationId(l.id); setSelectedId(null); setView('workshop'); }}><Map /><span>{l.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
        {view === 'workshop' && objects.length > 0 && <SidebarGroup><SidebarGroupLabel>Объекты локации</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{objects.map((o, i) => <SidebarMenuItem key={o.id}><SidebarMenuButton isActive={selectedId === o.id} onClick={() => setSelectedId(o.id)}><span className="object-number">{String(i + 1).padStart(2, '0')}</span><span>{o.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>}
      </SidebarContent>
      <SidebarFooter className="studio-sidebar-footer">{accountName && <div className="studio-account"><span>{accountName}</span>{signOutHref && <a href={signOutHref} target="_top">Выйти</a>}</div>}</SidebarFooter>
    </Sidebar>
    <SidebarInset className="studio-main">
      <header className="studio-header"><div className="studio-breadcrumb"><SidebarTrigger aria-label="Открыть меню мастерской" /><span>{project?.meta.title ?? 'Morimundus'}</span><ChevronRight size={14} aria-hidden="true" /><span>{nav.find(n => n.id === view)?.label}</span></div><div className="header-actions"><span className={dirty ? 'save-indicator unsaved' : 'save-indicator'} role="status">{busy === 'save' ? 'Сохраняю…' : dirty ? 'Есть несохранённые изменения' : document ? 'Сохранено' : 'Открываю проект…'}</span><Button variant="ghost" size="icon" disabled={!store.canUndo || busy === 'import'} onClick={store.undo} aria-label="Отменить изменение"><Undo2 /></Button><Button variant="ghost" size="icon" disabled={!store.canRedo || busy === 'import'} onClick={store.redo} aria-label="Повторить изменение"><Redo2 /></Button><Button variant="outline" onClick={() => openTest()} disabled={!project || !!busy}><FlaskConical />Проверить</Button><Button variant="ghost" onClick={() => openAuthorTest()} disabled={!project || !!busy}>Авторская проверка</Button><Button onClick={() => run(store.save())} disabled={!project || !dirty || !!busy}>{busy === 'save' ? <LoaderCircle className="animate-spin" /> : <Save />}Сохранить</Button></div></header>
      {store.error && project && <div className="storage-warning" role="alert"><span>{store.error}</span><Button variant="ghost" onClick={() => dirty ? setReopen(true) : run(store.reload())} disabled={!!busy}><Undo2 />Открыть сохранённый проект</Button></div>}
      {!project ? <div className="opening-state"><BookOpen size={36} strokeWidth={1} /><h1>{store.loading ? 'Открываю мастерскую' : 'Не удалось открыть проект'}</h1><p>{store.loading ? 'Загружаю локации и авторские данные.' : store.error}</p>{store.loading ? <LoaderCircle className="animate-spin" /> : <Button onClick={() => run(store.reload())}>Попробовать снова</Button>}</div> : <>
        <div className="workspace-toolbar"><div><span className="section-eyebrow">{view === 'cycle' ? 'КОНТРОЛЬНОЕ ПРОХОЖДЕНИЕ' : view === 'publication' ? 'ОПУБЛИКОВАННАЯ РЕДАКЦИЯ' : view === 'workshop' ? 'ЛОКАЦИЯ' : view === 'locations' ? 'ПРОСТРАНСТВО И ПЕРЕХОДЫ' : view === 'time' ? 'МИР ВО ВРЕМЕНИ' : view === 'rpg' ? 'ЗАДАНИЯ И ПРОГРЕСС' : view === 'recipes' ? 'ИНГРЕДИЕНТЫ И РЕЗУЛЬТАТ' : view === 'items' ? 'ВЕЩИ ГЕРОЯ' : view === 'scripts' ? 'ВЕТВЛЕНИЯ И ПОСЛЕДСТВИЯ' : view === 'resources' ? 'БИБЛИОТЕКА РЕСУРСОВ' : 'АВТОРСКИЙ ПРОЕКТ'}</span><h1>{view === 'cycle' ? 'Контрольная сцена' : view === 'publication' ? 'Игра по ссылке' : view === 'workshop' ? location?.name : view === 'locations' ? 'Библиотека локаций' : view === 'time' ? 'Время и расписания' : view === 'rpg' ? 'Задания' : view === 'recipes' ? 'Рецепты' : view === 'items' ? 'Предметы и одежда' : view === 'scripts' ? 'Текст и сценарии' : view === 'resources' ? 'Изображения и звук' : 'Настройки проекта'}</h1></div><div className="backup-actions"><Button variant="ghost" onClick={() => run(store.exportBackup())} disabled={!!busy}><Download />{busy === 'export' ? 'Собираю копию…' : 'Скачать копию'}</Button><Button variant="ghost" onClick={() => backupInput.current?.click()} disabled={!!busy || readingBackup}><FileUp />{readingBackup ? 'Читаю копию…' : 'Импорт'}</Button><input hidden ref={backupInput} type="file" accept=".json,application/json" aria-label="Импорт резервной копии" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void readBackup(file); }} /></div></div>
        <fieldset className="workspace-content" disabled={busy === 'import'}>
          {view === 'workshop' && location && <LocationEditor key={location.id} project={project} location={location} objects={objects} selectedId={selectedId} onSelect={setSelectedId} edit={edit} onOpenLocation={openLocation} onOpenScript={openScript} onCopy={copySelected} onPaste={pasteSelected} canPaste={!!clipboard} onTestPose={pose => openAuthorTest(location.id, pose)} />}
          {view === 'locations' && <LocationLibrary project={project} onOpen={openLocation} onTest={id => openAuthorTest(id)} onCreate={(name, width, depth, height) => { let created: string | null = null; const done = apply(p => { const next = createLocation(p, name, width, depth, height); created = next.id; return next.project; }); if (done && created) openLocation(created); return done; }} onDuplicate={id => { let copied: string | null = null; if (apply(p => { const next = duplicateLocation(p, id); copied = next.id; return next.project; }) && copied) openLocation(copied); }} onDelete={id => { const done = apply(p => deleteLocation(p, id)); if (done) { setSelectedId(null); if (locationId === id) setLocationId(null); } return done; }} />}
          {view === 'items' && <ItemLibrary project={project} edit={edit} />}
          {view === 'time' && <TimeWorkbench project={project} edit={edit} />}
          {view === 'rpg' && <RpgWorkbench project={project} edit={edit} />}
          {view === 'recipes' && <RecipeLibrary project={project} edit={edit} />}
          {view === 'scripts' && <ScriptWorkbench project={project} edit={edit} selectedId={scriptId} onSelect={setScriptId} onTest={testScript} />}
          {view === 'resources' && <><p className="field-help" role="status">{images.unavailable ? 'Этот браузер не поддерживает сжатие WebP. Открой мастерскую в другом браузере; оригиналы доступны.' : images.total ? `${images.running ? 'Подготавливаю изображения для игры' : 'Подготовка изображений'}: ${images.done} / ${images.total}${images.failed ? `. Отложено после ошибок: ${images.failed}; можно повторить при следующем открытии мастерской.` : '.'}` : 'Крупных изображений для сжатия нет.'} Оригиналы сохраняются в резервной копии.</p><Resources project={project} edit={edit} busy={busy} upload={files => run(store.upload(files))} replace={store.replaceResource} /></>}
          {view === 'project' && <ProjectSettings project={project} edit={edit} onOpenScript={openScript} />}
          {view === 'publication' && document && <PublicationPanel project={project} revision={document.revision} dirty={dirty} busy={!!busy} />}
          {view === 'cycle' && <GameCyclePanel project={project} busy={!!busy} onAdd={store.addControlCycle} onOpenLocation={openLocation} onOpenScript={openScript} onTest={(id, script) => openAuthorTest(id, undefined, script)} />}
        </fieldset>
        <footer className="workspace-footer"><span><FolderOpen size={14} /> Формат проекта {project.formatVersion} · версия {document?.revision}</span><span>{document && `Последнее сохранение: ${new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Qyzylorda' }).format(new Date(document.updatedAt))}`}</span></footer>
      </>}
    </SidebarInset>
    {testing && project && document && <TestPanel project={project} revision={document.revision} startLocationId={testing.locationId} startScriptId={testing.scriptId} authorSnapshot={testing.authorSnapshot} authorMode={testing.authorMode} savesDisabledReason={dirty ? 'Сохрани авторский проект перед записью прохождения. Проверка черновика доступна.' : undefined} onClose={() => setTesting(null)} />}
    <AlertDialog open={!!pendingBackup} onOpenChange={open => { if (!open) setPendingBackup(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Восстановить резервную копию?</AlertDialogTitle><AlertDialogDescription>Проект «{pendingBackup?.project.meta.title}», локаций: {pendingBackup?.project.locations.length}, ресурсов: {pendingBackup?.resources.length}. Он заменит открытый и сохранённый проект. Перед заменой можно отменить действие и скачать текущую копию.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => { if (pendingBackup) run(store.importBackup(pendingBackup)); }}>Восстановить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={reopen} onOpenChange={setReopen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Открыть сохранённый проект?</AlertDialogTitle><AlertDialogDescription>Несохранённые правки в этой вкладке будут потеряны. Сначала скачайте копию, если хотите сохранить их.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => run(store.reload())}>Открыть</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Toaster theme="light" position="bottom-right" richColors closeButton />
  </SidebarProvider>;
}
