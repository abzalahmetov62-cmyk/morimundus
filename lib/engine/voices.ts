import type { Project, Voice } from './project';

export const builtinVoiceIds = ['super-ego', 'ego', 'ono'] as const;
const superEgoSampleIds = ['super-ego-01', 'super-ego-02', 'super-ego-03', 'super-ego-04', 'super-ego-05', 'super-ego-06', 'super-ego-07', 'super-ego-08'] as const;
const egoSampleIds = ['ego-01', 'ego-02', 'ego-03', 'ego-04', 'ego-05'] as const;
const onoSampleIds = ['ono-01', 'ono-02', 'ono-03', 'ono-04'] as const;
export const builtinVoiceSampleIds = [...superEgoSampleIds, ...egoSampleIds, ...onoSampleIds] as const;
export const builtinVoiceSamples = [
  ...superEgoSampleIds.map((id, index) => ({ id, name: 'СУПЕР-ЭГО · сэмпл ' + (index + 1), url: '/voices/super-ego/' + String(index + 1).padStart(2, '0') + '.wav' })),
  ...egoSampleIds.map((id, index) => ({ id, name: 'ЭГО · сэмпл ' + (index + 1), url: '/voices/ego/' + String(index + 1).padStart(2, '0') + '.wav' })),
  ...onoSampleIds.map((id, index) => ({ id, name: 'ОНО · сэмпл ' + (index + 1), url: '/voices/ono/' + String(index + 1).padStart(2, '0') + '.wav' })),
];
export type PlayableVoice = { id: string; name: string; imageAssetId: string | null; samples: { key: string; url: string }[]; rate: number; pitchVariation: number; volumeVariation: number; intervalSeconds: number };
export const builtinVoiceDefinitions: readonly Voice[] = [{
  id: 'super-ego', name: 'СУПЕР-ЭГО', imageAssetId: null,
  samples: superEgoSampleIds.map(builtinSampleId => ({ builtinSampleId })),
  rate: 1, pitchVariation: .8, volumeVariation: .12, intervalSeconds: .10,
}, {
  id: 'ego', name: 'ЭГО', imageAssetId: null,
  samples: egoSampleIds.map(builtinSampleId => ({ builtinSampleId })),
  rate: 1, pitchVariation: .8, volumeVariation: .12, intervalSeconds: .10,
}, {
  id: 'ono', name: 'ОНО', imageAssetId: null,
  samples: onoSampleIds.map(builtinSampleId => ({ builtinSampleId })),
  rate: 1, pitchVariation: .8, volumeVariation: .12, intervalSeconds: .10,
}];
export function playableVoice(voice: Voice): PlayableVoice {
  return { ...voice, samples: voice.samples.map(sample => 'assetId' in sample
    ? { key: sample.assetId, url: '/api/assets/' + encodeURIComponent(sample.assetId) }
    : { key: sample.builtinSampleId, url: builtinVoiceSamples.find(builtin => builtin.id === sample.builtinSampleId)!.url }) };
}
export const builtinVoices: readonly PlayableVoice[] = builtinVoiceDefinitions.map(playableVoice);
export function voiceDefinitions(project: Pick<Project, 'voices'>): Voice[] {
  const definitions = new Map(builtinVoiceDefinitions.map(voice => [voice.id, voice]));
  for (const voice of project.voices ?? []) definitions.set(voice.id, voice);
  return [...definitions.values()];
}
export function voiceProfiles(project: Pick<Project, 'voices'>): PlayableVoice[] { return voiceDefinitions(project).map(playableVoice); }
export function findVoice(project: Pick<Project, 'voices'>, id: string | null | undefined) { return id ? voiceProfiles(project).find(voice => voice.id === id) ?? null : null; }
export function hasGameAudio(project: Project) { return project.assets.some(asset => asset.kind === 'audio') || project.scripts.some(script => script.nodes.some(node => node.paragraphs.some(paragraph => paragraph.voiceId))); }
