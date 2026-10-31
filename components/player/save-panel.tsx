'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { PlayerSaves } from '@/lib/player/saves';
import { emptySlot, SAVE_SLOTS, slotLabel, type SaveSlot } from '@/lib/engine/save-game';
import { formatWorldTime } from '@/lib/engine/time';

const unavailable = { ready: false, busy: false, blocked: false, error: '', slots: SAVE_SLOTS.map(s => emptySlot(s)) };
const subscribeNone = () => () => {};
const unavailableSnapshot = () => unavailable;
export function useSaveStatus(saves: PlayerSaves | null) { return useSyncExternalStore(saves?.subscribe ?? subscribeNone, saves?.getSnapshot ?? unavailableSnapshot, unavailableSnapshot); }

export function SavePanel({ saves, allowSave = false, onSave, onLoad, onRetry, onClose }: { saves: PlayerSaves; allowSave?: boolean; onSave?: (slot: SaveSlot) => Promise<void>; onLoad: (slot: SaveSlot) => Promise<void>; onRetry?: () => Promise<void>; onClose: () => void }) {
  const status = useSaveStatus(saves), panel = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null), closeRef = useRef(onClose);
  const [confirmation, setConfirmation] = useState<{ slot: SaveSlot; action: 'save' | 'load' | 'remove' | 'retry' } | null>(null);
  const [error, setError] = useState(''), [working, setWorking] = useState(false);
  closeRef.current = onClose;
  const busy = status.busy || working;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
      if (event.code === 'Tab') { const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])], first = buttons[0], last = buttons.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  async function run(slot: SaveSlot, action: 'save' | 'load' | 'remove' | 'retry') {
    setConfirmation(null); setError(''); setWorking(true);
    try { if (action === 'save') await onSave?.(slot); else if (action === 'load') await onLoad(slot); else if (action === 'retry') await onRetry?.(); else await saves.remove(slot); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Действие не удалось. Прохождение сохранено в открытом окне.'); }
    finally { setWorking(false); }
  }
  return <div className="player-overlay"><section ref={panel} className="player-saves-panel" role="dialog" aria-modal="true" aria-labelledby="saves-heading"><div className="section-title"><h2 id="saves-heading">Сохранения прохождения</h2><Button ref={close} variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button></div>
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    <p className="field-help">Автослот обновляется после действий, переходов и чтения, а также каждые 30 секунд исследования. Ручные слоты меняются только по твоему выбору.</p>
    <div className="player-save-tools"><Button variant="outline" disabled={busy} onClick={() => { setConfirmation(null); setError(''); void saves.initialize().catch(() => {}); }}>Обновить список</Button>{allowSave && status.blocked && onRetry && <Button variant="outline" disabled={busy} onClick={() => setConfirmation({ slot: 'auto', action: 'retry' })}>Сохранить текущее в автослот</Button>}<span role="status">{busy ? 'Подожди…' : status.blocked ? 'Автосохранение остановлено' : status.ready ? 'Хранилище доступно' : 'Сохранения недоступны'}</span></div>
    <div className="player-save-list">{status.slots.map(slot => {
      const compatible = saves.compatible(slot), selected = confirmation?.slot === slot.slot;
      return <article className="player-save-card" key={slot.slot}><div><h3>{slotLabel(slot.slot)}</h3>{slot.occupied ? <><p>{slot.health === 'damaged' ? 'Повреждено' : slot.locationName}</p>{slot.worldSeconds !== null && <p>{formatWorldTime(slot.worldSeconds)}</p>}{slot.updatedAt && <p className="field-help">{new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Qyzylorda' }).format(new Date(slot.updatedAt))}</p>}{slot.health === 'valid' && !compatible && <p className="field-help">Другая редакция проекта</p>}</> : <p>Пусто</p>}</div><div className="player-save-actions"><Button variant="outline" disabled={busy || !compatible} onClick={() => allowSave ? setConfirmation({ slot: slot.slot, action: 'load' }) : void run(slot.slot, 'load')}>Загрузить</Button>{allowSave && slot.slot !== 'auto' && <Button disabled={busy || !status.ready} onClick={() => slot.occupied ? setConfirmation({ slot: slot.slot, action: 'save' }) : void run(slot.slot, 'save')}>Сохранить</Button>}{slot.occupied && <Button variant="ghost" disabled={busy} onClick={() => setConfirmation({ slot: slot.slot, action: 'remove' })}>Удалить</Button>}</div>{selected && <div className="player-save-confirmation"><p>{confirmation.action === 'load' ? 'Загрузить этот слот? Текущее прохождение в открытом окне будет заменено.' : confirmation.action === 'remove' ? 'Удалить этот слот? Другие сохранения останутся.' : confirmation.action === 'retry' ? 'Записать текущее прохождение в автослот? Предыдущее автосохранение будет заменено.' : 'Перезаписать этот слот текущим прохождением?'}</p><Button disabled={busy} onClick={() => void run(slot.slot, confirmation.action)}>Подтвердить</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Отмена</Button></div>}</article>;
    })}</div></section></div>;
}
