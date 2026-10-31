import type { Project } from '../engine/project';
import type { GameState } from '../engine/game-state';
import { presentObjects } from '../engine/spatial';

export function locationImages(project: Project, locationId: string) {
  const location = project.locations.find(l => l.id === locationId);
  return [...new Set([...(location?.rooms.flatMap(r => [r.floorAssetId, r.wallAssetId, r.ceilingAssetId]) ?? []), ...project.objects.filter(o => o.locationId === locationId).map(o => o.imageAssetId)].filter((id): id is string => !!id))];
}
export function nearbyLocations(project: Project, locationId: string, state?: GameState) {
  const objects = state ? presentObjects(project.objects, state, locationId, project) : project.objects.filter(o => o.locationId === locationId);
  const doors = objects.filter(o => o.transition && o.transition.locationId !== locationId);
  if (state) doors.sort((a, b) => Math.hypot(a.transform.position[0] - state.player.position[0], a.transform.position[2] - state.player.position[2]) - Math.hypot(b.transform.position[0] - state.player.position[0], b.transform.position[2] - state.player.position[2]));
  return [...new Set(doors.map(o => o.transition!.locationId))].slice(0, 2);
}
export function transitionImages(project: Project, state: GameState) { return [...new Set(nearbyLocations(project, state.locationId, state).flatMap(id => locationImages(project, id)))]; }
export function transitionAudio(project: Project, locationId: string) {
  return [...new Set(nearbyLocations(project, locationId).flatMap(id => { const audio = project.locations.find(l => l.id === id)?.audio; return [audio?.musicAssetId, audio?.ambienceAssetId]; }).filter((id): id is string => !!id))];
}
