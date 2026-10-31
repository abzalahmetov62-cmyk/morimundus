import type { Location, WorldObject, Project } from './project';
import type { GameState } from './game-state';
import { evaluateCondition, objectIsPresent } from './conditions';

export type Point2 = { x: number; z: number };
export type Vector3 = [number, number, number];
export type Wall = { start: Point2; end: Point2; bottom: number; height: number; roomId: string };
export type CollisionWorld = { rooms: Location['rooms']; walls: Wall[]; obstacles: { id: string; x: number; z: number; radius: number }[] };
export const PLAYER_RADIUS = 0.22;
export const WALK_SPEED = 2.2;
const EPSILON = 1e-7;

function inRoom(point: Point2, room: Location['rooms'][number]) {
  return point.x >= room.origin[0] && point.x <= room.origin[0] + room.width && point.z >= room.origin[2] && point.z <= room.origin[2] + room.depth;
}

export function buildWalls(rooms: Location['rooms']): Wall[] {
  const walls = new Map<string, Wall>();
  for (const room of rooms) {
    const [x, y, z] = room.origin;
    const edges = [
      { axis: 'x', fixed: z, from: x, to: x + room.width, direction: -1 },
      { axis: 'x', fixed: z + room.depth, from: x, to: x + room.width, direction: 1 },
      { axis: 'z', fixed: x, from: z, to: z + room.depth, direction: -1 },
      { axis: 'z', fixed: x + room.width, from: z, to: z + room.depth, direction: 1 },
    ];
    for (const edge of edges) {
      const cuts = new Set([edge.from, edge.to]);
      for (const other of rooms) {
        const values = edge.axis === 'x' ? [other.origin[0], other.origin[0] + other.width] : [other.origin[2], other.origin[2] + other.depth];
        for (const value of values) if (value > edge.from && value < edge.to) cuts.add(value);
      }
      const points = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const midpoint = (a + b) / 2;
        const outside = edge.axis === 'x' ? { x: midpoint, z: edge.fixed + edge.direction * EPSILON } : { x: edge.fixed + edge.direction * EPSILON, z: midpoint };
        if (rooms.some(other => inRoom(outside, other))) continue;
        const start = edge.axis === 'x' ? { x: a, z: edge.fixed } : { x: edge.fixed, z: a };
        const end = edge.axis === 'x' ? { x: b, z: edge.fixed } : { x: edge.fixed, z: b };
        const key = `${start.x},${start.z}:${end.x},${end.z}`;
        if (!walls.has(key)) walls.set(key, { start, end, bottom: y, height: room.height, roomId: room.id });
      }
    }
  }
  return [...walls.values()];
}

export function distanceToWallSquared(point: Point2, wall: Wall) {
  const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
  const denominator = dx * dx + dz * dz;
  const amount = denominator ? Math.max(0, Math.min(1, ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / denominator)) : 0;
  return (point.x - wall.start.x - amount * dx) ** 2 + (point.z - wall.start.z - amount * dz) ** 2;
}

export function collisionWorld(location: Location, objects: WorldObject[]): CollisionWorld {
  return { rooms: location.rooms, walls: buildWalls(location.rooms), obstacles: objects.filter(o => o.collision.solid && o.collision.radius > 0).map(o => ({ id: o.id, x: o.transform.position[0], z: o.transform.position[2], radius: o.collision.radius })) };
}

export function presentObjects(objects: readonly WorldObject[], state: GameState, locationId = state.locationId, project?: Project) {
  return objects.filter(o => { const owner = state.items['instance-' + o.id]?.owner; return o.locationId === locationId && objectIsPresent(project, state, o.id) && evaluateCondition(o.visibleWhen, state, project) && (!o.interaction.itemDefinitionId || (owner?.type === 'world' && !owner.dropped && owner.locationId === locationId)); });
}

export function assertArrival(location: Location, objects: WorldObject[], position: Vector3) {
  if (!position.every(Number.isFinite) || !canStandAt({ x: position[0], z: position[2] }, collisionWorld(location, objects))) throw new Error('Точка появления находится в стене, препятствии или за пределами комнаты.');
  if (!location.rooms.some(r => inRoom({ x: position[0], z: position[2] }, r) && position[1] > r.origin[1] + .05 && position[1] < r.origin[1] + r.height - .05)) throw new Error('Высота точки появления должна находиться между полом и потолком.');
}

export function canStandAt(point: Point2, world: CollisionWorld, radius = PLAYER_RADIUS) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || !Number.isFinite(radius) || radius <= 0) return false;
  if (!world.rooms.some(room => inRoom(point, room))) return false;
  if (world.walls.some(wall => distanceToWallSquared(point, wall) < radius * radius - EPSILON)) return false;
  return !world.obstacles.some(o => (point.x - o.x) ** 2 + (point.z - o.z) ** 2 < (radius + o.radius) ** 2 - EPSILON);
}

export function movePlayer(position: Vector3, displacement: Point2, world: CollisionWorld, radius = PLAYER_RADIUS): Vector3 {
  const length = Math.hypot(displacement.x, displacement.z);
  if (!Number.isFinite(length) || length > 25) throw new Error('Неверное перемещение игрока');
  if (!canStandAt({ x: position[0], z: position[2] }, world, radius)) return [...position];
  const steps = Math.max(1, Math.ceil(length / (radius * .35)));
  const dx = displacement.x / steps, dz = displacement.z / steps;
  let x = position[0], z = position[2];
  for (let i = 0; i < steps; i++) {
    if (canStandAt({ x: x + dx, z }, world, radius)) x += dx;
    if (canStandAt({ x, z: z + dz }, world, radius)) z += dz;
  }
  return [x, position[1], z];
}

export function walkDisplacement(keys: ReadonlySet<string>, yaw: number, seconds: number, stick: { x: number; y: number } = { x: 0, y: 0 }): Point2 {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) - stick.y;
  const side = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + stick.x;
  const length = Math.hypot(forward, side);
  if (!length) return { x: 0, z: 0 };
  const scale = WALK_SPEED * Math.max(0, Math.min(.1, seconds)) / Math.max(1, length);
  return { x: (side * Math.cos(yaw) - forward * Math.sin(yaw)) * scale, z: (-side * Math.sin(yaw) - forward * Math.cos(yaw)) * scale };
}

export function turnView(yaw: number, pitch: number, movementX: number, movementY: number, sensitivity = .002) {
  if (![yaw, pitch, movementX, movementY, sensitivity].every(Number.isFinite)) return { yaw, pitch };
  const nextYaw = yaw - movementX * sensitivity;
  return { yaw: Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw)), pitch: Math.max(-Math.PI / 2 + .015, Math.min(Math.PI / 2 - .015, pitch - movementY * sensitivity)) };
}
