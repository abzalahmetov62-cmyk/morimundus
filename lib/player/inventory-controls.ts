type InventoryControls = { onSelectSlot: (slot: number) => void; onClose: () => void; onPause: () => void };

export function attachInventoryKeys(target: EventTarget, slotCount: () => number, controls: InventoryControls) {
  const key = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.repeat) return;
    const focused = keyboard.target as HTMLElement | null;
    if (focused?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (keyboard.code === 'Tab') { keyboard.preventDefault(); controls.onClose(); }
    else if (keyboard.code === 'Escape') { keyboard.preventDefault(); controls.onPause(); }
    else if (/^(Digit|Numpad)[1-9]$/.test(keyboard.code)) {
      const slot = Number(keyboard.code.at(-1)) - 1;
      if (slot < slotCount()) { keyboard.preventDefault(); controls.onSelectSlot(slot); }
    }
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}
