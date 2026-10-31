'use client';
import type { EffectPose, ObjectEffect } from '@/lib/engine/object-effects';
import { AssetImage } from './asset-image';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FlaskConical, LoaderCircle, MousePointer2, RotateCcw, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TestSession } from '@/lib/engine/session';
import type { Project, WorldObject } from '@/lib/engine/project';
import { FirstPersonWorld } from '@/lib/player/world';
import type { ControlMode } from '@/lib/player/input';
import { contextAction, type Target } from '@/lib/player/picking';
import { assetUrl } from '@/lib/storage/client';
import { itemPresentation } from '@/lib/engine/inventory';
import { StatePanel } from './state-panel';
import { InventoryPanel } from './inventory-panel';
import { ContainerPanel } from './container-panel';
import { RpgPanel } from './rpg-panel';
import { ScenePanel } from './scene-panel';
import { MobileBack, MobileControls, useTouchControls } from './mobile-controls';
import { hasGameAudio } from '@/lib/engine/voices';
import type { Paragraph } from '@/lib/engine/project';
import { GameAudio } from '@/lib/player/audio';
import { TranscriptProgress } from '@/lib/player/typewriter';
import { defaultTypewriter } from '@/lib/engine/presentation';
import { useReadingPreferences, ReadingOptions } from './reading-options';
import { formatWorldTime } from '@/lib/engine/time';
import type { GameState } from '@/lib/engine/game-state';
import type { SaveSlot } from '@/lib/engine/save-game';
import { PlayerSaves } from '@/lib/player/saves';
import { SavePanel, useSaveStatus } from './save-panel';

type Mode = 'loading' | 'ready' | 'playing' | 'paused' | 'inspect' | 'state' | 'scene' | 'inventory' | 'container' | 'rpg' | 'saves' | 'error';

