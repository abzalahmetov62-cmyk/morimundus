import type { Project } from '../engine/project';
import type { GameState } from '../engine/game-state';
import { createSavedGame, emptySlot, projectFingerprint, restoreSavedGame, SAVE_SLOTS, summarizeSave, type SaveSlot, type SlotSummary } from '../engine/save-game';
import { saveTransport, type SaveTransport, type SaveTransportFactory } from '../storage/saves-client';

export type SaveStatus = { ready: boolean; busy: boolean; blocked: boolean; error: string; slots: SlotSummary[] };
type Checkpoint = { state: GameState; marker: number };
export class PlayerSaves {
  private status: SaveStatus = { ready: false, busy: false, blocked: false, error: '', slots: SAVE_SLOTS.map(s => emptySlot(s)) };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private transport: SaveTransport;
  private fingerprint = '';
  private activeSession: string | null = null;
  private pending: Checkpoint | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private disposed = false;
  private lastStoredMarker = -1;

  constructor(readonly project: Project, readonly projectRevision: number, transport?: SaveTransport | SaveTransportFactory) { this.transport = typeof transport === 'function' ? transport(this.lifetime.signal) : transport ?? saveTransport(this.lifetime.signal); }
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SaveStatus>) { if (this.disposed) return; this.status = { ...this.status, ...patch }; this.listeners.forEach(fn => fn()); }
  private clearPending() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null; }
  private slot(slot: SaveSlot) { return this.status.slots.find(s => s.slot === slot)!; }
  private replace(slot: SlotSummary) { this.publish({ slots: this.status.slots.map(s => s.slot === slot.slot ? slot : s) }); }
  compatible(slot: SlotSummary) { return slot.occupied && slot.health === 'valid' && !!this.fingerprint && slot.projectFingerprint === this.fingerprint; }
  async initialize() {
    if (this.status.busy) throw new Error('Дождитесь завершения записи');
    this.clearPending(); this.publish({ busy: true, error: '' });
    try { const [slots, fingerprint] = await Promise.all([this.transport.list(), projectFingerprint(this.project)]); this.fingerprint = fingerprint; this.publish({ slots, ready: true }); }
    catch (cause) { this.publish({ error: cause instanceof Error ? cause.message : 'Не удалось открыть сохранения' }); throw cause; }
    finally { this.publish({ busy: false }); }
  }
  activate(sessionId: string, storedMarker = -1) { this.clearPending(); this.activeSession = sessionId; this.lastStoredMarker = storedMarker; }
  suspend() { this.clearPending(); this.activeSession = null; }
  hasUnsaved(sessionId: string, marker: number) { return this.activeSession === sessionId && (this.status.busy || this.lastStoredMarker !== marker); }
  requestAuto(state: GameState, marker: number, immediate = false) {
    if (this.disposed || !this.status.ready || this.status.blocked || state.id !== this.activeSession) return;
    this.pending = { state: structuredClone(state), marker };
    if (this.writing) return;
    if (this.timer) clearTimeout(this.timer);
    if (immediate) this.drain();
    else this.timer = setTimeout(() => { this.timer = null; this.drain(); }, 350);
  }
  private drain() {
    if (this.writing || this.status.blocked || !this.pending) return;
    const point = this.pending; this.pending = null;
    if (point.state.id === this.activeSession) void this.write('auto', point).catch(() => {});
  }
  private write(slot: SaveSlot, point: Checkpoint) {
    if (this.writing || this.status.busy) return Promise.reject(new Error('Дождитесь завершения записи'));
    if (!this.status.ready || this.disposed || point.state.id !== this.activeSession) return Promise.reject(new Error('Сохранение сейчас недоступно'));
    const expectedRevision = this.slot(slot).revision;
    this.publish({ busy: true, error: '' });
    const task = (async () => {
      try {
        const payload = await createSavedGame(this.project, this.projectRevision, point.state, this.fingerprint);
        const document = await this.transport.write(slot, { ...payload, expectedRevision });
        if (document.slot !== slot || document.revision !== expectedRevision + 1 || document.checksum !== payload.checksum) throw new Error('Ответ записи сохранения повреждён');
        await restoreSavedGame(document.save, document.checksum, this.project, this.projectRevision, this.fingerprint);
        this.replace(summarizeSave(document, this.project));
        if (this.activeSession === point.state.id) this.lastStoredMarker = point.marker;
      } catch (cause) { this.clearPending(); this.publish({ blocked: true, error: cause instanceof Error ? cause.message : 'Прохождение не сохранено. Попробуйте ещё раз.' }); throw cause; }
      finally { this.writing = null; this.publish({ busy: false }); if (!this.disposed) this.drain(); }
    })();
    this.writing = task;
    return task;
  }
  async save(slot: SaveSlot, state: GameState, marker: number) {
    this.clearPending(); await this.waitIdle();
    return this.write(slot, { state: structuredClone(state), marker });
  }
  async flush(state: GameState, marker: number) {
    this.clearPending(); await this.waitIdle();
    if (this.status.blocked) throw new Error(this.status.error || 'Автосохранение остановлено. Сначала восстановите запись в меню сохранений.');
    await this.write('auto', { state: structuredClone(state), marker });
  }
  async waitIdle() { while (this.writing) await this.writing.catch(() => {}); }
  async load(slot: SaveSlot) {
    this.suspend(); await this.waitIdle(); this.publish({ busy: true, error: '' });
    try {
      const document = await this.transport.read(slot);
      if (document.slot !== slot) throw new Error('Ответ относится к другому слоту');
      const state = await restoreSavedGame(document.save, document.checksum, this.project, this.projectRevision, this.fingerprint);
      this.replace(summarizeSave(document, this.project)); this.publish({ blocked: false });
      return state;
    } catch (cause) { this.publish({ error: cause instanceof Error ? cause.message : 'Не удалось загрузить прохождение' }); throw cause; }
    finally { this.publish({ busy: false }); }
  }
  async remove(slot: SaveSlot) {
    this.clearPending(); await this.waitIdle(); this.publish({ busy: true, error: '' });
    try { const summary = await this.transport.remove(slot, this.slot(slot).revision); if (summary.slot !== slot) throw new Error('Ответ относится к другому слоту'); this.replace(summary); if (slot === 'auto') this.lastStoredMarker = -1; }
    catch (cause) { this.publish({ error: cause instanceof Error ? cause.message : 'Не удалось удалить сохранение', blocked: true }); throw cause; }
    finally { this.publish({ busy: false }); }
  }
  async retryAuto(state: GameState, marker: number) { await this.waitIdle(); await this.initialize(); this.publish({ blocked: false }); await this.save('auto', state, marker); }
  enableAuto() { this.publish({ blocked: false, error: '' }); }
  dispose() { this.suspend(); this.disposed = true; this.lifetime.abort(); this.listeners.clear(); }
}
