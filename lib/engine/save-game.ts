import { z } from 'zod';
import { gameStateSchema, parseGameState, type GameState } from './game-state';
import { parseProject, type Project } from './project';
import { assertArrival, presentObjects } from './spatial';

export const SAVE_SLOTS = ['auto', 'manual-1', 'manual-2', 'manual-3', 'manual-4', 'manual-5'] as const;
export const slotSchema = z.enum(SAVE_SLOTS);
export type SaveSlot = z.infer<typeof slotSchema>;
export const MAX_SAVE_BYTES = 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const savedGameSchema = z.object({ formatVersion: z.literal(1), projectFingerprint: digestSchema, state: gameStateSchema }).strict();
export type SavedGame = z.infer<typeof savedGameSchema>;
export const saveDocumentSchema = z.object({ slot: slotSchema, revision: revisionSchema.positive(), updatedAt: z.string().datetime(), save: savedGameSchema, checksum: digestSchema }).strict();
export type SaveDocument = z.infer<typeof saveDocumentSchema>;
export const saveWriteSchema = z.object({ expectedRevision: revisionSchema, save: savedGameSchema, checksum: digestSchema }).strict();
export const saveDeleteSchema = z.object({ expectedRevision: revisionSchema.positive() }).strict();
export const slotSummarySchema = z.object({ slot: slotSchema, revision: revisionSchema, updatedAt: z.string().datetime().nullable(), occupied: z.boolean(), health: z.enum(['empty', 'valid', 'damaged']), projectFingerprint: digestSchema.nullable(), projectRevision: z.number().int().positive().nullable(), sessionId: z.string().nullable(), locationName: z.string().max(160).nullable(), worldSeconds: z.number().finite().nonnegative().nullable() }).strict();
export type SlotSummary = z.infer<typeof slotSummarySchema>;
export const slotListSchema = z.object({ slots: z.array(slotSummarySchema).length(SAVE_SLOTS.length) }).strict().superRefine((list, ctx) => {
  if (new Set(list.slots.map(s => s.slot)).size !== SAVE_SLOTS.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Список сохранений повреждён' });
});
export function emptySlot(slot: SaveSlot, revision = 0, updatedAt: string | null = null): SlotSummary { return { slot, revision, updatedAt, occupied: false, health: 'empty', projectFingerprint: null, projectRevision: null, sessionId: null, locationName: null, worldSeconds: null }; }
export function slotLabel(slot: SaveSlot) { return slot === 'auto' ? 'Автосохранение' : 'Слот ' + slot.slice(-1); }

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, ordered(v)]));
  return value;
}
export function canonicalJson(value: unknown) { return JSON.stringify(ordered(value)); }
export async function checksum(value: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function projectFingerprint(project: Project) { return checksum(parseProject(project)); }
function checkedState(input: unknown, project: Project) {
  const state = parseGameState(input, project);
  if (Object.keys(state.flags).some(k => !Object.hasOwn(project.flags, k)) || Object.keys(project.flags).some(k => !Object.hasOwn(state.flags, k))) throw new Error('Флаги сохранения неполные или неизвестны');
  const location = project.locations.find(l => l.id === state.locationId)!;
  assertArrival(location, presentObjects(project.objects, state, location.id, project), state.player.position);
  state.clock.pausedBy = state.interaction ? ['interaction'] : [];
  return state;
}
export async function createSavedGame(project: Project, revision: number, input: unknown, fingerprint?: string) {
  const state = checkedState(input, project);
  if (state.projectRevision !== revision) throw new Error('Прохождение создано для другой версии проекта');
  const save = savedGameSchema.parse({ formatVersion: 1, projectFingerprint: fingerprint ?? await projectFingerprint(project), state });
  if (new TextEncoder().encode(canonicalJson(save)).length > MAX_SAVE_BYTES) throw new Error('Сохранение превышает 1 МБ. Рабочий слот не изменён.');
  return { save, checksum: await checksum(save) };
}
export async function restoreSavedGame(input: unknown, expectedChecksum: string, project: Project, revision: number, fingerprint?: string): Promise<GameState> {
  const save = savedGameSchema.parse(input);
  if (!digestSchema.safeParse(expectedChecksum).success || await checksum(save) !== expectedChecksum) throw new Error('Сохранение повреждено: контрольная сумма не совпадает');
  if (save.projectFingerprint !== (fingerprint ?? await projectFingerprint(project))) throw new Error('Авторский проект изменён. Это сохранение подходит к прежней редакции.');
  const state = checkedState(save.state, project);
  state.projectRevision = revision;
  return state;
}
export function summarizeSave(document: SaveDocument, project: Project): SlotSummary {
  const state = document.save.state;
  return { slot: document.slot, revision: document.revision, updatedAt: document.updatedAt, occupied: true, health: 'valid', projectFingerprint: document.save.projectFingerprint, projectRevision: state.projectRevision, sessionId: state.id, locationName: project.locations.find(l => l.id === state.locationId)?.name ?? 'Локация прежней редакции', worldSeconds: state.clock.worldSeconds };
}
