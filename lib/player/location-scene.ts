import { ObjectLights } from './object-lights';
import type { EffectPose, ObjectEffect } from '../engine/object-effects';
import * as THREE from 'three';
import type { Location, WorldObject } from '../engine/project';
import { PlayerAssets } from './assets';
import { alignBillboard } from './billboard';
import type { SpriteData } from './picking';
import { roomGeometry } from './room-geometry';
import type { ResourceLease } from './resource-pool';
import type { ImageResource } from './assets';

type ImageBinding = { name: string; apply: (image: ImageResource) => void };

type Drawable = { object: WorldObject; root: THREE.Group; mesh: THREE.Mesh; aspect: number | null };

export class LocationScene {
  readonly scene = new THREE.Scene();
  readonly sprites: THREE.Mesh[] = [];
  readonly occluders: THREE.Object3D[] = [];
  readonly drawables = new Map<string, Drawable>();
  readonly warnings: string[] = [];
  private assets: PlayerAssets;
  private ownsAssets: boolean;
  private images = new Map<string, ResourceLease<ImageResource>>();
  private bindings = new Map<string, ImageBinding[]>();
  private missing = new Set<string>();
  private recovery: Promise<void> | null = null;
  private textures = new Set<THREE.Texture>();
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private disposed = false;
  private lighting: ObjectLights;

  constructor(public location: Location, private objects: readonly WorldObject[], private paperColor: string, private editor = false, assets?: PlayerAssets) { this.assets = assets ?? new PlayerAssets(); this.ownsAssets = !assets; this.scene.background = new THREE.Color(paperColor); this.lighting = new ObjectLights(this.scene, location.ambientLight ?? 1); }

  private imageResource(id: string) { let lease = this.images.get(id); if (!lease) { lease = this.assets.acquire(id); this.images.set(id, lease); } return lease.promise; }

  private updateWarnings() {
    this.warnings.splice(0, this.warnings.length, ...[...this.missing].flatMap(id =>
      [...new Set(this.bindings.get(id)?.map(binding => binding.name))].map(name => `Не удалось загрузить рисунок: ${name}`)));
  }

  private async bindImage(id: string, name: string, apply: ImageBinding['apply']) {
    const bindings = this.bindings.get(id) ?? []; bindings.push({ name, apply }); this.bindings.set(id, bindings);
    try { const image = await this.imageResource(id); if (!this.disposed) apply(image); }
    catch { if (!this.disposed) { this.missing.add(id); this.updateWarnings(); } }
  }

