import type { EffectPose, ObjectEffect } from '../engine/object-effects';
import * as THREE from 'three';
import { TestSession } from '../engine/session';
import { assertArrival, collisionWorld, movePlayer, type CollisionWorld } from '../engine/spatial';
import type { WorldObject } from '../engine/project';
import { PlayerInput, type ControlMode, type PlayerAction } from './input';
import { pickTarget, contextAction, type Target } from './picking';
import { LocationScene } from './location-scene';
import { PlayerAssets } from './assets';
import { transitionImages } from './resource-plan';

type Callbacks = { onSpatial?: (effects: ObjectEffect[], pose: EffectPose) => void; onResources?: (warnings: string[]) => void; onScene: () => void; onInventory: () => void; onContainer: (object: WorldObject) => void; onActive: (mode: ControlMode) => void; onPause: () => void; onInspect: (object: WorldObject) => void; onTarget: (target: Target | null) => void; onChange: (checkpoint?: boolean) => void; onMessage: (message: string) => void; onError: (message: string) => void; onTravel: (loading: boolean, name: string, warnings: string[]) => void };

export class FirstPersonWorld {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(65, 1, .05, 160);
  private visual: LocationScene;
  private assets = new PlayerAssets();
  private pendingVisual: LocationScene | null = null;
  private raycaster = new THREE.Raycaster();
  private collision: CollisionWorld;
  private input: PlayerInput;
  private resize: ResizeObserver;
  private lifecycle = new AbortController();
  private frame = 0;
  private last = 0;
  private lastWorldRevision = -1;
  private presenceKey = '\u0000';
  private lastTarget = '';
  private lastHud = 0;
  private disposed = false;
  private dirty = true;
  private effectSources: ObjectEffect[] = [];
  private travelling = false;
  private recovery: Promise<void> | null = null;
  private recoveryRounds = 0;
  private nextRecovery = 0;
  get warnings() { return this.visual.warnings; }
  isTravelling() { return this.travelling; }

