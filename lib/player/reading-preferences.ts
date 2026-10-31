import { z } from 'zod';

export const readingPreferencesSchema = z.object({ muted: z.boolean(), typingMuted: z.boolean(), typingEnabled: z.boolean().nullable(), speed: z.number().min(1).max(120).nullable(), textScale: z.number().min(.85).max(1.4) }).strict();
export type ReadingPreferences = z.infer<typeof readingPreferencesSchema>;
export const defaultReadingPreferences: ReadingPreferences = { muted: false, typingMuted: false, typingEnabled: null, speed: null, textScale: 1 };
export const readingPreferencesKey = 'morimundus-reading-v1';
export function parseReadingPreferences(input: unknown) { const result = readingPreferencesSchema.safeParse(input); return result.success ? result.data : { ...defaultReadingPreferences }; }
