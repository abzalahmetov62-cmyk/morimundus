'use client';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Paragraph } from '@/lib/engine/project';
import { revealParagraph, graphemes, TranscriptProgress, TypingClock } from '@/lib/player/typewriter';
import { RichParagraph } from './rich-paragraph';

export function TypingParagraph({ paragraph, index, progress, enabled, speed, onPulse, onStop, onComplete, onGrow }: { paragraph: Paragraph; index: number; progress: TranscriptProgress; enabled: boolean; speed: number; onPulse?: (text: string, paragraph: Paragraph) => void; onStop?: () => void; onComplete: () => void; onGrow?: () => void }) {
  useSyncExternalStore(progress.subscribe, progress.snapshot, progress.snapshot);
  const container = useRef<HTMLDivElement>(null);
  const prepared = useMemo(() => paragraph.spans.map(span => graphemes(span.text)), [paragraph]);
  const chars = useMemo(() => prepared.flat(), [prepared]), length = chars.length;
  useEffect(() => { if (!container.current || !onGrow || typeof ResizeObserver === 'undefined') return; const observer = new ResizeObserver(onGrow); observer.observe(container.current); return () => observer.disconnect(); }, [onGrow]);
  const visible = enabled ? progress.visible(index, length) : length, conversation = progress.conversation;
  useEffect(() => {
    if (!enabled) { progress.reveal(index, length, length); onStop?.(); onComplete(); return; }
    if (progress.complete(index, length)) return;
    const clock = new TypingClock(length, progress.visible(index, length));
    let frame = 0, previous = performance.now(), lastCount = progress.visible(index, length), stopped = false;
    const visibility = () => { previous = performance.now(); if (document.hidden) onStop?.(); };
    const tick = (now: number) => {
      if (stopped) return;
      if (progress.complete(index, length)) { onStop?.(); onComplete(); return; }
      const seconds = Math.min(.25, Math.max(0, (now - previous) / 1000)); previous = now;
      if (!document.hidden) {
        const next = clock.advance(seconds, speed);
        if (next !== lastCount) {
          onPulse?.(chars.slice(lastCount, next).join(''), paragraph);
          lastCount = next; progress.reveal(index, next, length);
        }
      }
      if (progress.complete(index, length)) { onStop?.(); onComplete(); }
      else frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility); frame = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); onStop?.(); };
  }, [paragraph, index, progress, conversation, enabled, speed, length, chars, onPulse, onStop, onComplete]);
  const revealed = useMemo(() => revealParagraph(paragraph, visible, prepared), [paragraph, visible, prepared]);
  return <div ref={container} className={'typing-paragraph' + (visible < length ? ' is-typing' : '')} aria-live="polite" aria-busy={visible < length}><div aria-hidden={visible < length || undefined}><RichParagraph paragraph={revealed} /></div>{visible < length && <span className="sr-only">Печатается новая реплика. Можно показать текст целиком.</span>}</div>;
}
