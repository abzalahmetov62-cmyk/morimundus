'use client';
import { useEffect, useState } from 'react';
import type { ReadingPreferences } from '@/lib/player/reading-preferences';
import { defaultReadingPreferences, parseReadingPreferences, readingPreferencesKey } from '@/lib/player/reading-preferences';

export function useReadingPreferences() {
  const [preferences, setPreferences] = useState(() => ({ ...defaultReadingPreferences })), [loaded, setLoaded] = useState(false);
  useEffect(() => { try { const stored = localStorage.getItem(readingPreferencesKey); if (stored) setPreferences(parseReadingPreferences(JSON.parse(stored))); } catch {} setLoaded(true); }, []);
  useEffect(() => { if (loaded) { try { localStorage.setItem(readingPreferencesKey, JSON.stringify(preferences)); } catch {} } }, [preferences, loaded]);
  return [preferences, setPreferences] as const;
}
export function ReadingOptions({ preferences, enabled, speed, onChange }: { preferences: ReadingPreferences; enabled: boolean; speed: number; onChange: (preferences: ReadingPreferences) => void }) {
  return <details className="reading-options"><summary>Настройки чтения</summary><div className="reading-options-fields"><label><input type="checkbox" checked={enabled} onChange={e => onChange({ ...preferences, typingEnabled: e.target.checked })} />Печатная машинка</label><label>Скорость печати: {speed}<input type="range" min={1} max={120} value={speed} onChange={e => onChange({ ...preferences, speed: Number(e.target.value) })} /></label><label><input type="checkbox" checked={!preferences.typingMuted} onChange={e => onChange({ ...preferences, typingMuted: !e.target.checked })} />Звук печати</label><label>Размер текста: {Math.round(preferences.textScale * 100)}%<input type="range" min={.85} max={1.4} step={.05} value={preferences.textScale} onChange={e => onChange({ ...preferences, textScale: Number(e.target.value) })} /></label></div></details>;
}
