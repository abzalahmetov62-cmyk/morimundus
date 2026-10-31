'use client';

import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { parseProject } from '../engine/project';
import type { useProject } from './use-project';

type Options = { store: ReturnType<typeof useProject>; setView: (view: 'workshop' | 'resources' | 'project') => void; startTest: () => void };
type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown | Promise<unknown> };
type ModelContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };
const empty = z.object({}).strict();
const metadata = z.object({ title: z.string().trim().min(1).max(160).optional(), author: z.string().max(160).optional(), description: z.string().max(20000).optional() }).strict().refine(v => Object.keys(v).length > 0, 'Нужно указать хотя бы одно поле');

export function useWorkbenchTools(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; }, [options]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      { name: 'get_morimundus_project_summary', title: 'Прочитать состояние проекта', description: 'Read the current author draft summary without changing the project or test session.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input) {
        empty.parse(input);
        const { draft, saved } = latest.current.store;
        const p = draft.current;
        if (!p || !saved.current) throw new Error('Проект ещё не открыт');
        return { id: p.id, title: p.meta.title, revision: saved.current.revision, unsavedChanges: JSON.stringify(p) !== JSON.stringify(saved.current.project), locations: p.locations.map(l => ({ id: l.id, name: l.name })), objects: p.objects.length, resources: p.assets.length };
      } },
      { name: 'configure_morimundus_project_metadata', title: 'Изменить сведения о проекте', description: 'Stage title, author or description changes in the visible draft. Does not save them; use save_morimundus_project to persist.', inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 160 }, author: { type: 'string', maxLength: 160 }, description: { type: 'string', maxLength: 20000 } }, minProperties: 1, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) {
        const patch = metadata.parse(input);
        const { draft, edit, busy } = latest.current.store;
        if (!draft.current || busy) throw new Error('Проект недоступен для изменения');
        const next = parseProject({ ...draft.current, meta: { ...draft.current.meta, ...patch } });
        edit(() => next);
        latest.current.setView('project');
        return { staged: true, title: next.meta.title, saved: false };
      } },
      { name: 'save_morimundus_project', title: 'Сохранить проект', description: 'Persist the current author draft and its resource references. Rejects invalid data and conflicting revisions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute(input) { empty.parse(input); return latest.current.store.save(); } },
    ];
    for (const tool of tools) {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
      catch { }
    }
    return () => lifecycle.abort();
  }, []);
}
