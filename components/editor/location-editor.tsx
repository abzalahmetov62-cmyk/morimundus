'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Copy, LoaderCircle, Map, MousePointer2, Plus, SquareDashed, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { EditProject } from '@/lib/editor/use-project';
import { addObject, addRoom, createReturnDoor, deleteObject, deleteRoom, setObjectKind, setObjectImage, spatialIssues, type Room } from '@/lib/editor/spatial-operations';
import type { Location, Project, WorldObject } from '@/lib/engine/project';
import type { Point2 } from '@/lib/engine/spatial';
import type { TestPose } from '@/lib/editor/test-tools';
import { ProjectMap, type MapTool } from './project-map';
import { ObjectProperties, objectKinds } from './object-properties';
import { RoomProperties } from './room-properties';
import { LocationProperties, SpawnProperties } from './location-properties';
import { NumberField } from './number-field';
import { createScript } from '@/lib/editor/script-operations';

const SpatialView = dynamic(() => import('./spatial-view'), { ssr: false, loading: () => <div className="spatial-opening"><LoaderCircle className="animate-spin" />Открываю объёмный вид…</div> });
type Props = { project: Project; location: Location; objects: WorldObject[]; selectedId: string | null; onSelect: (id: string | null) => void; edit: EditProject; onOpenLocation: (id: string, selectedId?: string) => void; onOpenScript: (id: string) => void; onCopy: () => void; onPaste: () => void; canPaste: boolean; onTestPose: (pose: TestPose) => void };

