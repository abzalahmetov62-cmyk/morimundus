'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/lib/engine/project';
import type { EditProject } from '@/lib/editor/use-project';
import { defaultTypewriter } from '@/lib/engine/presentation';
import { TestSession } from '@/lib/engine/session';
import { GameAudio } from '@/lib/player/audio';
import { TranscriptProgress } from '@/lib/player/typewriter';
import { TypingParagraph } from '@/components/player/typing-paragraph';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { NumberField } from './number-field';
import { AssetPicker } from './asset-picker';

const previewParagraph = { spans: [{ text: 'За окном слышен город. На бумаге появляется первая строка.', marks: [] }], audioAssetId: null, audioLoop: false, audioVolume: 1 };
export function TextPresentationEditor({ project, edit }: { project: Project; edit: EditProject }) {
  const options = project.settings.typewriter ?? defaultTypewriter;
  const [progress, setProgress] = useState<TranscriptProgress | null>(null), [error, setError] = useState('');
  const sound = useRef<GameAudio | null>(null);
  const update = (patch: Partial<typeof options>) => edit(p => ({ ...p, settings: { ...p.settings, typewriter: { ...(p.settings.typewriter ?? defaultTypewriter), ...patch } } }));
  const stop = useCallback(() => { sound.current?.stopTyping(); }, []);
  const pulse = useCallback(() => sound.current?.typingClick(options.soundAssetId, options.volume), [options.soundAssetId, options.volume]);
  const complete = useCallback(() => sound.current?.stopTyping(), []);
  const close = useCallback(() => { sound.current?.dispose(); sound.current = null; setProgress(null); }, []);
  useEffect(() => () => { sound.current?.dispose(); }, []);
  function preview() {
    try {
      sound.current?.dispose();
      const session = new TestSession(project, 1), audio = new GameAudio(project, session.audioSnapshot(), () => {}, { onError: setError });
      sound.current = audio; audio.sync(session.audioSnapshot(), { reading: true, hidden: false, effectsPaused: false });
      void audio.unlock(); setError(''); setProgress(new TranscriptProgress());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть предпросмотр'); }
  }
  return <section className="settings-sheet text-presentation-settings"><h2>Подача текста</h2><div className="collision-toggle"><Label htmlFor="text-typewriter-enabled">Печатная машинка по умолчанию</Label><Switch id="text-typewriter-enabled" checked={options.enabled} onCheckedChange={enabled => update({ enabled })} /></div><NumberField id="text-typewriter-speed" label="Символов в секунду" min={1} max={120} value={options.charactersPerSecond} onCommit={charactersPerSecond => update({ charactersPerSecond })} /><AssetPicker id="text-typewriter-sound" label="Звук печати — короткий щелчок" kind="audio" project={project} value={options.soundAssetId} onChange={soundAssetId => update({ soundAssetId })} /><NumberField id="text-typewriter-volume" label="Громкость печати, 0–1" min={0} max={1} step={.05} value={options.volume} onCommit={volume => update({ volume })} /><p className="field-help">Клик по реплике или пробел раскрывает абзац целиком. Щелчки печати не меняют музыку и озвучку. Игрок может выбрать скорость и отключить эффект в настройках чтения.</p><Button variant="outline" onClick={preview}>Предпросмотр печати</Button>{progress && <div className="typewriter-preview"><TypingParagraph paragraph={previewParagraph} index={0} progress={progress} enabled={options.enabled} speed={options.charactersPerSecond} onPulse={pulse} onStop={stop} onComplete={complete} /><Button variant="ghost" onClick={close}>Закрыть предпросмотр</Button></div>}{error && <p role="alert">{error}</p>}</section>;
}
