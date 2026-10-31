import type { Object3D, PerspectiveCamera } from 'three';
import type { WorldObject } from '../engine/project';

export function alignBillboard(mesh: Object3D, camera: PerspectiveCamera, mode: WorldObject['billboard']) {
  if (mode === 'vertical') mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
  else if (mode === 'camera') mesh.quaternion.copy(camera.quaternion);
}
