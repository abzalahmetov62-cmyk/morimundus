'use client';
import { Lightbulb, Volume2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Project, WorldObject } from '@/lib/engine/project';
import { defaultLight, defaultSpatialSound, type LightSettings, type SpatialSoundSettings } from '@/lib/engine/object-effects';
import { AssetPicker } from './asset-picker';
import { ConditionEditor } from './condition-editor';
import { NumberField, VectorFields } from './number-field';

export function ObjectEffectsEditor({ project, object, update }: { project: Project; object: WorldObject; update: (patch: Partial<WorldObject>) => void }) {
  const light = object.light, sound = object.spatialAudio;
  const updateLight = (patch: Partial<LightSettings>) => update({ light: { ...(light ?? defaultLight()), ...patch } });
  const updateSound = (patch: Partial<SpatialSoundSettings>) => update({ spatialAudio: { ...(sound ?? defaultSpatialSound()), ...patch } });
  return <>
    <div className="inspector-section"><h3><Lightbulb size={16} />Источник света</h3><div className="collision-toggle"><Label htmlFor="object-light-enabled">Излучать свет</Label><Switch id="object-light-enabled" checked={!!light?.enabled} onCheckedChange={enabled => updateLight({ enabled })} /></div>
      {light?.enabled && <><div className="form-field"><Label htmlFor="object-light-color">Цвет света</Label><Input id="object-light-color" type="color" value={light.color} onChange={event => updateLight({ color: event.target.value })} /></div>
        <NumberField id="object-light-intensity" label="Яркость" value={light.intensity} min={0} max={100} step={.5} onCommit={intensity => updateLight({ intensity })} />
        <NumberField id="object-light-distance" label="Дальность света, м" value={light.distance} min={.1} max={200} step={.1} onCommit={distance => updateLight({ distance })} />
        <h4>Смещение от основания объекта, м</h4><VectorFields prefix="object-light-offset" labels={['X', 'Высота Y', 'Z']} value={light.offset} onCommit={offset => updateLight({ offset })} />
        {object.interaction.itemDefinitionId && <div className="collision-toggle"><Label htmlFor="object-light-portable">Светить в выбранной ячейке и экипировке</Label><Switch id="object-light-portable" checked={light.portable} onCheckedChange={portable => updateLight({ portable })} /></div>}
        <ConditionEditor project={project} label="Когда свет включён" value={light.condition} onChange={condition => updateLight({ condition })} />
        <p className="field-help">Свет перемещается вместе с объектом. Фоновая освещённость задаётся в свойствах локации: уменьши её для тёмной комнаты.</p>
      </>}
    </div>
    <div className="inspector-section"><h3><Volume2 size={16} />Пространственный звук</h3><div className="collision-toggle"><Label htmlFor="object-spatial-enabled">Звучать из положения объекта</Label><Switch id="object-spatial-enabled" checked={!!sound?.enabled} onCheckedChange={enabled => updateSound({ enabled })} /></div>
      {sound?.enabled && <><AssetPicker project={project} kind="audio" id="object-spatial-audio" label="Звуковой файл" value={sound.assetId} onChange={assetId => updateSound({ assetId })} />
        <NumberField id="object-spatial-volume" label="Громкость источника" value={sound.volume} min={0} max={1} step={.05} onCommit={volume => updateSound({ volume })} />
        <NumberField id="object-spatial-near" label="Полная громкость до, м" value={sound.near} min={.1} max={sound.far - .1} step={.1} onCommit={near => updateSound({ near })} />
        <NumberField id="object-spatial-far" label="Полностью затихает на, м" value={sound.far} min={sound.near + .1} max={200} step={.1} onCommit={far => updateSound({ far })} />
        <div className="collision-toggle"><Label htmlFor="object-spatial-loop">Повторять запись</Label><Switch id="object-spatial-loop" checked={sound.loop} onCheckedChange={loop => updateSound({ loop })} /></div>
        <h4>Смещение от основания объекта, м</h4><VectorFields prefix="object-spatial-offset" labels={['X', 'Высота Y', 'Z']} value={sound.offset} onCommit={offset => updateSound({ offset })} />
        {object.interaction.itemDefinitionId && <div className="collision-toggle"><Label htmlFor="object-spatial-portable">Звучать в выбранной ячейке и экипировке</Label><Switch id="object-spatial-portable" checked={sound.portable} onCheckedChange={portable => updateSound({ portable })} /></div>}
        <ConditionEditor project={project} label="Когда источник звучит" value={sound.condition} onChange={condition => updateSound({ condition })} />
        <p className="field-help">Между двумя расстояниями звук плавно затихает. Направление меняется при повороте героя. Для лампы или звука без видимого предмета оставь рисунок пустым.</p>
      </>}
    </div>
  </>;
}
