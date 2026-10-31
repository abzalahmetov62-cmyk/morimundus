'use client';
import { useRef, useState } from 'react';
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Paragraph, Project, TextMark } from '@/lib/engine/project';
import { markedRange, marksAt, replaceText, textOf, toggleMark } from '@/lib/editor/rich-text';
import { RichParagraph } from '@/components/player/rich-paragraph';
import { Switch } from '@/components/ui/switch';
import { NumberField } from './number-field';
import { ResourceSelect } from './resource-select';
import { voiceProfiles } from '@/lib/engine/voices';

const marks = [{ id: 'bold' as const, label: 'Жирный', icon: Bold }, { id: 'italic' as const, label: 'Курсив', icon: Italic }, { id: 'underline' as const, label: 'Подчёркнутый', icon: Underline }, { id: 'strike' as const, label: 'Зачёркнутый', icon: Strikethrough }];
export function ParagraphEditor({ project, value, id, onChange }: { project: Project; value: Paragraph; id: string; onChange: (value: Paragraph, group?: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 }), [typingMarks, setTypingMarks] = useState<TextMark[] | undefined>();
  const selectionRef = useRef({ start: 0, end: 0 });
  const text = textOf(value.spans), voices = voiceProfiles(project);
  const syncSelection = () => { const element = input.current; if (element) { const next = { start: element.selectionStart, end: element.selectionEnd }; if (next.start !== selectionRef.current.start || next.end !== selectionRef.current.end) setTypingMarks(undefined); selectionRef.current = next; setSelection(next); } };
  const active = (mark: TextMark) => selection.start !== selection.end ? markedRange(value.spans, selection.start, selection.end, mark) : (typingMarks ?? marksAt(value.spans, Math.max(0, selection.start - 1))).includes(mark);
  function format(mark: TextMark) {
    if (selection.start === selection.end) { const current = typingMarks ?? marksAt(value.spans, Math.max(0, selection.start - 1)); setTypingMarks(current.includes(mark) ? current.filter(m => m !== mark) : [...current, mark]); }
    else onChange({ ...value, spans: toggleMark(value.spans, selection.start, selection.end, mark) });
    input.current?.focus();
  }
  return <div className="paragraph-editor"><div className="paragraph-format-tools">{marks.map(mark => <Button key={mark.id} size="sm" variant={active(mark.id) ? 'secondary' : 'ghost'} aria-label={mark.label} aria-pressed={active(mark.id)} onMouseDown={e => e.preventDefault()} onClick={() => format(mark.id)}><mark.icon size={16} /></Button>)}<span>Выдели текст, затем выбери начертание</span></div><Label htmlFor={id}>Текст абзаца</Label><Textarea ref={input} id={id} value={text} rows={4} maxLength={20000} onSelect={syncSelection} onBeforeInput={() => { if (input.current) selectionRef.current = { start: input.current.selectionStart, end: input.current.selectionEnd }; }} onChange={e => { const nextSelection = { start: e.target.selectionStart, end: e.target.selectionEnd }, range = { ...selectionRef.current }; if (range.start === range.end && e.target.value.length < text.length) { if (nextSelection.start < range.start) range.start = nextSelection.start; else range.end += text.length - e.target.value.length; } const spans = replaceText(value.spans, e.target.value, typingMarks, range); selectionRef.current = nextSelection; setSelection(nextSelection); onChange({ ...value, spans }, 'paragraph-' + id); }} />
    <div className="paragraph-live-preview" aria-label="Предпросмотр абзаца"><RichParagraph paragraph={value} />{!text && <span className="field-help">Предпросмотр текста</span>}</div>
    {value.audioAssetId && <><div className="collision-toggle"><Label htmlFor={id + '-loop'}>Повторять до остановки или замены</Label><Switch id={id + '-loop'} checked={value.audioLoop} onCheckedChange={audioLoop => onChange({ ...value, audioLoop })} /></div><NumberField id={id + '-volume'} label="Громкость" value={value.audioVolume} min={0} max={1} step={.05} onCommit={audioVolume => onChange({ ...value, audioVolume })} /></>}
    <ResourceSelect id={id + '-audio'} label="Аудио абзаца" noneLabel="Не назначено" value={value.voiceId ? 'voice:' + value.voiceId : value.audioAssetId} options={[...voices.map(voice => ({ value: 'voice:' + voice.id, label: 'Голос · ' + voice.name })), ...project.assets.filter(asset => asset.kind === 'audio').map(asset => ({ value: asset.id, label: asset.name }))]} onChange={selected => onChange({ ...value, audioAssetId: selected?.startsWith('voice:') || selected === null ? null : selected, voiceId: selected?.startsWith('voice:') ? selected.slice(6) : null, audioLoop: selected?.startsWith('voice:') ? false : value.audioLoop, audioStop: false })} />
    {value.voiceId && <><NumberField id={id + '-voice-volume'} label="Громкость голоса" value={value.audioVolume} min={0} max={1} step={.05} onCommit={audioVolume => onChange({ ...value, audioVolume })} /><p className="field-help">Голос следует за печатанием текста, делает паузы и останавливается при пропуске или открытии меню. Для озвучки включи постепенное появление текста.</p></>}
    {value.audioAssetId && <div className="collision-toggle"><Label htmlFor={id + '-restart'}>Начать этот звук заново</Label><Switch id={id + '-restart'} checked={!!value.audioRestart} onCheckedChange={audioRestart => onChange({ ...value, audioRestart })} /></div>}
    <div className="collision-toggle"><Label htmlFor={id + '-stop'}>Остановить текущий звук</Label><Switch id={id + '-stop'} checked={!!value.audioStop} onCheckedChange={audioStop => onChange({ ...value, audioStop, ...(audioStop ? { audioAssetId: null } : {}) })} /></div>
    <p className="field-help">Звук продолжается через ответы и после разговора. Другой файл заменяет его; тот же файл продолжает играть, если не выбран повторный старт. Неповторяющийся звук доигрывает до конца.</p>
  </div>;
}
