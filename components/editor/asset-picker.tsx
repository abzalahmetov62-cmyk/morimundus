'use client';
import type { Project } from '@/lib/engine/project';
import { ResourceSelect } from './resource-select';

export function AssetPicker({ id, label, value, kind, project, onChange }: { id: string; label: string; value: string | null; kind: 'image' | 'audio'; project: Project; onChange: (value: string | null) => void }) {
  return <ResourceSelect id={id} label={label} value={value} options={project.assets.filter(asset => asset.kind === kind).map(asset => ({ value: asset.id, label: asset.name }))} onChange={onChange} />;
}
