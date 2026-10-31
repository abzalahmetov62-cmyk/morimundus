'use client';
import { useEffect, useRef, useState } from 'react';
import { Focus, LoaderCircle, Maximize2, Move3d, Scaling } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Location, WorldObject } from '@/lib/engine/project';
import { SpatialPreview, type PreviewMode } from '@/lib/editor/spatial-preview';
import type { TestPose } from '@/lib/editor/test-tools';

export default function SpatialView({ location, objects, paperColor, selectedId, onSelect, onTransform, onTest }: { location: Location; objects: WorldObject[]; paperColor: string; selectedId: string | null; onSelect: (id: string | null) => void; onTransform: (id: string, transform: WorldObject['transform']) => void; onTest?: (pose: TestPose) => void }) {
  const container = useRef<HTMLDivElement>(null), preview = useRef<SpatialPreview | null>(null);
  const latest = useRef({ onSelect, onTransform });
  latest.current = { onSelect, onTransform };
  const [mode, setMode] = useState<PreviewMode>('translate'), [loading, setLoading] = useState(true), [error, setError] = useState(''), [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (!container.current) return;
    let alive = true;
    try { preview.current = new SpatialPreview(container.current, { onSelect: id => latest.current.onSelect(id), onTransform: (id, transform) => latest.current.onTransform(id, transform), onLoading: value => { if (alive) setLoading(value); }, onWarnings: value => { if (alive) setWarnings(value); }, onError: message => { if (alive) setError(message); } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть объёмный вид'); setLoading(false); }
    return () => { alive = false; preview.current?.dispose(); preview.current = null; };
  }, []);
  useEffect(() => { if (preview.current) { setError(''); void preview.current.update(location, objects, paperColor); } }, [location, objects, paperColor]);
  useEffect(() => { preview.current?.select(selectedId, mode); }, [selectedId, mode]);
  return <div className="spatial-view"><div className="spatial-mode-tools"><Button variant={mode === 'translate' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('translate')}><Move3d />Положение</Button><Button variant={mode === 'scale' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('scale')}><Scaling />Размер</Button><Button variant="ghost" size="sm" onClick={() => preview.current?.focus()} aria-label="Приблизить выбранный объект"><Focus /></Button><Button variant="ghost" size="sm" onClick={() => preview.current?.fit()} aria-label="Показать всю локацию"><Maximize2 /></Button></div>
    <div className="spatial-preview-canvas" ref={container} />
    {onTest && <div className="spatial-test-actions"><Button variant="outline" disabled={loading || !!error} onClick={() => { if (preview.current) onTest(preview.current.testPose()); }}>Проверить из точки обзора</Button><p className="field-help">Герой появится под точкой обзора на высоте глаз. Стена или препятствие блокируют запуск.</p></div>}
    {loading && !error && <div className="spatial-loading" role="status"><LoaderCircle className="animate-spin" size={16} />Обновляю объём…</div>}{error && <div className="spatial-error" role="alert">{error}</div>}
    <div className="spatial-help">Щелчок — выбрать · перетаскивание — обзор · правая кнопка — сдвиг · колесо — масштаб{selectedId && ' · цветные оси — изменение объекта'}</div>
    {warnings.length > 0 && <div className="spatial-warnings"><Button variant="outline" onClick={() => void preview.current?.retryResources(location, objects, paperColor)}>Повторить загрузку рисунков</Button>{warnings.map((w, i) => <p key={i}>{w}. Показана заглушка.</p>)}</div>}
  </div>;
}
