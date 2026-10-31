import type { PlayableVoice } from '../engine/voices';
import { ResourcePool, type ResourceLease } from './resource-pool';
import { abortable } from './asset-loading';

type Source = { source: AudioBufferSourceNode; gain: GainNode; stopping: boolean };
type Options = { load?: (context: AudioContext, url: string, signal: AbortSignal) => Promise<AudioBuffer>; random?: () => number; onError?: (message: string) => void };
export class VoiceCadence {
  private next = -Infinity;
  reset() { this.next = -Infinity; }
  pulse(text: string, now: number, interval: number) {
    const speak = /[\p{L}\p{N}]/u.test(text) && now >= this.next;
    if (speak) this.next = now + interval;
    if (/[.!?…]/u.test(text)) this.next = Math.max(this.next, now + .24);
    else if (/[,;:—]/u.test(text)) this.next = Math.max(this.next, now + .12);
    return speak;
  }
}
export class CharacterVoice {
  private ready: Promise<boolean> = Promise.resolve(true);
  private profile: PlayableVoice | null = null;
  private leases = new Map<string, ResourceLease<AudioBuffer>>();
  private buffers = new Map<string, AudioBuffer>();
  private sources = new Set<Source>();
  private cadence = new VoiceCadence();
  private lastSample = '';
  private disposed = false;
  private pool: ResourcePool<AudioBuffer>;
  constructor(private context: AudioContext, private output: AudioNode, private options: Options = {}) {
    this.pool = new ResourcePool({ load: async (url, lifetime) => {
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(20000)]);
      const buffer = options.load ? await options.load(context, url, signal) : await (async () => {
        const response = await fetch(url, { signal }); if (!response.ok) throw new Error('Сэмпл недоступен');
        return abortable(context.decodeAudioData(await response.arrayBuffer()), signal);
      })();
      signal.throwIfAborted(); if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Пустой сэмпл'); if (buffer.duration > 5) throw new Error('Для голоса нужны сэмплы до 5 секунд'); return buffer;
    }, bytes: buffer => buffer.length * buffer.numberOfChannels * 4, dispose() {}, idleCount: 20, idleBytes: 16 * 1024 * 1024, concurrency: 2 });
  }
  prepare(profile: PlayableVoice | null) {
    if (this.disposed) return Promise.resolve(false);
    if (JSON.stringify(this.profile) === JSON.stringify(profile)) return this.ready;
    this.stop(true); for (const lease of this.leases.values()) lease.release(); this.leases.clear(); this.buffers.clear(); this.profile = profile; this.lastSample = '';
    if (!profile) return this.ready = Promise.resolve(true);
    for (const sample of profile.samples) {
      const lease = this.pool.acquire(sample.url); this.leases.set(sample.url, lease);
      void lease.promise.then(buffer => { if (!this.disposed && this.profile === profile && this.leases.get(sample.url) === lease) this.buffers.set(sample.url, buffer); }).catch(() => {});
    }
    this.ready = Promise.allSettled([...this.leases.values()].map(lease => lease.promise)).then(() => {
      if (!this.disposed && this.profile === profile && !this.buffers.size) this.options.onError?.('Не удалось загрузить голос «' + profile.name + '». Можно повторить загрузку звука.');
      return !this.disposed && this.profile === profile && this.buffers.size > 0;
    });
    return this.ready;
  }
  retry() { const profile = this.profile; this.profile = null; this.prepare(profile); }
  private random() { return Math.max(0, Math.min(.999999, (this.options.random ?? Math.random)())); }
  pulse(text: string, volume: number) {
    const profile = this.profile;
    if (this.disposed || !profile || this.context.state !== 'running' || !Number.isFinite(volume) || volume <= 0) return;
    const ready = profile.samples.filter(sample => this.buffers.has(sample.url)); if (!ready.length) return;
    const now = this.context.currentTime;
    if (!this.cadence.pulse(text, now, profile.intervalSeconds)) return;
    const choices = ready.length > 1 ? ready.filter(sample => sample.url !== this.lastSample) : ready;
    const sample = choices[Math.floor(this.random() * choices.length)], buffer = this.buffers.get(sample.url)!;
    this.lastSample = sample.url;
    while (this.sources.size >= 2) this.release(this.sources.values().next().value!);
    const source = this.context.createBufferSource(), gain = this.context.createGain(), entry = { source, gain, stopping: false };
    const rate = profile.rate * 2 ** ((this.random() * 2 - 1) * profile.pitchVariation / 12);
    const amplitude = .75 * Math.min(1, volume * (1 - profile.volumeVariation + this.random() * profile.volumeVariation * 2));
    const duration = Math.min(.22, buffer.duration / rate), offset = Math.max(0, Math.min(buffer.duration - duration * rate, this.random() * .025));
    source.buffer = buffer; source.playbackRate.value = rate; source.connect(gain); gain.connect(this.output);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(amplitude, now + Math.min(.005, duration / 4));
    gain.gain.setValueAtTime(amplitude, now + Math.max(duration / 2, duration - .012)); gain.gain.linearRampToValueAtTime(0, now + duration);
    this.sources.add(entry); source.onended = () => this.release(entry, false);
    source.start(now, offset, duration * rate);
  }
  private release(entry: Source, stop = true) {
    this.sources.delete(entry); entry.source.onended = null;
    if (stop) { try { entry.source.stop(); } catch {} }
    entry.source.disconnect(); entry.gain.disconnect();
  }
  stop(immediate = false) {
    this.cadence.reset();
    for (const entry of this.sources) {
      if (immediate || this.context.state !== 'running') this.release(entry);
      else if (!entry.stopping) {
        entry.stopping = true; const now = this.context.currentTime;
        entry.gain.gain.cancelScheduledValues(now); entry.gain.gain.setValueAtTime(entry.gain.gain.value, now); entry.gain.gain.linearRampToValueAtTime(0, now + .008);
        try { entry.source.stop(now + .01); } catch { this.release(entry); }
      }
    }
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.stop(true); for (const lease of this.leases.values()) lease.release(); this.leases.clear(); this.buffers.clear(); this.pool.dispose(); }
}
