import { z } from 'zod';
import { parseProject, type Project } from './project';

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const publicationInfoSchema = z.object({ revision: revision.positive(), authorRevision: revision.positive(), publishedAt: z.string().datetime(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().max(160) }).strict();
export type PublicationInfo = z.infer<typeof publicationInfoSchema>;
export type PublishedGame = PublicationInfo & { project: Project };
export const publicationWriteSchema = z.object({ expectedAuthorRevision: revision.positive(), expectedPublicationRevision: revision }).strict();
export function parsePublishedGame(value: unknown): PublishedGame {
  const raw = z.object({ project: z.unknown(), ...publicationInfoSchema.shape }).strict().parse(value);
  return { ...publicationInfoSchema.parse(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'project'))), project: parseProject(raw.project) };
}
