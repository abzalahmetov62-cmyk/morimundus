'use client';

import { useId } from 'react';
import type { Location, WorldObject } from '@/lib/engine/project';
import type { Point2 } from '@/lib/engine/spatial';
import { buildWalls } from '@/lib/engine/spatial';
import { mapBounds } from '@/lib/editor/map-geometry';
import { snap } from '@/lib/editor/spatial-operations';

export function LocationThumbnail({ location, objects = [], point, onPick }: { location: Location; objects?: WorldObject[]; point?: [number, number, number]; onPick?: (point: Point2) => void }) {
  const pattern = useId().replaceAll(':', '_');
  const bounds = mapBounds(location, objects);
  return <svg className={`location-thumbnail ${onPick ? 'is-pickable' : ''}`} viewBox={`${bounds.x} ${bounds.z} ${bounds.width} ${bounds.depth}`} role="img" aria-label={`План: ${location.name}`} onClick={onPick ? e => { const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return; const p = e.currentTarget.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const local = p.matrixTransform(matrix.inverse()); onPick({ x: snap(local.x), z: snap(local.y) }); } : undefined}>
    <defs><pattern id={pattern} width=".5" height=".5" patternUnits="userSpaceOnUse"><path d="M .5 0 H 0 V .5" fill="none" stroke="#49433a" strokeOpacity=".12" strokeWidth=".012" /></pattern></defs>
    {location.rooms.map(r => <rect key={r.id} x={r.origin[0]} y={r.origin[2]} width={r.width} height={r.depth} fill={`url(#${pattern})`} />)}
    {buildWalls(location.rooms).map((w, i) => <line key={i} x1={w.start.x} y1={w.start.z} x2={w.end.x} y2={w.end.z} stroke="#49433a" strokeWidth=".07" />)}
    {objects.map(o => <circle key={o.id} cx={o.transform.position[0]} cy={o.transform.position[2]} r=".12" fill={o.transition ? '#873b31' : '#6c655a'} />)}
    <circle cx={(point ?? location.spawn.position)[0]} cy={(point ?? location.spawn.position)[2]} r=".14" fill="#873b31" stroke="#f5f0e9" strokeWidth=".035" />
  </svg>;
}
