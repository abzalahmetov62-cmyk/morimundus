import { SpatialObjectAudio } from './spatial-audio';
import type { EffectPose, ObjectEffect } from '../engine/object-effects';
import type { GameState, PauseReason } from '../engine/game-state';
import type { Project } from '../engine/project';
import { ResourcePool, type ResourceLease } from './resource-pool';
import { CharacterVoice } from './character-voice';
import { findVoice, hasGameAudio } from '../engine/voices';
import { transitionAudio } from './resource-plan';

export type AudioView = { locationId: string; audio: GameState['audio']; pausedBy: PauseReason[] };
type ChannelName = 'music' | 'ambience' | 'narrative';
type Channel = { key: string; assetId: string; loop: boolean; volume: number; offset: number; paused: boolean; source: AudioBufferSourceNode | null; gain: GainNode | null; buffer: AudioBuffer | null; resource: ResourceLease<AudioBuffer> | null; startedAt: number; loading: boolean; failed: boolean; ended: boolean };
type Presentation = { reading: boolean; hidden: boolean; effectsPaused: boolean };
type Options = { contextFactory?: () => AudioContext; load?: (context: AudioContext, assetId: string, signal: AbortSignal) => Promise<AudioBuffer>; onStatus?: (enabled: boolean, muted: boolean) => void; onError?: (message: string) => void };

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<ChannelName, Channel>();
  private effects = new Map<number, Channel>();
  private cache = new ResourcePool<AudioBuffer>({ load: (id, signal) => this.loadBuffer(id, signal), bytes: buffer => Number.isFinite(buffer.length) && Number.isFinite(buffer.numberOfChannels) ? buffer.length * buffer.numberOfChannels * 4 : 0, dispose: () => {}, idleCount: 6, concurrency: 2 });
  private warmedLocation: string | null = null;
  private lifetime = new AbortController();
  private seenEvent: number;
  private disposed = false;
  private muted = false;
  private characterVoice: CharacterVoice | null = null;
  private voiceId: string | null = null;
  private spatial: SpatialObjectAudio | null = null;
  private spatialFrame: { effects: ObjectEffect[]; pose: EffectPose } | null = null;
  private typingAssetId: string | null = null;
  private typingResource: ResourceLease<AudioBuffer> | null = null;
  private typingBuffer: AudioBuffer | null = null;
  private typingFailed = false;
  private typingSources = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  private lastTyping = -Infinity;
  private view: AudioView;
  private presentation: Presentation = { reading: false, hidden: false, effectsPaused: true };

  constructor(private project: Project, initial: AudioView, private writePosition: (channel: ChannelName, key: string, offset: number) => void, private options: Options = {}) {
    this.view = initial; this.seenEvent = initial.audio.eventSequence;
  }

  async unlock() {
    if (this.disposed) return;
    if (!hasGameAudio(this.project)) return;
    try {
      if (!this.context) {
        this.context = this.options.contextFactory ? this.options.contextFactory() : new AudioContext();
        this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.context.destination);
        this.characterVoice = new CharacterVoice(this.context, this.master, { onError: this.options.onError });
        this.spatial = new SpatialObjectAudio(this.context, this.master, { acquire: id => this.cache.acquire(id), onError: this.options.onError });
        if (this.spatialFrame) this.spatial.update(this.spatialFrame.effects, this.spatialFrame.pose);
        this.context.onstatechange = () => { if (!this.disposed) { this.options.onStatus?.(this.context?.state === 'running', this.muted); this.refresh(); } };
      }
      await this.context.resume();
      if (this.disposed) return;
      if (this.context.state !== 'running') throw new Error('Браузер приостановил звук. Нажми «Повторить звук».');
      this.options.onStatus?.(true, this.muted); this.refresh(); this.preloadNearby(); this.prepareTyping(); this.characterVoice?.prepare(findVoice(this.project, this.voiceId));
    } catch (cause) { if (!this.disposed) { this.options.onStatus?.(false, this.muted); this.options.onError?.(cause instanceof Error ? cause.message : 'Не удалось включить звук'); } }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopTyping();
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    this.options.onStatus?.(this.context?.state === 'running', muted);
  }

  retry() {
    this.typingFailed = false; this.characterVoice?.retry(); this.spatial?.retry();
    for (const channel of [...this.channels.values(), ...this.effects.values()]) channel.failed = false;
    void this.unlock();
  }

  syncSpatial(effects: ObjectEffect[], pose: EffectPose) { if (this.disposed) return; this.spatialFrame = { effects, pose }; this.spatial?.update(effects, pose); }
  prepareVoice(voiceId: string | null) { this.voiceId = voiceId; this.characterVoice?.prepare(findVoice(this.project, voiceId)); }
  voicePulse(text: string, volume: number) {
    if (this.disposed || this.muted || !this.presentation.reading || this.presentation.hidden || this.presentation.effectsPaused) return;
    this.characterVoice?.pulse(text, volume);
  }

  prepareTyping(assetId = this.project.settings.typewriter?.soundAssetId ?? null) {
    if (this.disposed || !this.context) return;
    if (this.typingAssetId === assetId && (this.typingResource || this.typingFailed)) return;
    this.stopTyping(); this.typingResource?.release(); this.typingResource = null; this.typingBuffer = null; this.typingFailed = false; this.typingAssetId = assetId;
    if (!assetId) return;
    const lease = this.cache.acquire(assetId); this.typingResource = lease;
    void lease.promise.then(buffer => { if (!this.disposed && this.typingResource === lease) this.typingBuffer = buffer; }).catch(cause => {
      lease.release();
      if (!this.disposed && this.typingResource === lease) { this.typingResource = null; this.typingFailed = true; this.options.onError?.('Не удалось загрузить звук печати: ' + (cause instanceof Error ? cause.message : 'ошибка звука')); }
    });
  }

  typingClick(assetId: string | null, volume: number) {
    if (this.disposed || this.muted || this.context?.state !== 'running' || !this.master || this.presentation.hidden || this.presentation.effectsPaused || !assetId || volume <= 0) return;
    this.prepareTyping(assetId);
    if (!this.typingBuffer || this.context.currentTime - this.lastTyping < .07) return;
    this.lastTyping = this.context.currentTime;
    if (this.typingSources.size >= 3) { const first = this.typingSources.values().next().value; if (first) this.stopTypingSource(first); }
    const source = this.context.createBufferSource(), gain = this.context.createGain(), entry = { source, gain };
    source.buffer = this.typingBuffer; gain.gain.value = Math.max(0, Math.min(1, volume)); source.connect(gain); gain.connect(this.master);
    this.typingSources.add(entry); source.onended = () => { this.typingSources.delete(entry); source.disconnect(); gain.disconnect(); };
    source.start(0, 0, Math.min(.12, this.typingBuffer.duration));
  }
  private stopTypingSource(entry: { source: AudioBufferSourceNode; gain: GainNode }) {
    this.typingSources.delete(entry); entry.source.onended = null; try { entry.source.stop(); } catch {} entry.source.disconnect(); entry.gain.disconnect();
  }
  stopTyping() { this.characterVoice?.stop(); for (const entry of this.typingSources) this.stopTypingSource(entry); }

  sync(view: AudioView, presentation: Presentation) {
    if (this.disposed) return;
    this.view = view; this.presentation = presentation;
    if (!presentation.reading) this.characterVoice?.stop();
    const location = this.project.locations.find(l => l.id === view.locationId)!;
    const paused = presentation.hidden || view.pausedBy.length > 0;
    this.configure('music', view.locationId + ':' + view.audio.locationTrackId, view.audio.locationTrackId, true, location.audio.volume, view.audio.offset, paused);
    this.configure('ambience', view.locationId + ':' + view.audio.ambienceTrackId, view.audio.ambienceTrackId, true, location.audio.volume, view.audio.ambienceOffset, paused);
    this.configure('narrative', String(view.audio.interactionSequence), view.audio.interactionTrackId, view.audio.interactionLoop, view.audio.interactionVolume, view.audio.interactionOffset, presentation.hidden || presentation.effectsPaused);
    for (const event of view.audio.events) {
      if (event.id <= this.seenEvent) continue;
      this.seenEvent = event.id;
      if (this.effects.size >= 8) { const oldest = this.effects.entries().next().value; if (oldest) { this.discard(oldest[1]); this.effects.delete(oldest[0]); } }
      this.effects.set(event.id, this.channel(String(event.id), event.assetId, false, event.volume, 0, presentation.hidden || presentation.effectsPaused));
    }
    this.refresh(); this.preloadNearby();
  }

  private channel(key: string, assetId: string, loop: boolean, volume: number, offset: number, paused: boolean): Channel {
    return { key, assetId, loop, volume, offset, paused, source: null, gain: null, buffer: null, resource: null, startedAt: 0, loading: false, failed: false, ended: false };
  }
  private configure(name: ChannelName, key: string, assetId: string | null, loop: boolean, volume: number, offset: number, paused: boolean) {
    let channel = this.channels.get(name);
    if (channel && (channel.key !== key || channel.assetId !== assetId)) { this.capture(name, channel); this.discard(channel); this.channels.delete(name); channel = undefined; }
    if (!assetId) return;
    if (!channel) { channel = this.channel(key, assetId, loop, volume, offset, paused); this.channels.set(name, channel); }
    if (channel.loop !== loop && channel.source && this.context) { channel.offset = this.position(channel); channel.startedAt = this.context.currentTime; channel.source.loop = loop; }
    channel.loop = loop; channel.paused = paused; channel.volume = volume;
    if (channel.gain) channel.gain.gain.value = volume;
  }
  private position(channel: Channel) {
    const elapsed = channel.source && this.context ? Math.max(0, this.context.currentTime - channel.startedAt) : 0;
    const offset = channel.offset + elapsed, duration = channel.buffer?.duration;
    return duration ? channel.loop ? offset % duration : Math.min(offset, duration) : offset;
  }
  private capture(name: ChannelName, channel: Channel) { this.writePosition(name, channel.key, this.position(channel)); }
  capturePositions() { if (!this.disposed) for (const [name, channel] of this.channels) this.capture(name, channel); }
  private stop(channel: Channel) {
    if (!channel.source) return;
    channel.offset = this.position(channel);
    channel.source.onended = null;
    try { channel.source.stop(); } catch { /* The source may have ended between frames. */ }
    channel.source.disconnect(); channel.gain?.disconnect(); channel.source = null; channel.gain = null;
  }
  private discard(channel: Channel) { this.stop(channel); channel.resource?.release(); channel.resource = null; channel.buffer = null; }
  private async loadBuffer(assetId: string, resourceSignal: AbortSignal) {
    const signal = AbortSignal.any([resourceSignal, this.lifetime.signal, AbortSignal.timeout(15000)]), context = this.context!;
    const buffer = this.options.load ? await this.options.load(context, assetId, signal) : await (async () => { const response = await fetch('/api/assets/' + encodeURIComponent(assetId), { signal }); if (!response.ok) throw new Error('Звуковой файл недоступен'); return context.decodeAudioData(await response.arrayBuffer()); })();
    signal.throwIfAborted(); if (!buffer.duration || !Number.isFinite(buffer.duration)) throw new Error('Пустой звуковой файл'); return buffer;
  }
  private preloadNearby() {
    if (this.disposed || this.context?.state !== 'running' || this.warmedLocation === this.view.locationId) return;
    this.warmedLocation = this.view.locationId; this.cache.preload(transitionAudio(this.project, this.view.locationId));
  }
  private play(channel: Channel, onEnded?: () => void) {
    if (channel.paused || this.context?.state !== 'running') { this.stop(channel); return; }
    if (channel.source || channel.ended || channel.failed || channel.loading || !this.context || !this.master) return;
    if (!channel.buffer) {
      channel.loading = true;
      channel.resource?.release(); channel.resource = this.cache.acquire(channel.assetId);
      void channel.resource.promise.then(buffer => {
        if (this.disposed || ![...this.channels.values(), ...this.effects.values()].includes(channel)) return;
        if (!buffer.duration || !Number.isFinite(buffer.duration)) throw new Error('Пустой звуковой файл');
        channel.buffer = buffer; channel.loading = false; this.refresh();
      }).catch(cause => { channel.loading = false; channel.failed = true; if (!this.disposed && [...this.channels.values(), ...this.effects.values()].includes(channel)) this.options.onError?.('Не удалось воспроизвести «' + (this.project.assets.find(a => a.id === channel.assetId)?.name ?? channel.assetId) + '»: ' + (cause instanceof Error ? cause.message : 'ошибка звука')); });
      return;
    }
    if (!channel.loop && channel.offset >= channel.buffer.duration) { channel.ended = true; onEnded?.(); return; }
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = channel.buffer; source.loop = channel.loop; gain.gain.value = channel.volume;
    source.connect(gain); gain.connect(this.master); channel.source = source; channel.gain = gain;
    channel.startedAt = this.context.currentTime;
    source.onended = () => { if (channel.source !== source) return; channel.offset = channel.buffer!.duration; channel.ended = true; channel.source = null; channel.gain = null; source.disconnect(); gain.disconnect(); onEnded?.(); };
    source.start(0, channel.loop ? channel.offset % channel.buffer.duration : channel.offset);
  }
  private refresh() {
    if (this.disposed) return;
    if (this.presentation.hidden || this.presentation.effectsPaused) this.stopTyping();
    this.spatial?.setPaused(this.presentation.hidden || this.presentation.effectsPaused);
    for (const [name, channel] of this.channels) { this.play(channel); this.capture(name, channel); }
    for (const [id, channel] of this.effects) { channel.paused = this.presentation.hidden || this.presentation.effectsPaused; this.play(channel, () => { this.discard(channel); this.effects.delete(id); }); }
  }
  dispose() {
    if (this.disposed) return;
    this.spatial?.dispose(); this.spatial = null; this.spatialFrame = null;
    this.stopTyping(); this.characterVoice?.dispose(); this.characterVoice = null; this.typingResource?.release(); this.typingResource = null; this.typingBuffer = null;
    for (const [name, channel] of this.channels) { this.capture(name, channel); this.discard(channel); }
    for (const channel of this.effects.values()) this.discard(channel);
    this.disposed = true; this.lifetime.abort(); this.channels.clear(); this.effects.clear(); this.cache.dispose();
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
    this.master?.disconnect(); this.master = null;
  }
}
