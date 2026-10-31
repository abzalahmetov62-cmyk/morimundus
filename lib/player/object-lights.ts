import * as THREE from 'three';
import { effectPosition, type EffectPose, type ObjectEffect } from '../engine/object-effects';

export class ObjectLights {
  readonly ambient: THREE.AmbientLight;
  private lights = new Map<string, THREE.PointLight>();
  private signature = '';
  constructor(private scene: THREE.Scene, ambient: number) {
    this.ambient = new THREE.AmbientLight('#ffffff', Math.PI * ambient); scene.add(this.ambient);
  }
  setAmbient(value: number) { this.ambient.intensity = Math.PI * value; }
  update(effects: ObjectEffect[], pose: EffectPose): boolean {
    const active = effects.filter(effect => effect.light?.enabled && effect.light.intensity > 0).map(effect => ({ effect, position: effectPosition(effect, effect.light!.offset, pose) })).sort((a, b) => Math.hypot(...a.position.map((value, i) => value - pose.position[i])) - Math.hypot(...b.position.map((value, i) => value - pose.position[i]))).slice(0, 8);
    const signature = JSON.stringify(active.map(({ effect, position }) => [effect.id, position, effect.light!.color, effect.light!.intensity, effect.light!.distance]));
    if (signature === this.signature) return false; this.signature = signature;
    const ids = new Set(active.map(({ effect }) => effect.id));
    for (const [id, light] of this.lights) if (!ids.has(id)) { light.removeFromParent(); light.dispose(); this.lights.delete(id); }
    for (const { effect, position } of active) {
      const settings = effect.light!; let light = this.lights.get(effect.id);
      if (!light) { light = new THREE.PointLight(); this.lights.set(effect.id, light); this.scene.add(light); }
      light.position.set(...position); light.color.set(settings.color); light.intensity = settings.intensity; light.distance = settings.distance; light.decay = 2;
    }
    return true;
  }
  dispose() { for (const light of this.lights.values()) { light.removeFromParent(); light.dispose(); } this.lights.clear(); this.ambient.removeFromParent(); }
}