  retryMissing(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.recovery) return this.recovery;
    this.recovery = Promise.all([...this.missing].map(async id => {
      this.images.get(id)?.release(); this.images.delete(id);
      try {
        const image = await this.imageResource(id);
        if (this.disposed) return;
        for (const binding of this.bindings.get(id) ?? []) binding.apply(image);
        this.missing.delete(id);
      } catch { /* Keep the placeholder and allow another recovery later. */ }
    })).then(() => { if (!this.disposed) this.updateWarnings(); }).finally(() => { this.recovery = null; });
    return this.recovery;
  }

  updateMetadata(location: Location, objects: readonly WorldObject[]) {
    this.location = location; this.lighting.setAmbient(location.ambientLight ?? 1);
    this.objects = objects;
    for (const object of objects) {
      const drawable = this.drawables.get(object.id);
      if (drawable) { drawable.object = object; drawable.mesh.userData.object = object; }
    }
  }

  private async image(material: THREE.MeshLambertMaterial, id: string | null, width: number, height: number, name: string) {
    if (!id) return;
    await this.bindImage(id, name, image => {
      if (material.map && this.textures.delete(material.map)) material.map.dispose();
      material.map = this.assets.tiled(image.texture, width, height); this.textures.add(material.map);
      material.color.set('#ffffff'); material.needsUpdate = true;
    });
  }

  async load() {
    const pending: Promise<unknown>[] = [];
    for (const part of roomGeometry(this.location)) {
      this.geometries.add(part.geometry);
      if (this.editor && part.kind === 'ceiling') continue;
      const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.paperColor).multiplyScalar(part.shade), side: THREE.DoubleSide, transparent: this.editor && part.kind === 'wall', opacity: this.editor && part.kind === 'wall' ? .2 : 1, depthWrite: !(this.editor && part.kind === 'wall') }); this.materials.add(material);
      const mesh = new THREE.Mesh(part.geometry, material); mesh.position.set(...part.position); mesh.rotation.set(...part.rotation); this.scene.add(mesh); this.occluders.push(mesh);
      if (this.editor && part.kind === 'wall') { const geometry = new THREE.EdgesGeometry(mesh.geometry); const lineMaterial = new THREE.LineBasicMaterial({ color: '#615b50' }); this.geometries.add(geometry); this.materials.add(lineMaterial); mesh.add(new THREE.LineSegments(geometry, lineMaterial)); }
      pending.push(this.image(material, part.assetId, part.width, part.height, { floor: 'пол', ceiling: 'потолок', wall: 'стены' }[part.kind]));
    }
    for (let index = 0; index < this.objects.length; index++) pending.push(this.addDrawable(this.objects[index], index));
    this.previewLights();
    await Promise.all(pending);
    if (this.disposed) throw new DOMException('Просмотр закрыт', 'AbortError');
  }

  private async addDrawable(object: WorldObject, index: number) {
      const geometry = new THREE.PlaneGeometry(1, 1); this.geometries.add(geometry);
      const material = new THREE.MeshLambertMaterial({ map: this.assets.placeholder(index + 1), side: THREE.DoubleSide, alphaTest: 20 / 255 }); this.materials.add(material);
      this.textures.add(material.map!);
      const root = new THREE.Group(); root.position.set(...object.transform.position); root.rotation.set(...object.transform.rotation); root.scale.set(...object.transform.scale); root.userData.objectId = object.id; this.scene.add(root);
      const mesh = new THREE.Mesh(geometry, material); mesh.position.y = .5; root.add(mesh);
      mesh.userData = { object, alpha: null, ready: !object.imageAssetId } satisfies SpriteData;
      const drawable = { object, root, mesh, aspect: null as number | null }; this.drawables.set(object.id, drawable); this.sprites.push(mesh);
      if (object.imageAssetId) {
        await this.bindImage(object.imageAssetId, object.name, image => {
          drawable.aspect = image.aspect;
          if (material.map && this.textures.delete(material.map)) material.map.dispose();
          material.map = image.texture; material.needsUpdate = true; mesh.userData.alpha = image.alpha;
        });
        if (!this.disposed) mesh.userData.ready = true;
      }
  }

  async syncObjects(objects: WorldObject[]) {
    if (this.disposed) return;
    const pending: Promise<void>[] = [];
    for (const object of objects) {
      const drawable = this.drawables.get(object.id);
      if (!drawable) pending.push(this.addDrawable(object, this.drawables.size));
      else { drawable.object = object; drawable.mesh.userData.object = object; drawable.root.position.set(...object.transform.position); }
    }
    this.setPresence(new Set(objects.map(o => o.id)));
    await Promise.all(pending);
  }

  updateEffects(effects: ObjectEffect[], pose: EffectPose) { return this.lighting.update(effects, pose); }
  private previewLights(camera?: THREE.PerspectiveCamera) {
    if (!this.editor) return;
    this.lighting.update(this.objects.filter(object => object.light?.enabled).map(object => ({ id: object.id, name: object.name, position: (this.drawables.get(object.id)?.root.position.toArray() ?? object.transform.position) as [number, number, number], carried: false, light: object.light!, sound: null })), { position: camera ? camera.position.toArray() as [number, number, number] : this.location.spawn.position, yaw: this.location.spawn.yaw, pitch: 0 });
  }
  align(camera: THREE.PerspectiveCamera) {
    this.previewLights(camera);
    for (const drawable of this.drawables.values()) {
      if (drawable.aspect) {
        const width = Math.max(.01, drawable.root.scale.x), height = Math.max(.01, drawable.root.scale.y);
        const drawnHeight = Math.min(height, width / drawable.aspect), drawnWidth = drawnHeight * drawable.aspect;
        drawable.mesh.scale.set(drawnWidth / width, drawnHeight / height, 1); drawable.mesh.position.y = drawnHeight / height / 2;
      }
      alignBillboard(drawable.root, camera, drawable.object.billboard);
    }
    this.scene.updateMatrixWorld(true);
  }

  setPresence(ids: Set<string>) { for (const { object, root, mesh } of this.drawables.values()) { root.visible = ids.has(object.id); mesh.visible = root.visible && (this.editor || !!object.imageAssetId || (!object.light && !object.spatialAudio)); } }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.lighting.dispose(); this.scene.clear();
    for (const geometry of this.geometries) geometry.dispose(); for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose(); this.textures.clear();
    for (const lease of this.images.values()) lease.release(); this.images.clear(); this.bindings.clear(); this.missing.clear(); if (this.ownsAssets) this.assets.dispose();
    this.geometries.clear(); this.materials.clear(); this.drawables.clear(); this.sprites.length = 0; this.occluders.length = 0;
  }
}
