'use client';
import { AssetImage } from './asset-image';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { joystickVector } from '@/lib/player/input';
import { attachContactDrag, subscribeTouchControls, touchControlsAvailable } from '@/lib/player/touch-input';

const touchSnapshot = () => touchControlsAvailable();
export function useTouchControls() { return useSyncExternalStore(subscribeTouchControls, touchSnapshot, () => false); }

export function MobileBack({ onBack, label = 'Назад', disabled = false }: { onBack: () => void; label?: string; disabled?: boolean }) {
  return <button type="button" className="mobile-art-button mobile-back" aria-label={label} disabled={disabled} onClick={onBack}><AssetImage src="/mobile-ui/back.webp" alt="" draggable={false} /></button>;
}

export function MobileControls({ action, targetName, heldName, onMove, onAction, onInventory }: { action: 'take' | 'use' | null; targetName: string; heldName: string; onMove: (x: number, y: number) => void; onAction: () => void; onInventory: () => void }) {
  const stick = useRef<HTMLDivElement>(null), move = useRef(onMove);
  move.current = onMove;
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const element = stick.current; if (!element) return;
    const update = (point: { x: number; y: number }) => {
      const rect = element.getBoundingClientRect(), radius = rect.width * .3;
      const dx = point.x - rect.left - rect.width / 2, dy = point.y - rect.top - rect.height / 2, length = Math.max(1, Math.hypot(dx, dy) / radius);
      setOffset({ x: dx / length, y: dy / length }); const axis = joystickVector(dx, dy, radius); move.current(axis.x, axis.y);
    };
    const gesture = attachContactDrag(element, { start: point => { update(point); return true; }, move: update, end: () => { setOffset({ x: 0, y: 0 }); move.current(0, 0); } });
    return () => { gesture.dispose(); move.current(0, 0); };
  }, []);
  return <div className="mobile-controls"><div ref={stick} className="mobile-joystick" role="group" aria-label="Джойстик движения">
    <AssetImage className="mobile-joystick-base" src="/mobile-ui/joystick-base.webp" alt="" draggable={false} /><AssetImage className="mobile-joystick-thumb" src="/mobile-ui/joystick-thumb.webp" alt="" draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} />
  </div><button type="button" className="mobile-art-button mobile-inventory-button" aria-label="Открыть инвентарь" onClick={onInventory}><AssetImage src="/mobile-ui/inventory.webp" alt="" draggable={false} /><span>Вещи</span></button>
    <button type="button" className="mobile-art-button mobile-context-action" disabled={!action} aria-label={action === 'take' ? 'Взять' : 'Использовать'} onClick={onAction}><AssetImage src={action === 'take' ? '/mobile-ui/take.webp' : '/mobile-ui/use.webp'} alt="" draggable={false} /><span>{action === 'take' ? 'Взять' : 'Использовать'}</span></button>
    {(targetName || heldName) && <div className="mobile-target-label" role="status">{targetName && <strong>{targetName}</strong>}{heldName && <span>В руке: {heldName}</span>}</div>}
  </div>;
}
