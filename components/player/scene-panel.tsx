'use client';
import { AssetImage } from './asset-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Paragraph } from '@/lib/engine/project';
import type { TestSession, GameState } from '@/lib/engine/session';
import { currentNode } from '@/lib/engine/scenarios';
import { defaultTypewriter } from '@/lib/engine/presentation';
import { paragraphLength, TranscriptProgress } from '@/lib/player/typewriter';
import { defaultReadingPreferences, type ReadingPreferences } from '@/lib/player/reading-preferences';
import { RichParagraph } from './rich-paragraph';
import { TypingParagraph } from './typing-paragraph';
import { ReadingOptions } from './reading-options';
import { CheckResult } from './check-result';
import { checkValues } from '@/lib/engine/rpg';
import { formatWorldTime } from '@/lib/engine/time';

type Props = { mobile?: boolean; session: TestSession; state: GameState; onChange: () => void; onPause: () => void; progress?: TranscriptProgress; preferences?: ReadingPreferences; onPreferences?: (preferences: ReadingPreferences) => void; onTypingPrepare?: (paragraph: Paragraph | null) => void; onTypingPulse?: (text: string, paragraph: Paragraph) => void; onTypingStop?: () => void };
export function ScenePanel({ session, state, onChange, onPause, progress: suppliedProgress, preferences = defaultReadingPreferences, onPreferences, onTypingPrepare, onTypingPulse, onTypingStop, mobile = false }: Props) {
  const fallback = useMemo(() => new TranscriptProgress(state.interaction?.transcript.length ?? 0), [session]);
  const progress = suppliedProgress ?? fallback;
  const transcript = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null), following = useRef(true);
  const [error, setError] = useState(''), [, setRevealed] = useState(0);
  const interaction = state.interaction, node = currentNode(session.project, state);
  const script = session.project.scripts.find(s => s.id === interaction?.scriptId);
  const source = session.project.objects.find(o => o.id === interaction?.objectId);
  const showsTime = source?.interaction.showsTime || session.project.items.find(i => i.id === source?.interaction.itemDefinitionId)?.showsTime;
  const choices = session.choices(), more = !!interaction && !!node && interaction.paragraph < node.paragraphs.length;
  const options = session.project.settings.typewriter ?? defaultTypewriter;
  const enabled = preferences.typingEnabled ?? options.enabled, speed = preferences.speed ?? options.charactersPerSecond;
  const index = (interaction?.transcript.length ?? 0) - 1, entry = interaction?.transcript[index];
  const activeParagraph = entry?.type === 'paragraph' ? session.project.scripts.find(s => s.id === entry.scriptId)?.nodes.find(n => n.id === entry.nodeId)?.paragraphs[entry.index] : null;
  useEffect(() => { onTypingPrepare?.(activeParagraph ?? null); }, [activeParagraph, onTypingPrepare]);
  const length = useMemo(() => activeParagraph ? paragraphLength(activeParagraph) : 0, [activeParagraph]);
  const typing = enabled && !!activeParagraph && !progress.complete(index, length);
  const follow = useCallback(() => { if (following.current) bottom.current?.scrollIntoView({ block: 'nearest' }); }, []);
  const complete = useCallback(() => { setRevealed(n => n + 1); follow(); }, [follow]);
  const skip = useCallback(() => { progress.reveal(index, length, length); onTypingStop?.(); complete(); }, [progress, index, length, onTypingStop, complete]);
  useEffect(() => { if (following.current) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [interaction?.transcript.length, interaction?.nodeId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onPause(); }
      if (event.repeat || event.code !== 'Space' || (event.target as HTMLElement | null)?.closest?.('button, input, textarea, select, summary, [contenteditable="true"]')) return;
      if (typing) { event.preventDefault(); skip(); }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [onPause, typing, skip]);
  function action(run: () => void) {
    if (enabled && activeParagraph && !progress.complete(index, length)) { skip(); return; }
    try { run(); setError(''); onChange(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Действие не удалось'); }
  }
  if (!interaction || !node || !script) return null;
  return <div className="player-scene-overlay"><section className="player-scene-panel" aria-label="Текстовое взаимодействие" style={{ '--reading-scale': preferences.textScale } as React.CSSProperties}>
    <header className="scene-panel-heading"><h2>{script.name}</h2><div className="scene-heading-tools">{onPreferences && <ReadingOptions preferences={preferences} enabled={enabled} speed={speed} onChange={onPreferences} />}<Button size="sm" variant="ghost" onClick={onPause} aria-label={mobile ? "Открыть меню" : "Пауза разговора"}>{mobile ? <AssetImage className="scene-back-icon" src="/mobile-ui/back.webp" alt="" /> : <Pause />}</Button></div></header>
    <div ref={transcript} className="scene-transcript" onScroll={() => { const el = transcript.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} onClick={() => { if (typing && !window.getSelection()?.toString()) skip(); }}>
      {showsTime && <p className="clock-reading" role="status">{formatWorldTime(state.clock.worldSeconds)}</p>}
      {interaction.transcript.length ? interaction.transcript.map((part, position) => {
        if (part.type === 'check') return <CheckResult key={position} name={session.project.checks.find(c => c.id === part.checkId)?.name ?? 'Проверка'} result={part.result} />;
        if (part.type === 'choice') return <p className="scene-answer-history" key={position}>{part.label}</p>;
        const paragraph = session.project.scripts.find(s => s.id === part.scriptId)?.nodes.find(n => n.id === part.nodeId)?.paragraphs[part.index];
        if (!paragraph) return null;
        return position === index ? <TypingParagraph key={position} paragraph={paragraph} index={position} progress={progress} enabled={enabled} speed={speed} onPulse={onTypingPulse} onStop={onTypingStop} onComplete={complete} onGrow={follow} /> : <RichParagraph key={position} paragraph={paragraph} />;
      }) : interaction.history.map((text, position) => <p className="rich-paragraph" key={position}>{text}</p>)}
      <div ref={bottom} />
    </div>
    {error && <p className="scene-action-error" role="alert">{error}</p>}
    <div className="scene-player-actions">
      {typing && <Button variant="ghost" onClick={skip}>Показать текст целиком <kbd>Пробел</kbd></Button>}
      {more ? <Button disabled={typing} onClick={() => action(() => session.nextParagraph())}>Дальше</Button> : choices.length ? choices.map(({ choice, allowed, reason }) => <div className="scene-response" key={choice.id}><Button variant="outline" disabled={typing || !allowed} onClick={() => action(() => session.choose(choice.id))}>{choice.label}</Button>{choice.checkId && <p>{session.project.checks.find(c => c.id === choice.checkId)?.name} · сложность {session.project.checks.find(c => c.id === choice.checkId)?.difficulty} · навык {checkValues(session.project, state, session.project.checks.find(c => c.id === choice.checkId)!).skillValue}</p>}{!allowed && <p>{reason}</p>}</div>) : <Button disabled={typing} onClick={() => action(() => session.finishInteraction())}>Завершить разговор</Button>}
      {session.retryChecks().filter(({ check }) => state.checks[check.id].resumeScriptId === interaction.scriptId && state.checks[check.id].resumeNodeId !== interaction.nodeId).map(({ check, allowed, reason }) => <div className="scene-response" key={'retry-' + check.id}><Button variant="outline" disabled={typing || !allowed} onClick={() => action(() => session.retryCheck(check.id))}>Повторить: {check.name}</Button>{!allowed && <p>{reason}</p>}</div>)}
    </div>
  </section></div>;
}
