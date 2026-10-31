export type ResourceLease<T> = { promise: Promise<T>; release: () => void };
type Entry<T> = { key: string; promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void; abort: AbortController; refs: number; prefetch: boolean; started: boolean; settled: boolean; value?: T; bytes: number };
type Options<T> = { load: (key: string, signal: AbortSignal) => Promise<T>; bytes: (value: T) => number; dispose: (value: T) => void; idleCount?: number; idleBytes?: number; concurrency?: number };

export class ResourcePool<T> {
  private entries = new Map<string, Entry<T>>();
  private queue: Entry<T>[] = [];
  private running = 0;
  private disposed = false;
  constructor(private options: Options<T>) {}

  acquire(key: string): ResourceLease<T> {
    const entry = this.entry(key); entry.refs++; this.touch(entry);
    if (!entry.started) { this.queue = [entry, ...this.queue.filter(job => job !== entry)]; this.drain(); }
    let released = false;
    return { promise: entry.promise, release: () => { if (released) return; released = true; entry.refs--; if (!entry.refs && !entry.prefetch && !entry.settled) this.remove(entry); this.trim(); } };
  }

  preload(keys: readonly string[]) {
    if (this.disposed) return;
    const wanted = new Set(keys.slice(0, this.options.idleCount ?? 8));
    for (const entry of this.entries.values()) {
      entry.prefetch = wanted.has(entry.key);
      if (!entry.refs && !entry.prefetch && !entry.settled) this.remove(entry);
    }
    for (const key of wanted) this.entry(key).prefetch = true;
    this.trim();
  }

  private touch(entry: Entry<T>) { if (this.entries.get(entry.key) === entry) { this.entries.delete(entry.key); this.entries.set(entry.key, entry); } }
  private entry(key: string) {
    if (this.disposed) throw new DOMException('Проигрыватель закрыт', 'AbortError');
    const existing = this.entries.get(key); if (existing) return existing;
    let resolve!: Entry<T>['resolve'], reject!: Entry<T>['reject'];
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    void promise.catch(() => {});
    const entry: Entry<T> = { key, promise, resolve, reject, abort: new AbortController(), refs: 0, prefetch: false, started: false, settled: false, bytes: 0 };
    this.entries.set(key, entry); this.queue.push(entry); this.drain(); return entry;
  }

  private drain() {
    if (this.disposed) return;
    while (this.running < (this.options.concurrency ?? 4) && this.queue.length) {
      const entry = this.queue.shift()!;
      if (this.entries.get(entry.key) !== entry) continue;
      entry.started = true; this.running++;
      void Promise.resolve().then(() => { entry.abort.signal.throwIfAborted(); return this.options.load(entry.key, entry.abort.signal); }).then(value => {
        if (this.disposed || this.entries.get(entry.key) !== entry || entry.abort.signal.aborted) { this.options.dispose(value); throw new DOMException('Загрузка отменена', 'AbortError'); }
        entry.value = value; entry.bytes = Math.max(0, this.options.bytes(value)); entry.settled = true; entry.resolve(value); this.trim();
      }).catch(cause => { if (this.entries.get(entry.key) === entry) this.remove(entry, cause); entry.reject(cause); }).finally(() => { this.running--; this.drain(); });
    }
  }

  private remove(entry: Entry<T>, cause: unknown = new DOMException('Загрузка отменена', 'AbortError')) {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key); entry.abort.abort();
    if (entry.settled && entry.value !== undefined) this.options.dispose(entry.value);
    else entry.reject(cause);
    if (!entry.started) this.queue = this.queue.filter(job => job !== entry);
  }
  private trim() {
    const idle = [...this.entries.values()].filter(entry => entry.settled && !entry.refs);
    let bytes = idle.reduce((sum, entry) => sum + entry.bytes, 0), count = idle.length;
    for (const entry of idle) {
      if (count <= (this.options.idleCount ?? 8) && bytes <= (this.options.idleBytes ?? 32 * 1024 * 1024)) break;
      this.remove(entry); count--; bytes -= entry.bytes;
    }
  }
  stats() { const entries = [...this.entries.values()]; return { entries: entries.length, active: entries.filter(e => e.refs > 0).length, idle: entries.filter(e => e.settled && !e.refs).length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0), loading: this.running, queued: this.queue.length }; }
  dispose() { if (this.disposed) return; this.disposed = true; for (const entry of this.entries.values()) this.remove(entry); this.queue = []; }
}
