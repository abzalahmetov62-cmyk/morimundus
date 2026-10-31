'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseProject, type Project } from '@/lib/engine/project';
import type { GameState } from '@/lib/engine/game-state';
import type { SaveSlot } from '@/lib/engine/save-game';
import { PlayerSaves } from '@/lib/player/saves';
import { SavePanel, useSaveStatus } from './save-panel';
import type { SaveTransportFactory } from '@/lib/storage/saves-client';
import dynamic from 'next/dynamic';
const FirstPerson = dynamic(() => import('./first-person'), { ssr: false, loading: () => <div className="player-opening"><LoaderCircle className="animate-spin" />Открываю мир…</div> });

export default function PlayerLauncher({ project, revision, startLocationId, startScriptId, authorSnapshot, authorMode = false, savesDisabledReason = '', transport, gameMode = false, storageLabel = '', exitLabel = 'В мастерскую', onClose }: { project: Project; revision: number; startLocationId?: string; startScriptId?: string; authorSnapshot?: GameState; authorMode?: boolean; savesDisabledReason?: string; transport?: SaveTransportFactory; gameMode?: boolean; storageLabel?: string; exitLabel?: string; onClose: () => void }) {
  const [source] = useState(() => ({ project: parseProject(structuredClone(project)), revision, startLocationId, startScriptId, authorSnapshot: authorSnapshot ? structuredClone(authorSnapshot) : undefined, authorMode, transport, gameMode, storageLabel, exitLabel, savesDisabledReason: authorMode ? 'Авторская проверка: временные изменения и прогресс не записываются в слоты.' : savesDisabledReason }));
  const [saves, setSaves] = useState<PlayerSaves | null>(null), [launch, setLaunch] = useState<{ snapshot?: GameState } | null>(source.savesDisabledReason ? { snapshot: source.authorSnapshot } : null);
  const [allSlots, setAllSlots] = useState(false), [confirmNew, setConfirmNew] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const status = useSaveStatus(saves);
  useEffect(() => { if (source.savesDisabledReason) return; const manager = new PlayerSaves(source.project, source.revision, source.transport); setSaves(manager); void manager.initialize().catch(() => {}); return () => manager.dispose(); }, [source]);
  async function load(slot: SaveSlot) { if (!saves) return; setLoading(true); setError(''); try { const snapshot = await saves.load(slot); setLaunch({ snapshot }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось продолжить'); throw cause; } finally { setLoading(false); } }
  const latest = saves ? status.slots.filter(s => saves.compatible(s)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] : undefined;
  if (launch) return <FirstPerson project={source.project} revision={source.revision} startLocationId={source.startLocationId} startScriptId={source.startScriptId} initialSnapshot={launch.snapshot} authorMode={source.authorMode} gameMode={source.gameMode} storageLabel={source.storageLabel} exitLabel={source.exitLabel} saves={saves} savesDisabledReason={source.savesDisabledReason} onClose={onClose} />;
  if (allSlots && saves) return <div className="first-person-player"><SavePanel saves={saves} onLoad={load} onClose={() => setAllSlots(false)} /></div>;
  return <div className="first-person-player"><div className="player-overlay"><section className="player-menu"><h1>Продолжить прохождение</h1>{error || status.error ? <p role="alert">{error || status.error}</p> : null}{status.busy || !saves ? <p className="player-loading"><LoaderCircle className="animate-spin" />Открываю сохранения…</p> : <p>{latest ? `${latest.locationName}. Можно продолжить с последней сохранённой точки.` : status.ready ? 'Подходящего сохранения пока нет. Начни новое прохождение или выбери другой слот.' : 'Хранилище недоступно. Можно проверить игру, а запись повторить позже в меню сохранений.'}</p>}
    {source.storageLabel && <p className="field-help">{source.storageLabel}</p>}<div className="player-menu-actions">{latest && <Button disabled={status.busy || loading} onClick={() => void load(latest.slot).catch(() => {})}>Продолжить</Button>}<Button variant="outline" disabled={!saves || status.busy || loading} onClick={() => { if (status.slots.find(s => s.slot === 'auto')?.occupied) setConfirmNew(true); else { saves?.enableAuto(); setLaunch({}); } }}>Начать заново</Button>{saves && <Button variant="outline" disabled={status.busy || loading} onClick={() => setAllSlots(true)}>Все сохранения</Button>}{saves && !status.ready && <Button variant="outline" disabled={status.busy || loading} onClick={() => void saves.initialize().catch(() => {})}>Повторить</Button>}<Button variant="ghost" disabled={loading} onClick={onClose}>{source.exitLabel}</Button></div>
    {confirmNew && <div className="player-save-confirmation"><p>Новое прохождение заменит автослот. Ручные слоты останутся.</p><Button disabled={status.busy || loading} onClick={() => { saves?.enableAuto(); setLaunch({}); }}>Начать новое прохождение</Button><Button variant="ghost" onClick={() => setConfirmNew(false)}>Отмена</Button></div>}
  </section></div></div>;
}
