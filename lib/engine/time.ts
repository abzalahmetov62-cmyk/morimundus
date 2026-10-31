import type { Project } from './project';
import type { GameState } from './game-state';
import { finishRecipe } from './item-interactions';

export function formatWorldTime(seconds: number) {
  const day = Math.floor(seconds / 86400) + 1, time = Math.floor(seconds % 86400);
  return 'День ' + day + ' · ' + String(Math.floor(time / 3600)).padStart(2, '0') + ':' + String(Math.floor(time / 60) % 60).padStart(2, '0');
}

export function startTimer(project: Project, state: GameState, timerId: string) {
  const timer = project.timers.find(t => t.id === timerId);
  if (!timer) throw new Error('Таймер не найден');
  state.timers = state.timers.filter(t => t.id !== timerId);
  state.timers.push({ id: timer.id, remainingSeconds: timer.durationSeconds, ruleId: timer.ruleId });
}

export function advanceClock(project: Project, state: GameState, seconds: number, onTimer: (ruleId: string) => void, options: { stopWhenPaused?: boolean; realSecondsPerWorldSecond?: number; budget?: { remaining: number } } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0 || state.clock.worldSeconds + seconds > Number.MAX_SAFE_INTEGER) throw new Error('Неверное или слишком большое время');
  const budget = options.budget ?? { remaining: 1000 };
  let remaining = seconds;
  while (remaining > 0 || state.timers.some(t => t.remainingSeconds === 0)) {
    const nearest = Math.min(remaining, ...state.timers.map(t => t.remainingSeconds));
    state.clock.worldSeconds += nearest;
    if (options.realSecondsPerWorldSecond) state.clock.playedSeconds += nearest * options.realSecondsPerWorldSecond;
    remaining = Math.max(0, remaining - nearest);
    for (const timer of state.timers) timer.remainingSeconds = Math.max(0, timer.remainingSeconds - nearest);
    const due = state.timers.filter(t => t.remainingSeconds === 0);
    for (const timer of due) {
      if (!state.timers.includes(timer)) continue;
      if (--budget.remaining < 0) throw new Error('Слишком длинная цепочка событий времени');
      state.timers = state.timers.filter(t => t !== timer);
      const cooking = Object.entries(state.cooking).find(([, c]) => c.timerId === timer.id);
      if (cooking) finishRecipe(project, state, cooking[0]);
      else if (timer.ruleId) onTimer(timer.ruleId);
    }
    if (options.stopWhenPaused && state.clock.pausedBy.length) break;
    if (!nearest && !due.length) break;
  }
}
