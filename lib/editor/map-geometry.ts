import type { Location, WorldObject } from '../engine/project';

export function mapBounds(location: Location, objects: readonly WorldObject[] = [], margin = 1) {
  const xs = location.rooms.flatMap(r => [r.origin[0], r.origin[0] + r.width]);
  const zs = location.rooms.flatMap(r => [r.origin[2], r.origin[2] + r.depth]);
  for (const o of objects) { xs.push(o.transform.position[0]); zs.push(o.transform.position[2]); }
  xs.push(location.spawn.position[0]); zs.push(location.spawn.position[2]);
  return { x: Math.min(...xs) - margin, z: Math.min(...zs) - margin, width: Math.max(...xs) - Math.min(...xs) + margin * 2, depth: Math.max(...zs) - Math.min(...zs) + margin * 2 };
}
