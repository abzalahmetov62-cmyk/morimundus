import type { Paragraph, TextMark } from '../engine/project';

type Span = Paragraph['spans'][number];
export const textOf = (spans: readonly Span[]) => spans.map(s => s.text).join('');
const order: TextMark[] = ['bold', 'italic', 'underline', 'strike'];
const same = (a: TextMark[], b: TextMark[]) => a.length === b.length && a.every((v, i) => v === b[i]);
export function normalizeSpans(spans: readonly Span[]): Span[] {
  const result: Span[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const marks = order.filter(m => span.marks.includes(m)), last = result.at(-1);
    if (last && same(last.marks, marks)) last.text += span.text;
    else result.push({ text: span.text, marks });
  }
  return result.length ? result : [{ text: '', marks: [] }];
}
function sliceSpans(spans: readonly Span[], start: number, end: number) {
  let offset = 0;
  const result: Span[] = [];
  for (const span of spans) {
    const from = Math.max(0, start - offset), to = Math.min(span.text.length, end - offset);
    if (to > from) result.push({ text: span.text.slice(from, to), marks: [...span.marks] });
    offset += span.text.length;
  }
  return result;
}
export function marksAt(spans: readonly Span[], position: number): TextMark[] {
  let offset = 0;
  for (const span of spans) { offset += span.text.length; if (position < offset) return [...span.marks]; }
  return [];
}
export function markedRange(spans: readonly Span[], start: number, end: number, mark: TextMark) {
  const selected = sliceSpans(spans, start, end);
  return selected.length > 0 && selected.every(s => s.marks.includes(mark));
}
export function toggleMark(spans: readonly Span[], start: number, end: number, mark: TextMark): Span[] {
  const length = textOf(spans).length;
  start = Math.max(0, Math.min(length, start)); end = Math.max(start, Math.min(length, end));
  if (start === end) return normalizeSpans(spans);
  const remove = markedRange(spans, start, end, mark);
  return normalizeSpans([...sliceSpans(spans, 0, start), ...sliceSpans(spans, start, end).map(s => ({ ...s, marks: remove ? s.marks.filter(m => m !== mark) : [...s.marks, mark] })), ...sliceSpans(spans, end, length)]);
}
export function replaceText(spans: readonly Span[], text: string, insertionMarks?: TextMark[], range?: { start: number; end: number }): Span[] {
  const before = textOf(spans);
  if (range && range.start >= 0 && range.end >= range.start && range.end <= before.length) {
    const insertedLength = text.length - before.length + range.end - range.start;
    const inserted = text.slice(range.start, range.start + insertedLength);
    if (insertedLength >= 0 && before.slice(0, range.start) + inserted + before.slice(range.end) === text) return normalizeSpans([...sliceSpans(spans, 0, range.start), ...(inserted ? [{ text: inserted, marks: insertionMarks ?? marksAt(spans, Math.max(0, range.start - 1)) }] : []), ...sliceSpans(spans, range.end, before.length)]);
  }
  let start = 0, tail = 0;
  while (start < before.length && start < text.length && before[start] === text[start]) start++;
  while (tail < before.length - start && tail < text.length - start && before[before.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
  const inserted = text.slice(start, text.length - tail);
  return normalizeSpans([...sliceSpans(spans, 0, start), ...(inserted ? [{ text: inserted, marks: insertionMarks ?? marksAt(spans, Math.max(0, start - 1)) }] : []), ...sliceSpans(spans, before.length - tail, before.length)]);
}
