'use client';
import type { Project } from '@/lib/engine/project';
import type { Room } from '@/lib/editor/spatial-operations';
import { NumberField } from './number-field';
import { AssetPicker } from './asset-picker';

export function RoomProperties({ project, room, update }: { project: Project; room: Room; update: (patch: Partial<Room>) => void }) {
  return <><div className="inspector-section"><h3>Положение на плане, м</h3><div className="two-number-fields"><NumberField id="room-x" label="X" value={room.origin[0]} onCommit={x => update({ origin: [x, room.origin[1], room.origin[2]] })} /><NumberField id="room-z" label="Z" value={room.origin[2]} onCommit={z => update({ origin: [room.origin[0], room.origin[1], z] })} /></div><h3>Размер комнаты, м</h3><div className="two-number-fields"><NumberField id="room-width" label="Ширина" value={room.width} min={.5} max={100} onCommit={width => update({ width })} /><NumberField id="room-depth" label="Глубина" value={room.depth} min={.5} max={100} onCommit={depth => update({ depth })} /></div><NumberField id="room-height" label="Высота потолка, м" value={room.height} min={1.9} max={20} step={.1} onCommit={height => update({ height })} /><p className="field-help">Соприкасающиеся прямоугольники образуют общее пространство. Узкий прямоугольник можно использовать как коридор.</p></div>
    <div className="inspector-section"><h3>Поверхности</h3><AssetPicker id="room-floor" label="Пол" value={room.floorAssetId} kind="image" project={project} onChange={floorAssetId => update({ floorAssetId })} /><AssetPicker id="room-wall" label="Стены" value={room.wallAssetId} kind="image" project={project} onChange={wallAssetId => update({ wallAssetId })} /><AssetPicker id="room-ceiling" label="Потолок" value={room.ceilingAssetId} kind="image" project={project} onChange={ceilingAssetId => update({ ceilingAssetId })} /></div>
    <div className="inspector-section"><dl className="property-list"><div><dt>Идентификатор</dt><dd><code>{room.id}</code></dd></div></dl></div></>;
}
