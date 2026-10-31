'use client';

import { useState } from 'react';
import { Copy, DoorOpen, FlaskConical, Map, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Project } from '@/lib/engine/project';
import { NumberField } from './number-field';
import { LocationThumbnail } from './location-thumbnail';

type Props = { project: Project; onOpen: (id: string) => void; onTest: (id: string) => void; onCreate: (name: string, width: number, depth: number, height: number) => boolean; onDuplicate: (id: string) => void; onDelete: (id: string) => boolean };
export function LocationLibrary({ project, onOpen, onTest, onCreate, onDuplicate, onDelete }: Props) {
  const [creating, setCreating] = useState(false), [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState('Новая локация'), [width, setWidth] = useState(6), [depth, setDepth] = useState(5), [height, setHeight] = useState(2.8);
  const deleted = project.locations.find(l => l.id === deleting);
  return <div className="location-library"><div className="library-toolbar"><p>Локации и двери между ними</p><Button onClick={() => { setName('Новая локация'); setWidth(6); setDepth(5); setHeight(2.8); setCreating(true); }}><Plus />Новая локация</Button></div>
    <div className="location-library-grid">{project.locations.map(location => {
      const objects = project.objects.filter(o => o.locationId === location.id), doors = objects.filter(o => o.transition);
      const incoming = project.objects.filter(o => o.transition?.locationId === location.id).length;
      return <article className="location-card" key={location.id}><button type="button" className="location-card-plan" onClick={() => onOpen(location.id)} aria-label={`Редактировать ${location.name}`}><LocationThumbnail location={location} objects={objects} /></button><div className="location-card-body"><div className="location-card-heading"><h2>{location.name}</h2>{project.settings.startLocationId === location.id && <span className="location-start-badge">Начальная</span>}</div><p className="location-card-meta">Комнат: {location.rooms.length} · Объектов: {objects.length} · Входов: {incoming}</p><div className="location-links">{doors.map(door => <div key={door.id}><DoorOpen size={14} /><span>{door.name} → {project.locations.find(l => l.id === door.transition!.locationId)?.name}</span></div>)}{!doors.length && <span className="location-card-meta">Переходов: 0</span>}</div><div className="location-card-actions"><Button size="sm" variant="outline" onClick={() => onOpen(location.id)}><Map />Открыть</Button><Button size="sm" variant="ghost" onClick={() => onTest(location.id)} aria-label={`Проверить ${location.name}`}><FlaskConical /></Button><Button size="sm" variant="ghost" onClick={() => onDuplicate(location.id)} aria-label={`Копировать локацию ${location.name}`}><Copy /></Button><Button size="sm" variant="ghost" disabled={project.locations.length <= 1} onClick={() => setDeleting(location.id)} aria-label={`Удалить локацию ${location.name}`}><Trash2 /></Button></div></div></article>;
    })}</div>
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent className="spatial-form-dialog"><form onSubmit={e => { e.preventDefault(); if (onCreate(name, width, depth, height)) setCreating(false); }}><DialogHeader><DialogTitle>Новая локация</DialogTitle><DialogDescription>Начнём с одной комнаты. План можно расширить и соединить проходами.</DialogDescription></DialogHeader><div className="form-field"><Label htmlFor="new-location-name">Название</Label><Input id="new-location-name" value={name} maxLength={160} required onChange={e => setName(e.target.value)} /></div><div className="vector-fields"><NumberField id="new-location-width" label="Ширина, м" value={width} min={.5} max={100} onCommit={setWidth} /><NumberField id="new-location-depth" label="Глубина, м" value={depth} min={.5} max={100} onCommit={setDepth} /><NumberField id="new-location-height" label="Потолок, м" value={height} min={1.9} max={20} step={.1} onCommit={setHeight} /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Отмена</Button><Button type="submit">Создать локацию</Button></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={!!deleted} onOpenChange={open => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить «{deleted?.name}»?</AlertDialogTitle><AlertDialogDescription>Комнаты и объекты этой локации будут удалены. Входящие двери потеряют назначение. Изменение можно отменить в мастерской.{deleted?.id === project.settings.startLocationId ? ' Начальной станет первая оставшаяся локация.' : ''}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={e => { if (deleted && !onDelete(deleted.id)) e.preventDefault(); else setDeleting(null); }}>Удалить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
