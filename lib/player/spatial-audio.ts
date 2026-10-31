import { effectPosition, type EffectPose, type ObjectEffect, type SpatialSoundSettings } from '../engine/object-effects';
import type { ResourceLease } from './resource-pool';

type Nodes = { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode; volume: number | null };
type Channel = { id: string; name: string; settings: SpatialSoundSettings; position: [number, number, number]; resource: ResourceLease<AudioBuffer> | null; buffer: AudioBuffer | null; nodes: Nodes | null; offset: number; startedAt: number; active: boolean; failed: boolean; ended: boolean };
type Options = { acquire: (id: string) => ResourceLease<AudioBuffer>; onError?: (message: string) => void };
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - b[i]));

export class SpatialObjectAudio {
  private channels = new Map<string, Channel>();
  private nodes = new Set<Nodes>();
  private paused = true;
  private disposed = false;
  constructor(private context: AudioContext, private output: AudioNode, private options: Options) {}
  update(effects: ObjectEffect[], pose: EffectPose) {
    if (this.disposed) return;
    const sounds = effects.filter(effect => effect.sound?.assetId).map(effect => ({ effect, position: effectPosition(effect, effect.sound!.offset, pose) }));
    if (sounds.length) this.listener(pose);
    const audible = new Set(sounds.filter(({ effect, position }) => effect.sound!.volume > 0 && distance(position, pose.position) < effect.sound!.far).sort((a, b) => distance(a.position, pose.position) - distance(b.position, pose.position)).slice(0, 8).map(({ effect }) => effect.id));
    const present = new Set(sounds.map(({ effect }) => effect.id));
    for (const [id, channel] of this.channels) if (!present.has(id)) { this.discard(channel); this.channels.delete(id); }
    for (const { effect, position } of sounds) {
      const settings = effect.sound!; let channel = this.channels.get(effect.id);
      if (channel && channel.settings.assetId !== settings.assetId) { this.discard(channel); this.channels.delete(effect.id); channel = undefined; }
      if (!channel) { channel = { id: effect.id, name: effect.name, settings, position, resource: null, buffer: null, nodes: null, offset: 0, startedAt: 0, active: false, failed: false, ended: false }; this.channels.set(effect.id, channel); }
      if (!channel.settings.loop && settings.loop && channel.ended) { channel.ended = false; channel.offset = 0; }
      channel.settings = settings; channel.position = position; channel.active = audible.has(effect.id);
      if (channel.nodes) this.configure(channel);
      if (!channel.active) { this.stop(channel); this.releaseBuffer(channel); }
      else this.play(channel);
    }
  }
  setPaused(paused: boolean) { this.paused = paused; for (const channel of this.channels.values()) this.play(channel); }
  private listener(pose: EffectPose) {
    const listener = this.context.listener, now = this.context.currentTime;
    if (!listener) return;
    const sin = Math.sin(pose.yaw), cos = Math.cos(pose.yaw), tilt = Math.sin(pose.pitch), flat = Math.cos(pose.pitch);
    const forward = [-sin * flat, tilt, -cos * flat], up = [sin * tilt, flat, cos * tilt];
    if (listener.positionX) {
      [listener.positionX, listener.positionY, listener.positionZ].forEach((param, i) => { if (param.value !== pose.position[i]) param.setValueAtTime(pose.position[i], now); });
      [listener.forwardX, listener.forwardY, listener.forwardZ].forEach((param, i) => { if (param.value !== forward[i]) param.setValueAtTime(forward[i], now); });
      [listener.upX, listener.upY, listener.upZ].forEach((param, i) => { if (param.value !== up[i]) param.setValueAtTime(up[i], now); });
    } else { listener.setPosition(...pose.position); listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]); }
  }
  private configure(channel: Channel) {
    const nodes = channel.nodes; if (!nodes) return;
    nodes.panner.distanceModel = 'linear'; nodes.panner.refDistance = channel.settings.near; nodes.panner.maxDistance = channel.settings.far; nodes.panner.rolloffFactor = 1;
    nodes.source.loop = channel.settings.loop;
    if (nodes.panner.positionX) [nodes.panner.positionX, nodes.panner.positionY, nodes.panner.positionZ].forEach((param, i) => { if (param.value !== channel.position[i]) param.setValueAtTime(channel.position[i], this.context.currentTime); });
    else nodes.panner.setPosition(...channel.position);
    if (nodes.volume !== channel.settings.volume) { nodes.gain.gain.setTargetAtTime(channel.settings.volume, this.context.currentTime, .025); nodes.volume = channel.settings.volume; }
  }
  private play(channel: Channel) {
    if (this.disposed || this.paused || this.context.state !== 'running' || !channel.active) { this.stop(channel); return; }
    if (channel.nodes || channel.failed || channel.ended) return;
    if (!channel.buffer) {
      if (channel.resource) return;
      const lease = this.options.acquire(channel.settings.assetId!); channel.resource = lease;
      void lease.promise.then(buffer => {
        if (this.disposed || this.channels.get(channel.id) !== channel || channel.resource !== lease) return;
        channel.buffer = buffer; this.play(channel);
      }).catch(cause => {
        if (this.disposed || this.channels.get(channel.id) !== channel || channel.resource !== lease) return;
        this.releaseBuffer(channel); channel.failed = true; this.options.onError?.('Не удалось загрузить звук объекта «' + channel.name + '»: ' + (cause instanceof Error ? cause.message : 'ошибка звука'));
      });
      return;
    }
    if (!channel.settings.loop && channel.offset >= channel.buffer.duration) { channel.ended = true; this.releaseBuffer(channel); return; }
    const source = this.context.createBufferSource(), gain = this.context.createGain(), panner = this.context.createPanner(), nodes: Nodes = { source, gain, panner, volume: null };
    source.buffer = channel.buffer; panner.panningModel = 'HRTF'; gain.gain.setValueAtTime(0, this.context.currentTime);
    source.connect(panner); panner.connect(gain); gain.connect(this.output); channel.nodes = nodes; this.nodes.add(nodes); this.configure(channel); channel.startedAt = this.context.currentTime;
    source.onended = () => { if (channel.nodes === nodes) { channel.nodes = null; channel.ended = true; channel.offset = channel.buffer?.duration ?? channel.offset; this.releaseBuffer(channel); } this.cleanup(nodes); };
    source.start(0, channel.settings.loop ? channel.offset % channel.buffer.duration : channel.offset);
  }
  private stop(channel: Channel, immediate = false) {
    const nodes = channel.nodes; if (!nodes) return;
    const duration = channel.buffer?.duration, position = channel.offset + Math.max(0, this.context.currentTime - channel.startedAt);
    channel.offset = duration ? channel.settings.loop ? position % duration : Math.min(position, duration) : position; channel.nodes = null;
    if (immediate || this.context.state !== 'running') { try { nodes.source.stop(); } catch {} this.cleanup(nodes); }
    else { const now = this.context.currentTime; nodes.gain.gain.cancelScheduledValues(now); nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now); nodes.gain.gain.linearRampToValueAtTime(0, now + .02); try { nodes.source.stop(now + .025); } catch { this.cleanup(nodes); } }
  }
  private cleanup(nodes: Nodes) { if (!this.nodes.delete(nodes)) return; nodes.source.onended = null; nodes.source.disconnect(); nodes.gain.disconnect(); nodes.panner.disconnect(); }
  private releaseBuffer(channel: Channel) { channel.resource?.release(); channel.resource = null; channel.buffer = null; }
  private discard(channel: Channel) { this.stop(channel); this.releaseBuffer(channel); }
  retry() { for (const channel of this.channels.values()) { channel.failed = false; this.play(channel); } }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const channel of this.channels.values()) { this.stop(channel, true); this.releaseBuffer(channel); }
    for (const nodes of [...this.nodes]) { try { nodes.source.stop(); } catch {} this.cleanup(nodes); }
    this.channels.clear();
  }
}