export function LocationEditor({ project, location, objects, selectedId, onSelect, edit, onOpenLocation, onOpenScript, onCopy, onPaste, canPaste, onTestPose }: Props) {
  const [mode, setMode] = useState('plan'), [tool, setTool] = useState<MapTool>('select'), [kind, setKind] = useState<WorldObject['kind']>('prop');
  const [roomId, setRoomId] = useState<string | null>(null), [spawnSelected, setSpawnSelected] = useState(false), [deleting, setDeleting] = useState<'object' | 'room' | null>(null), [addingRoom, setAddingRoom] = useState(false);
  const [roomX, setRoomX] = useState(0), [roomZ, setRoomZ] = useState(0), [roomWidth, setRoomWidth] = useState(2), [roomDepth, setRoomDepth] = useState(2);
  const selected = objects.find(o => o.id === selectedId), room = location.rooms.find(r => r.id === roomId);
  const issues = useMemo(() => spatialIssues(project, location), [project, location]);
  useEffect(() => { if (selectedId) { setRoomId(null); setSpawnSelected(false); } }, [selectedId]);
  function apply(update: (p: Project) => Project, group?: string) {
    try { edit(update, group); return true; }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Не удалось изменить пространство'); return false; }
  }
  const select = (id: string | null) => { setRoomId(null); setSpawnSelected(false); onSelect(id); };
  const selectRoom = (id: string) => { onSelect(null); setSpawnSelected(false); setRoomId(id); };
  const selectSpawn = () => { onSelect(null); setRoomId(null); setSpawnSelected(true); };
  const updateLocation = (patch: Partial<Location>, group?: string) => apply(p => ({ ...p, locations: p.locations.map(l => l.id === location.id ? { ...l, ...patch } : l) }), group);
  const updateRoom = (patch: Partial<Room>) => { if (room) updateLocation({ rooms: location.rooms.map(r => r.id === room.id ? { ...r, ...patch } : r) }); };
  const updateObject = (patch: Partial<WorldObject>, group?: string) => { if (selected) apply(p => ({ ...p, objects: p.objects.map(o => o.id === selected.id ? { ...o, ...patch } : o), items: patch.name !== undefined && selected.kind === 'item' ? p.items.map(i => i.id === selected.interaction.itemDefinitionId ? { ...i, name: patch.name! } : i) : p.items }), group); };
  const transformObject = (id: string, transform: WorldObject['transform']) => apply(p => ({ ...p, objects: p.objects.map(o => o.id === id ? { ...o, transform } : o) }));
  function createRoom(a: Point2, b: Point2) {
    let created: string | null = null;
    const done = apply(p => { const result = addRoom(p, location.id, a, b); created = result.id; return result.project; });
    if (done && created) { selectRoom(created); setTool('select'); } return done;
  }
  function createObject(point?: Point2) {
    let created: string | null = null;
    if (apply(p => { const result = addObject(p, location.id, kind, point); created = result.id; return result.project; }) && created) { select(created); setTool('select'); }
  }
  function setSpawn(point: Point2) {
    const floor = location.rooms.find(r => point.x >= r.origin[0] && point.x <= r.origin[0] + r.width && point.z >= r.origin[2] && point.z <= r.origin[2] + r.depth)?.origin[1] ?? location.rooms[0].origin[1];
    updateLocation({ spawn: { ...location.spawn, position: [point.x, floor + 1.65, point.z] } }); selectSpawn(); setTool('select');
  }
  const heading = selected?.name ?? (room ? `Комната ${location.rooms.indexOf(room) + 1}` : spawnSelected ? 'Начало героя' : location.name);
  const tools = [{ id: 'select' as const, label: 'Выбор', icon: MousePointer2 }, { id: 'room' as const, label: 'Нарисовать', icon: SquareDashed }, { id: 'spawn' as const, label: 'Герой', icon: UserRound }];
  return <div className="location-workspace spatial-workspace"><div className="location-canvas"><Tabs value={mode} onValueChange={value => { setMode(value); setTool('select'); }} className="spatial-tabs"><div className="spatial-canvas-header"><TabsList><TabsTrigger value="plan"><Map size={16} />План</TabsTrigger><TabsTrigger value="volume"><Box size={16} />Объём</TabsTrigger></TabsList><div className="spatial-selection-actions"><Button variant="ghost" size="sm" onClick={onCopy} disabled={!selected} aria-label="Копировать объект"><Copy /></Button><Button variant="ghost" size="sm" onClick={onPaste} disabled={!canPaste}>Вставить</Button><Button variant="ghost" size="sm" disabled={!selected && !room} onClick={() => setDeleting(selected ? 'object' : 'room')} aria-label="Удалить выбранный элемент"><Trash2 /></Button></div></div>
      <div className="spatial-tools">{mode === 'plan' && tools.map(item => <Button key={item.id} size="sm" variant={tool === item.id ? 'secondary' : 'ghost'} onClick={() => setTool(item.id)} aria-pressed={tool === item.id}><item.icon />{item.label}</Button>)}<Select value={kind} onValueChange={value => setKind(value as WorldObject['kind'])}><SelectTrigger className="object-kind-picker" aria-label="Вид нового объекта"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(objectKinds).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><Button size="sm" variant={tool === 'object' ? 'secondary' : 'outline'} onClick={() => mode === 'plan' ? setTool('object') : createObject()}><Plus />Объект</Button>{mode === 'plan' && <Button size="sm" variant="ghost" onClick={() => { const r = location.rooms.at(-1)!; setRoomX(r.origin[0] + r.width); setRoomZ(r.origin[2]); setAddingRoom(true); }}>Комната по размерам</Button>}</div>
      <TabsContent value="plan"><ProjectMap location={location} objects={objects} selectedId={selected?.id ?? null} selectedRoomId={room?.id ?? null} spawnSelected={spawnSelected} tool={tool} onSelect={select} onRoomSelect={selectRoom} onSpawnSelect={selectSpawn} onCreateRoom={createRoom} onPlaceObject={createObject} onSetSpawn={setSpawn} onMoveObject={(id, position) => { const o = objects.find(o => o.id === id); if (o) transformObject(id, { ...o.transform, position }); }} onCancel={() => setTool('select')} /></TabsContent><TabsContent value="volume"><SpatialView location={location} objects={objects} paperColor={project.settings.paperColor} selectedId={selected?.id ?? null} onSelect={select} onTransform={transformObject} onTest={onTestPose} /></TabsContent></Tabs>
      {issues.length > 0 && <div className="spatial-issues" role="status"><strong>Проверьте расположение</strong>{issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}
    </div><aside className="inspector spatial-inspector" aria-label="Свойства выбранного элемента"><div className="inspector-heading"><span className="section-eyebrow">{selected ? objectKinds[selected.kind] : room ? 'КОМНАТА' : spawnSelected ? 'ГЕРОЙ' : 'ЛОКАЦИЯ'}</span><h2>{heading}</h2>{(selected || room || spawnSelected) && <button type="button" className="text-action" onClick={() => select(null)}>К свойствам локации</button>}</div>
      {selected ? <ObjectProperties project={project} object={selected} update={updateObject} onOpenScript={onOpenScript} onCreateScript={() => { let created: string | null = null; if (apply(p => { const result = createScript(p, selected.name); created = result.id; return { ...result.project, objects: result.project.objects.map(o => o.id === selected.id ? { ...o, interaction: { ...o.interaction, scriptId: result.id } } : o) }; }) && created) onOpenScript(created); }} onKind={kind => apply(p => setObjectKind(p, selected.id, kind))} onImage={imageAssetId => apply(p => setObjectImage(p, selected.id, imageAssetId))} onOpenLocation={onOpenLocation} onReturnDoor={() => { let result: { id: string; locationId: string } | null = null; if (apply(p => { const next = createReturnDoor(p, selected.id); result = next; return next.project; })) { toast.success('Обратная дверь создана. Сохраните проект.'); if (result) onOpenLocation((result as { locationId: string }).locationId, (result as { id: string }).id); } }} /> : room ? <RoomProperties project={project} room={room} update={updateRoom} /> : spawnSelected ? <SpawnProperties location={location} update={updateLocation} /> : <LocationProperties project={project} location={location} update={updateLocation} onStart={() => apply(p => ({ ...p, settings: { ...p.settings, startLocationId: location.id } }))} onRoomSelect={selectRoom} />}
    </aside>
    <Dialog open={addingRoom} onOpenChange={setAddingRoom}><DialogContent className="spatial-form-dialog"><form onSubmit={e => { e.preventDefault(); if (createRoom({ x: roomX, z: roomZ }, { x: roomX + roomWidth, z: roomZ + roomDepth })) setAddingRoom(false); }}><DialogHeader><DialogTitle>Комната по размерам</DialogTitle><DialogDescription>Общая граница соседних комнат образует проход.</DialogDescription></DialogHeader><div className="two-number-fields"><NumberField id="new-room-x" label="X, м" value={roomX} onCommit={setRoomX} /><NumberField id="new-room-z" label="Z, м" value={roomZ} onCommit={setRoomZ} /><NumberField id="new-room-width" label="Ширина, м" value={roomWidth} min={.5} max={100} onCommit={setRoomWidth} /><NumberField id="new-room-depth" label="Глубина, м" value={roomDepth} min={.5} max={100} onCommit={setRoomDepth} /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setAddingRoom(false)}>Отмена</Button><Button type="submit">Добавить комнату</Button></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить {deleting === 'object' ? `«${selected?.name}»` : 'комнату'}?</AlertDialogTitle><AlertDialogDescription>{deleting === 'room' ? 'Объекты сохранят свои позиции. Если начало героя окажется вне оставшихся комнат, оно будет перенесено. ' : ''}Изменение можно отменить в мастерской. Используемые в других сценариях объекты защищены от удаления.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={e => { const done = deleting === 'object' && selected ? apply(p => deleteObject(p, selected.id)) : deleting === 'room' && room ? apply(p => deleteRoom(p, location.id, room.id)) : false; if (!done) e.preventDefault(); else { setDeleting(null); select(null); } }}>Удалить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
