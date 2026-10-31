'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Project, Trait } from '@/lib/engine/project';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AssetPicker } from './asset-picker';
import { NumberField } from './number-field';
import { TraitVisual } from '@/components/player/trait-panel';

export function TraitPresentationEditor({ project, trait, kind, onChange }: { project: Project; trait: Trait; kind: 'stats' | 'skills'; onChange: (patch: Partial<Trait>) => void }) {
  const [previewValue, setPreviewValue] = useState<number | null>(null), value = previewValue ?? trait.initial;
  const variants = trait.imageVariants ?? [];
  function addVariant() {
    let value = Math.ceil(trait.initial);
    while (variants.some(v => v.value === value)) value++;
    onChange({ imageVariants: [...variants, { value, imageAssetId: null }] });
  }
  return <div className="trait-presentation-editor">
    <div className="form-field"><Label htmlFor={'trait-description-' + kind + '-' + trait.id}>Описание для игрока</Label><Textarea id={'trait-description-' + kind + '-' + trait.id} rows={3} maxLength={5000} value={trait.description ?? ''} onChange={e => onChange({ description: e.target.value })} /></div>
    {kind === 'stats' ? <div className="trait-art-fields"><AssetPicker id={'trait-frame-' + kind + '-' + trait.id} label="Рамка / основа шкалы" kind="image" project={project} value={trait.barAssets?.frameAssetId ?? null} onChange={frameAssetId => onChange({ barAssets: { frameAssetId, fillAssetId: trait.barAssets?.fillAssetId ?? null } })} /><AssetPicker id={'trait-fill-' + kind + '-' + trait.id} label="Текстура заполнения шкалы" kind="image" project={project} value={trait.barAssets?.fillAssetId ?? null} onChange={fillAssetId => onChange({ barAssets: { fillAssetId, frameAssetId: trait.barAssets?.frameAssetId ?? null } })} /><p className="field-help">Пока текстуры не назначены, шкала остаётся пустой. Заполнение раскрывается по значению от минимума до максимума; рамка накладывается поверх.</p></div> : <>
      <AssetPicker id={'trait-image-' + kind + '-' + trait.id} label="Основное изображение навыка" kind="image" project={project} value={trait.imageAssetId ?? null} onChange={imageAssetId => onChange({ imageAssetId })} />
      <div className="section-title"><h4>Изображения по значениям</h4><Button size="sm" variant="outline" disabled={variants.length >= 100} onClick={addVariant}><Plus />Вариант</Button></div>
      {variants.map((variant, index) => <div className="trait-image-variant" key={index}><NumberField id={'trait-variant-value-' + kind + '-' + trait.id + '-' + index} label="Точное значение" value={variant.value} onCommit={value => { if (variants.some((v, i) => i !== index && v.value === value)) { toast.error('Для этого значения уже есть вариант.'); return; } onChange({ imageVariants: variants.map((v, i) => i === index ? { ...v, value } : v) }); }} /><AssetPicker id={'trait-variant-image-' + kind + '-' + trait.id + '-' + index} label="Изображение" kind="image" project={project} value={variant.imageAssetId} onChange={imageAssetId => onChange({ imageVariants: variants.map((v, i) => i === index ? { ...v, imageAssetId } : v) })} /><Button size="icon" variant="ghost" aria-label="Удалить вариант изображения" onClick={() => onChange({ imageVariants: variants.filter((_, i) => i !== index) })}><Trash2 /></Button></div>)}
      <p className="field-help">Сравнивается итоговое значение с бонусами одежды и статусов, без округления. При отсутствии подходящего варианта показывается основное изображение.</p>
    </>}
    <details className="trait-preview"><summary>Предпросмотр карточки</summary><NumberField id={'trait-preview-' + kind + '-' + trait.id} label="Значение в предпросмотре" value={value} onCommit={setPreviewValue} /><TraitVisual trait={trait} value={value} kind={kind} /></details>
  </div>;
}
