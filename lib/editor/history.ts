export class DraftHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastGroup: string | undefined;
  private lastTime = 0;
  constructor(private limit = 40) {}

  record(previous: T, next: T, group?: string, now = Date.now()) {
    if (previous === next || JSON.stringify(previous) === JSON.stringify(next)) return false;
    if (!group || group !== this.lastGroup || now - this.lastTime > 750) {
      this.past.push(structuredClone(previous));
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = []; this.lastGroup = group; this.lastTime = now; return true;
  }
  undo(current: T) {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(structuredClone(current)); this.breakGroup();
    return structuredClone(previous);
  }
  redo(current: T) {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(structuredClone(current)); this.breakGroup();
    return structuredClone(next);
  }
  breakGroup() { this.lastGroup = undefined; this.lastTime = 0; }
  clear() { this.past = []; this.future = []; this.breakGroup(); }
  status() { return { canUndo: this.past.length > 0, canRedo: this.future.length > 0 }; }
}
