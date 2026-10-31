import type { GameState } from './game-state';

export function emitAudio(state: GameState, assetId: string | null, volume = 1) {
  if (!assetId) return;
  if (state.audio.eventSequence >= Number.MAX_SAFE_INTEGER) throw new Error('Слишком много звуковых событий');
  state.audio.eventSequence++;
  state.audio.events.push({ id: state.audio.eventSequence, assetId, volume });
  state.audio.events = state.audio.events.slice(-64);
}

export function narrativeAudio(state: GameState, assetId: string | null, loop = false, volume = 1) {
  state.audio.interactionTrackId = assetId; state.audio.interactionLoop = loop; state.audio.interactionVolume = volume;
  state.audio.interactionSequence++; state.audio.interactionOffset = 0;
}
