const touchQueries = ['(pointer: coarse)', '(any-pointer: coarse)'];
export function touchControlsAvailable(host: Window = window) {
  return (host.navigator?.maxTouchPoints ?? 0) > 0 || (typeof host.matchMedia === 'function' && touchQueries.some(query => host.matchMedia(query).matches));
}
export function subscribeTouchControls(notify: () => void, host: Window = window) {
  const remove: (() => void)[] = [];
  if (typeof host.matchMedia === 'function') for (const query of touchQueries) {
    const media = host.matchMedia(query);
    if (typeof media.addEventListener === 'function') { media.addEventListener('change', notify); remove.push(() => media.removeEventListener('change', notify)); }
    else if (typeof media.addListener === 'function') { media.addListener(notify); remove.push(() => media.removeListener(notify)); }
  }
  host.addEventListener('pageshow', notify); remove.push(() => host.removeEventListener('pageshow', notify));
  return () => { for (const stop of remove) stop(); };
}

type Contact = { id: number; x: number; y: number; type: 'touch' | 'pen' | 'mouse' };
type Handlers = { start: (point: Contact) => boolean; move: (point: Contact) => void; end: () => void };
export function attachContactDrag(element: HTMLElement, handlers: Handlers, host: Window = window, doc: Document = document) {
  let owner: { family: 'touch' | 'pointer'; point: Contact } | null = null, disposed = false;
  const remove: (() => void)[] = [], handled = new WeakSet<Event>();
  const listen = (target: EventTarget, type: string, handler: (event: Event) => void) => {
    target.addEventListener(type, handler, { passive: false });
    remove.push(() => target.removeEventListener(type, handler));
  };
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  const once = (event: Event) => { if (handled.has(event)) return false; handled.add(event); return true; };
  const reset = () => {
    const previous = owner; owner = null;
    if (!previous) return;
    if (previous.family === 'pointer') try { if (element.hasPointerCapture?.(previous.point.id)) element.releasePointerCapture(previous.point.id); } catch {}
    handlers.end();
  };
  listen(element, 'pointerdown', event => {
    const pointer = event as PointerEvent;
    if (owner || disposed || (pointer.pointerType === 'mouse' && pointer.button !== 0) || (pointer.pointerType === 'touch' && 'ontouchstart' in host)) return;
    const point: Contact = { id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, type: pointer.pointerType === 'touch' ? 'touch' : pointer.pointerType === 'pen' ? 'pen' : 'mouse' };
    if (!handlers.start(point)) return;
    owner = { family: 'pointer', point }; prevent(event);
    try { element.setPointerCapture?.(point.id); } catch {}
  });
  const pointerMove = (event: Event) => {
    const pointer = event as PointerEvent;
    if (!owner || owner.family !== 'pointer' || owner.point.id !== pointer.pointerId || !once(event)) return;
    prevent(event); const point = { ...owner.point, x: pointer.clientX, y: pointer.clientY }; owner.point = point; handlers.move(point);
  };
  const pointerEnd = (event: Event) => { if (owner?.family === 'pointer' && owner.point.id === (event as PointerEvent).pointerId && once(event)) { prevent(event); reset(); } };
  for (const target of [element, host]) { listen(target, 'pointermove', pointerMove); listen(target, 'pointerup', pointerEnd); listen(target, 'pointercancel', pointerEnd); }
  listen(element, 'lostpointercapture', pointerEnd);
  listen(element, 'touchstart', event => {
    if (owner || disposed) return;
    const touch = (event as TouchEvent).changedTouches[0]; if (!touch) return;
    const point: Contact = { id: touch.identifier, x: touch.clientX, y: touch.clientY, type: 'touch' };
    if (!handlers.start(point)) return;
    owner = { family: 'touch', point }; prevent(event);
  });
  const touchMove = (event: Event) => {
    if (!owner || owner.family !== 'touch' || !once(event)) return;
    const touch = Array.from((event as TouchEvent).changedTouches).find(touch => touch.identifier === owner!.point.id);
    if (!touch) return;
    prevent(event); const point = { ...owner.point, x: touch.clientX, y: touch.clientY }; owner.point = point; handlers.move(point);
  };
  const touchEnd = (event: Event) => {
    if (owner?.family === 'touch' && Array.from((event as TouchEvent).changedTouches).some(touch => touch.identifier === owner!.point.id) && once(event)) { prevent(event); reset(); }
  };
  for (const target of [element, host]) { listen(target, 'touchmove', touchMove); listen(target, 'touchend', touchEnd); listen(target, 'touchcancel', touchEnd); }
  listen(element, 'contextmenu', prevent);
  listen(host, 'blur', reset); listen(host, 'orientationchange', reset);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });
  return { reset, dispose: () => { if (disposed) return; disposed = true; for (const stop of remove) stop(); reset(); } };
}
