'use client';
import { AssetImage } from './asset-image';
import { useState } from 'react';
import type { Project, Trait } from '@/lib/engine/project';
import type { GameState } from '@/lib/engine/game-state';
import { traitImage, traitFraction, traitDetails } from '@/lib/engine/presentation';
import { assetUrl } from '@/lib/storage/client';

export function TraitVisual({ trait, value, kind }: { trait: Trait; value: number; kind: 'stats' | 'skills' }) {
  if (kind === 'skills') {
    const image = traitImage(trait, value);
    return <div className="trait-portrait">{image ? <AssetImage key={image} src={assetUrl(image, 'game')} alt={trait.name} /> : <span className="trait-art-placeholder" aria-label={'Изображение навыка «' + trait.name + '» пока не задано'} />}</div>;
  }
  const fraction = traitFraction(trait, value), frame = trait.barAssets?.frameAssetId, fill = trait.barAssets?.fillAssetId;
  return <div className={'trait-scale' + (!frame && !fill ? ' is-placeholder' : '')} role="meter" aria-label={trait.name} aria-valuemin={trait.min} aria-valuemax={trait.max} aria-valuenow={Math.min(trait.max, Math.max(trait.min, value))} aria-valuetext={String(value)}>
    {fill && <div className="trait-scale-clip" style={{ width: fraction * 100 + '%' }}><AssetImage src={assetUrl(fill, 'game')} alt="" style={{ width: fraction > 0 ? 100 / fraction + '%' : '100%' }} /></div>}
    {frame && <AssetImage className="trait-scale-frame" src={assetUrl(frame, 'game')} alt="" />}
  </div>;
}

export function TraitPanel({ project, state, kind }: { project: Project; state: GameState; kind: 'stats' | 'skills' }) {
  const traits = project.character[kind], [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = traits.find(t => t.id === selectedId) ?? traits[0];
  if (!selected) return <p className="trait-empty">{kind === 'stats' ? 'Характеристики' : 'Навыки'} пока не заданы.</p>;
  const details = traitDetails(project, state, kind, selected);
  return <div className="trait-browser"><div className="trait-grid" aria-label={kind === 'stats' ? 'Характеристики героя' : 'Навыки героя'}>{traits.map(trait => {
    const value = traitDetails(project, state, kind, trait).total;
    return <button type="button" className={'trait-card' + (selected.id === trait.id ? ' is-selected' : '')} key={trait.id} aria-pressed={selected.id === trait.id} onClick={() => setSelectedId(trait.id)}><span className="trait-card-heading"><strong>{trait.name}</strong><span>{value}</span></span><TraitVisual trait={trait} value={value} kind={kind} /></button>;
  })}</div><aside className="trait-description"><div className="section-eyebrow">{kind === 'stats' ? 'ХАРАКТЕРИСТИКА' : 'НАВЫК'}</div><h3>{selected.name}</h3><strong className="trait-total">{details.total}</strong><p>{selected.description || 'Описание пока не задано.'}</p><dl className="trait-breakdown"><div><dt>Базовое значение</dt><dd>{details.base}</dd></div>{details.bonuses.map((bonus, i) => <div key={i}><dt>{bonus.name}</dt><dd>{bonus.value > 0 ? '+' : ''}{bonus.value}</dd></div>)}</dl></aside></div>;
}