  private constructor(private container: HTMLElement, readonly session: TestSession, private callbacks: Callbacks) {
    const location = session.project.locations.find(l => l.id === session.locationId())!;
    const objects = session.visibleObjects();
    this.collision = collisionWorld(location, objects);
    assertArrival(location, objects, session.pose().position);
    this.visual = new LocationScene(location, session.project.objects.filter(o => o.locationId === location.id), session.project.settings.paperColor, false, this.assets);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Комната от первого лица. WASD — движение, мышь — обзор, E или щелчок — взаимодействовать, F — взять, Escape — пауза.');
    this.container.appendChild(this.renderer.domElement);
    this.session.pause('menu');
    this.input = new PlayerInput(this.renderer.domElement, session, { onActive: mode => { this.dirty = true; this.last = performance.now(); callbacks.onActive(mode); }, onPause: () => { this.dirty = true; this.lastTarget = ''; callbacks.onTarget(null); callbacks.onPause(); }, onAction: type => this.action(type), onInventory: () => callbacks.onInventory(), onSlot: slot => { try { session.selectSlot(slot); callbacks.onChange(true); } catch (error) { callbacks.onMessage(error instanceof Error ? error.message : 'Ячейка недоступна'); } } });
    this.resize = new ResizeObserver(() => this.resizeCanvas()); this.resize.observe(container); this.resizeCanvas();
    window.addEventListener('online', () => { this.recoveryRounds = 0; this.nextRecovery = 0; void this.retryResources(); }, { signal: this.lifecycle.signal });
    this.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); this.dispose(); callbacks.onError('Объёмный вид остановлен: браузер потерял графический контекст. Перезапустите проверку.'); }, { signal: this.lifecycle.signal });
  }

  static async create(container: HTMLElement, session: TestSession, callbacks: Callbacks, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Проверка закрыта', 'AbortError');
    session.start();
    const world = new FirstPersonWorld(container, session, callbacks);
    signal.addEventListener('abort', () => world.dispose(), { once: true });
    try { await world.visual.load(); if (world.disposed) throw new DOMException('Проверка закрыта', 'AbortError'); world.refreshWorld(); world.start(); return world; }
    catch (error) { world.dispose(); throw error; }
  }

  private refreshWorld() {
    if (this.travelling || this.disposed) return;
    if (this.visual.location.id !== this.session.locationId()) { void this.syncLocation(); return; }
    if (this.lastWorldRevision === this.session.worldRevision()) return;
    this.lastWorldRevision = this.session.worldRevision(); this.effectSources = this.session.effectSources();
    const visible = this.session.visibleObjects(), key = visible.map(o => o.id + ':' + o.transform.position.join(',')).join('|');
    if (key !== this.presenceKey) {
      this.presenceKey = key; const visual = this.visual;
      void visual.syncObjects(visible).then(() => { if (!this.disposed && this.visual === visual) { this.dirty = true; this.callbacks.onResources?.([...visual.warnings]); } });
      this.collision = collisionWorld(this.visual.location, visible);
      this.assets.preload(transitionImages(this.session.project, this.session.snapshot()));
    }
    this.dirty = true;
  }

  private resizeCanvas() {
    const bounds = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    this.camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height); this.camera.updateProjectionMatrix(); this.dirty = true;
  }

  private updateCamera() {
    const pose = this.session.pose();
    this.camera.position.set(...pose.position); this.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ'); this.camera.updateMatrixWorld(true);
  }

  private target(): Target | null {
    const target = pickTarget(this.camera, this.visual.sprites, this.visual.occluders, this.raycaster);
    if (target?.canTake && !this.session.objectAvailability(target.objectId).allowed) return { ...target, canTake: false };
    return target;
  }
  private currentTarget() { this.refreshWorld(); if (this.travelling) return null; this.updateCamera(); this.visual.align(this.camera); return this.target(); }

  private action(type: PlayerAction) {
    if (this.travelling) return;
    if (type === 'drop') { try { this.session.dropItem(); this.refresh(); this.callbacks.onChange(true); } catch (error) { this.callbacks.onMessage(error instanceof Error ? error.message : 'Не удалось выбросить предмет'); } return; }
    if (type === 'inspectItem') { this.input.pause(); this.callbacks.onInventory(); return; }
    const target = this.currentTarget(); if (!target) return;
    const object = this.session.worldObject(target.objectId); if (!object) return;
    try {
      if (type === 'take') {
        if (!target.canTake) return;
        this.session.takeObject(object.id); this.refreshWorld(); this.callbacks.onChange(true); return;
      }
      const result = this.session.interactObject(object.id, type !== 'ordinaryInteract');
      if (result === 'travel') this.refresh();
      else if (result === 'applied') { this.refresh(); this.callbacks.onMessage('Готово.'); }
      else if (result === 'container') { this.input.pause(); this.callbacks.onContainer(object); }
      else if (result === 'door') void this.travel(object.id);
      else {
        if (result === 'inspect') this.session.pause('interaction');
        this.input.pause(); this.callbacks.onInspect(object);
      }
      this.callbacks.onChange(true);
    } catch (error) { this.callbacks.onMessage(error instanceof Error ? error.message : 'Не удалось взаимодействовать с объектом'); }
  }

  private beginTravel(name: string) {
    this.callbacks.onSpatial?.(this.effectSources.filter(effect => effect.carried), this.session.pose());
    this.travelling = true; this.input.hold(); this.lastTarget = ''; this.callbacks.onTarget(null); this.callbacks.onTravel(true, name, []);
  }
  private installVisual(visual: LocationScene) {
    const previous = this.visual; this.visual = visual; this.pendingVisual = null; previous.dispose();
    this.lastWorldRevision = -1; this.presenceKey = '\u0000'; this.recoveryRounds = 0; this.nextRecovery = 0;
  }
  private endTravel() {
    this.travelling = false; this.refreshWorld();
    if (this.session.hasInteraction()) this.input.pause();
    this.callbacks.onChange(); this.callbacks.onTravel(false, this.visual.location.name, [...this.visual.warnings]); this.input.finishHold();
  }
  private async loadLocation(locationId: string) {
    const location = this.session.project.locations.find(l => l.id === locationId)!;
    const visual = new LocationScene(location, this.session.project.objects.filter(o => o.locationId === location.id), this.session.project.settings.paperColor, false, this.assets);
    this.pendingVisual = visual; await visual.load(); return visual;
  }
  private async travel(objectId: string) {
    try {
      const destination = this.session.destination(objectId);
      this.beginTravel(destination.location.name);
      const prepared = this.session.prepareTransition(objectId);
      const visual = await this.loadLocation(prepared.state.locationId);
      if (this.disposed) return;
      this.session.commitTransition(prepared); this.installVisual(visual); this.endTravel();
    } catch (error) {
      this.pendingVisual?.dispose(); this.pendingVisual = null;
      if (!this.disposed) {
        this.callbacks.onMessage(error instanceof Error ? error.message : 'Не удалось перейти в локацию');
        if (this.travelling) this.endTravel();
      }
    }
  }
  private async syncLocation() {
    if (this.travelling || this.disposed) return;
    const location = this.session.project.locations.find(l => l.id === this.session.locationId())!;
    this.beginTravel(location.name);
    try {
      const visual = await this.loadLocation(location.id);
      if (this.disposed) return;
      if (this.session.locationId() !== location.id) throw new Error('Локация изменилась во время загрузки. Перезапустите проверку.');
      this.installVisual(visual); this.endTravel();
    } catch (error) {
      this.pendingVisual?.dispose(); this.pendingVisual = null;
      if (!this.disposed) { this.input.pause(); this.callbacks.onError(error instanceof Error ? error.message : 'Не удалось загрузить локацию'); }
    }
  }

  private start() {
    this.last = performance.now();
    const draw = (now: number) => {
      if (this.disposed) return;
      const delta = Math.max(0, Math.min(.1, (now - this.last) / 1000)); this.last = now;
      this.refreshWorld();
      if (!this.travelling && !this.recovery && this.visual.warnings.length && this.recoveryRounds < 2 && now >= this.nextRecovery) {
        this.recoveryRounds++; this.nextRecovery = now + 15000; void this.retryResources();
      }
      if (!this.travelling && this.input.active()) {
        const pose = this.session.pose(), displacement = this.input.movement(delta);
        this.session.setPose(movePlayer(pose.position, displacement, this.collision), pose.yaw, pose.pitch);
        try {
          if (this.session.tick(delta)) this.callbacks.onChange(true);
          if (this.session.hasInteraction()) { this.input.pause(); this.callbacks.onScene(); }
          this.refreshWorld();
        } catch (cause) { this.input.pause(); this.callbacks.onMessage(cause instanceof Error ? cause.message : 'Не удалось выполнить событие времени'); this.callbacks.onChange(); }
        this.dirty = true;
      }
      if (this.dirty && !this.travelling) {
        this.updateCamera(); this.visual.updateEffects(this.effectSources, this.session.pose()); this.callbacks.onSpatial?.(this.effectSources, this.session.pose()); this.visual.align(this.camera);
        const target = this.input.active() ? this.target() : null;
        const key = target ? target.objectId + ':' + target.canTake : '';
        if (key !== this.lastTarget) { this.lastTarget = key; this.callbacks.onTarget(target); }
        this.renderer.render(this.visual.scene, this.camera); this.dirty = false;
      }
      if (!this.travelling && this.input.active() && now - this.lastHud > 250) { this.lastHud = now; this.callbacks.onChange(); }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  setTouchMode(value: boolean) { this.input.setTouchMode(value); this.renderer.domElement.setAttribute('aria-label', value ? 'Комната от первого лица. Обзор — движение пальцем, движение — экранный джойстик, взаимодействие — кнопка справа.' : 'Комната от первого лица. WASD — движение, мышь — обзор, E — взаимодействовать, F — взять, Escape — пауза.'); this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, value ? 1.25 : 1.5)); this.resizeCanvas(); }
  setStick(x: number, y: number) { this.input.setStick(x, y); }
  performContextAction() { if (!this.input.active() || this.travelling) return; const action = contextAction(this.session.project, this.session.snapshot(), this.currentTarget()); if (action) this.action(action); }
  resume() { if (this.travelling || this.session.hasInteraction()) return; this.session.resume('interaction'); this.input.resume(); }
  retryResources(): Promise<void> {
    if (this.disposed || this.travelling) return Promise.resolve();
    if (this.recovery) return this.recovery;
    const visual = this.visual;
    this.recovery = visual.retryMissing().then(() => {
      if (!this.disposed && visual === this.visual) { this.dirty = true; this.callbacks.onResources?.([...visual.warnings]); }
    }).finally(() => { this.recovery = null; this.nextRecovery = performance.now() + 15000; });
    return this.recovery;
  }
  pause() { this.input.pause(); this.dirty = true; }
  refresh() { this.lastWorldRevision = -1; this.dirty = true; this.refreshWorld(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.input.dispose(); this.resize.disconnect(); this.lifecycle.abort();
    this.visual.dispose(); this.pendingVisual?.dispose(); this.assets.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
