import type { Paragraph } from '../engine/project';

const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
export function graphemes(text: string) { return Array.from(segmenter.segment(text), part => part.segment); }
export function paragraphLength(paragraph: Paragraph) { return paragraph.spans.reduce((sum, span) => sum + graphemes(span.text).length, 0); }
export function revealParagraph(paragraph: Paragraph, visible: number, prepared?: string[][]): Paragraph {
  let remaining = Math.max(0, Math.floor(visible));
  return { ...paragraph, spans: paragraph.spans.flatMap((span, index) => {
    const chars = prepared?.[index] ?? graphemes(span.text), text = chars.slice(0, remaining).join(''); remaining = Math.max(0, remaining - chars.length);
    return text ? [{ ...span, text }] : [];
  }) };
}
export class TranscriptProgress {
  private counts = new Map<number, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  conversation = 0;
  constructor(private completedThrough = 0) {}
  reset() { this.completedThrough = 0; this.counts.clear(); this.conversation++; this.version++; for (const listener of this.listeners) listener(); }
  visible(index: number, total: number) { return index < this.completedThrough ? total : Math.min(total, this.counts.get(index) ?? 0); }
  complete(index: number, total: number) { return this.visible(index, total) >= total; }
  reveal(index: number, count: number, total: number) {
    const next = Math.max(this.visible(index, total), Math.min(total, Math.max(0, Math.floor(count))));
    if (next === this.visible(index, total)) return;
    this.counts.set(index, next); this.version++; for (const listener of this.listeners) listener();
  }
  snapshot = () => this.version;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
}
export class TypingClock {
  private position: number;
  constructor(private length: number, visible = 0) { this.position = visible; }
  advance(seconds: number, speed: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('Неверная скорость печати');
    this.position = Math.min(this.length, this.position + seconds * speed);
    return Math.floor(this.position);
  }
}