export default function FirstPerson({ project, revision, startLocationId, startScriptId, initialSnapshot, authorMode = false, gameMode = false, storageLabel = '', exitLabel = 'В мастерскую', saves = null, savesDisabledReason = '', onClose }: { project: Project; revision: number; startLocationId?: string; startScriptId?: string; initialSnapshot?: GameState; authorMode?: boolean; gameMode?: boolean; storageLabel?: string; exitLabel?: string; saves?: PlayerSaves | null; savesDisabledReason?: string; onClose: () => void }) {
  const touch = useTouchControls(), touchRef = useRef(touch), inventoryReturn = useRef<'playing' | 'paused'>('playing'); touchRef.current = touch;
  const [session, setSession] = useState(() => initialSnapshot ? TestSession.restore(project, revision, initialSnapshot) : new TestSession(project, revision, startLocationId, { startScriptId }));
  const [state, setState] = useState(() => session.snapshot());
  const textProgress = useMemo(() => new TranscriptProgress(session.snapshot().interaction?.transcript.length ?? 0), [session]);
  const dialogueActive = useRef(session.hasInteraction());
  const [preferences, setPreferences] = useReadingPreferences();
  const [mode, setMode] = useState<Mode>('loading');
  const [controls, setControls] = useState<ControlMode>('locked');
  const [target, setTarget] = useState<Target | null>(null);
  const [inspection, setInspection] = useState<WorldObject | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [travelName, setTravelName] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false), [audioError, setAudioError] = useState('');
  const modeRef = useRef<Mode>('loading');
  const container = useRef<HTMLDivElement>(null);
  const world = useRef<FirstPersonWorld | null>(null);
  const audio = useRef<GameAudio | null>(null);
  const saveStatus = useSaveStatus(saves);
  const [leaving, setLeaving] = useState(false), [exitError, setExitError] = useState(''), [confirmRestart, setConfirmRestart] = useState(false);
  const messageTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = session.project.locations.find(l => l.id === state.locationId)!;
  const syncTranscript = () => { const active = session.hasInteraction(); if (active && !dialogueActive.current) textProgress.reset(); dialogueActive.current = active; };
  const typewriter = session.project.settings.typewriter ?? defaultTypewriter;
  const typingPrepare = useCallback((paragraph: Paragraph | null) => audio.current?.prepareVoice(paragraph?.voiceId ?? null), []);
  const typingPulse = useCallback((text: string, paragraph: Paragraph) => { if (preferences.typingMuted) return; if (paragraph.voiceId) audio.current?.voicePulse(text, paragraph.audioVolume); else if (/\S/u.test(text)) audio.current?.typingClick(typewriter.soundAssetId, typewriter.volume); }, [preferences.typingMuted, typewriter.soundAssetId, typewriter.volume]);
  const typingStop = useCallback(() => audio.current?.stopTyping(), []);
  const toggleAudio = () => { const muted = !preferences.muted; setPreferences({ ...preferences, muted }); audio.current?.setMuted(muted); if (!muted) void audio.current?.unlock(); };
  const changeMode = (next: Mode) => { modeRef.current = next; setMode(next); };
  const savedSnapshot = () => { audio.current?.capturePositions(); return session.snapshot(); };
  const checkpoint = (immediate = false) => { if (saves && !world.current?.isTravelling() && !['loading', 'error'].includes(modeRef.current)) saves.requestAuto(savedSnapshot(), session.worldRevision(), immediate); };

  useEffect(() => {
    if (!container.current) return;
    const lifetime = new AbortController();
    saves?.activate(session.snapshot().id, initialSnapshot?.id === session.snapshot().id ? session.worldRevision() : -1);
    setAudioEnabled(false); setAudioError(''); dialogueActive.current = session.hasInteraction();
    let focusLost = false;
    const sound = new GameAudio(session.project, session.audioSnapshot(), (channel, key, offset) => session.setAudioPosition(channel, key, offset), { onStatus: enabled => { if (!lifetime.signal.aborted) { setAudioEnabled(enabled); } }, onError: value => { if (!lifetime.signal.aborted) setAudioError(value); } });
    audio.current = sound; sound.setMuted(preferences.muted);
    const unlock = () => { void sound.unlock(); };
    document.addEventListener('pointerdown', unlock, { signal: lifetime.signal, once: true, capture: true });
    document.addEventListener('keydown', unlock, { signal: lifetime.signal, once: true, capture: true });
    const syncAudio = () => sound.sync(session.audioSnapshot(), { reading: modeRef.current === 'scene', hidden: document.hidden || focusLost, effectsPaused: ['ready', 'loading', 'paused', 'inventory', 'state', 'rpg', 'saves', 'error'].includes(modeRef.current) });
    const audioInterval = setInterval(syncAudio, 100);
    document.addEventListener('visibilitychange', () => { syncAudio(); if (document.hidden) checkpoint(true); }, { signal: lifetime.signal });
    window.addEventListener('blur', () => { focusLost = true; syncAudio(); checkpoint(true); }, { signal: lifetime.signal });
    window.addEventListener('focus', () => { focusLost = false; syncAudio(); }, { signal: lifetime.signal });
    const saveInterval = setInterval(() => { if (!document.hidden && !focusLost && ['playing', 'scene'].includes(modeRef.current)) checkpoint(); }, 30000);
    window.addEventListener('beforeunload', event => { if (saves?.hasUnsaved(session.snapshot().id, session.worldRevision())) { event.preventDefault(); event.returnValue = ''; } }, { signal: lifetime.signal });
    modeRef.current = 'loading'; setMode('loading'); setTarget(null); setWarnings([]); setError(''); setTravelName('');
    const callbacks = {
      onSpatial: (effects: ObjectEffect[], pose: EffectPose) => { if (!lifetime.signal.aborted) sound.syncSpatial(effects, pose); },
      onScene: () => { if (!lifetime.signal.aborted) { syncTranscript(); setState(session.snapshot()); modeRef.current = 'scene'; setMode('scene'); syncAudio(); checkpoint(); } },
      onContainer: (object: WorldObject) => { if (!lifetime.signal.aborted) { setInspection(object); syncTranscript(); setState(session.snapshot()); modeRef.current = 'container'; setMode('container'); } },
      onInventory: () => { if (!lifetime.signal.aborted) { inventoryReturn.current = 'playing'; syncTranscript(); setState(session.snapshot()); modeRef.current = 'inventory'; setMode('inventory'); } },
      onActive: (control: ControlMode) => { if (!lifetime.signal.aborted) { setControls(control); modeRef.current = 'playing'; setMode('playing'); } },
      onPause: () => { if (!lifetime.signal.aborted && modeRef.current === 'playing') { modeRef.current = 'paused'; setMode('paused'); setTarget(null); checkpoint(true); } },
      onInspect: (object: WorldObject) => { if (!lifetime.signal.aborted) { setInspection(object); const next = session.hasInteraction() ? 'scene' : 'inspect'; modeRef.current = next; setMode(next); syncTranscript(); setState(session.snapshot()); } },
      onTarget: (value: Target | null) => { if (!lifetime.signal.aborted) setTarget(value); },
      onChange: (save = false) => { if (!lifetime.signal.aborted) { syncTranscript(); setState(session.snapshot()); if (save) checkpoint(); } },
      onMessage: (value: string) => { if (lifetime.signal.aborted) return; if (messageTimeout.current) clearTimeout(messageTimeout.current); setMessage(value); messageTimeout.current = setTimeout(() => setMessage(''), 3000); },
      onError: (value: string) => { if (!lifetime.signal.aborted) { setError(value); modeRef.current = 'error'; setMode('error'); } },
      onResources: (nextWarnings: string[]) => { if (!lifetime.signal.aborted) setWarnings(nextWarnings); },
      onTravel: (loading: boolean, name: string, nextWarnings: string[]) => { if (!lifetime.signal.aborted) { setTravelName(loading ? name : ''); syncTranscript(); setState(session.snapshot()); setWarnings(nextWarnings); const next = loading ? 'loading' : session.hasInteraction() ? 'scene' : 'ready'; modeRef.current = next; setMode(next); if (!loading) checkpoint(); } },
    };
    void FirstPersonWorld.create(container.current, session, callbacks, lifetime.signal).then(created => {
      if (lifetime.signal.aborted) { created.dispose(); return; }
      world.current = created; created.setTouchMode(touchRef.current); setWarnings([...created.warnings]); syncTranscript(); setState(session.snapshot()); const next: Mode = 'ready'; modeRef.current = next; setMode(next); if (!initialSnapshot || session.snapshot().id !== initialSnapshot.id) checkpoint();
    }).catch(cause => {
      if (lifetime.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть объёмную комнату'); modeRef.current = 'error'; setMode('error');
    });
    return () => { lifetime.abort(); clearInterval(audioInterval); clearInterval(saveInterval); sound.dispose(); saves?.suspend(); audio.current = null; world.current = null; if (messageTimeout.current) clearTimeout(messageTimeout.current); };
  }, [session, saves]);

  const resume = () => { void audio.current?.unlock(); setInspection(null); syncTranscript(); setState(session.snapshot()); if (session.hasInteraction()) changeMode('scene'); else { changeMode('paused'); world.current?.resume(); } };
  const pauseScene = () => { world.current?.pause(); syncTranscript(); setState(session.snapshot()); changeMode('paused'); checkpoint(true); };
  const sceneChanged = () => { syncTranscript(); const next = session.snapshot(), checked = session.project.checks.find(c => (next.checks[c.id]?.attempts ?? 0) > (state.checks[c.id]?.attempts ?? 0)); if (checked) { const result = next.checks[checked.id].lastResult; if (result) { if (messageTimeout.current) clearTimeout(messageTimeout.current); setMessage(checked.name + ': ' + (result.succeeded ? 'успех' : 'провал') + ' · ' + Number(result.score.toFixed(4)) + ' / ' + result.difficulty); messageTimeout.current = setTimeout(() => setMessage(''), 5000); } } setState(next); world.current?.refresh(); if (world.current?.isTravelling()) return; if (session.hasInteraction()) changeMode('scene'); else resume(); checkpoint(); };
  const dialogueLocked = session.hasInteraction() && !authorMode && mode !== 'error';
  const close = async () => { if (session.hasInteraction() && !authorMode && modeRef.current !== 'error') return; world.current?.pause(); if (!saves) { onClose(); return; } changeMode('paused'); setLeaving(true); setExitError(''); try { await saves.flush(savedSnapshot(), session.worldRevision()); onClose(); } catch (cause) { setExitError(cause instanceof Error ? cause.message : 'Прохождение не сохранено'); } finally { setLeaving(false); } };
  const restart = async () => { if (session.hasInteraction() && !authorMode && modeRef.current !== 'error') return; world.current?.pause(); saves?.suspend(); await saves?.waitIdle(); try { const next = authorMode && initialSnapshot ? TestSession.restore(project, revision, initialSnapshot) : new TestSession(project, revision, startLocationId, { startScriptId }); saves?.enableAuto(); setSession(next); setState(next.snapshot()); setInspection(null); setMessage(''); setExitError(''); setConfirmRestart(false); } catch (cause) { saves?.activate(session.snapshot().id); setError(cause instanceof Error ? cause.message : 'Не удалось начать проверку'); changeMode('error'); } };
  const update = (action: () => void) => { try { action(); syncTranscript(); setState(session.snapshot()); world.current?.refresh(); checkpoint(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Не удалось изменить состояние'); } };
  const loadSave = async (slot: SaveSlot) => { if (!saves) return; world.current?.pause(); try { const snapshot = await saves.load(slot), next = TestSession.restore(project, revision, snapshot); setSession(next); setState(next.snapshot()); setInspection(null); setMessage(''); setExitError(''); changeMode('loading'); } catch (cause) { saves.activate(session.snapshot().id); throw cause; } };
  const openSaves = () => { world.current?.pause(); syncTranscript(); setState(session.snapshot()); changeMode('saves'); };
  const openInventory = () => { inventoryReturn.current = modeRef.current === 'playing' ? 'playing' : 'paused'; world.current?.pause(); syncTranscript(); setState(session.snapshot()); changeMode('inventory'); };
  const closeInventory = () => { if (inventoryReturn.current === 'paused') changeMode('paused'); else resume(); };
  const mobileBack = () => { if (mode === 'inventory') closeInventory(); else if (['scene', 'playing'].includes(mode)) pauseScene(); else if (['inspect', 'container', 'paused'].includes(mode)) resume(); else changeMode('paused'); };
  const moveStick = useCallback((x: number, y: number) => world.current?.setStick(x, y), []);
  const mobileAction = touch ? contextAction(session.project, state, target) : null;
  useEffect(() => { world.current?.setTouchMode(touch); }, [touch, session]);
  const firstVisibleSlot = Math.max(0, Math.min(state.player.inventory.length - 7, state.player.activeSlot - 3));
  useEffect(() => { audio.current?.setMuted(preferences.muted); }, [session, preferences.muted]);
  const itemName = (id: string) => itemPresentation(session.project, state, id)?.name ?? 'Предмет';

  return <div className={`first-person-player mode-${mode}${touch ? ' is-touch' : ''}`}>{touch && ["joystick-base", "joystick-thumb", "use", "take", "inventory", "back"].map(name => <link key={name} rel="preload" as="image" href={"/mobile-ui/" + name + ".webp"} />)}<div className="player-viewport" ref={container} />
    {mode !== 'loading' && mode !== 'error' && hasGameAudio(session.project) && <div className="player-audio-controls"><Button size="sm" variant="outline" aria-pressed={preferences.muted} onClick={toggleAudio}>{preferences.muted ? <VolumeX /> : <Volume2 />}{preferences.muted ? 'Включить звук' : 'Выключить звук'}</Button>{!audioEnabled && !audioError && !preferences.muted && <span className="audio-ready-note">Звук начнётся при входе в игру</span>}{audioError && <div><p role="status">{audioError}</p><Button size="sm" variant="ghost" onClick={() => { setAudioError(''); audio.current?.retry(); }}>Повторить звук</Button></div>}</div>}
    {mode === 'playing' && <><div className="player-reticle" aria-hidden="true" /><div className="player-action-keys" aria-live="polite">{target && <><kbd>E</kbd>{target.canTake && <kbd>F</kbd>}</>}</div>{controls === 'drag' && <div className="player-drag-note">Для обзора удерживай левую кнопку мыши · Esc — пауза</div>}<div className="player-inventory" aria-label="Инвентарь"><div className="player-slot-line">{state.player.inventory.slice(firstVisibleSlot, firstVisibleSlot + 7).map((id, offset) => { const index = firstVisibleSlot + offset; const definition = itemPresentation(session.project, state, id); return <div className={index === state.player.activeSlot ? 'player-slot is-active' : 'player-slot'} key={index} aria-label={id ? `${index + 1}: ${itemName(id)}` : `Ячейка ${index + 1}, пусто`}><span className="slot-index">{index + 1}</span>{definition?.imageAssetId ? <AssetImage key={id + '-' + definition.imageAssetId} src={assetUrl(definition.imageAssetId, 'game')} alt={definition.name} /> : id ? <span>{itemName(id)}</span> : null}</div>; })}</div><p className="player-inventory-help">{state.player.inventory[state.player.activeSlot] ? itemName(state.player.inventory[state.player.activeSlot]!) : 'Пустая ячейка'} · 1–9 / колесо · E — применить · R — открыть · Tab — вещи · Q — выбросить</p></div></>}
    {touch && mode === 'playing' && <MobileControls action={mobileAction ? mobileAction === 'take' ? 'take' : 'use' : null} targetName={session.worldObject(target?.objectId ?? '')?.name ?? ''} heldName={state.player.inventory[state.player.activeSlot] ? itemName(state.player.inventory[state.player.activeSlot]!) : ''} onMove={moveStick} onAction={() => world.current?.performContextAction()} onInventory={openInventory} />}
    {touch && ['playing', 'paused', 'inspect', 'container', 'rpg', 'saves', 'state'].includes(mode) && <MobileBack disabled={leaving} onBack={mobileBack} label={mode === 'playing' ? 'Открыть меню' : 'Назад'} />}
    {touch && mode === 'playing' && <div className="mobile-orientation-note">Для широкого обзора поверни телефон горизонтально</div>}
    {message && <div className="player-message" role="status">{message}</div>}
    {(mode === 'loading' || mode === 'ready' || mode === 'paused' || mode === 'error') && <div className="player-overlay"><section className="player-menu"><div className="section-eyebrow player-menu-heading">{touch ? <AssetImage className="mobile-menu-sign" src="/mobile-ui/menu.webp" alt="Меню" /> : <><FlaskConical size={16} /> ПРОВЕРКА ЛОКАЦИИ</>}</div><h1>{mode === 'error' ? 'Не удалось запустить комнату' : travelName || location.name}</h1>{mode === 'loading' ? <p className="player-loading"><LoaderCircle className="animate-spin" />{travelName ? 'Переходим в локацию…' : 'Подготавливаю комнату и рисунки…'}</p> : mode === 'error' ? <p role="alert">{error}</p> : <><p>{mode === 'ready' ? 'Свободное исследование от первого лица. Изменения останутся только в этом прохождении.' : 'Игра на паузе. Можно продолжить или проверить состояние мира.'}</p><p className="mobile-control-help">Джойстик слева — движение. Проведи пальцем по комнате для обзора. Кнопка справа меняется между «Взять» и «Использовать». Стрелка открывает меню.</p><dl className="player-controls"><div><dt>W A S D</dt><dd>Движение</dd></div><div><dt>Мышь</dt><dd>Свободный обзор</dd></div><div><dt>E / щелчок</dt><dd>Применить выбранную вещь; с пустой ячейкой — взаимодействовать</dd></div><div><dt>R</dt><dd>Открыть контейнер, разговор или дверь без применения вещи</dd></div><div><dt>F</dt><dd>Взять предмет</dd></div><div><dt>1–9 / колесо</dt><dd>Выбрать предмет</dd></div><div><dt>Tab / I</dt><dd>Вещи / осмотр</dd></div><div><dt>Q</dt><dd>Выбросить выбранное</dd></div><div><dt>Esc</dt><dd>Освободить курсор и остановить мир</dd></div></dl></>}
      {warnings.length > 0 && <div className="player-warnings">{warnings.map((warning, i) => <p key={i}>{warning}. Показана заглушка.</p>)}</div>}
      {savesDisabledReason && <p className="field-help">{savesDisabledReason}</p>}{saves && mode !== 'loading' && <p className="field-help" role="status">{leaving ? 'Сохраняю перед выходом…' : saveStatus.busy ? 'Сохраняю прохождение…' : !saveStatus.ready ? 'Хранилище недоступно. Повтори открытие в меню сохранений.' : saveStatus.blocked ? 'Автосохранение остановлено. Открой сохранения, чтобы повторить запись.' : 'Автосохранение включено'}</p>}
      {exitError && !dialogueLocked && <div className="player-save-confirmation"><p role="alert">{exitError}</p><Button variant="outline" disabled={leaving} onClick={() => void close()}>Повторить выход с сохранением</Button><Button variant="ghost" disabled={leaving || saveStatus.busy} onClick={onClose}>Выйти без сохранения</Button></div>}
      {storageLabel && <p className="field-help">{storageLabel}</p>}{touch && audioError && <p className="field-help" role="status">{audioError}<Button size="sm" variant="ghost" onClick={() => { setAudioError(''); audio.current?.retry(); }}>Повторить звук</Button></p>}{touch && (mode === 'ready' || mode === 'paused') && <Button variant="outline" className="mobile-audio-toggle" onClick={toggleAudio}>{preferences.muted ? 'Включить звук' : 'Выключить звук'}</Button>}<ReadingOptions preferences={preferences} enabled={preferences.typingEnabled ?? typewriter.enabled} speed={preferences.speed ?? typewriter.charactersPerSecond} onChange={setPreferences} /><div className="player-menu-actions">{warnings.length > 0 && <Button variant="outline" disabled={leaving || mode === "loading"} onClick={() => void world.current?.retryResources()}>Повторить загрузку рисунков</Button>}{(mode === 'ready' || mode === 'paused') && <Button size="lg" disabled={leaving} onClick={resume}><MousePointer2 />{mode === 'ready' ? 'Играть' : session.hasInteraction() ? 'Продолжить разговор' : 'Продолжить'}</Button>}{(mode === 'ready' || mode === 'paused') && <Button variant="outline" disabled={leaving} onClick={openInventory}>Инвентарь и экипировка</Button>}{(mode === 'ready' || mode === 'paused') && <Button variant="outline" disabled={leaving} onClick={() => { syncTranscript(); setState(session.snapshot()); changeMode('rpg'); }}>Журнал и состояния</Button>}{!gameMode && mode === 'paused' && <Button variant="outline" disabled={leaving} onClick={() => { syncTranscript(); setState(session.snapshot()); changeMode('state'); }}><SlidersHorizontal />Состояние мира</Button>}{saves && mode !== 'loading' && <Button variant="outline" disabled={leaving} onClick={openSaves}>Сохранения</Button>}{mode !== 'loading' && !dialogueLocked && <Button variant="ghost" disabled={leaving || saveStatus.busy} onClick={() => saves ? setConfirmRestart(true) : void restart()}><RotateCcw />Начать заново</Button>}{!dialogueLocked && <Button variant="ghost" disabled={leaving || mode === 'loading'} onClick={() => void close()}><ArrowLeft />{exitLabel}</Button>}</div>
      {confirmRestart && !dialogueLocked && <div className="player-save-confirmation"><p>Начать заново? Текущее прохождение и автослот будут заменены; ручные слоты останутся.</p><Button disabled={leaving || saveStatus.busy} onClick={() => void restart()}>Начать новое прохождение</Button><Button variant="ghost" onClick={() => setConfirmRestart(false)}>Отмена</Button></div>}
    </section></div>}
    {mode === 'inspect' && inspection && <div className="player-inspection-overlay"><section className="player-inspection"><div className="section-eyebrow">ОСМОТР</div><h2>{inspection.name}</h2>{(inspection.interaction.showsTime || session.project.items.find(i => i.id === inspection.interaction.itemDefinitionId)?.showsTime) && <p className="clock-reading" role="status">{formatWorldTime(state.clock.worldSeconds)}</p>}<div className="inspection-text">{inspection.notes || session.project.items.find(i => i.id === inspection.interaction.itemDefinitionId)?.description || 'Для этого объекта ещё не задано описание.'}</div><Button onClick={resume}>Продолжить исследование</Button><Button variant="ghost" onClick={() => { session.resume('interaction'); setInspection(null); changeMode('paused'); }}>Пауза</Button></section></div>}
    {mode === 'rpg' && <RpgPanel session={session} state={state} onClose={resume} onPause={() => changeMode('paused')} onRetry={id => { session.retryCheck(id); syncTranscript(); setState(session.snapshot()); world.current?.refresh(); changeMode('scene'); checkpoint(); }} />}
    {mode === 'container' && inspection && <ContainerPanel session={session} state={state} objectId={inspection.id} onChange={() => { syncTranscript(); setState(session.snapshot()); world.current?.refresh(); checkpoint(); }} onClose={resume} onPause={() => changeMode('paused')} />}
    {mode === 'inventory' && <InventoryPanel mobile={touch} session={session} state={state} onChange={() => { syncTranscript(); setState(session.snapshot()); world.current?.refresh(); checkpoint(); }} onClose={closeInventory} onPause={() => changeMode('paused')} />}
    {mode === 'saves' && saves && <SavePanel saves={saves} allowSave onSave={slot => saves.save(slot, savedSnapshot(), session.worldRevision())} onLoad={loadSave} onRetry={() => saves.retryAuto(savedSnapshot(), session.worldRevision())} onClose={() => changeMode('paused')} />}
    {mode === 'playing' && saveStatus.error && <div className="player-save-notice"><p role="status">Автосохранение не выполнено. Прохождение остаётся в открытом окне.</p><Button size="sm" variant="outline" onClick={openSaves}>Открыть сохранения</Button></div>}
    {mode === 'scene' && <ScenePanel mobile={touch} session={session} state={state} onChange={sceneChanged} onPause={pauseScene} progress={textProgress} preferences={preferences} onPreferences={setPreferences} onTypingPrepare={typingPrepare} onTypingPulse={typingPulse} onTypingStop={typingStop} />}
    {mode === 'state' && <div className="player-overlay"><section className="player-state-panel"><div className="section-title"><div><span className="section-eyebrow">{authorMode ? 'АВТОРСКАЯ ПРОВЕРКА' : 'ОТДЕЛЬНОЕ ПРОХОЖДЕНИЕ'}</span><h2>Состояние мира</h2></div><Button variant="outline" onClick={() => changeMode('paused')}>Назад</Button></div><StatePanel session={session} state={state} authorMode={authorMode} update={update} /></section></div>}
  </div>;
}
