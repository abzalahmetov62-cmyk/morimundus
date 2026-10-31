import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Location, WorldObject } from '../engine/project';
import { LocationScene } from '../player/location-scene';
import { opaqueAt, type SpriteData } from '../player/picking';
import { mapBounds } from './map-geometry';
import type { TestPose } from './test-tools';
import { PlayerAssets } from '../player/assets';

export type PreviewMode = 'translate' | 'scale';
type Callbacks = { onSelect: (id: string | null) => void; onTransform: (id: string, transform: WorldObject['transform']) => void; onLoading: (loading: boolean) => void; onWarnings: (warnings: string[]) => void; onError: (message: string) => void };

export class SpatialPreview {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(55, 1, .05, 5000);
  private orbit: OrbitControls;
  private transform: TransformControls;
  private resize: ResizeObserver;
  private lifecycle = new AbortController();
  private visual: LocationScene | null = null;
  private assets = new PlayerAssets();
  private pending: LocationScene | null = null;
  private generation = 0;
  private disposed = false;
  private loading = false;
  private dirty = true;
  private frame = 0;
  private selected: string | null = null;
  private mode: PreviewMode = 'translate';
  private box: THREE.BoxHelper | null = null;
  private arrow: THREE.ArrowHelper | null = null;
  private gesture: { x: number; y: number } | null = null;
  private manipulated = false;
  private raycaster = new THREE.Raycaster();
  private fitted = false;
  private signature: string | null = null;

