import type { Project, WorldObject } from './project';
import type { GameState } from './game-state';
import { evaluateCondition } from './conditions';
import { presentObjects } from './spatial';

export type LightSettings = NonNullable<WorldObject['light']>;
export type SpatialSoundSettings = NonNullable<WorldObject['spatialAudio']>;
export type EffectPose = { position: [number, number, number]; yaw: number; pitch: number };
export type ObjectEffect = { id: string; name: string; position: [number, number, number]; carried: boolean; light: LightSettings | null; sound: SpatialSoundSettings | null };
export function defaultLight(): LightSettings { return { enabled: true, color: '#ffe2b5', intensity: 10, distance: 8, offset: [0, 1.3, 0], portable: true, condition: null }; }
export function defaultSpatialSound(): SpatialSoundSettings { return { enabled: true, assetId: null, volume: .6, loop: true, near: 1, far: 10, offset: [0, 1, 0], portable: true, condition: null }; }
export function objectEffects(project: Project, state: GameState): ObjectEffect[] {
  const sources = project.objects.filter(object => object.light || object.spatialAudio);
  if (!sources.length) return [];
  const visible = new Set(presentObjects(sources, state, state.locationId, project).map(object => object.id));
  return sources.flatMap(object => {
    const item = object.interaction.itemDefinitionId ? state.items['instance-' + object.id] : null;
    let carried = false, position: [number, number, number] = [...object.transform.position];
    if (item) {
      if (item.owner.type === 'inventory') carried = state.player.inventory[state.player.activeSlot] === item.id;
      else if (item.owner.type === 'equipment') carried = true;
      else if (item.owner.type === 'world') {
        if (item.owner.locationId !== state.locationId || (!item.owner.dropped && !visible.has(object.id))) return [];
        position = [...item.owner.position];
      }
      if (item.owner.type === 'container' || (item.owner.type !== 'world' && !carried)) return [];
    } else if (!visible.has(object.id)) return [];
    const light = object.light?.enabled && (!carried || object.light.portable) && evaluateCondition(object.light.condition, state, project) ? object.light : null;
    const sound = object.spatialAudio?.enabled && object.spatialAudio.assetId && (!carried || object.spatialAudio.portable) && evaluateCondition(object.spatialAudio.condition, state, project) ? object.spatialAudio : null;
    return light || sound ? [{ id: object.id, name: object.name, position, carried, light, sound }] : [];
  });
}
export function effectPosition(effect: ObjectEffect, offset: [number, number, number], pose: EffectPose): [number, number, number] {
  if (!effect.carried) return effect.position.map((value, index) => value + offset[index]) as [number, number, number];
  const sin = Math.sin(pose.yaw), cos = Math.cos(pose.yaw);
  return [pose.position[0] - sin * .4 + cos * offset[0] + sin * offset[2], pose.position[1] - 1.65 + offset[1], pose.position[2] - cos * .4 - sin * offset[0] + cos * offset[2]];
}
