import { turnView, walkDisplacement } from '../engine/spatial';
import type { TestSession } from '../engine/session';
import { attachContactDrag } from './touch-input';

export type PlayerAction = 'interact' | 'take' | 'drop' | 'inspectItem' | 'ordinaryInteract';
export type ControlMode = 'locked' | 'drag' | 'touch';
type Callbacks = { onActive: (mode: ControlMode) => void; onPause: () => void; onAction: (type: PlayerAction) => void; onInventory?: () => void; onSlot?: (slot: number) => void };
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class PlayerInput {
  readonly keys = new Set<string>();
  private enabled = false;
  private touchMode = false;
  private stick = { x: 0, y: 0 };
  private viewPointer: { id: number; x: number; y: number } | null = null;
  private lookGesture: ReturnType<typeof attachContactDrag>;
  private dragging = false;
  private dragDistance = 0;
  private mode: ControlMode = 'locked';
  private disposed = false;
  private pending = false;
  private holding = false;
  private requestId = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private lifecycle = new AbortController();

  constructor(private canvas: HTMLCanvasElement, private session: TestSession, private callbacks: Callbacks) {
    const options = { signal: this.lifecycle.signal };
    this.lookGesture = attachContactDrag(canvas, {
      start: point => { if (point.type === 'mouse' || !this.active() || this.viewPointer) return false; this.viewPointer = { id: point.id, x: point.x, y: point.y }; return true; },
      move: point => { const pointer = this.viewPointer; if (!pointer || !this.active()) return; this.look(point.x - pointer.x, point.y - pointer.y); pointer.x = point.x; pointer.y = point.y; },
      end: () => { this.viewPointer = null; },
    });
    window.addEventListener('orientationchange', this.pause, options);
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', event => this.keys.delete(event.code), options);
    window.addEventListener('mousemove', this.mouseMove, options);
    window.addEventListener('mouseup', event => { const click = this.enabled && !this.session.isPaused() && this.dragging && this.dragDistance < 4 && event.button === 0 && event.target === canvas; this.dragging = false; if (click) this.callbacks.onAction('interact'); }, options);
    window.addEventListener('blur', this.pause, options);
    canvas.addEventListener('mousedown', event => { if (this.mode !== 'touch' && this.enabled && !this.session.isPaused() && event.button === 0) { event.preventDefault(); if (this.mode === 'locked') this.callbacks.onAction('interact'); else { this.dragging = true; this.dragDistance = 0; canvas.focus(); } } }, options);
    canvas.addEventListener('wheel', event => { if (!this.active() || !event.deltaY) return; event.preventDefault(); const state = this.session.snapshot(); this.callbacks.onSlot?.((state.player.activeSlot + (event.deltaY > 0 ? 1 : -1) + state.player.inventory.length) % state.player.inventory.length); }, { ...options, passive: false });
    document.addEventListener('pointerlockchange', this.pointerChange, options);
    document.addEventListener('pointerlockerror', () => { if (this.pending) this.enable('drag'); }, options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.session.pause('hidden'); this.pause(); }
      else this.session.resume('hidden');
    }, options);
  }

  private keyDown = (event: KeyboardEvent) => {
    if (!this.enabled) return;
    if (event.code === 'Escape') { event.preventDefault(); this.pause(); return; }
    if (this.session.isPaused()) return;
    if (movementKeys.has(event.code)) { event.preventDefault(); this.keys.add(event.code); return; }
    if (event.repeat) return;
    if (event.code === 'Tab') { event.preventDefault(); this.pause(); this.callbacks.onInventory?.(); return; }
    if (/^(Digit|Numpad)[1-9]$/.test(event.code)) { event.preventDefault(); const slot = Number(event.code.at(-1)) - 1; if (slot < this.session.snapshot().player.inventory.length) this.callbacks.onSlot?.(slot); return; }
    if (event.code === 'KeyQ') { event.preventDefault(); this.callbacks.onAction('drop'); }
    if (event.code === 'KeyI') { event.preventDefault(); this.callbacks.onAction('inspectItem'); }
    if (event.code === 'KeyE') { event.preventDefault(); this.callbacks.onAction('interact'); }
    if (event.code === 'KeyR') { event.preventDefault(); this.callbacks.onAction('ordinaryInteract'); }
    if (event.code === 'KeyF') { event.preventDefault(); this.callbacks.onAction('take'); }
  };

  private mouseMove = (event: MouseEvent) => {
    if (this.mode === 'touch' || !this.enabled || this.session.isPaused() || (this.mode === 'drag' && !this.dragging)) return;
    if (this.dragging) this.dragDistance += Math.hypot(event.movementX, event.movementY);
    const pose = this.session.pose();
    const next = turnView(pose.yaw, pose.pitch, event.movementX, event.movementY);
    this.session.setPose(pose.position, next.yaw, next.pitch);
  };

  private pointerChange = () => {
    if (document.pointerLockElement === this.canvas) {
      if (!this.pending && !this.enabled) document.exitPointerLock();
      else this.enable('locked');
    }
    else if (this.enabled && this.mode === 'locked') this.pause();
  };

  private enable(mode: ControlMode) {
    if (this.disposed || (!this.pending && !this.enabled)) return;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null; this.pending = false; this.mode = mode; this.enabled = true;
    this.canvas.focus({ preventScroll: true });
    if (!this.holding) { this.session.resume('menu'); this.callbacks.onActive(mode); }
  }

  resume() {
    if (this.disposed || this.pending || this.enabled) return;
    this.pending = true;
    const requestId = ++this.requestId;
    this.canvas.focus({ preventScroll: true });
    if (this.touchMode) { this.enable('touch'); return; }
    if (!this.canvas.requestPointerLock) { this.enable('drag'); return; }
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.then === 'function') void result.then(() => {
        if ((this.disposed || requestId !== this.requestId) && document.pointerLockElement === this.canvas) document.exitPointerLock();
      }, () => { if (!this.disposed && requestId === this.requestId && this.pending) this.enable('drag'); });
      if (this.pending) this.timeout = setTimeout(() => { if (this.pending && requestId === this.requestId) this.enable('drag'); }, 1200);
    } catch { this.enable('drag'); }
  }

  pause = () => {
    if (this.disposed) return;
    const wasActive = this.enabled || this.pending;
    this.requestId++;
    this.pending = false; this.enabled = false; this.dragging = false; this.keys.clear(); this.resetTouch(); this.session.pause('menu');
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (wasActive) this.callbacks.onPause();
  };

  setTouchMode(value: boolean) { if (this.touchMode !== value && this.enabled) this.pause(); this.touchMode = value; }
  setStick(x: number, y: number) {
    if (!this.active() || ![x, y].every(Number.isFinite)) { this.stick = { x: 0, y: 0 }; return; }
    const length = Math.max(1, Math.hypot(x, y)); this.stick = { x: x / length, y: y / length };
  }
  look(x: number, y: number) { if (!this.active()) return; const pose = this.session.pose(), next = turnView(pose.yaw, pose.pitch, x, y, .004); this.session.setPose(pose.position, next.yaw, next.pitch); }
  movement(seconds: number) { return walkDisplacement(this.keys, this.session.pose().yaw, seconds, this.stick); }
  private resetTouch() { this.stick = { x: 0, y: 0 }; this.lookGesture.reset(); this.viewPointer = null; }
  active() { return this.enabled && !this.holding && !this.session.isPaused(); }
  hold() { this.holding = true; this.keys.clear(); this.dragging = false; this.resetTouch(); this.session.pause('menu'); }
  finishHold() { this.holding = false; if (!this.disposed && this.enabled) { this.session.resume('menu'); this.callbacks.onActive(this.mode); } }

  dispose() {
    this.pause(); this.disposed = true;
    this.lookGesture.dispose(); this.lifecycle.abort();
  }
}

export function joystickVector(dx: number, dy: number, radius: number) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy), magnitude = Math.min(1, length / radius);
  if (magnitude < .12) return { x: 0, y: 0 };
  const scaled = (magnitude - .12) / .88;
  return { x: dx / length * scaled, y: dy / length * scaled };
}