  constructor(private container: HTMLElement, private callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.container.appendChild(this.renderer.domElement); this.renderer.domElement.setAttribute('aria-label', 'Объёмная расстановка. Выберите объект и перетащите ось положения или размера.');
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableDamping = false; this.orbit.minDistance = .5; this.orbit.maxDistance = 3000; this.orbit.maxPolarAngle = Math.PI * .49;
    this.orbit.addEventListener('change', () => { this.dirty = true; });
    this.transform = new TransformControls(this.camera, this.renderer.domElement); this.transform.setTranslationSnap(.25); this.transform.setScaleSnap(.05); this.transform.setSize(.8);
    this.transform.addEventListener('change', () => { this.dirty = true; });
    this.transform.addEventListener('dragging-changed', e => { this.orbit.enabled = !e.value; });
    this.transform.addEventListener('mouseDown', () => { this.manipulated = true; });
    this.transform.addEventListener('objectChange', () => { const object = this.transform.object; if (object) object.scale.set(Math.max(.05, object.scale.x), Math.max(.05, object.scale.y), Math.max(.05, object.scale.z)); this.dirty = true; });
    this.transform.addEventListener('mouseUp', () => {
      const root = this.transform.object, drawable = this.selected && this.visual?.drawables.get(this.selected);
      if (!root || !drawable) return;
      const round = (n: number) => Number(n.toFixed(4));
      this.callbacks.onTransform(drawable.object.id, { position: root.position.toArray().map(round) as [number, number, number], rotation: [...drawable.object.transform.rotation], scale: root.scale.toArray().map(round) as [number, number, number] });
    });
    const options = { signal: this.lifecycle.signal };
    this.renderer.domElement.addEventListener('pointerdown', e => { this.gesture = { x: e.clientX, y: e.clientY }; }, options);
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (this.manipulated) { this.manipulated = false; this.gesture = null; return; }
      const start = this.gesture; this.gesture = null;
      if (this.loading || e.button !== 0 || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || !this.visual) return;
      const bounds = this.renderer.domElement.getBoundingClientRect(); this.camera.updateMatrixWorld(true); this.visual.align(this.camera);
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - bounds.left) / bounds.width * 2 - 1, -(e.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
      const hit = this.raycaster.intersectObjects(this.visual.sprites, false).find(hit => { const data = hit.object.userData as SpriteData; return data.ready && opaqueAt(data.alpha, hit.uv); });
      this.callbacks.onSelect(hit ? (hit.object.userData as SpriteData).object.id : null);
    }, options);
    this.renderer.domElement.addEventListener('pointercancel', () => { this.gesture = null; this.manipulated = false; }, options);
    this.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); this.callbacks.onError('Браузер потерял объёмный вид. Переключитесь на план и откройте объём снова.'); }, options);
    this.resize = new ResizeObserver(() => { const bounds = container.getBoundingClientRect(); this.renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false); this.camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height); this.camera.updateProjectionMatrix(); this.dirty = true; }); this.resize.observe(container);
    const draw = () => { if (this.disposed) return; if (this.dirty && this.visual) { this.visual.align(this.camera); this.box?.update(); this.renderer.render(this.visual.scene, this.camera); this.dirty = false; } this.frame = requestAnimationFrame(draw); }; this.frame = requestAnimationFrame(draw);
  }

  async update(location: Location, objects: WorldObject[], paperColor: string) {
    if (this.disposed) return;
    const signature = JSON.stringify({ rooms: location.rooms, spawn: location.spawn, paperColor, objects: objects.map(o => [o.id, o.transform, o.imageAssetId, o.billboard]) });
    if (signature === this.signature) { (this.pending ?? this.visual)?.updateMetadata(location, objects); this.dirty = true; return; }
    this.signature = signature;
    const generation = ++this.generation; this.loading = true; this.callbacks.onLoading(true); this.transform.detach(); this.pending?.dispose();
    const visual = new LocationScene(location, objects, paperColor, true, this.assets); this.pending = visual;
    try {
      await visual.load();
      if (this.disposed || generation !== this.generation) { visual.dispose(); return; }
      this.removeExtras(); this.visual?.dispose(); this.visual = visual; this.pending = null;
      visual.scene.add(this.transform.getHelper());
      const floor = location.rooms.find(r => location.spawn.position[0] >= r.origin[0] && location.spawn.position[0] <= r.origin[0] + r.width && location.spawn.position[2] >= r.origin[2] && location.spawn.position[2] <= r.origin[2] + r.depth)?.origin[1] ?? 0;
      this.arrow = new THREE.ArrowHelper(new THREE.Vector3(-Math.sin(location.spawn.yaw), 0, -Math.cos(location.spawn.yaw)), new THREE.Vector3(location.spawn.position[0], floor + .12, location.spawn.position[2]), .65, '#873b31', .18, .12); visual.scene.add(this.arrow);
      if (!this.fitted) { this.fit(); this.fitted = true; }
      this.loading = false; this.select(this.selected, this.mode); this.dirty = true; this.callbacks.onLoading(false); this.callbacks.onWarnings([...visual.warnings]);
    } catch (error) {
      visual.dispose();
      if (!this.disposed && generation === this.generation) { this.signature = null; this.pending = null; this.loading = false; this.callbacks.onLoading(false); this.callbacks.onError(error instanceof Error ? error.message : 'Не удалось открыть объёмный вид'); }
    }
  }

  select(id: string | null, mode: PreviewMode) {
    this.selected = id; this.mode = mode;
    this.transform.setMode(mode); this.transform.setSpace(mode === 'scale' ? 'local' : 'world'); this.transform.showZ = mode === 'translate';
    this.transform.showXZ = this.transform.showYZ = mode === 'translate';
    const object = id ? this.visual?.drawables.get(id)?.root : null;
    this.box?.removeFromParent(); this.box?.geometry.dispose(); if (this.box) (this.box.material as THREE.Material).dispose(); this.box = null;
    if (object && !this.loading) { this.transform.attach(object); this.box = new THREE.BoxHelper(object, '#873b31'); this.visual!.scene.add(this.box); }
    else this.transform.detach();
    this.dirty = true;
  }

  testPose(): TestPose {
    this.camera.updateMatrixWorld(true);
    const rotation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    return { position: this.camera.position.toArray() as [number, number, number], yaw: rotation.y, pitch: rotation.x };
  }
  retryResources(location: Location, objects: WorldObject[], paperColor: string) { this.signature = null; return this.update(location, objects, paperColor); }

  focus() {
    const object = this.selected && this.visual?.drawables.get(this.selected)?.root;
    if (!object) { this.fit(); return; }
    this.orbit.target.copy(object.position).add(new THREE.Vector3(0, object.scale.y / 2, 0)); this.orbit.update(); this.dirty = true;
  }

  fit() {
    if (!this.visual) return;
    const bounds = mapBounds(this.visual.location, [...this.visual.drawables.values()].map(d => d.object), 1), span = Math.max(bounds.width, bounds.depth, 3);
    const target = new THREE.Vector3(bounds.x + bounds.width / 2, .5, bounds.z + bounds.depth / 2);
    this.camera.position.copy(target).add(new THREE.Vector3(span * .8, span * .95, span * .8)); this.orbit.target.copy(target); this.orbit.update(); this.dirty = true;
  }

  private removeExtras() {
    this.box?.removeFromParent(); this.box?.geometry.dispose(); if (this.box) (this.box.material as THREE.Material).dispose(); this.box = null;
    if (this.arrow) { this.arrow.removeFromParent(); this.arrow.dispose(); this.arrow = null; }
    this.transform.getHelper().removeFromParent();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.generation++; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.lifecycle.abort(); this.removeExtras(); this.transform.dispose(); this.orbit.dispose(); this.visual?.dispose(); this.pending?.dispose(); this.assets.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
