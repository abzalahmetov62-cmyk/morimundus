import * as THREE from 'three';
import type { Location } from '../engine/project';
import { buildWalls } from '../engine/spatial';

export type RoomPart = { kind: 'floor' | 'ceiling' | 'wall'; geometry: THREE.BufferGeometry; position: [number, number, number]; rotation: [number, number, number]; assetId: string | null; width: number; height: number; shade: number };

export function roomGeometry(location: Location): RoomPart[] {
  const parts: RoomPart[] = [];
  for (const room of location.rooms) {
    const center: [number, number, number] = [room.origin[0] + room.width / 2, room.origin[1], room.origin[2] + room.depth / 2];
    parts.push({ kind: 'floor', geometry: new THREE.PlaneGeometry(room.width, room.depth), position: center, rotation: [-Math.PI / 2, 0, 0], assetId: room.floorAssetId, width: room.width, height: room.depth, shade: .79 });
    parts.push({ kind: 'ceiling', geometry: new THREE.PlaneGeometry(room.width, room.depth), position: [center[0], center[1] + room.height, center[2]], rotation: [Math.PI / 2, 0, 0], assetId: room.ceilingAssetId, width: room.width, height: room.depth, shade: .91 });
  }
  for (const wall of buildWalls(location.rooms)) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, width = Math.hypot(dx, dz);
    parts.push({ kind: 'wall', geometry: new THREE.BoxGeometry(width, wall.height, .05), position: [(wall.start.x + wall.end.x) / 2, wall.bottom + wall.height / 2, (wall.start.z + wall.end.z) / 2], rotation: [0, -Math.atan2(dz, dx), 0], assetId: location.rooms.find(r => r.id === wall.roomId)!.wallAssetId, width, height: wall.height, shade: Math.abs(dx) > Math.abs(dz) ? .97 : .88 });
  }
  return parts;
}
