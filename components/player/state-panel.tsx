'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatWorldTime } from '@/lib/engine/time';
import { Switch } from '@/components/ui/switch';
import type { TestSession, GameState } from '@/lib/engine/session';
import type { ConditionTrace } from '@/lib/engine/conditions';
import { objectDiagnostics } from '@/lib/editor/test-tools';
import { ScalarField } from '@/components/editor/scalar-field';

function ConditionTree({ trace }: { trace: ConditionTrace }) {
  return <li className={trace.allowed ? 'condition-passed' : 'condition-failed'}><span>{trace.allowed ? 'Выполнено' : 'Не выполнено'}: {trace.label}</span>{trace.detail && <p>{trace.detail}</p>}{trace.children.length > 0 && <ul>{trace.children.map((child, i) => <ConditionTree key={i} trace={child} />)}</ul>}</li>;
}

export function StatePanel({ session, state, authorMode = false, update }: { session: TestSession; state: GameState; authorMode?: boolean; update: (action: () => void) => void }) {
  const [itemId, setItemId] = useState(''), [locationId, setLocationId] = useState(''), [objectId, setObjectId] = useState('');
  const objects = session.project.objects.filter(o => o.locationId === state.locationId);
  const selectedObject = objects.find(o => o.id === objectId) ?? objects[0];
  const selectedItem = session.project.items.find(i => i.id === itemId) ?? session.project.items[0];
  const selectedLocation = session.project.locations.find(l => l.id === locationId) ?? session.project.locations.find(l => l.id === state.locationId)!;
  return <div className="player-state-content"><div className="test-summary"><div><small>Локация</small><strong>{session.project.locations.find(l => l.id === state.locationId)?.name}</strong></div><div><small>Время мира</small><strong>{formatWorldTime(state.clock.worldSeconds)}</strong></div><div><small>Позиция X / Y / Z</small><strong>{state.player.position.map(n => n.toFixed(2)).join(' / ')}</strong></div></div>
    <p className="field-help">{authorMode ? 'Временные изменения действуют только в этой проверке. После выхода черновик и слоты останутся прежними.' : 'Для временной выдачи вещей и изменения флагов открой «Авторская проверка» в мастерской.'}</p>
    {authorMode && <section className="test-section"><h3>Быстрая подготовка</h3><div className="test-tools-row"><Select value={selectedLocation.id} onValueChange={setLocationId}><SelectTrigger aria-label="Локация для авторской проверки"><SelectValue /></SelectTrigger><SelectContent>{session.project.locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={selectedLocation.id === state.locationId} onClick={() => update(() => session.goToTestLocation(selectedLocation.id))}>Перейти</Button></div><p className="field-help">Переход проверяет точку появления и выполняет реакции входа.</p>{selectedItem && <div className="test-tools-row"><Select value={selectedItem.id} onValueChange={setItemId}><SelectTrigger aria-label="Временный предмет"><SelectValue /></SelectTrigger><SelectContent>{session.project.items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => update(() => session.giveTestItem(selectedItem.id))}>Выдать предмет</Button></div>}</section>}
    <section className="test-section"><h3>Флаги</h3>{Object.entries(state.flags).map(([key, value]) => <div className="test-flag" key={key}>{authorMode ? <ScalarField id={'test-flag-' + key} label={key} value={value} onChange={v => update(() => session.setFlag(key, v))} /> : <div className="test-row"><code>{key}</code><span>{value === null ? 'пусто' : value === true ? 'да' : value === false ? 'нет' : String(value)}</span></div>}</div>)}</section>
    <section className="test-section"><h3>Присутствие объектов</h3>{objects.map(o => {
      const item = state.items[`instance-${o.id}`];
      const moved = item && (item.owner.type !== 'world' || item.owner.dropped || item.owner.locationId !== o.locationId);
      return <div className="test-row" key={o.id}><span>{o.name}</span>{moved ? <span className="field-help">{item.owner.type === 'equipment' ? 'Надето' : item.owner.type === 'world' ? 'Выброшено' : item.owner.type === 'container' ? 'В контейнере' : 'В инвентаре'}</span> : <Button variant="ghost" size="sm" disabled={!authorMode} onClick={() => update(() => session.setObjectPresence(o.id, !state.objects[o.id].present))}>{state.objects[o.id].present ? <Eye size={16} /> : <EyeOff size={16} />}{state.objects[o.id].present ? 'Присутствует' : 'Убран'}</Button>}</div>;
    })}</section>
    {selectedObject && <section className="test-section"><h3>Почему условие сработало</h3><Select value={selectedObject.id} onValueChange={setObjectId}><SelectTrigger aria-label="Объект для объяснения условий"><SelectValue /></SelectTrigger><SelectContent>{objects.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select><p className="field-help">Показаны текущие значения и каждая ветвь И / ИЛИ / НЕ. Просмотр не запускает реакции. Для реакции дополнительно нужны её событие и подходящая вещь.</p><ul className="condition-traces">{objectDiagnostics(session.project, state, selectedObject.id).map((trace, i) => <ConditionTree key={i} trace={trace} />)}</ul></section>}
    {authorMode && <div className="test-clock"><Button variant="outline" onClick={() => update(() => { session.advanceTime(60); })}>Продвинуть на минуту</Button><label><Switch checked={state.clock.pausedBy.includes('debug')} onCheckedChange={v => update(() => v ? session.pause('debug') : session.resume('debug'))} /> Остановить время</label></div>}
  </div>;
}
