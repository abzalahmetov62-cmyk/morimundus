import type { Project, Trait } from './project';
import type { GameState } from './game-state';
import { effectiveTraitValue } from './conditions';

export const defaultTypewriter = { enabled: true, charactersPerSecond: 35, soundAssetId: null, volume: .25 } satisfies NonNullable<Project['settings']['typewriter']>;
export function traitImage(trait: Trait, value: number) {
  return trait.imageVariants?.find(variant => variant.value === value)?.imageAssetId ?? trait.imageRanges?.find(range => range.min <= value && value <= range.max)?.imageAssetId ?? trait.imageAssetId ?? null;
}
export function traitFraction(trait: Trait, value: number) {
  if (trait.max === trait.min) return value >= trait.max ? 1 : 0;
  return Math.max(0, Math.min(1, (value - trait.min) / (trait.max - trait.min)));
}
export function traitDetails(project: Project, state: GameState, kind: 'stats' | 'skills', trait: Trait) {
  const base = state.player[kind][trait.id] ?? 0, total = effectiveTraitValue(project, state, kind, trait.id) ?? base;
  const equipment = Object.values(state.player.equipment).flatMap(id => {
    const definition = id ? project.items.find(d => d.id === state.items[id]?.definitionId) : null;
    const value = definition?.modifiers[trait.id] ?? 0;
    return value ? [{ name: definition!.name, value }] : [];
  });
  const statuses = project.character.statuses.filter(s => state.player.statuses.includes(s.id) && s.modifiers[trait.id]).map(s => ({ name: s.name, value: s.modifiers[trait.id] }));
  return { base, total, bonuses: [...equipment, ...statuses] };
}
