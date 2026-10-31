import * as THREE from 'three';
import type { GameState } from '../engine/game-state';
import type { WorldObject, Project } from '../engine/project';

export type AlphaMask = { width: number; height: number; values: Uint8Array };
export type SpriteData = { object: WorldObject; alpha: AlphaMask | null; ready: boolean };
export type Target = { objectId: string; canTake: boolean };

export function opaqueAt(mask: AlphaMask | null, uv: { x: number; y: number } | undefined, threshold = 20) {
  if (!mask) return true;
  if (!uv || !Number.isFinite(uv.x) || !Number.isFinite(uv.y) || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return false;
  const x = Math.min(mask.width - 1, Math.floor(uv.x * mask.width));
  const y = Math.min(mask.height - 1, Math.floor((1 - uv.y) * mask.height));
  return mask.values[y * mask.width + x] >= threshold;
}

const center = new THREE.Vector2(0, 0);
export function pickTarget(camera: THREE.PerspectiveCamera, sprites: THREE.Mesh[], walls: THREE.Object3D[], raycaster: THREE.Raycaster): Target | null {
  raycaster.near = 0; raycaster.far = 10;
  raycaster.setFromCamera(center, camera);
  const blockingDistance = raycaster.intersectObjects(walls, false)[0]?.distance ?? Infinity;
  for (const hit of raycaster.intersectObjects(sprites.filter(s => s.visible), false)) {
    if (hit.distance >= blockingDistance - 1e-5) return null;
    const data = hit.object.userData as SpriteData;
    if (!data.ready || !opaqueAt(data.alpha, hit.uv)) continue;
    if (hit.distance > data.object.interaction.reach) return null;
    return { objectId: data.object.id, canTake: data.object.interaction.canTake };
  }
  return null;
}

export function contextAction(project: Project, state: GameState, target: Target | null): 'take' | 'interact' | 'ordinaryInteract' | null {
  if (!target) return null;
  const selected = state.items[state.player.inventory[state.player.activeSlot] ?? ''];
  const definition = project.items.find(i => i.id === selected?.definitionId);
  if (definition && project.rules.some(r => r.trigger === 'useItem' && (!r.targetObjectId || r.targetObjectId === target.objectId) && (!r.itemDefinitionId || r.itemDefinitionId === definition.id) && (!r.itemTag || definition.tags.includes(r.itemTag)))) return 'interact';
  return target.canTake ? 'take' : 'ordinaryInteract';
}
