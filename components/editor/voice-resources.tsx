'use client';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, Play, Plus, Square, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Project, Voice } from '@/lib/engine/project';
import { builtinVoiceIds, builtinVoiceSamples, playableVoice, voiceDefinitions, type PlayableVoice } from '@/lib/engine/voices';
import { resourceNameMatches } from '@/lib/editor/resource-search';
import { CharacterVoice } from '@/lib/player/character-voice';
import { assetUrl } from '@/lib/storage/client';
import type { EditProject } from '@/lib/editor/use-project';
import { AssetPicker } from './asset-picker';
import { NumberField } from './number-field';

function VoicePreview({ voice }: { voice: PlayableVoice }) {
  const [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const cleanup = useRef<(() => void) | null>(null);
  const signature = JSON.stringify(voice);
  useEffect(() => { setPlaying(false); setError(''); return () => cleanup.current?.(); }, [signature]);
  const play = async () => {
    cleanup.current?.(); if (playing) { setPlaying(false); return; }
    setError(''); setPlaying(true);
    let context: AudioContext | null = null, player: CharacterVoice | null = null, timer: ReturnType<typeof setInterval> | undefined, cancelled = false;
    const stop = () => { cancelled = true; clearInterval(timer); player?.dispose(); if (context) void context.close().catch(() => {}); };
    cleanup.current = stop;
    try {
      context = new AudioContext(); await context.resume(); if (cancelled) return;
      player = new CharacterVoice(context, context.destination, { onError: message => { if (!cancelled) setError(message); } });
      const ready = await player.prepare(voice);
      if (cancelled) return;
      if (!ready) { stop(); setPlaying(false); return; }
      const syllables = ['Здра', 'вствуй', ',', 'ты', 'у', 'же', 'здесь', '.', 'Ти', 'ше', '.']; let index = 0;
      timer = setInterval(() => {
        if (index >= syllables.length) { stop(); setPlaying(false); return; }
        player?.pulse(syllables[index++], .65);
      }, 150);
    } catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : 'Не удалось включить голос'); stop(); setPlaying(false); } }
  };
  return <><Button variant="outline" onClick={() => void play()}>{playing ? <Square /> : <Play />}{playing ? 'Остановить' : 'Послушать голос'}</Button>{error && <p className="field-help" role="alert">{error}</p>}</>;
}
export function VoiceForm({ project, initial, onSave, onCancel, busy = false }: { project: Project; initial: Voice; onSave: (voice: Voice) => void; onCancel: () => void; busy?: boolean }) {
  const [draft, setDraft] = useState(initial), [sampleQuery, setSampleQuery] = useState('');
  const sounds = project.assets.filter(asset => asset.kind === 'audio');
  const matchingSounds = sounds.filter(asset => resourceNameMatches(asset.name, sampleQuery));
  const matchingBuiltins = builtinVoiceSamples.filter(sample => resourceNameMatches(sample.name, sampleQuery));
  return <fieldset className="voice-form" disabled={busy}><legend>Редактирование голоса</legend><Label htmlFor={'voice-name-' + draft.id}>Имя персонажа</Label><Input id={'voice-name-' + draft.id} value={draft.name} maxLength={160} onChange={event => setDraft({ ...draft, name: event.target.value })} />
    <AssetPicker project={project} kind="image" id={'voice-image-' + draft.id} label="Иконка голоса" value={draft.imageAssetId} onChange={imageAssetId => setDraft({ ...draft, imageAssetId })} />
    <div className="form-field"><Label htmlFor={'voice-sample-search-' + draft.id}>Поиск сэмплов по названию</Label><Input type="search" id={'voice-sample-search-' + draft.id} placeholder="Найти сэмпл…" value={sampleQuery} onChange={event => setSampleQuery(event.target.value)} />{sampleQuery && <Button variant="ghost" onClick={() => setSampleQuery('')}>Сбросить поиск сэмплов</Button>}</div>
    <fieldset className="voice-samples"><legend>Короткие сэмплы · {draft.samples.length} / 20</legend>
      {matchingBuiltins.map(sample => { const selected = draft.samples.some(value => 'builtinSampleId' in value && value.builtinSampleId === sample.id); return <Label key={sample.id}><input type="checkbox" checked={selected} disabled={!selected && draft.samples.length >= 20} onChange={event => setDraft({ ...draft, samples: event.target.checked ? [...draft.samples, { builtinSampleId: sample.id }] : draft.samples.filter(value => !('builtinSampleId' in value) || value.builtinSampleId !== sample.id) })} />{sample.name}</Label>; })}
      {matchingSounds.map(asset => { const selected = draft.samples.some(sample => 'assetId' in sample && sample.assetId === asset.id); return <Label key={asset.id}><input type="checkbox" checked={selected} disabled={!selected && draft.samples.length >= 20} onChange={event => setDraft({ ...draft, samples: event.target.checked ? [...draft.samples, { assetId: asset.id }] : draft.samples.filter(sample => !('assetId' in sample) || sample.assetId !== asset.id) })} />{asset.name}</Label>; })}
      {!matchingBuiltins.length && !matchingSounds.length && <p className="field-help" role="status">Сэмплы не найдены. Измени название в поиске.</p>}
      {!sounds.length && <p className="field-help">Чтобы добавить свои сэмплы, сначала загрузи короткие звуки в ресурсы.</p>}
    </fieldset>
    <NumberField id={'voice-rate-' + draft.id} label="Высота / скорость голоса" value={draft.rate} min={.5} max={2} step={.05} onCommit={rate => setDraft({ ...draft, rate })} />
    <NumberField id={'voice-pitch-' + draft.id} label="Разброс высоты, полутонов" value={draft.pitchVariation} min={0} max={3} step={.1} onCommit={pitchVariation => setDraft({ ...draft, pitchVariation })} />
    <NumberField id={'voice-volume-variation-' + draft.id} label="Разброс громкости" value={draft.volumeVariation} min={0} max={.5} step={.01} onCommit={volumeVariation => setDraft({ ...draft, volumeVariation })} />
    <NumberField id={'voice-cadence-' + draft.id} label="Пауза между слогами, секунд" value={draft.intervalSeconds} min={.06} max={.5} step={.01} onCommit={intervalSeconds => setDraft({ ...draft, intervalSeconds })} />
    <p className="field-help">Записи до 5 секунд; лучше 5–10 коротких слогов без музыки. Громкость задаётся у абзаца.</p>
    {!!draft.samples.length && <div><VoicePreview voice={playableVoice(draft)} /><p className="field-help">Прослушивание использует текущие настройки, даже до сохранения.</p></div>}
    <div className="resource-actions"><Button disabled={!draft.name.trim() || !draft.samples.length} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>Сохранить голос</Button><Button variant="ghost" onClick={onCancel}>Отмена</Button></div>
  </fieldset>;
}
export function VoiceResources({ project, edit, busy, query = '' }: { project: Project; edit: EditProject; busy: boolean; query?: string }) {
  const [editing, setEditing] = useState<Voice | null>(null);
  const definitions = voiceDefinitions(project), profiles = definitions.filter(voice => resourceNameMatches(voice.name, query)).map(playableVoice);
  const save = (voice: Voice) => {
    try { edit(p => ({ ...p, voices: [...(p.voices ?? []).filter(existing => existing.id !== voice.id), voice] })); setEditing(null); toast.success('Голос обновлён. Сохрани проект, чтобы применить изменения.'); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить голос'); }
  };
  const remove = (id: string) => {
    if (project.scripts.some(script => script.nodes.some(node => node.paragraphs.some(paragraph => paragraph.voiceId === id)))) { toast.error('Сначала сними голос с абзацев, в которых он используется.'); return; }
    edit(p => ({ ...p, voices: (p.voices ?? []).filter(voice => voice.id !== id) }));
  };
  return <section className="voice-resources" aria-label="Голоса персонажей"><div className="resource-controls"><div><h2>Голоса персонажей</h2><p className="field-help">Выбирай голос в аудио абзаца — он звучит в такт появлению текста.</p></div><Button variant="outline" disabled={busy || (project.voices?.length ?? 0) >= 200} onClick={() => setEditing({ id: crypto.randomUUID(), name: 'Новый персонаж', imageAssetId: null, samples: [], rate: 1, pitchVariation: .8, volumeVariation: .12, intervalSeconds: .10 })}><Plus />Добавить голос NPC</Button></div>
    {editing && <VoiceForm key={editing.id} project={project} initial={editing} busy={busy} onSave={save} onCancel={() => setEditing(null)} />}
    <div className="resource-grid">{profiles.map(voice => <article key={voice.id} className="resource-card voice-card"><div className="resource-preview">{voice.imageAssetId ? <img src={assetUrl(voice.imageAssetId)} alt="" /> : <AudioLines size={52} strokeWidth={1} />}<strong>{voice.name}</strong></div><div className="resource-card-body"><p>{voice.samples.length} сэмплов · голос при печатании</p><VoicePreview voice={voice} /><div className="resource-actions"><Button variant="ghost" disabled={busy} onClick={() => setEditing(structuredClone(definitions.find(profile => profile.id === voice.id)!))}>Редактировать</Button>{(builtinVoiceIds as readonly string[]).includes(voice.id)
      ? project.voices?.some(profile => profile.id === voice.id) && <Button variant="ghost" disabled={busy} onClick={() => { edit(p => ({ ...p, voices: (p.voices ?? []).filter(profile => profile.id !== voice.id) })); if (editing?.id === voice.id) setEditing(null); toast.success('Восстановлен исходный голос'); }}><RotateCcw />Сбросить голос</Button>
      : <Button variant="ghost" disabled={busy} size="icon-sm" aria-label={'Удалить голос ' + voice.name} onClick={() => remove(voice.id)}><Trash2 /></Button>}</div></div></article>)}</div>
  </section>;
}
