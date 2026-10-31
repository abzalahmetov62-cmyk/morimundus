'use client';

import { useId, useRef, useState } from 'react';
import type { Location, WorldObject } from '@/lib/engine/project';
import { buildWalls, type Point2 } from '@/lib/engine/spatial';
import { mapBounds } from '@/lib/editor/map-geometry';
import { rectangle, snap } from '@/lib/editor/spatial-operations';

export type MapTool = 'select' | 'room' | 'object' | 'spawn';
type Gesture = { type: 'room'; start: Point2; current: Point2 } | { type: 'object'; id: string; start: Point2; current: Point2; original: [number, number, number] };
type Props = { location: Location; objects: WorldObject[]; selectedId: string | null; selectedRoomId: string | null; spawnSelected: boolean; tool: MapTool; onSelect: (id: string | null) => void; onRoomSelect: (id: string) => void; onSpawnSelect: () => void; onCreateRoom: (a: Point2, b: Point2) => void; onPlaceObject: (p: Point2) => void; onSetSpawn: (p: Point2) => void; onMoveObject: (id: string, position: [number, number, number]) => void; onCancel: () => void };

export function ProjectMap(props: Props) {
  const { location, objects, tool } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const pattern = useId().replaceAll(':', '_');
  const bounds = mapBounds(location, objects, 3);
  const wallSegments = buildWalls(location.rooms);
  const preview = gesture?.type === 'room' ? rectangle(gesture.start, gesture.current) : null;
  function point(event: React.PointerEvent<SVGElement>) {
    const element = svg.current, matrix = element?.getScreenCTM();
    if (!element || !matrix) return null;
    const p = element.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const local = p.matrixTransform(matrix.inverse()); return { x: local.x, z: local.y };
  }
  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const p = point(event); if (!p) return;
    event.preventDefault(); event.currentTarget.focus();
    if (tool === 'room') { event.currentTarget.setPointerCapture(event.pointerId); const a = { x: snap(p.x), z: snap(p.z) }; setGesture({ type: 'room', start: a, current: a }); }
    else if (tool === 'object') props.onPlaceObject({ x: snap(p.x), z: snap(p.z) });
    else if (tool === 'spawn') props.onSetSpawn({ x: snap(p.x), z: snap(p.z) });
    else props.onSelect(null);
  }
  function finish(event: React.PointerEvent<SVGSVGElement>) {
    if (!gesture) return;
    const p = point(event) ?? gesture.current;
    if (gesture.type === 'room') props.onCreateRoom(gesture.start, { x: snap(p.x), z: snap(p.z) });
    else {
      const dx = snap(p.x - gesture.start.x), dz = snap(p.z - gesture.start.z);
      if (dx || dz) props.onMoveObject(gesture.id, [gesture.original[0] + dx, gesture.original[1], gesture.original[2] + dz]);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setGesture(null);
  }
  const instruction = { select: 'Выбирай комнаты и объекты. Объект можно перетащить.', room: 'Протяни прямоугольник комнаты. Общая граница станет проходом.', object: 'Щёлкни по плану, чтобы разместить объект.', spawn: 'Щёлкни по полу, чтобы поставить начало героя.' }[tool];
  return <div className="map-board spatial-map-board"><div className="map-heading"><span>ПЛАН ЛОКАЦИИ</span><span>Сетка 0,25 м</span></div>
    <svg ref={svg} role="group" tabIndex={0} aria-label={`Редактор плана: ${location.name}. ${instruction}`} viewBox={`${bounds.x} ${bounds.z} ${bounds.width} ${bounds.depth}`} className={`location-map tool-${tool}`} onPointerDown={start} onPointerMove={e => { const p = point(e); if (!p) return; setCursor({ x: snap(p.x), z: snap(p.z) }); if (gesture) setGesture({ ...gesture, current: gesture.type === 'room' ? { x: snap(p.x), z: snap(p.z) } : p }); }} onPointerUp={finish} onPointerCancel={() => setGesture(null)} onKeyDown={e => { if (e.key === 'Escape') { setGesture(null); props.onCancel(); } }}>
      <defs><pattern id={pattern} width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0 H 0 V .25" fill="none" stroke="#302e2a" strokeOpacity=".09" strokeWidth=".012" /></pattern></defs>
      <rect x={bounds.x} y={bounds.z} width={bounds.width} height={bounds.depth} fill={`url(#${pattern})`} />
      {location.rooms.map((room, i) => <g key={room.id} role="button" tabIndex={0} aria-label={`Комната ${i + 1}, ${room.width} на ${room.depth} метров`} onPointerDown={e => { if (tool === 'select') { e.stopPropagation(); props.onRoomSelect(room.id); } }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onRoomSelect(room.id); } }}>
        <rect x={room.origin[0]} y={room.origin[2]} width={room.width} height={room.depth} fill={props.selectedRoomId === room.id ? '#d8c5b2' : '#f3ede4'} fillOpacity=".75" stroke={props.selectedRoomId === room.id ? '#873b31' : '#9c9282'} strokeWidth=".025" strokeDasharray=".12 .08" />
        <text x={room.origin[0] + room.width / 2} y={room.origin[2] + .3} textAnchor="middle" fontSize=".2" fill="#756d60" pointerEvents="none">{i + 1} · {room.width} × {room.depth} м</text>
      </g>)}
      {wallSegments.map((wall, i) => <line key={i} x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} stroke="#403d38" strokeWidth=".07" pointerEvents="none" />)}
      {objects.map((object, index) => {
        const moving = gesture?.type === 'object' && gesture.id === object.id ? gesture : null;
        const x = object.transform.position[0] + (moving ? snap(moving.current.x - moving.start.x) : 0), z = object.transform.position[2] + (moving ? snap(moving.current.z - moving.start.z) : 0);
        return <g key={object.id} className="map-object" role="button" tabIndex={0} aria-label={`Выбрать ${object.name}`} onPointerDown={e => {
          if (tool !== 'select' || e.button !== 0) return;
          const p = point(e); if (!p || !svg.current) return; e.stopPropagation(); e.preventDefault(); props.onSelect(object.id); svg.current.setPointerCapture(e.pointerId); svg.current.focus(); setGesture({ type: 'object', id: object.id, start: p, current: p, original: [...object.transform.position] });
        }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(object.id); } }}>
          {object.collision.solid && <circle cx={x} cy={z} r={object.collision.radius} fill="#a39683" fillOpacity=".15" stroke="#867761" strokeWidth=".025" strokeDasharray=".08 .06" />}
          <circle cx={x} cy={z} r=".22" fill={props.selectedId === object.id ? '#953e32' : '#35342f'} />
          <text x={x} y={z + .065} textAnchor="middle" fontSize=".17" fill="#f5efe5" pointerEvents="none">{index + 1}</text>
        </g>;
      })}
      <g role="button" tabIndex={0} aria-label="Начальная позиция героя" onPointerDown={e => { if (tool === 'select') { e.stopPropagation(); props.onSpawnSelect(); } }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSpawnSelect(); } }} transform={`translate(${location.spawn.position[0]} ${location.spawn.position[2]}) rotate(${-location.spawn.yaw * 180 / Math.PI})`}>
        <circle r=".22" fill="#f5f0e9" stroke={props.spawnSelected ? '#873b31' : '#a39683'} strokeWidth=".035" /><path d="M -.12 .12 L 0 -.16 L .12 .12 Z" fill="#873b31" />
      </g>
      {preview && <rect x={preview.x} y={preview.z} width={preview.width} height={preview.depth} fill="#873b31" fillOpacity=".12" stroke="#873b31" strokeWidth=".04" strokeDasharray=".1 .07" pointerEvents="none" />}
    </svg><div className="map-legend"><span>{instruction}</span><span>{cursor ? `X ${cursor.x} · Z ${cursor.z}` : 'Esc — отменить инструмент'}</span></div>
  </div>;
}
