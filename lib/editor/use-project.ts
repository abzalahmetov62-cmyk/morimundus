'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { parseProject, type Project } from '../engine/project';
import { loadProject, saveProject, uploadAsset, type ProjectDocument } from '../storage/client';
import { createBackup, downloadBackup, restoreBackup, type Backup } from '../storage/backup';
import { MAX_ASSET_BYTES } from '../storage/asset-format';
import { DraftHistory } from './history';
import { replaceAsset } from './asset-operations';
import { addGameCycle } from '../engine/game-cycle';
import { gameCyclePulse } from '../engine/game-cycle-audio';

export type EditProject = (update: (project: Project) => Project, group?: string) => void;
export type Operation = 'save' | 'upload' | 'replace' | 'export' | 'import' | 'cycle';

export function useProject() {
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const draft = useRef<Project | null>(null);
  const saved = useRef<ProjectDocument | null>(null);
  const operation = useRef<Operation | null>(null);
  const loadId = useRef(0);
  const history = useRef(new DraftHistory<Project>());
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });

  const adopt = useCallback((next: ProjectDocument, resetHistory = true) => {
    saved.current = next;
    draft.current = next.project;
    setDocument(next);
    setProject(next.project);
    setError(null);
    if (resetHistory) { history.current.clear(); setHistoryStatus(history.current.status()); }
  }, []);

  const reload = useCallback(async () => {
    if (operation.current) return;
    const id = ++loadId.current;
    setLoading(true);
    try {
      const next = await loadProject();
      if (id === loadId.current) adopt(next);
    } catch (cause) {
      if (id === loadId.current) setError(cause instanceof Error ? cause.message : 'Не удалось открыть проект');
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [adopt]);

  useEffect(() => { void reload(); return () => { loadId.current++; }; }, [reload]);

  const edit: EditProject = useCallback((update, group) => {
    if (!draft.current || operation.current === 'import') return;
    const next = update(draft.current);
    if (!history.current.record(draft.current, next, group)) return;
    draft.current = next;
    setProject(next);
    setHistoryStatus(history.current.status());
  }, []);

  const undo = useCallback(() => {
    if (!draft.current || operation.current === 'import') return;
    const next = history.current.undo(draft.current);
    if (next) { draft.current = next; setProject(next); setHistoryStatus(history.current.status()); }
  }, []);
  const redo = useCallback(() => {
    if (!draft.current || operation.current === 'import') return;
    const next = history.current.redo(draft.current);
    if (next) { draft.current = next; setProject(next); setHistoryStatus(history.current.status()); }
  }, []);

  const perform = useCallback(async <T,>(kind: Operation, action: () => Promise<T>): Promise<T> => {
    if (operation.current) throw new Error('Дождитесь завершения текущего действия');
    operation.current = kind;
    setBusy(kind);
    setError(null);
    try { return await action(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Действие не удалось выполнить';
      setError(message);
      toast.error(message);
      throw cause;
    } finally { operation.current = null; setBusy(null); }
  }, []);

  const save = useCallback(() => perform('save', async () => {
    if (!draft.current || !saved.current) throw new Error('Сначала откройте проект');
    const original = draft.current;
    const snapshot = parseProject(original);
    const next = await saveProject(snapshot, saved.current.revision);
    history.current.breakGroup();
    if (draft.current === original) adopt(next, false);
    else { saved.current = next; setDocument(next); }
    toast.success('Проект сохранён');
    return { revision: next.revision };
  }), [perform, adopt]);

  const upload = useCallback((files: File[]) => perform('upload', async () => {
    if (!draft.current) throw new Error('Сначала откройте проект');
    if (draft.current.assets.length + files.length > 500) throw new Error('В проекте может быть не больше 500 ресурсов');
    let count = 0;
    for (const file of files) {
      if (file.size > MAX_ASSET_BYTES) throw new Error(`«${file.name}» превышает 24 МБ`);
      const asset = await uploadAsset(file);
      edit(p => ({ ...p, assets: [...p.assets, asset] }));
      count++;
    }
    toast.success(`Добавлено ресурсов: ${count}. Сохраните проект.`);
    return { count };
  }), [perform, edit]);

  const replaceResource = useCallback((assetId: string, file: File) => perform('replace', async () => {
    if (!draft.current?.assets.some(a => a.id === assetId)) throw new Error('Ресурс уже убран из проекта');
    if (file.size > MAX_ASSET_BYTES) throw new Error(`«${file.name}» превышает 24 МБ`);
    const replacement = await uploadAsset(file);
    edit(p => replaceAsset(p, assetId, replacement));
    toast.success('Ресурс заменён во всех назначениях. Сохраните проект.');
  }), [perform, edit]);

  const addControlCycle = useCallback((startHere: boolean, signal: AbortSignal) => perform('cycle', async () => {
    if (!draft.current) throw new Error('Сначала открой проект');
    const bytes = gameCyclePulse();
    addGameCycle(draft.current, { id: crypto.randomUUID(), name: 'Пульс контрольной сцены', kind: 'audio', mime: 'audio/wav', bytes: bytes.length, sha256: '0'.repeat(64) }, startHere);
    const file = new File([bytes], 'Контрольное утро — пульс.wav', { type: 'audio/wav' });
    const asset = await uploadAsset(file, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
    signal.throwIfAborted();
    let locationId = '', scriptId = '';
    edit(p => { const next = addGameCycle(p, asset, startHere); locationId = next.locationId; scriptId = next.scriptId; return next.project; });
    if (!locationId) throw new Error('Не удалось добавить контрольную сцену');
    toast.success('Контрольная сцена добавлена. Сохрани проект перед публикацией.');
    return { locationId, scriptId };
  }), [perform, edit]);

  const exportBackup = useCallback(() => perform('export', async () => {
    if (!draft.current) throw new Error('Сначала откройте проект');
    downloadBackup(await createBackup(draft.current));
    toast.success('Резервная копия скачана вместе с ресурсами');
  }), [perform]);

  const importBackup = useCallback((backup: Backup) => perform('import', async () => {
    if (!saved.current) throw new Error('Сначала откройте проект');
    const restored = await restoreBackup(backup);
    adopt(await saveProject(restored, saved.current.revision));
    toast.success('Резервная копия восстановлена и сохранена');
  }), [perform, adopt]);

  const dirty = !!project && !!document && JSON.stringify(project) !== JSON.stringify(document.project);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return { document, project, loading, error, busy, dirty, draft, saved, edit, reload, save, upload, replaceResource, addControlCycle, exportBackup, importBackup, undo, redo, ...historyStatus };
}
